import { pageCheck, pass, skip, fail, info, result, plural, trunc } from './helpers.js';
import { typesOf } from '../extract.js';

const C = 'schema';

const LOCAL_TYPES = new Set(['LocalBusiness', 'ProfessionalService', 'Store', 'Restaurant', 'Dentist', 'Physician', 'LegalService',
  'Attorney', 'Notary', 'AutomotiveBusiness', 'AutoRepair', 'AutoDealer', 'HomeAndConstructionBusiness', 'Plumber', 'Electrician',
  'Locksmith', 'RoofingContractor', 'HVACBusiness', 'GeneralContractor', 'HousePainter', 'MovingCompany', 'HealthAndBeautyBusiness',
  'BeautySalon', 'HairSalon', 'DaySpa', 'NailSalon', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub', 'FastFoodRestaurant',
  'LodgingBusiness', 'Hotel', 'BedAndBreakfast', 'Hostel', 'Resort', 'MedicalBusiness', 'MedicalClinic', 'Optician', 'Pharmacy',
  'FinancialService', 'AccountingService', 'InsuranceAgency', 'RealEstateAgent', 'SportsActivityLocation', 'ExerciseGym',
  'EntertainmentBusiness', 'EmergencyService', 'ChildCare', 'DryCleaningOrLaundry', 'EmploymentAgency', 'TravelAgency',
  'SelfStorage', 'ShoppingCenter', 'AnimalShelter', 'VeterinaryCare', 'Florist', 'ClothingStore', 'ElectronicsStore',
  'FurnitureStore', 'HardwareStore', 'GroceryStore', 'JewelryStore', 'PetStore', 'BookStore', 'BikeStore', 'Winery', 'Brewery']);
const ORG_TYPES = new Set(['Organization', 'Corporation', 'NGO', 'EducationalOrganization', 'GovernmentOrganization', 'MedicalOrganization',
  'NewsMediaOrganization', 'OnlineBusiness', 'OnlineStore', 'SportsOrganization', 'PerformingGroup', ...LOCAL_TYPES]);

export const isLocalType = t => LOCAL_TYPES.has(t);
export const isOrgType = t => ORG_TYPES.has(t);

/** Properties Google's rich-result documentation lists as required; each inner
 *  array is satisfied by any one of its keys. */
const REQUIRED = {
  Product: [['name'], ['offers', 'review', 'aggregateRating']],
  Event: [['name'], ['startDate'], ['location']],
  Recipe: [['name'], ['image']],
  JobPosting: [['title'], ['description'], ['datePosted'], ['hiringOrganization'], ['jobLocation', 'jobLocationType']],
  VideoObject: [['name'], ['thumbnailUrl'], ['uploadDate']],
  BreadcrumbList: [['itemListElement']],
  FAQPage: [['mainEntity']],
  Course: [['name'], ['description']],
  SoftwareApplication: [['name'], ['offers', 'aggregateRating', 'review']],
};
const RECOMMENDED = {
  Article: ['headline', 'image', 'datePublished', 'author'], NewsArticle: ['headline', 'image', 'datePublished', 'author'],
  BlogPosting: ['headline', 'image', 'datePublished', 'author'],
  Organization: ['name', 'url', 'logo'],
  WebSite: ['name', 'url'],
};
const has = (node, key) => {
  const v = node[key];
  return v != null && v !== '' && !(Array.isArray(v) && !v.length);
};

function missingRequired(node) {
  const out = [];
  for (const t of typesOf(node)) {
    const req = REQUIRED[t] || (isLocalType(t) ? [['name'], ['address']] : null);
    if (req) for (const group of req) if (!group.some(k => has(node, k))) out.push(`${t}: ${group.join(' or ')}`);
    if (t === 'FAQPage' && has(node, 'mainEntity')) {
      const qs = [].concat(node.mainEntity);
      if (qs.some(q => !q?.name || !(q.acceptedAnswer?.text || [].concat(q.acceptedAnswer || [])[0]?.text))) out.push('FAQPage: every Question needs name and acceptedAnswer.text');
    }
    if (t === 'BreadcrumbList' && has(node, 'itemListElement')) {
      const items = [].concat(node.itemListElement);
      if (items.some(i => i?.position == null || !(i.name || i.item?.name))) out.push('BreadcrumbList: each item needs position and name');
    }
  }
  return out;
}

export const schemaChecks = [

  function jsonLdErrors({ pages }) {
    const def = { id: 'schema.jsonld-errors', category: C, title: 'Structured data is valid JSON', weight: 8,
      fix: 'Fix the JSON syntax in these <script type="application/ld+json"> blocks (often a trailing comma or unescaped quote). Google ignores invalid blocks entirely.' };
    return pageCheck(def, pages.filter(p => p.jsonLdBlocks), p => p.jsonLdErrors.length && p.jsonLdErrors.map(e => `${e.error} near "${trunc(e.snippet, 40)}"`).join('; '),
      { severity: 'critical', passMessage: 'All JSON-LD blocks parse correctly.' });
  },

  function homepageMarkup({ home }) {
    const def = { id: 'schema.homepage', category: C, title: 'Homepage has structured data', weight: 6,
      fix: 'Add JSON-LD describing your business (Organization or LocalBusiness) and website to the homepage — see the Fixes tab for a starter.' };
    if (!home) return skip(def, 'Homepage not analysed.');
    const types = [...home.schemaTypes, ...home.microdataTypes];
    return types.length ? pass(def, `Homepage declares: ${types.slice(0, 8).join(', ')}.`)
      : fail(def, 'warning', 'The homepage has no structured data, so Google has to guess what your business is.');
  },

  function organization({ home, pages }) {
    const def = { id: 'schema.organization', category: C, title: 'Business identity markup (Organization/LocalBusiness)', weight: 4,
      fix: 'Add Organization or LocalBusiness JSON-LD with name, url, logo, contact details and sameAs links to your social profiles.' };
    const all = pages.flatMap(p => p.schemaNodes);
    const org = all.find(n => typesOf(n).some(isOrgType));
    if (!org) return fail(def, 'warning', 'No Organization or LocalBusiness markup on any crawled page.');
    const missing = RECOMMENDED.Organization.filter(k => !has(org, k));
    const where = home?.schemaNodes.includes(org) ? 'homepage' : 'site';
    if (!missing.length) return pass(def, `${typesOf(org).join('/')} markup found on the ${where} with name, url and logo.`);
    return result(def, { status: 'warning', score: 0.6, message: `${typesOf(org).join('/')} markup found but missing recommended: ${missing.join(', ')}.` });
  },

  function requiredProperties({ pages }) {
    const def = { id: 'schema.required-properties', category: C, title: 'Rich-result markup has required properties', weight: 6,
      fix: 'Add the missing properties listed. Without them Google won\'t show rich results (stars, FAQs, breadcrumbs, prices) for the page.' };
    const withRich = pages.filter(p => p.schemaRoots.some(n => typesOf(n).some(t => REQUIRED[t] || isLocalType(t))));
    if (!withRich.length) return skip(def, 'No rich-result types (Product, FAQ, Breadcrumb, Event, LocalBusiness…) found.');
    const r = pageCheck(def, withRich, p => {
      const miss = [...new Set(p.schemaRoots.flatMap(missingRequired))];
      return miss.length && `Missing ${miss.slice(0, 4).join('; ')}`;
    }, { passMessage: `Required properties present on all ${withRich.length} pages with rich-result markup.` });
    r.message += ' (Checked against Google\'s documented required properties — use Google\'s Rich Results Test for full validation.)';
    return r;
  },

  function articleProperties({ pages }) {
    const def = { id: 'schema.article', category: C, title: 'Article markup is complete', weight: 0,
      fix: 'Add headline, image, datePublished and author to Article/BlogPosting markup.' };
    const withArticles = pages.filter(p => p.schemaNodes.some(n => typesOf(n).some(t => RECOMMENDED[t] && /Article|BlogPosting/.test(t))));
    if (!withArticles.length) return skip(def, 'No Article or BlogPosting markup found.');
    const r = pageCheck(def, withArticles, p => {
      const node = p.schemaNodes.find(n => typesOf(n).some(t => /Article|BlogPosting/.test(t)));
      const t = typesOf(node).find(t => RECOMMENDED[t]);
      const miss = RECOMMENDED[t].filter(k => !has(node, k));
      return miss.length && `${t} missing ${miss.join(', ')}`;
    }, { passMessage: 'Article markup includes the recommended properties.' });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },

  function openGraph({ indexable }) {
    const def = { id: 'schema.open-graph', category: C, title: 'Open Graph tags for social sharing', weight: 3,
      fix: 'Add og:title, og:description and og:image (1200×630px) so links shared on WhatsApp, Facebook and LinkedIn show a proper preview.' };
    return pageCheck(def, indexable, p => {
      const miss = ['title', 'description', 'image'].filter(k => !p.og[k]);
      return miss.length && `Missing og:${miss.join(', og:')}`;
    }, { passMessage: 'Every page has Open Graph title, description and image.' });
  },

  function twitterCard({ indexable }) {
    const def = { id: 'schema.twitter-card', category: C, title: 'Twitter/X card tag', weight: 0,
      fix: 'Add <meta name="twitter:card" content="summary_large_image"> for large link previews on X.' };
    const r = pageCheck(def, indexable, p => !p.twitterCard && 'No twitter:card', { passMessage: 'Twitter card tags present.' });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },

  function breadcrumbs({ indexable }) {
    const def = { id: 'schema.breadcrumbs', category: C, title: 'Breadcrumb markup on deeper pages', weight: 0,
      fix: 'Add BreadcrumbList JSON-LD to pages two or more levels deep so Google can show the page\'s place in your site.' };
    const deep = indexable.filter(p => new URL(p.finalUrl).pathname.split('/').filter(Boolean).length >= 2);
    if (!deep.length) return skip(def, 'No pages two or more levels deep.');
    const r = pageCheck(def, deep, p => !p.schemaTypes.includes('BreadcrumbList') && !p.microdataTypes.includes('BreadcrumbList') && 'No BreadcrumbList',
      { passMessage: 'Deeper pages have breadcrumb markup.' });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },

  function coverage({ indexable }) {
    const def = { id: 'schema.coverage', category: C, title: 'Structured data coverage', weight: 0, fix: '' };
    const none = indexable.filter(p => !p.schemaTypes.length && !p.microdataTypes.length);
    const types = [...new Set(indexable.flatMap(p => [...p.schemaTypes, ...p.microdataTypes]))];
    return info(def, `${indexable.length - none.length} of ${indexable.length} pages have structured data. Types found: ${types.length ? types.join(', ') : 'none'}.`,
      { affected: none.map(p => ({ url: p.finalUrl, detail: 'No structured data' })) });
  },
];

import { pass, skip, fail, info, result, plural } from './helpers.js';
import { typesOf } from '../extract.js';
import { isLocalType } from './schema.js';

const C = 'local';
const digits = s => String(s || '').replace(/\D/g, '');
const tail9 = s => digits(s).slice(-9);

function localNode(pages, home) {
  const nodes = [...(home?.schemaNodes || []), ...pages.flatMap(p => p.schemaNodes)];
  return nodes.find(n => typesOf(n).some(isLocalType)) || null;
}
const addressOf = node => {
  const a = node && [].concat(node.address || [])[0];
  return a && typeof a === 'object' ? a : null;
};

export const localChecks = [

  function businessSchema({ pages, home }) {
    const def = { id: 'local.business-schema', category: C, title: 'LocalBusiness markup', weight: 8,
      fix: 'Add LocalBusiness JSON-LD (or a more specific type like Plumber or Dentist) with your name, address, phone, opening hours and map coordinates. The Fixes tab has a pre-filled starter.' };
    const node = localNode(pages, home);
    return node ? pass(def, `Found ${typesOf(node).join('/')} markup${node.name ? ` for "${node.name}"` : ''}.`)
      : fail(def, 'warning', 'No LocalBusiness markup found. It\'s the clearest way to tell Google where you are and when you\'re open.');
  },

  function businessDetails({ pages, home }) {
    const def = { id: 'local.business-details', category: C, title: 'LocalBusiness markup is complete', weight: 5,
      fix: 'Complete the LocalBusiness markup: name, full PostalAddress, telephone, openingHoursSpecification, geo coordinates, url and image.' };
    const node = localNode(pages, home);
    if (!node) return skip(def, 'No LocalBusiness markup to check.');
    const addr = addressOf(node);
    // Service-area businesses (no storefront) are told by Google to hide their street
    // address, so a town plus a declared service area counts as a complete address.
    const serviceArea = !addr?.streetAddress && !!addr?.addressLocality && !!node.areaServed;
    const required = { name: !!node.name, address: !!(addr?.streetAddress || typeof node.address === 'string' || serviceArea), telephone: !!node.telephone };
    const recommended = {
      openingHours: !!(node.openingHoursSpecification || node.openingHours), geo: !!node.geo, url: !!node.url,
      image: !!(node.image || node.logo), 'address.addressLocality': !!addr?.addressLocality, 'address.postalCode': !!addr?.postalCode,
    };
    if (serviceArea) { delete recommended.geo; delete recommended['address.postalCode']; } // only meaningful for a visitable location
    const missReq = Object.keys(required).filter(k => !required[k]);
    const missRec = Object.keys(recommended).filter(k => !recommended[k]);
    if (!missReq.length && !missRec.length) return pass(def, 'Name, address, phone, hours, coordinates, url and image are all present.');
    const score = (Object.values(required).filter(Boolean).length * 2 + Object.values(recommended).filter(Boolean).length) / (3 * 2 + Object.keys(recommended).length);
    return result(def, { status: missReq.length ? 'warning' : 'info', score,
      message: [missReq.length && `Missing key details: ${missReq.join(', ')}.`, missRec.length && `Missing recommended: ${missRec.join(', ')}.`].filter(Boolean).join(' ') });
  },

  function phoneVisible({ pages }) {
    const def = { id: 'local.phone', category: C, title: 'Phone number is on the site', weight: 5,
      fix: 'Show your phone number in the header or footer of every page, as text (not only in an image).' };
    const withPhone = pages.filter(p => p.phones.length || p.telLinks.length);
    if (!withPhone.length) return fail(def, 'warning', 'No phone number found in the text of any crawled page.');
    const share = withPhone.length / pages.length;
    return share >= 0.8 ? pass(def, `A phone number appears on ${withPhone.length} of ${pages.length} pages.`)
      : result(def, { status: 'warning', score: share, message: `A phone number appears on only ${withPhone.length} of ${pages.length} pages. Put it in the site-wide header or footer.`,
        affected: pages.filter(p => !withPhone.includes(p)).map(p => ({ url: p.finalUrl, detail: 'No phone number' })) });
  },

  function clickToCall({ pages }) {
    const def = { id: 'local.click-to-call', category: C, title: 'Phone number is tappable', weight: 2,
      fix: 'Wrap the phone number in a link: <a href="tel:+27821234567">082 123 4567</a>, so mobile visitors can call with one tap.' };
    return pages.some(p => p.telLinks.length) ? pass(def, 'tel: links found.')
      : fail(def, 'warning', 'No tap-to-call (tel:) links found.');
  },

  function napConsistency({ pages, home }) {
    const def = { id: 'local.nap-consistency', category: C, title: 'Phone number is consistent', weight: 3,
      fix: 'Use exactly the same phone number in your markup, website, Google Business Profile and directory listings.' };
    const node = localNode(pages, home);
    const visible = [...new Set(pages.flatMap(p => [...p.phones, ...p.telLinks]).map(tail9).filter(d => d.length === 9))];
    if (!visible.length) return skip(def, 'No phone numbers found to compare.');
    if (node?.telephone) {
      const schemaPhone = tail9(node.telephone);
      if (!visible.includes(schemaPhone)) return fail(def, 'warning', `The markup phone (${node.telephone}) doesn't appear anywhere on the crawled pages.`);
    }
    if (visible.length > 3) return info(def, `${visible.length} different phone numbers appear across the site — check they're all intentional.`);
    return pass(def, node?.telephone ? 'The markup phone number matches the one shown on the site.' : `${plural(visible.length, 'phone number')} used consistently.`);
  },

  function address({ pages, home }) {
    const def = { id: 'local.address', category: C, title: 'Business address is on the site', weight: 4,
      fix: 'Show your street address (or service area for mobile businesses) in the footer or contact page, matching your Google Business Profile exactly.' };
    const node = localNode(pages, home);
    const street = addressOf(node)?.streetAddress;
    const onPage = street && pages.some(p => p.bodyTextSample?.toLowerCase().includes(String(street).toLowerCase()));
    if (onPage) return pass(def, `Street address "${street}" is shown on the site.`);
    if (pages.some(p => p.hasAddressTag)) return pass(def, 'An <address> block is present.');
    if (street) return fail(def, 'warning', `The markup has an address (${street}) but it isn't visible on any crawled page.`);
    return fail(def, 'warning', 'No address found in markup or an <address> element. (Addresses written as plain text can\'t be detected reliably.)');
  },

  function contactPage({ pages }) {
    const def = { id: 'local.contact-page', category: C, title: 'Contact page or form exists', weight: 3,
      fix: 'Add a dedicated contact page with phone, email, address, hours, a map and a form, and link to it from the menu.' };
    const page = pages.find(p => /contact/i.test(new URL(p.finalUrl).pathname) || /contact/i.test(p.title || ''));
    if (page) return pass(def, `Contact page: ${page.finalUrl}`);
    const section = pages.find(p => p.contactSection);
    if (section) return pass(def, `Contact section or form found on ${section.finalUrl}.`);
    return fail(def, 'warning', 'No contact page, contact section or contact form was found.');
  },

  function map({ pages }) {
    const def = { id: 'local.map', category: C, title: 'Google Maps link or embed', weight: 2,
      fix: 'Embed your Google Maps location on the contact page or link to your Google Business Profile.' };
    return pages.some(p => p.mapsLink) ? pass(def, 'A Google Maps link or embed is present.')
      : fail(def, 'warning', 'No Google Maps link or embed found.');
  },

  function locationInHome({ pages, home }) {
    const def = { id: 'local.location-keywords', category: C, title: 'Homepage mentions your town or city', weight: 3,
      fix: 'Mention your town/city in the homepage title and H1, e.g. "Electrician in Bellville | Smith Electrical".' };
    const locality = addressOf(localNode(pages, home))?.addressLocality;
    if (!locality) return skip(def, 'No addressLocality in the markup, so the business location is unknown.');
    if (!home) return skip(def, 'Homepage not analysed.');
    const l = String(locality).toLowerCase();
    const inTitle = (home.title || '').toLowerCase().includes(l);
    const inH1 = home.headings.some(h => h.level === 1 && h.text.toLowerCase().includes(l));
    if (inTitle && inH1) return pass(def, `"${locality}" appears in the homepage title and H1.`);
    return result(def, { status: 'warning', score: inTitle || inH1 ? 0.5 : 0,
      message: `"${locality}" is missing from the homepage ${[!inTitle && 'title', !inH1 && 'H1'].filter(Boolean).join(' and ')}.` });
  },

  function googleBusinessProfile() {
    const def = { id: 'local.google-business-profile', category: C, title: 'Google Business Profile', weight: 0,
      fix: 'Claim and complete your free profile at business.google.com — it drives the map results for local searches.' };
    return skip(def, 'Not checked automatically: it needs Google\'s Places API. Check your listing at business.google.com.');
  },
];

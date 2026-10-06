/* Competitor comparison. Every statement is generated from scan data, with
   thresholds so small differences aren't overstated. Page counts are "pages
   found within the scan limit", and are labelled that way. */
import { competitivePosition } from './scoring.js';
import { typesOf } from '../extract.js';

const SCHEMA_OF_INTEREST = {
  FAQPage: 'FAQ structured data', LocalBusiness: 'LocalBusiness structured data', Product: 'Product structured data',
  BreadcrumbList: 'breadcrumb structured data', Organization: 'Organization structured data', Article: 'article structured data',
  Review: 'review structured data', AggregateRating: 'review-star structured data',
};
const LOCAL_LIKE = /Business|Service|Store|Restaurant|Agent|Clinic|Dentist|Physician|Attorney|Plumber|Electrician|Contractor|Salon|Spa|Hotel|Gym/;

const pct = (n, d) => (d ? Math.round(n / d * 100) : null);
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Facts used for the comparison table, from one site's scan. */
export function siteFacts(site) {
  const pages = site.pages.filter(p => p.isHtml && !p.aliasOf && !p.offsite);
  const imgs = pages.flatMap(p => p.images);
  const schemaTypes = new Set(pages.flatMap(p => [...p.schemaNodes.flatMap(typesOf), ...p.microdataTypes]));
  const has = t => schemaTypes.has(t) || (t === 'LocalBusiness' && [...schemaTypes].some(x => LOCAL_LIKE.test(x)));
  return {
    pages: pages.length,
    limitHit: !!site.limitHit,
    titlePct: pct(pages.filter(p => p.title).length, pages.length),
    metaPct: pct(pages.filter(p => p.metaDescription).length, pages.length),
    h1Pct: pct(pages.filter(p => p.headings.filter(h => h.level === 1).length === 1).length, pages.length),
    avgWords: pages.length ? Math.round(pages.reduce((n, p) => n + p.wordCount, 0) / pages.length) : null,
    avgInternalLinks: pages.length ? Math.round(pages.reduce((n, p) => n + new Set(p.links.filter(l => l.internal).map(l => l.url)).size, 0) / pages.length) : null,
    images: imgs.length,
    altPct: pct(imgs.filter(i => i.alt != null && i.alt !== '').length, imgs.length),
    schema: Object.keys(SCHEMA_OF_INTEREST).filter(has),
    schemaCount: schemaTypes.size,
    mobileReady: pages.length ? pages.every(p => /width\s*=\s*device-width/i.test(p.viewport || '')) : null,
    ttfb: median(pages.map(p => p.ttfbMs)),
    pageWeight: site.perf?.totals?.bytes ?? null,
    lighthouse: site.perf?.psi?.score ?? null,
  };
}

const ROWS = [
  ['Overall health', s => s.health.overall, 'score'],
  ['SEO', s => s.health.areas.seo, 'score'],
  ['Performance', s => s.health.areas.performance, 'score'],
  ['Technical health', s => s.health.areas.technical, 'score'],
  ['Content', s => s.health.groups.content, 'score'],
  ['Pages found (scan limit)', s => s.facts.pages, 'count'],
  ['Pages with a title', s => s.facts.titlePct, 'pct'],
  ['Pages with a meta description', s => s.facts.metaPct, 'pct'],
  ['Pages with one H1', s => s.facts.h1Pct, 'pct'],
  ['Average words per page', s => s.facts.avgWords, 'count'],
  ['Average internal links per page', s => s.facts.avgInternalLinks, 'count'],
  ['Images with alt text', s => s.facts.altPct, 'pct'],
  ['Structured data types', s => s.facts.schemaCount, 'count'],
  ['Mobile viewport', s => (s.facts.mobileReady == null ? null : s.facts.mobileReady ? 'Yes' : 'No'), 'bool'],
  ['Server response (median)', s => s.facts.ttfb, 'ms'],
  ['Homepage weight', s => s.facts.pageWeight, 'bytes'],
  ['Lighthouse mobile', s => s.facts.lighthouse, 'score'],
];

/**
 * @param {{label:string, url:string, report:object, perf:object, health:object, facts:object}} you
 * @param {Array<typeof you>} competitors
 */
export function buildComparison(you, competitors) {
  const table = ROWS.map(([label, get, unit]) => ({ label, unit, values: [you, ...competitors].map(get) }));
  const yours = [], theirs = [], opportunities = [];
  const names = competitors.map(c => c.label);
  const all = (pred) => competitors.length && competitors.every(pred);

  // Scores: lead/trail by 10+ points
  for (const [label, key] of [['SEO', 'seo'], ['performance', 'performance'], ['technical health', 'technical']]) {
    const a = you.health.areas[key];
    if (a == null) continue;
    const ahead = competitors.filter(c => c.health.areas[key] != null && a - c.health.areas[key] >= 10);
    const behind = competitors.filter(c => c.health.areas[key] != null && c.health.areas[key] - a >= 10);
    if (ahead.length && ahead.length === competitors.length) yours.push(`Better ${label} score than ${competitors.length > 1 ? 'all competitors' : names[0]} (${a} vs ${ahead.map(c => c.health.areas[key]).join(', ')})`);
    for (const c of behind) theirs.push(`${c.label} has a better ${label} score (${c.health.areas[key]} vs your ${a})`);
  }

  // Speed (server response) — 25%+ difference
  const t = you.facts.ttfb;
  if (t != null) {
    if (all(c => c.facts.ttfb != null && t <= c.facts.ttfb * 0.75)) yours.push(`Your server responds faster than ${competitors.length > 1 ? 'every competitor' : names[0]} (${t} ms vs ${competitors.map(c => `${c.facts.ttfb} ms`).join(', ')})`);
    for (const c of competitors) if (c.facts.ttfb != null && c.facts.ttfb <= t * 0.75) theirs.push(`${c.label}'s server responds faster (${c.facts.ttfb} ms vs your ${t} ms)`);
  }
  // Page weight — 30%+ lighter
  const w = you.facts.pageWeight;
  if (w) for (const c of competitors) {
    if (c.facts.pageWeight && w <= c.facts.pageWeight * 0.7) yours.push(`Your homepage is lighter than ${c.label}'s (${(w / 1048576).toFixed(1)} MB vs ${(c.facts.pageWeight / 1048576).toFixed(1)} MB)`);
    if (c.facts.pageWeight && c.facts.pageWeight <= w * 0.7) theirs.push(`${c.label}'s homepage is lighter (${(c.facts.pageWeight / 1048576).toFixed(1)} MB vs your ${(w / 1048576).toFixed(1)} MB)`);
  }

  // Content volume — pages and words
  for (const c of competitors) {
    if (c.facts.pages >= you.facts.pages * 1.5 && c.facts.pages - you.facts.pages >= 3) {
      const limitNote = c.facts.limitHit ? ' (and possibly more — the scan limit was reached)' : '';
      theirs.push(`${c.label} has more pages (${c.facts.pages} found vs your ${you.facts.pages})${limitNote}`);
      opportunities.push(`${c.label} has ${c.facts.pages} pages${limitNote} while your website has ${you.facts.pages}. Dedicated pages for each service and area you cover give Google more to rank.`);
    }
    if (you.facts.avgWords && c.facts.avgWords >= you.facts.avgWords * 1.4 && c.facts.avgWords - you.facts.avgWords >= 150) {
      theirs.push(`${c.label} has more content per page (${c.facts.avgWords} vs ${you.facts.avgWords} words on average)`);
      opportunities.push(`${c.label}'s pages average ${c.facts.avgWords} words vs your ${you.facts.avgWords}. Expanding key pages with FAQs, examples and details about your services could help you compete.`);
    }
  }
  if (you.facts.avgWords && all(c => c.facts.avgWords != null && you.facts.avgWords >= c.facts.avgWords * 1.4)) yours.push(`More content per page than ${competitors.length > 1 ? 'all competitors' : names[0]} (${you.facts.avgWords} words on average)`);

  // On-page coverage
  for (const [key, what] of [['metaPct', 'meta descriptions'], ['titlePct', 'page titles'], ['altPct', 'image alt text']]) {
    const a = you.facts[key];
    if (a == null) continue;
    if (all(c => c.facts[key] != null && a - c.facts[key] >= 20)) yours.push(`Better ${what} coverage (${a}% of ${key === 'altPct' ? 'images' : 'pages'})`);
    for (const c of competitors) if (c.facts[key] != null && c.facts[key] - a >= 20) {
      theirs.push(`${c.label} has better ${what} coverage (${c.facts[key]}% vs your ${a}%)`);
      opportunities.push(`Add ${what} where they're missing — ${c.label} covers ${c.facts[key]}% vs your ${a}%.`);
    }
  }
  if (you.facts.avgInternalLinks != null) for (const c of competitors) {
    if (c.facts.avgInternalLinks >= you.facts.avgInternalLinks * 1.5 && c.facts.avgInternalLinks - you.facts.avgInternalLinks >= 5) theirs.push(`${c.label} links between its pages more (${c.facts.avgInternalLinks} vs ${you.facts.avgInternalLinks} internal links per page)`);
  }

  // Structured data
  for (const type of Object.keys(SCHEMA_OF_INTEREST)) {
    const mine = you.facts.schema.includes(type);
    const withIt = competitors.filter(c => c.facts.schema.includes(type));
    if (!mine && withIt.length) {
      theirs.push(`${withIt.map(c => c.label).join(' and ')} ${withIt.length > 1 ? 'have' : 'has'} ${SCHEMA_OF_INTEREST[type]}`);
      opportunities.push(`${withIt.map(c => c.label).join(' and ')} ${withIt.length > 1 ? 'use' : 'uses'} ${SCHEMA_OF_INTEREST[type]} while your website does not. Adding it can unlock richer Google results.`);
    }
    if (mine && competitors.length && !withIt.length) yours.push(`You have ${SCHEMA_OF_INTEREST[type]} and ${competitors.length > 1 ? 'no competitor does' : `${names[0]} doesn't`}`);
  }

  // Mobile
  if (you.facts.mobileReady === false && competitors.some(c => c.facts.mobileReady)) theirs.push('Competitors are set up for mobile and your site is not');
  if (you.facts.mobileReady && competitors.some(c => c.facts.mobileReady === false)) yours.push(`Better mobile setup than ${competitors.filter(c => c.facts.mobileReady === false).map(c => c.label).join(' and ')}`);

  if (t != null && all(c => c.facts.ttfb != null && t <= c.facts.ttfb * 0.75)) opportunities.push(`Your website responds faster than ${competitors.length === 2 ? 'both competitors' : competitors.length > 2 ? 'all competitors' : names[0]} — mention speed in your marketing.`);

  return { table, yours, theirs, opportunities, position: competitivePosition(you, competitors) };
}

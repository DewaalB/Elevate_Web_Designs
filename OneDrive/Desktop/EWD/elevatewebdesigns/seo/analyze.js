/* Runs every check against a finished crawl and builds the report object
   that the dashboard renders and Firestore stores. To add a check, add a
   function to one of the arrays in ./checks — nothing else needs to change. */
import { CATEGORIES } from './checks/helpers.js';
import { technicalChecks } from './checks/technical.js';
import { onpageChecks } from './checks/onpage.js';
import { contentChecks } from './checks/content.js';
import { imageChecks } from './checks/images.js';
import { performanceChecks } from './checks/performance.js';
import { localChecks } from './checks/local.js';
import { schemaChecks } from './checks/schema.js';
import { buildFixes } from './fixes.js';

export const ALL_CHECKS = [
  ...technicalChecks, ...onpageChecks, ...contentChecks, ...imageChecks,
  ...performanceChecks, ...localChecks, ...schemaChecks,
];
export const REPORT_VERSION = 1;

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, skipped: 3, pass: 4 };

function buildContext(crawl) {
  const { site, records, byFinal, checks, psi } = crawl;
  const pages = records.filter(r => r.isHtml && !r.aliasOf && !r.offsite);
  const byUrl = new Map(records.map(r => [r.url, r]));
  // A link target resolves through redirects, then through the target's own canonical
  // tag when that canonical is another page we crawled (e.g. /index.html → /).
  const canonicalOf = finalUrl => {
    const c = byFinal.get(finalUrl)?.canonicals?.[0]?.url;
    return c && c !== finalUrl && byFinal.has(c) ? c : finalUrl;
  };
  const resolve = u => canonicalOf(byUrl.get(u)?.finalUrl || u);
  // Pages that aren't just a canonicalised copy of another crawled page.
  const primary = pages.filter(p => canonicalOf(p.finalUrl) === p.finalUrl);

  const isNoindex = p => /\b(noindex|none)\b/i.test(p.metaRobots || '') || /\b(noindex|none)\b/i.test(p.headers?.['x-robots-tag'] || '');
  // Pages competing in search: not noindexed, not a copy of another crawled page.
  // Pages whose canonical is broken or off-site stay in so their titles etc. are still
  // checked — the canonical check reports the canonical problem itself.
  const indexable = primary.filter(p => !isNoindex(p));

  const inbound = new Map();
  const linkSources = new Map();
  for (const p of pages) {
    const targets = new Set();
    for (const l of p.links) {
      if (!l.internal) continue;
      if (!linkSources.has(l.url)) linkSources.set(l.url, []);
      const src = linkSources.get(l.url);
      if (!src.includes(p.finalUrl)) src.push(p.finalUrl);
      const t = resolve(l.url);
      if (t !== p.finalUrl) targets.add(t);
    }
    for (const t of targets) inbound.set(t, (inbound.get(t) || 0) + 1);
  }

  const statusOf = u => byUrl.get(u) || byFinal.get(u) || checks.internal.get(u) || checks.canonical.get(u) || null;

  return {
    site, records, pages, primary, indexable, checks, psi, isNoindex, inbound, linkSources, statusOf, canonicalOf,
    home: byFinal.get(site.homeUrl) || pages[0] || null,
  };
}

function runChecks(ctx) {
  return ALL_CHECKS.map(fn => {
    try { return fn(ctx); }
    catch (e) {
      console.error(`Check ${fn.name} failed`, e);
      return { id: fn.name, category: 'technical', title: fn.name, weight: 0, status: 'skipped', score: 0,
        message: `This check hit an internal error and was skipped (${e.message}).`, affected: [], affectedTotal: 0, fix: '' };
    }
  });
}

function scoreCategories(results) {
  return CATEGORIES.map(cat => {
    const mine = results.filter(r => r.category === cat.id);
    const scored = mine.filter(r => ['pass', 'warning', 'critical'].includes(r.status) && r.weight > 0);
    const w = scored.reduce((n, r) => n + r.weight, 0);
    const missingRequired = cat.requires && mine.find(r => r.id === cat.requires)?.status === 'skipped';
    const score = missingRequired ? null : w ? Math.round(scored.reduce((n, r) => n + r.weight * Math.max(0, Math.min(1, r.score)), 0) / w * 100) : null;
    const counts = { critical: 0, warning: 0, info: 0, pass: 0, skipped: 0 };
    mine.forEach(r => counts[r.status]++);
    return { id: cat.id, name: cat.name, weight: cat.weight, score, counts };
  });
}

function recommendations(results) {
  const catWeight = Object.fromEntries(CATEGORIES.map(c => [c.id, c.weight]));
  return results
    .filter(r => (r.status === 'critical' || r.status === 'warning') && r.weight > 0)
    .map(r => ({
      id: r.id, title: r.title, category: r.category, status: r.status, message: r.message, fix: r.fix, affectedTotal: r.affectedTotal,
      impact: +(r.weight * (1 - Math.max(0, Math.min(1, r.score))) * (catWeight[r.category] / 20) * (r.status === 'critical' ? 1.5 : 1)).toFixed(2),
    }))
    .filter(r => r.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 25);
}

function pageRows(ctx, results) {
  const issues = new Map();
  for (const r of results) {
    if (!['critical', 'warning', 'info'].includes(r.status)) continue;
    for (const a of r.affected) {
      if (!issues.has(a.url)) issues.set(a.url, []);
      issues.get(a.url).push({ id: r.id, title: r.title, status: r.status, detail: a.detail });
    }
  }
  return ctx.records.map(r => {
    const url = r.finalUrl || r.url;
    const row = {
      url: r.url, finalUrl: url, status: r.status, error: r.error || null, depth: r.depth, via: r.via,
      ttfbMs: r.ttfbMs || null, bytes: r.bytes || 0, redirects: r.redirects?.length || 0,
      aliasOf: r.aliasOf || null, offsite: !!r.offsite, isHtml: !!r.isHtml,
      issues: (issues.get(url) || issues.get(r.url) || []).sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status]),
    };
    if (r.isHtml && !r.aliasOf && !r.offsite) Object.assign(row, {
      title: r.title, metaDescription: r.metaDescription, h1: r.headings.filter(h => h.level === 1).map(h => h.text),
      words: r.wordCount, inbound: ctx.inbound.get(ctx.canonicalOf(url)) || 0,
      internalLinks: new Set(r.links.filter(l => l.internal).map(l => l.url)).size,
      externalLinks: new Set(r.links.filter(l => !l.internal).map(l => l.url)).size,
      images: r.images.length, imagesNoAlt: r.images.filter(i => i.alt === null).length,
      canonical: r.canonicals[0]?.url || null, noindex: ctx.isNoindex(r), schemaTypes: r.schemaTypes,
      readability: r.readability?.score ?? null, headings: r.headings.slice(0, 40),
    });
    return row;
  });
}

function siteSummary(site) {
  return {
    robots: site.robots && { url: site.robots.url, status: site.robots.status, found: site.robots.found, sitemaps: site.robots.sitemaps, text: site.robots.text?.slice(0, 5000) || null },
    sitemaps: site.sitemaps.map(s => ({ url: s.url, status: s.status, type: s.type || null, count: s.count || 0, error: s.error || s.parseError || null })),
    sitemapUrlCount: site.sitemapUrls.length,
    probes: Object.fromEntries(Object.entries(site.probes).map(([k, p]) => [k, { url: p.url, status: p.status, finalUrl: p.finalUrl || null, error: p.error || null, redirects: p.redirects?.length || 0 }])),
    crawl: { ...site.crawl, blockedByRobots: site.crawl.blockedByRobots.slice(0, 100) },
    checkLimits: site.checkLimits,
  };
}

/** Checks that need a full crawl or link/image status checks. The public quick
 *  check doesn't do those, so it reports them as not checked instead of passing. */
const FULL_AUDIT_ONLY = new Set([
  'tech.broken-internal-links', 'tech.broken-external-links', 'tech.sitemap-quality',
  'onpage.orphans', 'onpage.few-inbound', 'onpage.important-unlinked',
  'images.broken', 'images.large', 'images.format', 'perf.image-caching',
]);

export function analyze(crawl) {
  const ctx = buildContext(crawl);
  let raw = runChecks(ctx);
  if (crawl.site.quick) {
    raw = raw.map(r => (FULL_AUDIT_ONLY.has(r.id)
      ? { ...r, status: 'skipped', score: 0, message: 'Included in the full audit.', affected: [], affectedTotal: 0 } : r));
  }
  const results = raw.sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] || b.weight - a.weight);
  const categories = scoreCategories(results);
  const scored = categories.filter(c => c.score != null);
  const wSum = scored.reduce((n, c) => n + c.weight, 0);
  const overall = wSum ? Math.round(scored.reduce((n, c) => n + c.weight * c.score, 0) / wSum) : null;
  const counts = { critical: 0, warning: 0, info: 0, pass: 0, skipped: 0 };
  results.forEach(r => counts[r.status]++);

  const { site } = crawl;
  return {
    version: REPORT_VERSION,
    url: site.input, homeUrl: site.homeUrl, rootHost: site.rootHost,
    createdAt: new Date().toISOString(), durationMs: site.durationMs, settings: { ...site.settings, psiKey: undefined },
    overall, categories, counts,
    checks: results,
    recommendations: recommendations(results),
    pages: pageRows(ctx, results),
    site: siteSummary(site),
    psi: crawl.psi || null,
    fixes: buildFixes(ctx, results),
    ai: null,
  };
}

/** Compact, fact-only digest of the report for the AI recommendations call. */
export function aiSummary(report) {
  const home = report.pages.find(p => p.finalUrl === report.homeUrl) || report.pages.find(p => p.title !== undefined);
  return {
    site: report.homeUrl,
    overallScore: report.overall,
    categoryScores: Object.fromEntries(report.categories.map(c => [c.name, c.score])),
    failedChecks: report.checks.filter(c => c.status === 'critical' || c.status === 'warning').slice(0, 35).map(c => ({
      id: c.id, title: c.title, category: c.category, severity: c.status, finding: c.message,
      examples: c.affected.slice(0, 4).map(a => `${a.url}${a.detail ? ` — ${a.detail}` : ''}`),
    })),
    homepage: home && { title: home.title, metaDescription: home.metaDescription, h1: home.h1, words: home.words, structuredData: home.schemaTypes },
    pages: report.pages.filter(p => p.title !== undefined).slice(0, 30).map(p => ({ url: p.finalUrl, title: p.title, h1: p.h1?.[0] || null, words: p.words })),
    performance: report.psi && !report.psi.error ? { mobileScore: report.psi.score, realUsers: report.psi.field?.overall || 'no data', opportunities: report.psi.opportunities.map(o => o.title) } : 'not measured',
  };
}

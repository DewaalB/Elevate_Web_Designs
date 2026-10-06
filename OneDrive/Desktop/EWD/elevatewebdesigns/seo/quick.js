/* Builds a crawl object (same shape crawler.js produces) from the worker's
   one-shot /public/quick response, so analyze() can score it unchanged. */
import { normalizeUrl, isSameSite } from './url.js';
import { parseRobots, rulesFor, isAllowed } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { extractPage } from './extract.js';

export function buildQuickCrawl(data) {
  const startedAt = Date.now();
  const home = normalizeUrl(data.home.finalUrl);
  const { hostname: rootHost, origin } = new URL(home);

  // robots.txt
  const r = data.robots || {};
  const robotsFound = !r.error && r.status === 200 && r.body != null && /text\/plain|^$/i.test((r.contentType || '').split(';')[0]);
  const parsed = robotsFound ? parseRobots(r.body) : { groups: [], sitemaps: [] };
  const googleRules = rulesFor(parsed, 'googlebot');

  // sitemap
  const sitemaps = [];
  const sitemapUrls = [];
  if (data.sitemap) {
    const s = data.sitemap;
    const entry = { url: s.requestedUrl, status: s.status, error: s.error || null, fromRobots: parsed.sitemaps.includes(s.requestedUrl) };
    if (!s.error && s.status === 200 && s.body) {
      const p = parseSitemap(s.body);
      Object.assign(entry, { type: p.type, parseError: p.error || null, count: p.urls.length + p.sitemaps.length });
      for (const u of p.urls) {
        const n = normalizeUrl(u.loc);
        if (n) sitemapUrls.push({ url: n, priority: u.priority, lastmod: u.lastmod, sameSite: isSameSite(n, rootHost) });
      }
      // A sitemap index is valid even though its pages live in child sitemaps.
      if (p.type === 'index' && !p.urls.length) entry.count = p.sitemaps.length;
    }
    sitemaps.push(entry);
  }

  // pages
  const records = [];
  const byFinal = new Map();
  const add = (res, depth, via) => {
    const { body, ...meta } = res;
    const finalUrl = normalizeUrl(res.finalUrl) || res.requestedUrl;
    const rec = { url: normalizeUrl(res.requestedUrl) || res.requestedUrl, depth, via, ...meta, finalUrl };
    records.push(rec);
    if (res.error || res.status < 200 || res.status >= 300 || body == null || !/html/i.test(res.contentType || '')) return;
    if (!isSameSite(finalUrl, rootHost)) rec.offsite = true;
    else if (byFinal.has(finalUrl)) rec.aliasOf = finalUrl;
    else { byFinal.set(finalUrl, rec); Object.assign(rec, extractPage(body, finalUrl, rootHost)); }
  };
  add(data.home, 0, 'start');
  for (const p of data.pages) add(p, 1, 'link');

  const probe = p => (p ? { url: p.requestedUrl, ...p } : undefined);
  const site = {
    quick: true, input: data.input, startUrl: normalizeUrl(data.home.requestedUrl), homeUrl: home, rootHost, origin, startedAt,
    settings: { quick: true, maxPages: 5, maxDepth: 1, pageSpeed: false },
    robots: {
      url: `${origin}/robots.txt`, status: r.status, error: r.error || null, found: robotsFound, contentType: r.contentType || null,
      sitemaps: parsed.sitemaps, groups: parsed.groups.length, googleAgent: googleRules.agent, googleRules: googleRules.rules,
      text: robotsFound ? r.body.slice(0, 20000) : null,
    },
    googleAllows: path => isAllowed(googleRules.rules, path),
    sitemaps, sitemapUrls,
    probes: { http: probe(data.probes.http), altHost: probe(data.probes.altHost), notFound: probe(data.probes.notFound) },
    crawl: { maxPages: 5, maxDepth: 1, respectRobots: false, limitHit: true, blockedByRobots: [], fetched: records.length },
    checkLimits: { internal: { total: 0, checked: 0 }, images: { total: 0, checked: 0 }, external: { total: 0, checked: 0, enabled: false } },
    durationMs: 0,
  };
  const pages = records.filter(x => x.isHtml);
  return { site, records, pages, byFinal, checks: { internal: new Map(), external: new Map(), images: new Map(), canonical: new Map() }, psi: null };
}

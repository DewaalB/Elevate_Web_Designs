/* Crawl orchestration. Runs in the browser and asks the worker for one URL
   at a time, so each worker call stays tiny and progress is live.

   Order of work:
     1. start URL (decides the site's real host after redirects)
     2. robots.txt + XML sitemaps
     3. breadth-first crawl of internal links (page + depth limits, robots)
     4. sitemap-only URLs if budget remains (finds orphan pages)
     5. status checks: uncrawled internal links, external links, images,
        canonical targets, plus site probes (http→https, www, 404, favicon,
        trailing slash) — and PageSpeed in parallel */
import { normalizeUrl, isSameSite, isFileUrl, siteKey, pathOf } from './url.js';
import { parseRobots, rulesFor, isAllowed, AUDIT_AGENT } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { extractPage } from './extract.js';
import { runPageSpeed } from './api.js';

const DEFAULT_LIMITS = { internalChecks: 150, externalChecks: 100, imageChecks: 150, canonicalChecks: 50, sitemapUrls: 5000, childSitemaps: 10 };
const UNVERIFIABLE = new Set([401, 403, 405, 406, 429, 999]);

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

async function runQueue(queue, concurrency, handler, signal) {
  let active = 0;
  await new Promise((resolve, reject) => {
    const pump = () => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      while (active < concurrency && queue.length) {
        const item = queue.shift();
        active++;
        handler(item).catch(e => { if (e?.name === 'AbortError' || e?.status === 401) reject(e); })
          .finally(() => { active--; pump(); });
      }
      if (!queue.length && !active) resolve();
    };
    pump();
  });
}

/** Friendly explanation when the start page can't be loaded. */
function startFailureMessage(r, url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  if (r.error === 'timeout') return `${host} took too long to respond, so the scan couldn't start. Try again in a few minutes.`;
  if (r.error === 'blocked') return `That address can't be scanned: ${r.message}`;
  if (r.error === 'redirect_loop' || r.error === 'too_many_redirects') return `${host} redirects in a loop, so the page never loads. This needs fixing on the website itself.`;
  if (r.error) return `We couldn't connect to ${host}. Check the address — the site may be offline, the domain may not exist, or its security (SSL) certificate may be invalid.`;
  if ([401, 403, 429].includes(r.status) || r.headers?.['cf-mitigated'] || (r.status === 503 && /cloudflare|sucuri|akamai/i.test(r.headers?.server || '')))
    return `We couldn't complete the scan because ${host} is blocking automated requests (HTTP ${r.status}).`;
  if (r.status === 404 || r.status === 410) return `That page doesn't exist on ${host} (HTTP ${r.status}). Check the address.`;
  if (r.status >= 500) return `${host} returned a server error (HTTP ${r.status}). The website may be down — try again later.`;
  if (r.status >= 400) return `${host} refused the request (HTTP ${r.status}).`;
  return `That address didn't return a web page (${r.contentType || 'no content'}).`;
}

export const isBroken = r => !!r && (r.error ? !['blocked'].includes(r.error) : r.status >= 400 && !UNVERIFIABLE.has(r.status));
export const isUnverifiable = r => !!r && !r.error && UNVERIFIABLE.has(r.status);

/**
 * @param {object} o
 * @param {string} o.startUrl
 * @param {{maxPages:number, maxDepth:number, respectRobots:boolean, checkExternal:boolean, pageSpeed:boolean, psiKey:string}} o.settings
 * @param {ReturnType<import('./api.js').createApi>} o.api
 * @param {(p:{phase:string, done?:number, total?:number, message?:string}) => void} o.onProgress
 * @param {AbortSignal} o.signal
 */
export async function crawlSite({ startUrl, settings, api, onProgress, signal }) {
  const progress = (phase, extra = {}) => onProgress?.({ phase, ...extra });
  const LIMITS = { ...DEFAULT_LIMITS, ...(settings.limits || {}) };
  const startedAt = Date.now();

  // ── 1. Start URL ──
  const input = /^https?:\/\//i.test(startUrl.trim()) ? startUrl.trim() : `https://${startUrl.trim()}`;
  const start = normalizeUrl(input);
  if (!start) throw new Error('That does not look like a valid website address.');
  progress('start', { message: `Loading ${start}` });
  const first = await api.fetchPage(start, signal);
  if (first.error || first.status >= 400 || !first.body || !/html/i.test(first.contentType || '')) {
    throw new Error(startFailureMessage(first, start));
  }
  const home = normalizeUrl(first.finalUrl);
  const rootHost = new URL(home).hostname;
  const origin = new URL(home).origin;

  const site = {
    input, startUrl: start, homeUrl: home, rootHost, origin, startedAt,
    settings: { ...settings },
    robots: null, sitemaps: [], sitemapUrls: [], probes: {}, crawl: {},
  };

  // ── 2. robots.txt & sitemaps ──
  progress('robots', { message: 'Reading robots.txt and sitemaps' });
  let auditRules = { rules: [], crawlDelay: null }, googleRules = { rules: [] };
  try {
    const r = await api.fetchPage(`${origin}/robots.txt`, signal);
    const found = !r.error && r.status === 200 && /text\/plain|^$/i.test((r.contentType || '').split(';')[0] || '') && r.body != null;
    const parsed = found ? parseRobots(r.body) : { groups: [], sitemaps: [] };
    auditRules = rulesFor(parsed, AUDIT_AGENT);
    googleRules = rulesFor(parsed, 'googlebot');
    site.robots = {
      url: `${origin}/robots.txt`, status: r.status, error: r.error || null, found,
      contentType: r.contentType || null, sitemaps: parsed.sitemaps, groups: parsed.groups.length,
      googleAgent: googleRules.agent, googleRules: googleRules.rules, crawlDelay: auditRules.crawlDelay,
      text: found ? r.body.slice(0, 20000) : null,
    };
  } catch (e) {
    if (e.name === 'AbortError' || e.status === 401) throw e;
    site.robots = { url: `${origin}/robots.txt`, error: 'worker', message: e.message, found: false, sitemaps: [], googleRules: [] };
  }
  site.googleAllows = path => isAllowed(googleRules.rules, path);

  const sitemapUrlMap = new Map();
  let childBudget = LIMITS.childSitemaps;
  const readSitemaps = async list => {
    const sitemapQueue = [...new Set(list)];
    while (sitemapQueue.length && sitemapUrlMap.size < LIMITS.sitemapUrls) {
      const smUrl = sitemapQueue.shift();
      const entry = { url: smUrl, fromRobots: site.robots.sitemaps.includes(smUrl) };
      try {
        const r = await api.fetchPage(smUrl, signal);
        entry.status = r.status; entry.error = r.error || null; entry.finalUrl = r.finalUrl;
        if (!r.error && r.status === 200 && r.body) {
          const p = parseSitemap(r.body);
          Object.assign(entry, { type: p.type, parseError: p.error || null, count: p.urls.length, children: p.sitemaps.length, truncated: r.truncated });
          for (const u of p.urls) {
            const n = normalizeUrl(u.loc);
            if (n && sitemapUrlMap.size < LIMITS.sitemapUrls) sitemapUrlMap.set(n, { priority: u.priority, lastmod: u.lastmod, sameSite: isSameSite(n, rootHost) });
          }
          for (const c of p.sitemaps) if (childBudget-- > 0) sitemapQueue.push(c);
        }
      } catch (e) {
        if (e.name === 'AbortError' || e.status === 401) throw e;
        entry.error = 'worker'; entry.message = e.message;
      }
      site.sitemaps.push(entry);
    }
  };
  const validSitemap = () => site.sitemaps.some(s => s.status === 200 && s.type && s.type !== 'invalid');
  if (site.robots.sitemaps.length) await readSitemaps(site.robots.sitemaps);
  if (!validSitemap()) await readSitemaps([`${origin}/sitemap.xml`]);
  if (!validSitemap()) await readSitemaps([`${origin}/sitemap_index.xml`]);
  site.sitemapUrls = [...sitemapUrlMap].map(([url, v]) => ({ url, ...v }));

  // ── 3. Crawl ──
  const { maxPages, maxDepth, respectRobots } = settings;
  const records = [];               // every fetched URL, in crawl order
  const byFinal = new Map();        // final URL → primary record
  const seen = new Set();
  const blockedByRobots = [];
  const queue = [];
  let limitHit = false;
  let budgetHit = false;

  const enqueue = (url, depth, via) => {
    if (!url || seen.has(url) || !isSameSite(url, rootHost) || isFileUrl(url)) return;
    if (respectRobots && !isAllowed(auditRules.rules, pathOf(url))) { seen.add(url); blockedByRobots.push(url); return; }
    if (seen.size - blockedByRobots.length >= maxPages) { limitHit = true; return; }
    seen.add(url);
    queue.push({ url, depth, via });
  };

  const handle = async ({ url, depth, via }) => {
    progress('page', { url, state: 'start' });
    let r;
    try { r = await api.fetchPage(url, signal); }
    catch (e) {
      if (e.name === 'AbortError' || e.status === 401) throw e;
      if (e.code === 'budget_exhausted') { budgetHit = true; queue.length = 0; return; }
      r = { requestedUrl: url, finalUrl: url, status: 0, redirects: [], error: 'worker', message: e.message };
    }
    const { body, ...meta } = r;
    const rec = { url, depth, via, ...meta, finalUrl: normalizeUrl(r.finalUrl) || url };
    records.push(rec);
    progress('page', { url, state: 'done', status: r.error ? r.error : r.status, queued: queue.length });
    progress('crawl', { done: records.length, total: Math.max(records.length, seen.size - blockedByRobots.length), message: pathOf(url) });

    const html = body != null && /html/i.test(r.contentType || '');
    if (!r.error && r.status >= 200 && r.status < 300 && html) {
      if (!isSameSite(rec.finalUrl, rootHost)) { rec.offsite = true; }
      else if (byFinal.has(rec.finalUrl) && byFinal.get(rec.finalUrl) !== rec) { rec.aliasOf = rec.finalUrl; }
      else {
        byFinal.set(rec.finalUrl, rec);
        Object.assign(rec, extractPage(body, rec.finalUrl, rootHost));
        if (depth !== null && depth < maxDepth) {
          for (const l of rec.links) if (l.internal) enqueue(l.url, depth + 1, 'link');
        }
      }
    }
    if (auditRules.crawlDelay) await sleep(Math.min(auditRules.crawlDelay, 10) * 1000, signal);
  };

  // Seed with the already-fetched start page so it isn't downloaded twice.
  seen.add(start);
  if (home !== start) seen.add(home);
  {
    const { body, ...meta } = first;
    const rec = { url: start, depth: 0, via: 'start', ...meta, finalUrl: home };
    records.push(rec);
    byFinal.set(home, rec);
    Object.assign(rec, extractPage(body, home, rootHost));
    if (maxDepth > 0) for (const l of rec.links) if (l.internal) enqueue(l.url, 1, 'link');
  }
  const concurrency = auditRules.crawlDelay ? 1 : 4;
  await runQueue(queue, concurrency, handle, signal);

  // ── 4. Sitemap URLs the links never reached (orphan candidates) ──
  for (const s of site.sitemapUrls) {
    if (!s.sameSite || seen.has(s.url) || byFinal.has(s.url)) continue;
    if (seen.size - blockedByRobots.length >= maxPages) { limitHit = true; break; }
    if (respectRobots && !isAllowed(auditRules.rules, pathOf(s.url))) { blockedByRobots.push(s.url); seen.add(s.url); continue; }
    seen.add(s.url);
    queue.push({ url: s.url, depth: null, via: 'sitemap' });
  }
  await runQueue(queue, concurrency, handle, signal);

  site.crawl = { maxPages, maxDepth, respectRobots, limitHit, blockedByRobots, fetched: records.length, concurrency };
  Object.defineProperty(site.crawl, 'budgetHit', { get: () => budgetHit, enumerable: true });

  // ── 5. Status checks & probes (PageSpeed runs alongside) ──
  const psiPromise = settings.pageSpeed
    ? runPageSpeed(home, { key: settings.psiKey, signal }).catch(e => (e.name === 'AbortError' ? Promise.reject(e) : { error: e.message }))
    : Promise.resolve(null);
  if (settings.pageSpeed) progress('pagespeed', { message: 'PageSpeed Insights running in the background' });

  const fetchedStatus = new Map();
  for (const r of records) fetchedStatus.set(r.url, r);
  const pages = records.filter(r => r.isHtml);

  const internalTargets = new Set(), externalTargets = new Set(), imageTargets = new Set(), canonicalTargets = new Set();
  for (const p of pages) {
    for (const l of p.links) {
      if (l.internal) { if (!fetchedStatus.has(l.url) && !byFinal.has(l.url)) internalTargets.add(l.url); }
      else if (settings.checkExternal) externalTargets.add(l.url);
    }
    for (const img of p.images) if (img.src) imageTargets.add(img.src);
    for (const c of p.canonicals) if (c.url && !fetchedStatus.has(c.url) && !byFinal.has(c.url)) canonicalTargets.add(c.url);
  }

  const checks = { internal: new Map(), external: new Map(), images: new Map(), canonical: new Map() };
  const jobs = [
    ...[...internalTargets].slice(0, LIMITS.internalChecks).map(u => ['internal', u]),
    ...[...canonicalTargets].slice(0, LIMITS.canonicalChecks).map(u => ['canonical', u]),
    ...[...imageTargets].slice(0, LIMITS.imageChecks).map(u => ['images', u]),
    ...[...externalTargets].slice(0, LIMITS.externalChecks).map(u => ['external', u]),
  ];
  site.checkLimits = {
    internal: { total: internalTargets.size, checked: Math.min(internalTargets.size, LIMITS.internalChecks) },
    images: { total: imageTargets.size, checked: Math.min(imageTargets.size, LIMITS.imageChecks) },
    external: { total: externalTargets.size, checked: Math.min(externalTargets.size, LIMITS.externalChecks), enabled: settings.checkExternal },
  };

  // Site-level probes ride in the same queue.
  const altHost = rootHost.startsWith('www.') ? rootHost.slice(4) : `www.${rootHost}`;
  const probeJobs = [
    ['probe', 'http', `http://${rootHost}/`],
    ['probe', 'altHost', `${new URL(home).protocol}//${altHost}/`],
    ['probe', 'notFound', `${origin}/elevate-seo-check-${Math.random().toString(36).slice(2, 10)}`],
  ];
  const homePage = byFinal.get(home);
  if (!homePage?.favicons?.length) probeJobs.push(['probe', 'faviconIco', `${origin}/favicon.ico`]);
  const slashSample = pages.filter(p => !p.aliasOf && new URL(p.finalUrl).pathname.length > 1 && !new URL(p.finalUrl).search).slice(0, 2);
  slashSample.forEach((p, i) => {
    const u = new URL(p.finalUrl);
    u.pathname = u.pathname.endsWith('/') ? u.pathname.replace(/\/+$/, '') : `${u.pathname}/`;
    probeJobs.push(['probe', `slash${i}`, u.href, p.finalUrl]);
  });

  const allJobs = [...probeJobs, ...jobs];
  let done = 0;
  await runQueue(allJobs.slice(), 6, async ([kind, a, b, c]) => {
    const url = kind === 'probe' ? b : a;
    let r;
    try { r = await api.checkUrl(url, signal); }
    catch (e) {
      if (e.name === 'AbortError' || e.status === 401) throw e;
      if (e.code === 'budget_exhausted') { budgetHit = true; return; } // left unchecked, not "broken"
      r = { status: 0, error: 'worker', message: e.message };
    }
    if (kind === 'probe') site.probes[a] = { url, original: c || null, ...r };
    else checks[kind].set(url, r);
    progress('checks', { done: ++done, total: allJobs.length, message: url });
  }, signal);

  progress('pagespeed', { message: settings.pageSpeed ? 'Waiting for PageSpeed Insights…' : '' });
  const psi = await psiPromise;

  site.durationMs = Date.now() - startedAt;
  site.checksFor = url => fetchedStatus.get(url) || checks.internal.get(url) || checks.canonical.get(url) || null;
  return { site, records, pages, byFinal, checks, psi };
}

export { siteKey };

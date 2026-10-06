/* Website Performance Analyzer.
   Measures every resource the page loads (via the worker's /measure: real
   download size and time), then scores Loading, Images, JavaScript, CSS and
   Caching. Lighthouse/Core Web Vitals come only from PageSpeed Insights; when
   that isn't available they are reported as "Not available", never estimated.

   Sizes: `size` is the transfer size the server reports (Content-Length,
   compressed) when it sends one, otherwise the downloaded size.
   Times are measured from the scanning server, not a visitor's phone. */
import { lin, PERF_WEIGHTS, LIGHTHOUSE_SHARE, weightedAverage } from './scoring.js';

const MAX_RESOURCES = 40;
const TEXT_TYPES = new Set(['script', 'stylesheet', 'document']);
const RASTER = /\.(jpe?g|png|gif|bmp|tiff?)(\?|$)/i;
const MODERN = /\.(webp|avif|svg)(\?|$)/i;
const KB = 1024, MB = 1024 * 1024;

export const fmtBytes = b => (b == null ? '—' : b >= MB ? `${(b / MB).toFixed(1)} MB` : b >= KB ? `${Math.round(b / KB)} KB` : `${b} B`);
const fileName = u => { try { const p = new URL(u).pathname.split('/').pop(); return decodeURIComponent(p) || new URL(u).hostname; } catch { return u; } };

function kindOf(type, contentType, url) {
  const ct = (contentType || '').toLowerCase();
  if (type === 'font' || /font|woff/.test(ct) || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)) return 'font';
  if (type === 'image' || ct.startsWith('image/')) return 'image';
  if (type === 'stylesheet' || ct.includes('css')) return 'stylesheet';
  if (type === 'script' || ct.includes('javascript')) return 'script';
  if (type === 'iframe') return 'iframe';
  return 'other';
}

function maxAgeOf(cc) {
  if (!cc) return 0;
  if (/no-store|no-cache/i.test(cc)) return 0;
  return Number(cc.match(/(?:s-)?max-age=(\d+)/i)?.[1] || 0);
}

async function pool(items, n, fn, signal) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

/** Font files referenced by same-site stylesheets (@font-face). */
async function discoverFonts(page, api, signal) {
  const host = new URL(page.finalUrl).hostname.replace(/^www\./, '');
  const sheets = page.resources.filter(r => r.type === 'stylesheet' && new URL(r.url).hostname.replace(/^www\./, '') === host).slice(0, 3);
  const fonts = [];
  for (const s of sheets) {
    try {
      const r = await api.fetchPage(s.url, signal);
      if (!r.body) continue;
      for (const m of r.body.matchAll(/url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf)(?:\?[^"')]*)?)["']?\s*\)/gi)) {
        try { fonts.push({ url: new URL(m[1], s.url).href, type: 'font' }); } catch {}
      }
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  return fonts;
}

/**
 * @param {object} o
 * @param {object} o.page    homepage record from the crawl (with resources)
 * @param {object} o.api     worker client (measureUrl, fetchPage)
 * @param {object|null} o.psi  runPageSpeed() result or null
 */
export async function analyzePerformance({ page, api, psi = null, signal, onProgress }) {
  const fonts = await discoverFonts(page, api, signal).catch(e => { if (e.name === 'AbortError') throw e; return []; });
  const seen = new Set();
  const list = [...page.resources, ...fonts].filter(r => r.type !== 'iframe' && !seen.has(r.url) && seen.add(r.url));
  const toMeasure = list.slice(0, MAX_RESOURCES);
  let done = 0;

  const measured = await pool(toMeasure, 6, async res => {
    let m;
    try { m = await api.measureUrl(res.url, signal); }
    catch (e) {
      if (e.name === 'AbortError' || e.status === 401) throw e;
      if (e.code === 'budget_exhausted') return null; // free-scan limit: leave unmeasured
      m = { error: 'worker', message: e.message };
    }
    onProgress?.({ done: ++done, total: toMeasure.length, message: fileName(res.url) });
    const headers = m.headers || {};
    const transfer = Number(headers['content-length']) || null;
    const kind = kindOf(res.type, m.contentType, res.url);
    return {
      url: res.url, name: fileName(res.url), kind, blocking: !!res.blocking, lazy: !!res.lazy, hasDims: res.hasDims,
      status: m.status ?? 0, error: m.error || null,
      size: transfer ?? (m.error ? null : m.bytes), sizeIsTransfer: transfer != null, decoded: m.bytes ?? null, truncated: !!m.truncated,
      ms: m.error ? null : (m.ttfbMs || 0) + (m.downloadMs || 0),
      compressed: /gzip|br|zstd|deflate/i.test(headers['content-encoding'] || ''),
      maxAge: maxAgeOf(headers['cache-control']), cacheControl: headers['cache-control'] || null,
      thirdParty: new URL(res.url).hostname.replace(/^www\./, '') !== new URL(page.finalUrl).hostname.replace(/^www\./, ''),
    };
  }, signal).then(xs => xs.filter(Boolean));

  // The HTML document itself
  const docSize = Number(page.headers?.['content-length']) || page.bytes || null;
  const doc = {
    url: page.finalUrl, name: 'HTML page', kind: 'document', status: page.status, size: docSize, ms: page.ttfbMs ?? null,
    compressed: /gzip|br|zstd|deflate/i.test(page.headers?.['content-encoding'] || ''), maxAge: maxAgeOf(page.headers?.['cache-control']),
  };
  const all = [doc, ...measured];
  const ok = all.filter(r => !r.error && r.size != null);

  // ── Totals ──
  const sum = (kind) => ok.filter(r => kind == null || r.kind === kind).reduce((n, r) => n + r.size, 0);
  const count = kind => all.filter(r => r.kind === kind).length;
  const totals = {
    requests: list.length + 1, notMeasured: Math.max(0, list.length - measured.length),
    bytes: sum(), document: sum('document'), script: sum('script'), stylesheet: sum('stylesheet'), image: sum('image'), font: sum('font'), other: sum('other'),
    scripts: count('script'), stylesheets: count('stylesheet'), images: count('image'), fonts: count('font'),
    inlineScriptBytes: page.inlineScriptBytes || 0, inlineStyleBytes: page.inlineStyleBytes || 0,
  };
  const images = ok.filter(r => r.kind === 'image');
  const rasterBig = images.filter(r => RASTER.test(r.url) && r.size > 20 * KB);
  const blockingScripts = measured.filter(r => r.kind === 'script' && r.blocking).length;
  const blockingCss = measured.filter(r => r.kind === 'stylesheet' && r.blocking).length;
  const textRes = ok.filter(r => TEXT_TYPES.has(r.kind) && (r.decoded ?? r.size) > 2 * KB);
  const staticRes = ok.filter(r => ['script', 'stylesheet', 'image', 'font'].includes(r.kind));
  const pageImages = page.resources.filter(r => r.type === 'image');

  const metrics = {
    ttfbMs: page.ttfbMs ?? null,
    largestImage: images.reduce((m, r) => (!m || r.size > m.size ? r : m), null),
    compressionShare: textRes.length ? textRes.filter(r => r.compressed).length / textRes.length : null,
    cachingShare: staticRes.length ? staticRes.filter(r => r.maxAge >= 7 * 86400).length / staticRes.length : null,
    lazyShare: pageImages.length > 3 ? pageImages.slice(2).filter(r => r.lazy).length / (pageImages.length - 2) : null,
    dimsShare: pageImages.length ? pageImages.filter(r => r.hasDims).length / pageImages.length : null,
    modernShare: rasterBig.length + images.filter(r => MODERN.test(r.url)).length
      ? images.filter(r => MODERN.test(r.url)).length / (rasterBig.length + images.filter(r => MODERN.test(r.url)).length) : null,
    blockingScripts, blockingCss,
  };

  // ── Sub-scores (thresholds documented inline) ──
  const avg = xs => { const v = xs.filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const subscores = {
    loading: avg([lin(metrics.ttfbMs, 600, 2500), lin(totals.bytes, 1 * MB, 6 * MB), lin(totals.requests, 40, 150), lin(blockingScripts + Math.max(0, blockingCss - 2), 0, 8)]),
    images: images.length ? avg([
      lin(totals.image, 500 * KB, 4 * MB), lin(metrics.largestImage?.size, 250 * KB, 2.5 * MB),
      metrics.modernShare != null ? Math.round(metrics.modernShare * 100) : null,
      metrics.lazyShare != null ? Math.round(metrics.lazyShare * 100) : null,
      metrics.dimsShare != null ? Math.round(metrics.dimsShare * 100) : null,
    ]) : null,
    javascript: totals.scripts ? avg([lin(totals.script, 300 * KB, 2 * MB), lin(totals.scripts, 10, 50), lin(blockingScripts, 0, 5)]) : 100,
    css: avg([lin(totals.stylesheet + totals.inlineStyleBytes, 100 * KB, 600 * KB), lin(totals.stylesheets, 4, 20),
      metrics.compressionShare != null ? Math.round(metrics.compressionShare * 100) : null]),
    caching: metrics.cachingShare != null ? Math.round(metrics.cachingShare * 100) : null,
  };
  const resourceScore = weightedAverage(subscores, PERF_WEIGHTS);
  const psiOk = psi && !psi.error ? psi : null;
  const score = psiOk && resourceScore != null ? Math.round(LIGHTHOUSE_SHARE * psiOk.score + (1 - LIGHTHOUSE_SHARE) * resourceScore)
    : psiOk ? psiOk.score : resourceScore;

  // ── Per-resource problems ──
  for (const r of all) {
    const p = [];
    if (r.error || r.status >= 400) p.push(['critical', r.error ? 'Failed to load' : `Broken (${r.status})`]);
    else {
      if (r.kind === 'image' && r.size > MB) p.push(['critical', 'Very large']);
      else if (r.kind === 'image' && r.size > 300 * KB) p.push(['warning', 'Large']);
      if (r.kind === 'image' && RASTER.test(r.url) && r.size > 100 * KB) p.push(['info', 'Could use WebP/AVIF']);
      if (r.kind === 'script' && r.size > 500 * KB) p.push(['critical', 'Very large']);
      else if (r.kind === 'script' && r.size > 150 * KB) p.push(['warning', 'Large']);
      if (r.kind === 'stylesheet' && r.size > 150 * KB) p.push(['warning', 'Large']);
      if (r.kind === 'script' && r.blocking) p.push(['warning', 'Blocks rendering']);
      if (TEXT_TYPES.has(r.kind) && !r.compressed && (r.decoded ?? r.size) > 10 * KB) p.push(['warning', 'Not compressed']);
      if (['script', 'stylesheet', 'image', 'font'].includes(r.kind) && !r.thirdParty && r.maxAge < 86400) p.push(['info', 'Short or no caching']);
    }
    r.problems = p;
  }

  // ── Recommendations (specific, from measurements) ──
  const recs = [];
  const add = (impact, severity, title, detail) => recs.push({ impact, severity, title, detail });
  for (const r of images.filter(x => x.size > 300 * KB).sort((a, b) => b.size - a.size).slice(0, 3)) {
    add(r.size > MB ? 9 : 6, r.size > MB ? 'critical' : 'warning', `Compress ${r.name}`,
      `Your homepage loads a ${fmtBytes(r.size)} image (${r.name}). Resizing it to the size it's shown at and saving it as WebP could cut it by more than half and noticeably speed up mobile loading.`);
  }
  if (totals.script > 600 * KB) add(7, 'warning', 'Reduce JavaScript', `The page loads ${fmtBytes(totals.script)} of JavaScript across ${totals.scripts} files. Remove unused plugins and scripts, and defer the rest.`);
  if (blockingScripts) add(6, 'warning', 'Stop scripts blocking the page', `${blockingScripts} script${blockingScripts === 1 ? '' : 's'} in the <head> must download before anything shows. Add "defer" to them.`);
  if (metrics.compressionShare != null && metrics.compressionShare < 1) {
    const unc = textRes.filter(r => !r.compressed);
    add(5, 'warning', 'Turn on compression', `${unc.length} text file${unc.length === 1 ? ' is' : 's are'} sent uncompressed (${unc.slice(0, 2).map(r => r.name).join(', ')}). Enabling gzip/Brotli on the server typically shrinks them by 60–80%.`);
  }
  if (metrics.cachingShare != null && metrics.cachingShare < 0.7) add(4, 'warning', 'Let browsers cache your files', `Only ${Math.round(metrics.cachingShare * 100)}% of images, scripts, styles and fonts can be cached for a week or more, so returning visitors download them again.`);
  if (metrics.ttfbMs > 800) add(metrics.ttfbMs > 1800 ? 8 : 5, metrics.ttfbMs > 1800 ? 'critical' : 'warning', 'Speed up the server', `The server took ${(metrics.ttfbMs / 1000).toFixed(1)}s to start sending the page. Page caching or better hosting usually fixes this.`);
  if (metrics.lazyShare != null && metrics.lazyShare < 0.5) add(3, 'info', 'Lazy-load images', `${pageImages.length} images load immediately. Add loading="lazy" to images further down the page.`);
  if (metrics.modernShare != null && metrics.modernShare < 0.5 && rasterBig.length >= 2) add(3, 'info', 'Use modern image formats', `${rasterBig.length} JPEG/PNG images could be served as WebP or AVIF for smaller files at the same quality.`);
  if (totals.bytes > 3 * MB) add(6, 'warning', 'Lighten the page', `The homepage downloads ${fmtBytes(totals.bytes)} in total. Aim for under 2 MB so it loads quickly on mobile data.`);
  if (psiOk) for (const o of psiOk.opportunities.slice(0, 3)) add(Math.min(8, 3 + o.savingsMs / 1000), 'info', o.title, `Google Lighthouse estimates this could save about ${(o.savingsMs / 1000).toFixed(1)}s.`);
  recs.sort((a, b) => b.impact - a.impact);

  return {
    url: page.finalUrl, measuredAt: new Date().toISOString(),
    score, resourceScore, subscores, totals, metrics,
    psi: psiOk ? { score: psiOk.score, lab: psiOk.lab, field: psiOk.field } : null,
    psiError: psi?.error || null,
    resources: all.sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 60),
    recommendations: recs,
  };
}

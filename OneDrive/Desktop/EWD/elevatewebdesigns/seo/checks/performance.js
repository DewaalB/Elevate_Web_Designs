import { pageCheck, pass, skip, fail, result, plural } from './helpers.js';

const C = 'performance';
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export const performanceChecks = [

  function lighthouse({ psi }) {
    const def = { id: 'perf.lighthouse', category: C, title: 'Mobile performance score (Lighthouse)', weight: 10,
      fix: 'Start with the biggest opportunities listed: compress and resize images, remove unused JavaScript/CSS, and defer non-critical scripts.' };
    if (!psi) return skip(def, 'PageSpeed Insights was turned off for this audit.');
    if (psi.error) return skip(def, psi.error);
    const s = psi.score;
    const lab = Object.values(psi.lab).map(m => `${m.title}: ${m.display}`).join(' · ');
    const affected = psi.opportunities.map(o => ({ url: o.title, detail: `could save about ${(o.savingsMs / 1000).toFixed(1)}s` }));
    const status = s >= 90 ? 'pass' : s >= 50 ? 'warning' : 'critical';
    return result(def, { status, score: s / 100, message: `${s}/100 on mobile for ${psi.url}. ${lab}`, affected, data: { psi } });
  },

  function coreWebVitals({ psi }) {
    const def = { id: 'perf.core-web-vitals', category: C, title: 'Core Web Vitals (real Chrome users)', weight: 6,
      fix: 'Real-user experience is slow. Focus on the metric marked SLOW: LCP (main content load), INP (responsiveness) or CLS (layout jumps).' };
    if (!psi || psi.error) return skip(def, 'Needs PageSpeed Insights.');
    if (!psi.field?.overall) return skip(def, 'Google has no real-user (Chrome UX Report) data for this site yet — common for smaller sites. Lab results above still apply.');
    const f = psi.field;
    const metrics = Object.entries(f.metrics).map(([k, v]) => `${k} ${v.category}`).join(' · ');
    const scope = f.scope === 'page' ? 'this page' : 'the whole site';
    if (f.overall === 'FAST') return pass(def, `Real users of ${scope} get a fast experience. ${metrics}`);
    return fail(def, f.overall === 'SLOW' ? 'critical' : 'warning', `Real-user experience for ${scope} is ${f.overall === 'SLOW' ? 'poor' : 'average'}. ${metrics}`);
  },

  function serverResponse({ pages }) {
    const def = { id: 'perf.server-response', category: C, title: 'Fast server response', weight: 4,
      fix: 'Slow server responses usually mean slow hosting, no page caching, or heavy server-side code. Consider caching or a CDN.' };
    const timed = pages.filter(p => p.ttfbMs > 0);
    if (!timed.length) return skip(def, 'No timings recorded.');
    const med = median(timed.map(p => p.ttfbMs));
    const r = pageCheck(def, timed, p => p.ttfbMs > 1500 && `${(p.ttfbMs / 1000).toFixed(1)}s to first byte`,
      { passMessage: `Median time to first byte ${med} ms.`, failMessage: n => `${plural(n, 'page')} took over 1.5s to start responding (median ${med} ms).` });
    r.message += ' Measured from Cloudflare\'s network, so it reflects server speed rather than any one visitor\'s connection.';
    return r;
  },

  function htmlSize({ pages }) {
    const def = { id: 'perf.html-size', category: C, title: 'HTML documents are lean', weight: 2,
      fix: 'Large HTML is often inlined images/SVG, huge inline scripts or page-builder bloat. Move assets to separate files and trim markup.' };
    return pageCheck(def, pages, p => (p.truncated ? 'Over 3 MB — download was cut off' : p.bytes > 500 * 1024 && `${Math.round(p.bytes / 1024)} KB of HTML`),
      { passMessage: 'Every page\'s HTML is under 500 KB.' });
  },

  function renderBlocking({ pages }) {
    const def = { id: 'perf.render-blocking', category: C, title: 'No render-blocking scripts in <head>', weight: 3,
      fix: 'Add defer (or async) to <script src> tags in the <head>, or move them to the end of <body>, so the page can render first.' };
    return pageCheck(def, pages, p => p.renderBlockingScripts.length && `${plural(p.renderBlockingScripts.length, 'blocking script')}: ${p.renderBlockingScripts.slice(0, 2).map(s => s.split('/').pop()).join(', ')}`,
      { passMessage: 'No page has render-blocking scripts in the <head>.' });
  },

  function imageCaching({ checks, site }) {
    const def = { id: 'perf.image-caching', category: C, title: 'Images are cached by browsers', weight: 2,
      fix: 'Send a Cache-Control header with a long max-age (e.g. 1 week or more) for images so repeat visits load instantly.' };
    const own = [...checks.images].filter(([src, r]) => !r.error && r.status < 400 && new URL(src).hostname.replace(/^www\./, '') === site.rootHost.replace(/^www\./, ''));
    if (!own.length) return skip(def, 'No images on this domain were checked.');
    const uncached = own.filter(([, r]) => {
      const cc = r.headers?.['cache-control'] || '';
      const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1] || 0);
      return /no-store|no-cache/.test(cc) || maxAge < 86400;
    });
    if (!uncached.length) return pass(def, `All ${own.length} checked images are cacheable for a day or more.`);
    return result(def, { status: 'warning', score: 1 - uncached.length / own.length,
      message: `${uncached.length} of ${own.length} images are cached for less than a day (or not at all).`,
      affected: uncached.map(([src, r]) => ({ url: src, detail: r.headers?.['cache-control'] ? `Cache-Control: ${r.headers['cache-control']}` : 'No Cache-Control header' })) });
  },
];


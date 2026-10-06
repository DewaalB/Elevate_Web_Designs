/* Thin client for the SEO worker (cf-seo-worker) and Google PageSpeed Insights. */

const PROD_WORKER_URL = 'https://elevate-seo-audit.dewaalb3.workers.dev';
const DEV_WORKER_URL = 'http://localhost:8787';

/** Dev mode (local testing only): http://localhost…/seo.html?dev=1 talks to
 *  `wrangler dev` without signing in. The deployed worker always requires
 *  the admin's sign-in token, so this switch can't bypass anything in production. */
export const DEV_MODE = ['localhost', '127.0.0.1'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('dev');

export class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export const WORKER_URL = DEV_MODE ? DEV_WORKER_URL : PROD_WORKER_URL;

/** getToken: admin sign-in token getter. getSession (optional): public scan
 *  session id — when it returns one, requests use it instead of a sign-in. */
export function createApi(getToken, { getSession } = {}) {
  const base = WORKER_URL;

  async function postOnce(path, body, signal) {
    const headers = { 'content-type': 'application/json' };
    const sid = getSession?.();
    if (sid) headers['x-session'] = sid;
    else if (!DEV_MODE) headers.authorization = `Bearer ${await getToken()}`;
    let res;
    try {
      res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiError('worker_unreachable', 'Could not reach the SEO audit worker. Check your connection or that the worker is deployed.');
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new ApiError(data?.error || 'worker_error', data?.message || `Worker returned HTTP ${res.status}`, res.status);
    return data;
  }

  /** Phones pause background tabs and drop their requests. Transient failures
   *  wait until the tab is visible and online again, then retry, so a scan
   *  survives the screen turning off or a quick app switch. */
  async function post(path, body, signal, { retries = 4 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await postOnce(path, body, signal); }
      catch (e) {
        const transient = e.code === 'worker_unreachable' || ([502, 503, 504].includes(e.status) && e.code !== 'ai_not_configured');
        if (signal?.aborted || !transient || attempt >= retries) throw e;
        await waitUntilActive(signal);
        await sleep(1000 * 2 ** attempt, signal);
      }
    }
  }

  return {
    base,
    fetchPage: (url, signal) => post('/fetch', { url }, signal),
    checkUrl: (url, signal) => post('/check', { url }, signal),
    measureUrl: (url, signal) => post('/measure', { url }, signal),
    ai: (summary, signal) => post('/ai', { summary }, signal, { retries: 1 }),
    async health() {
      try { const r = await fetch(base + '/health'); return r.ok ? await r.json() : null; } catch { return null; }
    },
  };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Resolves once the page is visible and the device is online. */
export function waitUntilActive(signal) {
  if (document.visibilityState === 'visible' && navigator.onLine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) { cleanup(); resolve(); }
    };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      signal?.removeEventListener('abort', abort);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const LAB_AUDITS = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'];
const FIELD_METRICS = {
  LARGEST_CONTENTFUL_PAINT_MS: 'LCP', INTERACTION_TO_NEXT_PAINT: 'INP', CUMULATIVE_LAYOUT_SHIFT_SCORE: 'CLS',
  FIRST_CONTENTFUL_PAINT_MS: 'FCP', EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'TTFB',
};

/** Runs Lighthouse (via PageSpeed Insights) for one URL. Returns a compact
 *  summary, or {error} — never a made-up score. */
export async function runPageSpeed(url, { strategy = 'mobile', key = '', signal } = {}) {
  const qs = new URLSearchParams({ url, strategy, category: 'performance' });
  if (key) qs.set('key', key);
  let res;
  for (let attempt = 0; !res; attempt++) {
    try { res = await fetch(`${PSI_ENDPOINT}?${qs}`, { signal }); }
    catch (e) {
      if (signal?.aborted) throw e;
      if (attempt >= 1) return { error: 'PageSpeed Insights could not be reached.' };
      await waitUntilActive(signal); // the phone may have paused the tab mid-request
    }
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    return { error: res.status === 429 ? 'PageSpeed Insights quota exceeded — add a free API key in Settings.' : `PageSpeed Insights error: ${msg}` };
  }
  const lh = data.lighthouseResult;
  if (!lh?.categories?.performance) return { error: 'PageSpeed Insights returned no performance result.' };

  const lab = {};
  for (const id of LAB_AUDITS) {
    const a = lh.audits[id];
    if (a) lab[id] = { title: a.title, display: a.displayValue || '', score: a.score };
  }
  const opportunities = Object.values(lh.audits)
    .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9 && (a.details.overallSavingsMs || 0) > 0)
    .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs)
    .slice(0, 8)
    .map(a => ({ title: a.title, savingsMs: Math.round(a.details.overallSavingsMs) }));

  const fieldSrc = data.loadingExperience?.metrics ? data.loadingExperience
    : data.originLoadingExperience?.metrics ? data.originLoadingExperience : null;
  const field = fieldSrc ? {
    scope: fieldSrc === data.loadingExperience ? 'page' : 'origin',
    overall: fieldSrc.overall_category || null,
    metrics: Object.fromEntries(Object.entries(fieldSrc.metrics)
      .filter(([k]) => FIELD_METRICS[k])
      .map(([k, v]) => [FIELD_METRICS[k], { p75: v.percentile, category: v.category }])),
  } : null;

  return {
    url: lh.finalDisplayedUrl || lh.finalUrl || url,
    strategy,
    score: Math.round(lh.categories.performance.score * 100),
    lab, opportunities, field,
    fetchedAt: lh.fetchTime,
  };
}

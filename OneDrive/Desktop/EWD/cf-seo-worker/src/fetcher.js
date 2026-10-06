/* Fetches a URL hop-by-hop (redirect: 'manual') so every redirect is
   recorded and safety-checked, with an overall timeout and a body size cap.
   Parsing happens in the dashboard (browser DOMParser), not here — that
   keeps this worker well inside Cloudflare's free-plan CPU budget. */
import { assertPublicUrl } from './guard.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; ElevateSEOAudit/1.0; +https://elevatewebdesign.co.za)';

const TEXT_TYPE = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json|ld\+json|manifest\+json))/i;
const KEEP_HEADERS = [
  'content-type', 'content-length', 'content-encoding', 'x-robots-tag', 'cache-control',
  'last-modified', 'server', 'strict-transport-security', 'link', 'cf-mitigated', 'retry-after',
  'content-language', 'vary', 'x-frame-options',
  'x-content-type-options', 'referrer-policy', 'content-security-policy', 'permissions-policy',
];

function pickHeaders(headers) {
  const out = {};
  for (const k of KEEP_HEADERS) { const v = headers.get(k); if (v != null) out[k] = v.slice(0, 1000); }
  return out;
}

function charsetOf(contentType, firstBytes) {
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder('latin1').decode(firstBytes.slice(0, 2048));
  return head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes + value.byteLength > maxBytes) {
      chunks.push(value.slice(0, maxBytes - bytes));
      bytes = maxBytes; truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value); bytes += value.byteLength;
  }
  const all = new Uint8Array(bytes);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return { all, bytes, truncated };
}

/**
 * @param {string} rawUrl
 * @param {{method?: 'GET'|'HEAD', readBody?: boolean, maxBytes?: number, timeoutMs?: number, maxHops?: number}} opts
 */
export async function fetchChain(rawUrl, opts = {}) {
  const { method = 'GET', readBody = true, countBody = false, maxBytes = 3_000_000, timeoutMs = 15_000, maxHops = 10 } = opts;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const redirects = [];
  const seen = new Set();
  const fail = (error, message, extra = {}) =>
    ({ requestedUrl: rawUrl, finalUrl: current, status: 0, redirects, error, message, totalMs: Date.now() - started, ...extra });

  let current;
  try { current = assertPublicUrl(rawUrl).href; } catch (e) { current = rawUrl; return fail('blocked', e.message); }

  for (let hop = 0; hop <= maxHops; hop++) {
    if (seen.has(current)) return fail('redirect_loop', 'Redirect loop detected');
    seen.add(current);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, deadline - Date.now()));
    const hopStart = Date.now();
    let res;
    try {
      res = await fetch(current, {
        method, redirect: 'manual', signal: ctrl.signal,
        headers: {
          'user-agent': USER_AGENT,
          'accept': method === 'GET' ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : '*/*',
          'accept-language': 'en-ZA,en;q=0.9',
          // Ask for compression like a browser does, so compression checks reflect what visitors get.
          'accept-encoding': 'gzip, br',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      return ctrl.signal.aborted ? fail('timeout', `No response within ${Math.round(timeoutMs / 1000)}s`)
                                 : fail('network', 'Could not connect — the domain may not exist (DNS) or the server refused the connection');
    }
    const ttfbMs = Date.now() - hopStart;
    const location = res.headers.get('location');

    if (res.status >= 300 && res.status < 400 && location) {
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch {}
      let next;
      try { next = new URL(location, current).href; } catch { return fail('bad_redirect', `Invalid redirect target: ${location}`); }
      redirects.push({ url: current, status: res.status, location: next, ms: ttfbMs });
      try { assertPublicUrl(next); } catch (e) { return fail('blocked', `Redirect blocked: ${e.message}`); }
      current = next;
      continue;
    }

    const contentType = res.headers.get('content-type') || '';
    const out = {
      requestedUrl: rawUrl, finalUrl: current, status: res.status, redirects,
      headers: pickHeaders(res.headers), contentType, ttfbMs, bytes: 0, truncated: false, body: null,
    };
    try {
      if (readBody && method === 'GET' && res.body && TEXT_TYPE.test(contentType)) {
        const { all, bytes, truncated } = await readCapped(res, maxBytes);
        let decoder;
        try { decoder = new TextDecoder(charsetOf(contentType, all)); } catch { decoder = new TextDecoder('utf-8'); }
        Object.assign(out, { body: decoder.decode(all), bytes, truncated });
      } else if (countBody && method === 'GET' && res.body) {
        // Download only to measure size and time; nothing is kept or returned.
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.bytes += value.byteLength;
          if (out.bytes > maxBytes) { out.truncated = true; await reader.cancel(); break; }
        }
      } else {
        try { await res.body?.cancel(); } catch {}
      }
    } catch (e) {
      clearTimeout(timer);
      return ctrl.signal.aborted ? fail('timeout', 'Page took too long to download', { status: res.status })
                                 : fail('network', e.message || 'Download failed', { status: res.status });
    }
    clearTimeout(timer);
    out.totalMs = Date.now() - started;
    return out;
  }
  return fail('too_many_redirects', `More than ${maxHops} redirects`);
}

/** Lightweight status check for links/images: HEAD, falling back to GET when HEAD isn't supported. */
/** Downloads a page resource (script, stylesheet, image, font) to measure its real
 *  size and download time. bytes = decoded size; headers['content-length'] is the
 *  transfer size when the server sends it. */
export async function measureUrl(rawUrl) {
  const r = await fetchChain(rawUrl, { method: 'GET', readBody: false, countBody: true, maxBytes: 10_000_000, timeoutMs: 15_000, maxHops: 5 });
  if (!r.error) r.downloadMs = Math.max(0, r.totalMs - (r.ttfbMs || 0) - (r.redirects?.reduce((n, h) => n + (h.ms || 0), 0) || 0));
  return r;
}

export async function checkUrl(rawUrl) {
  let r = await fetchChain(rawUrl, { method: 'HEAD', readBody: false, timeoutMs: 10_000 });
  if (!r.error && [400, 403, 405, 501].includes(r.status)) {
    r = await fetchChain(rawUrl, { method: 'GET', readBody: false, timeoutMs: 10_000 });
  }
  const { body, ...rest } = r;
  return rest;
}

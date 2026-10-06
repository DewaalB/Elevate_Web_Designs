/* =========================================================
   ELEVATE — SEO Audit fetcher (Cloudflare Worker)
   =========================================================
   A locked-down fetch service for the SEO Audit dashboard
   (elevatewebdesigns/seo.html). Browsers can't read other
   websites (CORS), so the dashboard asks this worker for one
   URL at a time and does all crawling and analysis itself.

   Endpoints (all POST JSON, all require the admin's Firebase
   ID token as `Authorization: Bearer <token>`):
     /fetch  {url}       full page: status, redirect chain,
                         headers, timing, body (≤3 MB, text only)
     /check  {url}       status-only check for links and images
     /ai     {summary}   Claude recommendations (needs the
                         ANTHROPIC_API_KEY secret)
   POST /measure {url}   download a page resource to measure size/time
   POST /public/growth/session {urls, turnstileToken}
                         public Website Growth scan: Turnstile, then a
                         session id (x-session header) with a request
                         budget, accepted by /fetch, /check, /measure
   POST /public/quick {url, turnstileToken}
                         public Quick SEO Check — no sign-in, but
                         Turnstile + per-IP/global daily limits
   GET /health           liveness, no auth
   ========================================================= */
import { verifyAdmin, AuthError } from './auth.js';
import { fetchChain, checkUrl, measureUrl } from './fetcher.js';
import { aiRecommendations, Anthropic } from './ai.js';
import { quickCheck, QuickError } from './quick.js';
import { startGrowthSession, consumeSession } from './growth.js';
export { Limiter } from './limiter.js';

const MAX_BODY = 300_000;

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const devLocal = env.DEV_NO_AUTH === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.includes(origin) && !devLocal) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-session',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('Request too large');
  return JSON.parse(text || '{}');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ch = cors(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY) }, 200, ch);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, ch);

    // Public visitor endpoint: its own protection (Turnstile + limits), no admin token.
    if (url.pathname === '/public/quick') {
      if (!ch['access-control-allow-origin']) return json({ error: 'forbidden' }, 403, ch);
      try {
        return json(await quickCheck(await readJson(request), request, env), 200, ch);
      } catch (e) {
        if (e instanceof QuickError) return json({ error: e.code, message: e.message }, e.status, ch);
        return json({ error: 'quick_failed', message: 'Something went wrong running the check. Please try again.' }, 500, ch);
      }
    }

    if (url.pathname === '/public/growth/session') {
      if (!ch['access-control-allow-origin']) return json({ error: 'forbidden' }, 403, ch);
      try {
        return json(await startGrowthSession(await readJson(request), request, env), 200, ch);
      } catch (e) {
        if (e instanceof QuickError) return json({ error: e.code, message: e.message }, e.status, ch);
        console.log('growth session failed', e.message);
        return json({ error: 'session_failed', message: 'Could not start the scan. Please try again.' }, 500, ch);
      }
    }

    let body;
    try { body = await readJson(request); } catch (e) { return json({ error: 'bad_request', message: e.message }, 400, ch); }

    const session = request.headers.get('x-session');
    if (session) {
      // Public scan: limited to /fetch, /check, /measure within the session's budget.
      if (!ch['access-control-allow-origin']) return json({ error: 'forbidden' }, 403, ch);
      const kind = { '/fetch': 'fetch', '/check': 'check', '/measure': 'measure' }[url.pathname];
      if (!kind || typeof body.url !== 'string') return json({ error: 'bad_request', message: 'Not available for public scans.' }, 400, ch);
      try { await consumeSession(session, body.url, kind, env); }
      catch (e) {
        if (e instanceof QuickError) return json({ error: e.code, message: e.message }, e.status, ch);
        throw e;
      }
    } else {
      // Local `wrangler dev` only: .dev.vars can switch auth off for requests to localhost.
      const devBypass = env.DEV_NO_AUTH === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);
      if (!devBypass) {
        try { await verifyAdmin(request, env); }
        catch (e) {
          if (e instanceof AuthError) return json({ error: 'unauthorized', message: e.message }, 401, ch);
          return json({ error: 'auth_unavailable', message: e.message }, 503, ch);
        }
      }
    }

    switch (url.pathname) {
      case '/fetch':
        if (typeof body.url !== 'string') return json({ error: 'bad_request', message: 'url is required' }, 400, ch);
        return json(await fetchChain(body.url), 200, ch);

      case '/check':
        if (typeof body.url !== 'string') return json({ error: 'bad_request', message: 'url is required' }, 400, ch);
        return json(await checkUrl(body.url), 200, ch);

      case '/measure':
        if (typeof body.url !== 'string') return json({ error: 'bad_request', message: 'url is required' }, 400, ch);
        return json(await measureUrl(body.url), 200, ch);

      case '/ai': {
        if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured', message: 'Add the ANTHROPIC_API_KEY secret to enable AI recommendations.' }, 503, ch);
        if (!body.summary || typeof body.summary !== 'object') return json({ error: 'bad_request', message: 'summary is required' }, 400, ch);
        try {
          return json(await aiRecommendations(body.summary, env), 200, ch);
        } catch (e) {
          if (e instanceof Anthropic.RateLimitError) return json({ error: 'ai_rate_limited', message: 'The AI service is busy — try again in a minute.' }, 429, ch);
          if (e instanceof Anthropic.AuthenticationError) return json({ error: 'ai_bad_key', message: 'The ANTHROPIC_API_KEY secret is invalid.' }, 502, ch);
          if (e instanceof Anthropic.APIError) return json({ error: 'ai_error', message: `AI service error ${e.status}: ${e.message}` }, 502, ch);
          return json({ error: 'ai_error', message: e.message }, 502, ch);
        }
      }

      default:
        return json({ error: 'not_found' }, 404, ch);
    }
  },
};

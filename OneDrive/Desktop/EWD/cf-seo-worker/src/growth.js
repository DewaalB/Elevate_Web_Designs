/* Public Website Growth sessions. A visitor passes Turnstile once and gets a
   short-lived session id with a request budget sized for the sites they
   entered; /fetch, /check and /measure then accept `x-session: <id>`. */
import { assertPublicUrl } from './guard.js';
import { verifyTurnstile, QuickError } from './quick.js';

export const PUBLIC_LIMITS = {
  sitesMax: 3,          // own site + 2 competitors
  budgetPerSite: 140,   // ~15 pages + robots/sitemaps/probes + link/image checks + ~40 resource measurements
  ipDaily: 3,           // scan sessions per visitor per day
  globalDaily: 100,     // scan sessions per day for everyone
};

const siteKey = host => host.toLowerCase().replace(/^www\./, '');

function limiter(env) {
  return env.LIMITER.get(env.LIMITER.idFromName('global'));
}

export async function startGrowthSession(body, request, env) {
  if (!env.TURNSTILE_SECRET || !env.LIMITER) throw new QuickError('growth_not_configured', 'Website Growth scans are being set up. Please try again later.', 503);
  const urls = Array.isArray(body.urls) ? body.urls.slice(0, PUBLIC_LIMITS.sitesMax) : [];
  if (!urls.length) throw new QuickError('bad_url', 'Enter a website address to scan.', 400);
  const hosts = [];
  for (const raw of urls) {
    const s = String(raw || '').trim();
    try { hosts.push(siteKey(assertPublicUrl(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname)); }
    catch (e) { throw new QuickError('bad_url', `"${s.slice(0, 80)}" can't be scanned: ${e.message}.`, 400); }
  }
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  // Optional overrides via wrangler vars: GROWTH_IP_DAILY, GROWTH_GLOBAL_DAILY.
  const ipDaily = Number(env.GROWTH_IP_DAILY) || PUBLIC_LIMITS.ipDaily;
  const globalDaily = Number(env.GROWTH_GLOBAL_DAILY) || PUBLIC_LIMITS.globalDaily;
  await verifyTurnstile(body.turnstileToken, ip, env);
  const r = await limiter(env).startSession({
    ip, hosts: [...new Set(hosts)], budget: PUBLIC_LIMITS.budgetPerSite * hosts.length,
    ipDaily, globalDaily,
  });
  if (r.error === 'limit_reached') throw new QuickError('limit_reached', `You've used today's ${ipDaily} free scans. Come back tomorrow, or ask us for a full audit.`, 429);
  if (r.error === 'busy') throw new QuickError('busy', 'The free scanner is very busy today. Please try again tomorrow, or ask us for a full audit.', 429);
  return { session: r.sid, expiresAt: r.exp, budget: r.budget, hosts };
}

/** Throws QuickError when the session can't make this request. */
export async function consumeSession(sid, targetUrl, kind, env) {
  if (!env.LIMITER) throw new QuickError('growth_not_configured', 'Scanning is unavailable right now.', 503);
  let host, path;
  try { const u = new URL(targetUrl); host = siteKey(u.hostname); path = u.pathname; } catch { throw new QuickError('bad_request', 'Invalid URL', 400); }
  // robots.txt may point to a sitemap on another domain (Google allows that), so
  // sitemap files may be read from any host; every other page fetch stays on the entered sites.
  if (kind === 'fetch' && /(^|\/)(sitemap[^/]*|[^/]*\.xml)(\.gz)?$/i.test(path)) kind = 'sitemap';
  const r = await limiter(env).consume(String(sid).slice(0, 64), host, kind);
  if (r.ok) return;
  const msg = {
    session_expired: 'This scan session expired. Please start the scan again.',
    host_not_allowed: 'This scan can only read pages from the websites you entered.',
    budget_exhausted: 'This scan reached its free limit. Results so far are shown.',
  }[r.error] || 'Scan not allowed.';
  throw new QuickError(r.error, msg, r.error === 'budget_exhausted' ? 429 : 403);
}

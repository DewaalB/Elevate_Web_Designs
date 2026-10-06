/* Public "Quick SEO Check" for website visitors.
   One request does a small, fixed scan — homepage, up to 4 linked pages,
   robots.txt, sitemap and three site probes — so visitors can't use the
   worker as a general fetcher. Protected by Cloudflare Turnstile plus
   per-IP and global daily limits (KV), so public use can't eat the
   account's free request allowance. */
import { assertPublicUrl } from './guard.js';
import { fetchChain, checkUrl } from './fetcher.js';

const IP_DAILY = 5;
const GLOBAL_DAILY = 300;
const EXTRA_PAGES = 4;
const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mp3|zip|docx?|xlsx?|pptx?|csv|txt|xml|json|css|js)$/i;

export class QuickError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function verifyTurnstile(token, ip, env) {
  if (!token || typeof token !== 'string') throw new QuickError('captcha_failed', 'Please complete the "I\'m human" check.', 403);
  const form = new FormData();
  // Tolerate stray whitespace/quotes from pasting the secret into a terminal.
  form.append('secret', String(env.TURNSTILE_SECRET).trim().replace(/^["']|["']$/g, '').trim());
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  // Reason codes show in `npx wrangler tail` (e.g. invalid-input-secret = wrong TURNSTILE_SECRET).
  if (!data.success) console.log('turnstile rejected', JSON.stringify(data['error-codes']));
  if (!data.success) throw new QuickError('captcha_failed', 'The "I\'m human" check expired or failed. Please try again.', 403);
}

async function enforceLimits(ip, env) {
  const day = new Date().toISOString().slice(0, 10);
  const ipKey = `ip:${day}:${ip}`, allKey = `all:${day}`;
  const [ipCount, allCount] = await Promise.all([env.QUICK_LIMITS.get(ipKey), env.QUICK_LIMITS.get(allKey)]);
  if (Number(ipCount) >= IP_DAILY) throw new QuickError('limit_reached', `You've used today's ${IP_DAILY} free checks. Come back tomorrow, or ask us for a full audit.`, 429);
  if (Number(allCount) >= GLOBAL_DAILY) throw new QuickError('busy', 'The free checker is very busy today. Please try again tomorrow, or ask us for a full audit.', 429);
  // KV counters are approximate (no atomic increment) — fine for abuse limits.
  const ttl = { expirationTtl: 2 * 86400 };
  await Promise.all([
    env.QUICK_LIMITS.put(ipKey, String(Number(ipCount) + 1), ttl),
    env.QUICK_LIMITS.put(allKey, String(Number(allCount) + 1), ttl).catch(() => {}),
  ]);
}

/** Up to `max` same-site page links from the homepage, shallowest paths first. */
function pickLinks(html, baseUrl, max) {
  const base = new URL(baseUrl);
  const site = base.hostname.replace(/^www\./, '');
  const seen = new Set([base.href.replace(/#.*$/, '')]);
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== site || FILE_EXT.test(u.pathname)) continue;
    u.hash = '';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
  }
  return out.sort((a, b) => a.split('/').length - b.split('/').length).slice(0, max);
}

export async function quickCheck(body, request, env) {
  if (!env.TURNSTILE_SECRET || !env.QUICK_LIMITS) throw new QuickError('quick_not_configured', 'The free SEO check is being set up. Please try again later.', 503);

  const raw = String(body.url || '').trim();
  let start;
  try { start = assertPublicUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch (e) { throw new QuickError('bad_url', `That address can't be checked: ${e.message}.`, 400); }

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  await verifyTurnstile(body.turnstileToken, ip, env);
  await enforceLimits(ip, env);

  const home = await fetchChain(start.href, { maxBytes: 1_500_000, timeoutMs: 15_000, maxHops: 5 });
  if (home.error || home.status >= 400 || !home.body || !/html/i.test(home.contentType || '')) {
    const why = home.error ? home.message : home.status >= 400 ? `it returned error ${home.status}` : 'it did not return a web page';
    throw new QuickError('site_unreachable', `We couldn't load ${start.hostname} (${why}). Check the address and try again.`, 422);
  }
  const finalUrl = new URL(home.finalUrl);
  const origin = finalUrl.origin;
  const altHost = finalUrl.hostname.startsWith('www.') ? finalUrl.hostname.slice(4) : `www.${finalUrl.hostname}`;

  const robots = await fetchChain(`${origin}/robots.txt`, { maxBytes: 100_000, timeoutMs: 8_000, maxHops: 3 });
  const sitemapUrl = (robots.status === 200 && robots.body?.match(/^\s*sitemap:\s*(\S+)/im)?.[1]) || `${origin}/sitemap.xml`;
  let sitemapTarget = null;
  try { sitemapTarget = assertPublicUrl(sitemapUrl).href; } catch {}

  const links = pickLinks(home.body, home.finalUrl, EXTRA_PAGES);
  const [sitemap, http, alt, notFound, ...pages] = await Promise.all([
    sitemapTarget ? fetchChain(sitemapTarget, { maxBytes: 500_000, timeoutMs: 8_000, maxHops: 3 }) : null,
    checkUrl(`http://${finalUrl.hostname}/`),
    checkUrl(`${finalUrl.protocol}//${altHost}/`),
    checkUrl(`${origin}/elevate-seo-check-${crypto.randomUUID().slice(0, 8)}`),
    ...links.map(u => fetchChain(u, { maxBytes: 800_000, timeoutMs: 10_000, maxHops: 3 })),
  ]);

  return {
    input: raw, home, robots, sitemap, pages,
    probes: { http, altHost: alt, notFound }, limits: { perDay: IP_DAILY },
  };
}

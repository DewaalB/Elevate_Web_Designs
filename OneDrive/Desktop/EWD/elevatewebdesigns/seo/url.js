/* URL helpers shared by the crawler and the checks. */

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid)$/i;
const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|webm|mov|avi|m4v|mp3|wav|ogg|m4a|zip|rar|7z|gz|tar|exe|dmg|msi|apk|docx?|xlsx?|pptx?|odt|csv|txt|xml|json|css|js|mjs|map|woff2?|ttf|otf|eot|rss)$/i;

/** Absolute, crawl-comparable form of a URL: no fragment, lower-case host,
 *  no default port, tracking parameters removed. Returns null for non-web URLs. */
export function normalizeUrl(raw, base) {
  let u;
  try { u = new URL(String(raw).trim(), base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  return u.href;
}

/** www.example.com and example.com count as the same site. */
export const siteKey = host => String(host).toLowerCase().replace(/^www\./, '');

export function isSameSite(url, rootHost) {
  try { return siteKey(new URL(url).hostname) === siteKey(rootHost); } catch { return false; }
}

export function isFileUrl(url) {
  try { return FILE_EXT.test(new URL(url).pathname); } catch { return false; }
}

/** Key that ignores a trailing slash and letter case in the path — used to
 *  spot the same page linked under different spellings. */
export function looseKey(url) {
  const u = new URL(url);
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
  return `${siteKey(u.hostname)}${path.toLowerCase()}${u.search}`;
}

export function pathOf(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

/** Short display form: path for internal URLs, full URL otherwise. */
export function shortUrl(url, rootHost) {
  if (!url) return '';
  return rootHost && isSameSite(url, rootHost) ? (pathOf(url) || '/') : url;
}

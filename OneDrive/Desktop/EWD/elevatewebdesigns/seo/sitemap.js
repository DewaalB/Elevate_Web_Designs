/* XML sitemap parsing (urlset and sitemap index), plus plain-text sitemaps. */

export function parseSitemap(text) {
  const src = String(text || '').trim();
  if (!src) return { type: 'invalid', error: 'Empty file', urls: [], sitemaps: [] };

  if (!src.startsWith('<')) {
    const urls = src.split(/\s+/).filter(l => /^https?:\/\//i.test(l)).map(loc => ({ loc }));
    return urls.length ? { type: 'text', urls, sitemaps: [] }
                       : { type: 'invalid', error: 'Not XML and contains no URLs', urls: [], sitemaps: [] };
  }

  const doc = new DOMParser().parseFromString(src, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    return { type: 'invalid', error: 'XML could not be parsed', urls: [], sitemaps: [] };
  }
  const root = doc.documentElement.localName;
  const text1 = (el, name) => el.getElementsByTagNameNS('*', name)[0]?.textContent.trim() || null;

  if (root === 'sitemapindex') {
    const sitemaps = [...doc.getElementsByTagNameNS('*', 'sitemap')].map(s => text1(s, 'loc')).filter(Boolean);
    return { type: 'index', urls: [], sitemaps };
  }
  if (root === 'urlset') {
    const urls = [...doc.getElementsByTagNameNS('*', 'url')].map(u => ({
      loc: text1(u, 'loc'),
      lastmod: text1(u, 'lastmod'),
      priority: text1(u, 'priority') != null ? Number(text1(u, 'priority')) : null,
    })).filter(u => u.loc);
    return { type: 'urlset', urls, sitemaps: [] };
  }
  return { type: 'invalid', error: `Unexpected root element <${root}>`, urls: [], sitemaps: [] };
}

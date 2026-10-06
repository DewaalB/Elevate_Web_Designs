/* Generates ready-to-paste fixes from the crawl data. Everything here is
   deterministic: values come from the audited site, and anything the crawl
   couldn't know is left as an obvious FILL-IN placeholder. */
import { typesOf } from './extract.js';
import { isOrgType, isLocalType } from './checks/schema.js';

const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const htmlAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const failing = (results, id) => results.some(r => r.id === id && (r.status === 'critical' || r.status === 'warning'));

function businessName(home) {
  if (home?.og?.site_name) return home.og.site_name;
  const t = home?.title || '';
  const parts = t.split(/\s[|–—-]\s/).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || 'FILL IN business name';
}

function e164(phone) {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  if (d.startsWith('27')) return `+${d}`;
  if (d.startsWith('0') && d.length === 10) return `+27${d.slice(1)}`;
  return d;
}

export function buildFixes(ctx, results) {
  const { site, indexable, home, pages } = ctx;
  const fixes = [];

  // 1. sitemap.xml
  const live = indexable.filter(p => p.status === 200 && !p.redirects?.length).map(p => p.finalUrl);
  if (live.length && (failing(results, 'tech.sitemap') || failing(results, 'tech.sitemap-quality') || failing(results, 'onpage.orphans'))) {
    const body = live.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
      .map(u => `  <url>\n    <loc>${xmlEscape(u)}</loc>\n  </url>`).join('\n');
    fixes.push({
      id: 'fix.sitemap', relatedCheck: 'tech.sitemap', title: 'sitemap.xml', filename: 'sitemap.xml', language: 'xml',
      description: `Lists the ${live.length} live, indexable pages found in this crawl. Upload it to your site root, check it includes every page you want in Google, then submit it in Search Console.${site.crawl.limitHit ? ' The crawl hit its page limit, so some pages may be missing.' : ''}`,
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    });
  }

  // 2. robots.txt
  const robotsMissing = failing(results, 'tech.robots-txt');
  const robotsNoSitemap = failing(results, 'tech.sitemap-in-robots');
  if (robotsMissing || robotsNoSitemap) {
    const content = robotsMissing
      ? `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`
      : `${site.robots.text.trimEnd()}\n\nSitemap: ${site.origin}/sitemap.xml\n`;
    fixes.push({
      id: 'fix.robots', relatedCheck: robotsMissing ? 'tech.robots-txt' : 'tech.sitemap-in-robots', title: 'robots.txt', filename: 'robots.txt', language: 'text',
      description: robotsMissing ? 'A minimal robots.txt that allows all crawlers and points them to your sitemap. Add Disallow lines for any private areas (e.g. /admin).'
        : 'Your current robots.txt with the sitemap line added at the end.',
      content,
    });
  }
  if (failing(results, 'tech.robots-googlebot')) {
    fixes.push({
      id: 'fix.robots-blocking', relatedCheck: 'tech.robots-googlebot', title: 'robots.txt rules blocking Google', language: 'text',
      description: 'These are your current rules for Googlebot. Remove or narrow the Disallow lines that match pages you want in search results.',
      content: site.robots.googleRules.map(r => `${r.allow ? 'Allow' : 'Disallow'}: ${r.path}`).join('\n') || '(none)',
    });
  }

  // 3. Head tags
  const headLines = [];
  if (failing(results, 'tech.charset')) headLines.push('<meta charset="UTF-8">');
  if (failing(results, 'tech.viewport')) headLines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (failing(results, 'tech.canonical-missing')) headLines.push('<link rel="canonical" href="https://FULL-URL-OF-THIS-PAGE">');
  if (headLines.length || failing(results, 'tech.lang')) {
    fixes.push({
      id: 'fix.head', relatedCheck: 'tech.viewport', title: 'Missing <head> tags', language: 'html',
      description: 'Add these inside <head> on every page that the related checks list (the canonical must be each page\'s own full URL).' +
        (failing(results, 'tech.lang') ? ' Also set the page language on the <html> tag.' : ''),
      content: [failing(results, 'tech.lang') ? '<html lang="en-ZA">' : null, headLines.length ? '<head>' : null, ...headLines.map(l => `  ${l}`), headLines.length ? '</head>' : null].filter(Boolean).join('\n'),
    });
  }

  // 4. Business identity markup
  const allNodes = pages.flatMap(p => p.schemaNodes);
  const hasLocal = allNodes.some(n => typesOf(n).some(isLocalType));
  const hasOrg = allNodes.some(n => typesOf(n).some(isOrgType));
  if (!hasLocal || !hasOrg) {
    const phone = e164(pages.flatMap(p => [...p.telLinks, ...p.phones])[0]);
    const sameAs = [...new Set((home?.links || []).filter(l => !l.internal && /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok)\.com/i.test(l.url)).map(l => l.url))].slice(0, 6);
    const node = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: businessName(home),
      url: site.homeUrl,
      ...(home?.og?.image ? { image: home.og.image } : { image: 'FILL IN https://…/logo-or-photo.jpg' }),
      telephone: phone || 'FILL IN +27…',
      address: { '@type': 'PostalAddress', streetAddress: 'FILL IN', addressLocality: 'FILL IN town/city', addressRegion: 'FILL IN province', postalCode: 'FILL IN', addressCountry: 'ZA' },
      geo: { '@type': 'GeoCoordinates', latitude: 'FILL IN', longitude: 'FILL IN' },
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '17:00' }],
      ...(sameAs.length ? { sameAs } : {}),
    };
    fixes.push({
      id: 'fix.localbusiness', relatedCheck: 'local.business-schema', title: 'LocalBusiness structured data', language: 'html',
      description: 'Starter JSON-LD built from what the crawl found. Replace every FILL IN value (and the opening hours), change "LocalBusiness" to a more specific type if one fits (e.g. "Plumber", "Dentist"), then paste it into the homepage <head> and test it at search.google.com/test/rich-results. Not a local business? Change the type to "Organization" and remove address, geo and hours.',
      content: `<script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n</script>`,
    });
  }

  // 5. Open Graph for the homepage
  if (home && (!home.og.title || !home.og.description || !home.og.image)) {
    const lines = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:url" content="${htmlAttr(site.homeUrl)}">`,
      `<meta property="og:title" content="${htmlAttr(home.og.title || home.title || 'FILL IN')}">`,
      `<meta property="og:description" content="${htmlAttr(home.og.description || home.metaDescription || 'FILL IN')}">`,
      `<meta property="og:image" content="${htmlAttr(home.og.image || 'FILL IN https://…/share-image-1200x630.jpg')}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ];
    fixes.push({
      id: 'fix.og', relatedCheck: 'schema.open-graph', title: 'Open Graph tags (homepage)', language: 'html',
      description: 'Controls how your homepage looks when shared on WhatsApp, Facebook and LinkedIn. Values are taken from the page where possible. Repeat with page-specific values on other pages.',
      content: lines.join('\n'),
    });
  }

  return fixes;
}

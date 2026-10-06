import { pageCheck, pass, fail, skip, info, result, duplicates, plural, trunc } from './helpers.js';
import { isBroken, isUnverifiable } from '../crawler.js';
import { looseKey, pathOf, shortUrl } from '../url.js';

const C = 'technical';
const statusText = r => (r?.error ? (r.message || r.error) : `HTTP ${r?.status}`);

export const technicalChecks = [

  function https({ site }) {
    const def = { id: 'tech.https', category: C, title: 'Site uses HTTPS', weight: 10,
      fix: 'Install an SSL certificate (free with Let\'s Encrypt or your host) and serve every page over https://.' };
    return site.homeUrl.startsWith('https:') ? pass(def, `Homepage loads securely at ${site.homeUrl}.`)
      : fail(def, 'critical', `The homepage loads over plain http (${site.homeUrl}). Browsers mark it "Not secure" and Google prefers HTTPS pages.`);
  },

  function httpRedirect({ site }) {
    const def = { id: 'tech.http-redirect', category: C, title: 'HTTP redirects to HTTPS', weight: 8,
      fix: 'Add a permanent (301) redirect from every http:// URL to its https:// version at your host or CDN.' };
    const p = site.probes.http;
    if (!p) return skip(def, 'Not tested.');
    if (p.error) return skip(def, `Could not test http://${site.rootHost}/ (${statusText(p)}).`);
    const finalHttps = String(p.finalUrl || '').startsWith('https:');
    if (!finalHttps) return fail(def, 'critical', `http://${site.rootHost}/ does not redirect to HTTPS (ends at ${p.finalUrl}, ${statusText(p)}).`);
    const hops = p.redirects?.length || 0;
    if (hops > 1) return result(def, { status: 'warning', score: 0.7, message: `HTTP reaches HTTPS, but through ${hops} redirects. One redirect is ideal.`, affected: p.redirects.map(r => ({ url: r.url, detail: `${r.status} → ${r.location}` })) });
    const perm = p.redirects?.[0]?.status;
    if (perm && ![301, 308].includes(perm)) return result(def, { status: 'warning', score: 0.7, message: `HTTP redirects to HTTPS with a temporary ${perm} redirect. Use 301 so Google transfers ranking signals.` });
    return pass(def, `http://${site.rootHost}/ permanently redirects to HTTPS.`);
  },

  function hostVariant({ site }) {
    const def = { id: 'tech.host-variant', category: C, title: 'www and non-www resolve to one address', weight: 4,
      fix: 'Make the other host (with or without www) load and 301-redirect to your main address, e.g. via your host\'s custom-domain settings.' };
    const p = site.probes.altHost;
    if (!p) return skip(def, 'Not tested.');
    const alt = new URL(p.url).host;
    if (p.error) return fail(def, 'warning', `${alt} does not load (${statusText(p)}). Visitors who type it get an error page.`);
    const finalHost = (() => { try { return new URL(p.finalUrl).hostname; } catch { return ''; } })();
    if (finalHost === site.rootHost) return pass(def, `${alt} redirects to ${site.rootHost}.`);
    if (p.status < 400) return fail(def, 'warning', `${alt} serves the site without redirecting to ${site.rootHost}, creating two copies of every page.`);
    return fail(def, 'warning', `${alt} returns ${statusText(p)}.`);
  },

  function robotsTxt({ site }) {
    const def = { id: 'tech.robots-txt', category: C, title: 'robots.txt is present', weight: 3,
      fix: 'Add a plain-text /robots.txt that allows crawling and lists your sitemap (see the Fixes tab).' };
    const r = site.robots;
    if (!r || r.error === 'worker') return skip(def, 'robots.txt could not be fetched.');
    if (r.found) return pass(def, `Found, with ${plural(r.groups, 'user-agent group')}.`);
    if (r.status >= 500) return fail(def, 'critical', `robots.txt returns HTTP ${r.status}. Google pauses crawling a site whose robots.txt errors.`);
    if (r.status === 200) return fail(def, 'warning', `/robots.txt returns a ${r.contentType || 'non-text'} page instead of a robots file — usually a site-wide fallback page.`);
    return fail(def, 'warning', `No robots.txt (${statusText(r)}). Not harmful on its own, but it is the standard place to point crawlers to your sitemap.`);
  },

  function robotsBlocking({ site, pages }) {
    const def = { id: 'tech.robots-googlebot', category: C, title: 'Googlebot may crawl your pages', weight: 10,
      fix: 'Remove or narrow the Disallow rules in robots.txt that match these pages.' };
    if (!site.robots?.found) return pass(def, 'No robots.txt rules restrict Googlebot.');
    if (!site.googleAllows(pathOf(site.homeUrl))) return fail(def, 'critical', 'robots.txt blocks Googlebot from the homepage. Google cannot crawl the site.');
    return pageCheck(def, pages, p => !site.googleAllows(pathOf(p.finalUrl)) && `Blocked by robots.txt rules for "${site.robots.googleAgent}"`, {
      passMessage: `Googlebot is allowed on all ${pages.length} crawled pages.`,
      failMessage: n => `${plural(n, 'page')} linked on the site are blocked for Googlebot.`,
    });
  },

  function sitemap({ site }) {
    const def = { id: 'tech.sitemap', category: C, title: 'XML sitemap is available', weight: 4,
      fix: 'Publish /sitemap.xml listing every page you want indexed (the Fixes tab generates one from this crawl), then submit it in Google Search Console.' };
    const good = site.sitemaps.filter(s => s.status === 200 && s.type && s.type !== 'invalid');
    const bad = site.sitemaps.filter(s => s.status === 200 && s.type === 'invalid');
    if (good.length) {
      const total = site.sitemapUrls.length;
      return total ? pass(def, `${plural(good.length, 'sitemap')} with ${plural(total, 'URL')}.`, { data: { sitemaps: good.map(s => s.url) } })
                   : fail(def, 'warning', 'The sitemap was found but lists no URLs.');
    }
    if (bad.length) return fail(def, 'critical', `Sitemap at ${bad[0].url} is broken: ${bad[0].parseError}. Google cannot read it.`);
    const tried = site.sitemaps.map(s => `${shortUrl(s.url, site.rootHost)} (${statusText(s)})`).join(', ');
    return fail(def, 'warning', `No working sitemap found. Tried: ${tried || 'none'}.`);
  },

  function sitemapInRobots({ site }) {
    const def = { id: 'tech.sitemap-in-robots', category: C, title: 'robots.txt lists the sitemap', weight: 1,
      fix: 'Add a line like "Sitemap: https://yourdomain/sitemap.xml" to robots.txt.' };
    if (!site.robots?.found) return skip(def, 'No robots.txt.');
    return site.robots.sitemaps.length ? pass(def, `robots.txt lists ${plural(site.robots.sitemaps.length, 'sitemap')}.`)
      : fail(def, 'warning', 'robots.txt does not mention a sitemap.');
  },

  function sitemapQuality({ site, records, pages, isNoindex }) {
    const def = { id: 'tech.sitemap-quality', category: C, title: 'Sitemap lists only live, indexable pages', weight: 3,
      fix: 'Remove redirected, broken, noindex and canonicalised URLs from the sitemap; list only the final URL of each page.' };
    if (!site.sitemapUrls.length) return skip(def, 'No sitemap URLs to check.');
    const byUrl = new Map(records.map(r => [r.url, r]));
    const affected = [];
    for (const s of site.sitemapUrls) {
      if (!s.sameSite) { affected.push({ url: s.url, detail: 'Different domain from the site' }); continue; }
      const r = byUrl.get(s.url);
      if (!r) continue;
      if (r.error || r.status >= 400) affected.push({ url: s.url, detail: statusText(r) });
      else if (r.redirects?.length) affected.push({ url: s.url, detail: `Redirects to ${r.finalUrl}` });
      else if (r.isHtml && isNoindex(r)) affected.push({ url: s.url, detail: 'Marked noindex' });
      else if (r.isHtml && r.canonicals?.[0]?.url && r.canonicals[0].url !== r.finalUrl) affected.push({ url: s.url, detail: `Canonical points to ${r.canonicals[0].url}` });
    }
    const checked = site.sitemapUrls.filter(s => byUrl.has(s.url) || !s.sameSite).length;
    if (!checked) return skip(def, 'None of the sitemap URLs were within the crawl limit.');
    if (!affected.length) return pass(def, `All ${checked} checked sitemap URLs are live and indexable.`);
    return result(def, { status: 'warning', score: 1 - affected.length / checked, message: `${affected.length} of ${checked} checked sitemap URLs shouldn't be in the sitemap.`, affected });
  },

  function statusErrors({ records, linkSources, site }) {
    const def = { id: 'tech.http-errors', category: C, title: 'Pages return a successful status', weight: 8,
      fix: 'Restore these pages or 301-redirect them to the closest live page, and update the links pointing to them.' };
    const bad = records.filter(r => !r.error && r.status >= 400);
    if (!records.length) return skip(def, 'Nothing crawled.');
    if (!bad.length) return pass(def, `All ${records.length} crawled URLs returned a successful status.`);
    const severe = bad.some(r => r.status >= 500 || r.status === 404 || r.status === 410) ? 'critical' : 'warning';
    return result(def, {
      status: severe, score: 1 - bad.length / records.length,
      message: `${plural(bad.length, 'URL')} returned an error status (${[...new Set(bad.map(r => r.status))].join(', ')}).`,
      affected: bad.map(r => ({ url: r.url, detail: `HTTP ${r.status}${linkSources.get(r.url)?.length ? ` · linked from ${shortUrl(linkSources.get(r.url)[0], site.rootHost)}` : ''}` })),
    });
  },

  function fetchErrors({ records }) {
    const def = { id: 'tech.load-errors', category: C, title: 'Pages load without timeouts or errors', weight: 6,
      fix: 'Check these URLs in a browser. Timeouts point to slow hosting; redirect loops and DNS errors need fixing at the server or DNS.' };
    const bad = records.filter(r => r.error && r.error !== 'blocked');
    if (!records.length) return skip(def, 'Nothing crawled.');
    if (!bad.length) return pass(def, 'Every page loaded.');
    return result(def, { status: 'critical', score: 1 - bad.length / records.length,
      message: `${plural(bad.length, 'URL')} failed to load.`,
      affected: bad.map(r => ({ url: r.url, detail: `${r.error}: ${r.message || ''}` })) });
  },

  function brokenInternal({ pages, statusOf, site }) {
    const def = { id: 'tech.broken-internal-links', category: C, title: 'No broken internal links', weight: 8,
      fix: 'Update or remove links pointing to pages that no longer exist.' };
    const lim = site.checkLimits.internal;
    const r = pageCheck(def, pages, p => {
      const broken = [...new Set(p.links.filter(l => l.internal && isBroken(statusOf(l.url))).map(l => l.url))];
      return broken.length && broken.slice(0, 5).map(u => `${shortUrl(u, site.rootHost)} (${statusText(statusOf(u))})`).join(', ') + (broken.length > 5 ? ` +${broken.length - 5} more` : '');
    }, { severity: 'critical', passMessage: 'No broken internal links found.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'links' : 'link'} to broken internal URLs.` });
    if (lim.total > lim.checked) r.message += ` (${lim.total - lim.checked} uncrawled internal links not checked — limit reached.)`;
    return r;
  },

  function brokenExternal({ pages, checks, site }) {
    const def = { id: 'tech.broken-external-links', category: C, title: 'No broken external links', weight: 3,
      fix: 'Replace or remove links to external pages that no longer exist.' };
    const lim = site.checkLimits.external;
    if (!lim.enabled) return skip(def, 'External link checking was turned off for this audit.');
    if (!lim.total) return pass(def, 'No external links found.');
    const unverifiable = [...checks.external.values()].filter(isUnverifiable).length;
    const r = pageCheck(def, pages, p => {
      const broken = [...new Set(p.links.filter(l => !l.internal && isBroken(checks.external.get(l.url))).map(l => l.url))];
      return broken.length && broken.slice(0, 4).map(u => `${trunc(u, 70)} (${statusText(checks.external.get(u))})`).join(', ') + (broken.length > 4 ? ` +${broken.length - 4} more` : '');
    }, { passMessage: `Checked ${lim.checked} external links — none broken.`, failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'links' : 'link'} to broken external pages.` });
    const notes = [];
    if (unverifiable) notes.push(`${unverifiable} could not be verified (sites like social networks block automated checks)`);
    if (lim.total > lim.checked) notes.push(`${lim.total - lim.checked} not checked (limit ${lim.checked})`);
    if (notes.length) r.message += ` ${notes.join('; ')}.`;
    return r;
  },

  function redirectChains({ records }) {
    const def = { id: 'tech.redirect-chains', category: C, title: 'No redirect chains', weight: 3,
      fix: 'Point each redirect straight at the final URL, and update internal links to the final URL.' };
    const chains = records.filter(r => (r.redirects?.length || 0) >= 2);
    if (!chains.length) return pass(def, 'No URL needed more than one redirect.');
    return result(def, { status: 'warning', score: 1 - chains.length / records.length,
      message: `${plural(chains.length, 'URL')} ${chains.length === 1 ? 'passes' : 'pass'} through 2+ redirects before loading.`,
      affected: chains.map(r => ({ url: r.url, detail: [...r.redirects.map(h => `${h.status}`), r.status].join(' → ') + ` → ${r.finalUrl}` })) });
  },

  function linksToRedirects({ pages, records, site, canonicalOf }) {
    const def = { id: 'tech.links-to-redirects', category: C, title: 'Internal links point to final, canonical URLs', weight: 1,
      fix: 'Update these links to the destination (canonical) URL so visitors and crawlers skip the redirect or duplicate.' };
    const target = new Map();
    for (const r of records) {
      if (r.error) continue;
      const dest = canonicalOf(r.finalUrl);
      if (dest !== r.url) target.set(r.url, dest);
    }
    return pageCheck(def, pages, p => {
      const hits = [...new Set(p.links.filter(l => l.internal && target.has(l.url)).map(l => l.url))];
      return hits.length && hits.slice(0, 4).map(u => `${shortUrl(u, site.rootHost)} → ${shortUrl(target.get(u), site.rootHost)}`).join(', ');
    }, { severity: 'warning', passMessage: 'Internal links point straight at final, canonical URLs.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'links' : 'link'} to URLs that redirect or aren't the canonical version.` });
  },

  function canonicalMissing({ pages, isNoindex }) {
    const def = { id: 'tech.canonical-missing', category: C, title: 'Pages declare a canonical URL', weight: 4,
      fix: 'Add <link rel="canonical" href="https://yourdomain/page-url"> to each page\'s <head>, pointing at the page\'s own preferred URL.' };
    return pageCheck(def, pages.filter(p => !isNoindex(p)), p => !p.canonicals.length && 'No canonical tag',
      { passMessage: 'Every indexable page declares a canonical URL.', failMessage: (n, t) => `${n} of ${t} pages ${n === 1 ? 'has' : 'have'} no canonical tag.` });
  },

  function canonicalProblems({ pages, statusOf, site }) {
    const def = { id: 'tech.canonical-valid', category: C, title: 'Canonical tags are valid', weight: 5,
      fix: 'Use exactly one absolute canonical URL in the <head>, pointing at a live (200) page on this site.' };
    const withCanon = pages.filter(p => p.canonicals.length);
    return pageCheck(def, withCanon, p => {
      const urls = [...new Set(p.canonicals.map(c => c.url))];
      if (urls.length > 1) return `${urls.length} different canonical URLs — Google ignores them all`;
      const c = p.canonicals[0];
      if (!c.url) return `Invalid canonical href "${trunc(c.raw, 60)}"`;
      if (!c.inHead) return 'Canonical tag is outside <head>, so Google ignores it';
      if (new URL(c.url).hostname.replace(/^www\./, '') !== site.rootHost.replace(/^www\./, '')) return `Points to another domain: ${c.url}`;
      const s = statusOf(c.url);
      if (s && (s.error || s.status >= 400)) return `Points to a broken URL (${statusText(s)})`;
      if (s && s.redirects?.length) return `Points to a URL that redirects (${c.url} → ${s.finalUrl})`;
      return false;
    }, { severity: 'critical', passMessage: `All ${withCanon.length} canonical tags are valid.`, failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} a canonical tag Google will ignore or misread.` });
  },

  function noindexHome({ home, isNoindex }) {
    const def = { id: 'tech.noindex-home', category: C, title: 'Homepage can be indexed', weight: 10,
      fix: 'Remove "noindex" from the homepage\'s robots meta tag or X-Robots-Tag header.' };
    if (!home) return skip(def, 'Homepage not analysed.');
    return isNoindex(home) ? fail(def, 'critical', 'The homepage is marked noindex — Google will drop it from search results.') : pass(def, 'The homepage is indexable.');
  },

  function noindexPages({ pages, home, isNoindex }) {
    const def = { id: 'tech.noindex-pages', category: C, title: 'Pages are not unintentionally noindexed', weight: 3,
      fix: 'Confirm each of these should be hidden from Google. If not, remove "noindex" from the robots meta tag or X-Robots-Tag header.' };
    const rest = pages.filter(p => p !== home);
    const r = pageCheck(def, rest, p => isNoindex(p) && `noindex via ${p.metaRobots?.includes('noindex') ? 'meta robots' : 'X-Robots-Tag header'}`,
      { passMessage: 'No other pages are noindexed.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'is' : 'are'} hidden from Google with noindex — check this is intentional.` });
    if (r.status === 'warning' || r.status === 'critical') { r.status = 'info'; r.weight = 0; }
    return r;
  },

  function duplicateUrls({ pages, site }) {
    const def = { id: 'tech.duplicate-urls', category: C, title: 'No duplicate pages under different URLs', weight: 4,
      fix: 'Pick one URL per page: 301-redirect the copies, or add a canonical tag on each copy pointing at the preferred URL.' };
    const groups = duplicates(pages.filter(p => p.contentWordCount >= 30), p => p.contentHash)
      .filter(g => new Set(g.map(p => p.canonicals[0]?.url || p.finalUrl)).size > 1);
    if (!groups.length) return pass(def, 'No identical pages found under different URLs.');
    const affected = groups.flatMap(g => g.map(p => ({ url: p.finalUrl, detail: `Identical to ${g.filter(o => o !== p).map(o => shortUrl(o.finalUrl, site.rootHost)).slice(0, 3).join(', ')}` })));
    return result(def, { status: 'warning', score: 1 - affected.length / pages.length, message: `${plural(groups.length, 'group')} of identical pages (${affected.length} URLs).`, affected });
  },

  function trailingSlash({ site, pages }) {
    const def = { id: 'tech.trailing-slash', category: C, title: 'Consistent trailing slashes', weight: 2,
      fix: 'Choose one style (with or without the trailing slash), 301-redirect the other, and use it in every internal link.' };
    const issues = [];
    for (const [k, p] of Object.entries(site.probes)) {
      if (!k.startsWith('slash') || p.error) continue;
      if (p.status === 200 && !p.redirects?.length) {
        const page = pages.find(x => x.finalUrl === p.original);
        const canon = page?.canonicals?.[0]?.url;
        if (!canon || canon === p.url) issues.push({ url: p.url, detail: `Loads as a separate page from ${shortUrl(p.original, site.rootHost)} (no redirect)` });
      }
    }
    const spellings = new Map();
    for (const p of pages) for (const l of p.links) if (l.internal) {
      const k = looseKey(l.url);
      if (!spellings.has(k)) spellings.set(k, new Set());
      spellings.get(k).add(l.url);
    }
    for (const set of spellings.values()) if (set.size > 1) {
      const [a, ...rest] = [...set];
      issues.push({ url: a, detail: `Also linked as ${rest.map(u => shortUrl(u, site.rootHost)).join(', ')}` });
    }
    if (!issues.length) return pass(def, 'URLs use one consistent form.');
    return result(def, { status: 'warning', score: 0.5, message: `${plural(issues.length, 'page')} reachable under more than one spelling.`, affected: issues });
  },

  function urlStructure({ pages }) {
    const def = { id: 'tech.url-structure', category: C, title: 'Clean, readable URLs', weight: 0,
      fix: 'Prefer short, lowercase, hyphen-separated URLs that describe the page. Change existing URLs only with 301 redirects.' };
    const r = pageCheck(def, pages, p => {
      const u = new URL(p.finalUrl);
      const why = [];
      if (p.finalUrl.length > 115) why.push(`${p.finalUrl.length} characters long`);
      if (/[A-Z]/.test(u.pathname)) why.push('uppercase letters');
      if (/_/.test(u.pathname)) why.push('underscores');
      if (/%20|\s/.test(u.pathname)) why.push('spaces');
      if ([...u.searchParams.keys()].length > 2) why.push('many query parameters');
      if (u.pathname.split('/').filter(Boolean).length > 5) why.push('deeply nested');
      return why.join(', ');
    }, { passMessage: 'URLs are clean and readable.', failMessage: n => `${plural(n, 'URL')} could be cleaner.` });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },

  function viewport({ pages }) {
    const def = { id: 'tech.viewport', category: C, title: 'Mobile viewport is set', weight: 6,
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to every page\'s <head>.' };
    return pageCheck(def, pages, p => !p.viewport ? 'No viewport meta tag' : !/width\s*=\s*device-width/i.test(p.viewport) && `Viewport "${p.viewport}" lacks width=device-width`,
      { severity: 'critical', passMessage: 'Every page sets a mobile viewport.', failMessage: n => `${plural(n, 'page')} won't display properly on phones — Google indexes the mobile version first.` });
  },

  function language({ pages }) {
    const def = { id: 'tech.lang', category: C, title: 'Page language is declared', weight: 2,
      fix: 'Add a lang attribute to the <html> tag, e.g. <html lang="en-ZA">.' };
    return pageCheck(def, pages, p => !p.lang && 'No lang attribute on <html>', { passMessage: 'Every page declares its language.' });
  },

  function charset({ pages }) {
    const def = { id: 'tech.charset', category: C, title: 'Character encoding is declared', weight: 2,
      fix: 'Add <meta charset="UTF-8"> as the first element in <head> (or send charset in the Content-Type header).' };
    return pageCheck(def, pages, p => !p.charsetMeta && !/charset=/i.test(p.contentType || '') && 'No charset in <meta> or Content-Type header',
      { passMessage: 'Every page declares its character encoding.' });
  },

  function favicon({ site, home }) {
    const def = { id: 'tech.favicon', category: C, title: 'Favicon is present', weight: 1,
      fix: 'Add a square icon (at least 48×48px) and <link rel="icon" href="/favicon.png"> in the <head>. Google shows it next to your search result.' };
    if (home?.favicons?.length) return pass(def, `Declared: ${home.favicons[0]}`);
    const p = site.probes.faviconIco;
    if (p && !p.error && p.status === 200 && /image|icon|octet/i.test(p.contentType || '')) return pass(def, 'Found /favicon.ico.');
    return fail(def, 'warning', 'No favicon declared and /favicon.ico not found.');
  },

  function soft404({ site }) {
    const def = { id: 'tech.soft-404', category: C, title: 'Missing pages return 404', weight: 3,
      fix: 'Configure the server to return HTTP 404 (with a helpful "page not found" page) for URLs that don\'t exist.' };
    const p = site.probes.notFound;
    if (!p || p.error) return skip(def, 'Could not test.');
    if (p.status === 404 || p.status === 410) return pass(def, `A made-up URL correctly returns ${p.status}.`);
    if (p.status === 200) return fail(def, 'warning', `A made-up URL (${pathOf(p.url)}) returns 200${p.redirects?.length ? ` after redirecting to ${p.finalUrl}` : ''}. Google treats these as "soft 404s", and broken links stay hidden.`);
    return fail(def, 'warning', `A made-up URL returns HTTP ${p.status} instead of 404.`);
  },

  function mixedContent({ pages }) {
    const def = { id: 'tech.mixed-content', category: C, title: 'No insecure (http) resources on HTTPS pages', weight: 3,
      fix: 'Change these resource URLs to https://. Browsers block or warn about insecure content on secure pages.' };
    return pageCheck(def, pages.filter(p => p.finalUrl.startsWith('https:')), p => p.mixedContent.length && p.mixedContent.slice(0, 3).join(', '),
      { passMessage: 'No insecure resources found.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'loads' : 'load'} http:// resources.` });
  },

  function jsRendering({ pages }) {
    const def = { id: 'tech.js-content', category: C, title: 'Content is in the HTML (not only JavaScript)', weight: 0,
      fix: 'Render important text in the HTML (server-side rendering or pre-rendering) so every crawler and social preview can read it.' };
    const r = pageCheck(def, pages, p => (p.appShell || (p.wordCount < 50 && p.scriptCount >= 5)) && `Only ${p.wordCount} words in the raw HTML, ${p.scriptCount} scripts`,
      { passMessage: 'Page content is present in the HTML.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'appears' : 'appear'} to build their content with JavaScript. This audit (like many crawlers) reads raw HTML, so content results for these pages may be incomplete.` });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },
];

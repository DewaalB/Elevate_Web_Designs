import { pageCheck, pass, skip, result, duplicates, plural, trunc } from './helpers.js';
import { shortUrl } from '../url.js';

const C = 'onpage';
const GENERIC_TITLES = /^(home|homepage|home page|untitled|untitled document|index|new page|document|page|welcome|default|my site|my website|website|test|wordpress|just another wordpress site)$/i;
const PLACEHOLDER_DESC = /(lorem ipsum|^description$|^meta description|^default|enter (a|your) description|^this is (a|my) (website|site))/i;

function dupCheck(def, pages, keyFn, label, site) {
  const groups = duplicates(pages, keyFn);
  if (!groups.length) return pass(def, `Every page has a unique ${label}.`);
  const affected = groups.flatMap(g => g.map(p => ({ url: p.finalUrl, detail: `"${trunc(label === 'title' ? p.title : p.metaDescription, 70)}" — shared with ${g.filter(o => o !== p).map(o => shortUrl(o.finalUrl, site.rootHost)).slice(0, 3).join(', ')}${g.length > 4 ? ` +${g.length - 4}` : ''}` })));
  return result(def, { status: 'warning', score: 1 - affected.length / pages.length,
    message: `${plural(groups.length, 'group')} of pages share the same ${label} (${affected.length} pages).`, affected });
}

export const onpageChecks = [

  function titleMissing({ indexable }) {
    const def = { id: 'onpage.title-missing', category: C, title: 'Every page has a title', weight: 10,
      fix: 'Add a unique <title> to each page: main keyword first, then your brand, e.g. "Web Design Cape Town | Elevate".' };
    return pageCheck(def, indexable, p => (p.title === null ? 'No <title> tag' : !p.title ? 'Empty <title>' : p.titleCount > 1 && `${p.titleCount} <title> tags`),
      { severity: 'critical', passMessage: 'Every page has exactly one title.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} a missing, empty or repeated <title>.` });
  },

  function titleLength({ indexable }) {
    const def = { id: 'onpage.title-length', category: C, title: 'Titles are 30–60 characters', weight: 4,
      fix: 'Keep titles between roughly 30 and 60 characters so Google shows them in full. Lead with what the page is about.' };
    return pageCheck(def, indexable.filter(p => p.title), p => {
      const n = p.title.length;
      return n < 30 ? `${n} chars — too short: "${p.title}"` : n > 60 && `${n} chars — will be cut off: "${trunc(p.title, 70)}"`;
    }, { passMessage: 'All titles are a good length.' });
  },

  function titleDuplicate({ indexable, site }) {
    const def = { id: 'onpage.title-duplicate', category: C, title: 'Titles are unique', weight: 5,
      fix: 'Give each page its own title describing that page specifically. Duplicate titles make pages compete with each other.' };
    return dupCheck(def, indexable.filter(p => p.title), p => p.title.toLowerCase(), 'title', site);
  },

  function titleQuality({ indexable, home }) {
    const def = { id: 'onpage.title-quality', category: C, title: 'Titles are descriptive', weight: 3,
      fix: 'Replace generic titles with ones that say what the page offers (and where, for local businesses). Avoid ALL CAPS and repeated words.' };
    return pageCheck(def, indexable.filter(p => p.title), p => {
      const t = p.title;
      if (GENERIC_TITLES.test(t.replace(/\s*[|\-–—:].*$/, '').trim())) return `Generic title "${t}"`;
      if (t.length > 12 && t === t.toUpperCase() && /[A-Z]/.test(t)) return `ALL CAPS: "${trunc(t, 60)}"`;
      const words = t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
      const rep = words.find((w, i) => words.indexOf(w) !== i && words.filter(x => x === w).length >= 3);
      if (rep) return `"${rep}" repeated ${words.filter(x => x === rep).length} times`;
      if (p !== home && home?.title && t === home.title) return 'Same as the homepage title';
      return false;
    }, { passMessage: 'Titles look descriptive.' });
  },

  function metaMissing({ indexable }) {
    const def = { id: 'onpage.meta-missing', category: C, title: 'Every page has a meta description', weight: 6,
      fix: 'Write a 120–160 character <meta name="description"> for each page summarising it and inviting the click. Google often shows it under your title.' };
    return pageCheck(def, indexable, p => (p.metaDescription === null ? 'No meta description' : !p.metaDescription ? 'Empty meta description' : p.metaDescriptionCount > 1 && `${p.metaDescriptionCount} meta descriptions`),
      { passMessage: 'Every page has a meta description.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} no usable meta description.` });
  },

  function metaLength({ indexable }) {
    const def = { id: 'onpage.meta-length', category: C, title: 'Meta descriptions are 70–160 characters', weight: 3,
      fix: 'Aim for 120–160 characters: long enough to persuade, short enough not to be cut off.' };
    return pageCheck(def, indexable.filter(p => p.metaDescription), p => {
      const n = p.metaDescription.length;
      return n < 70 ? `${n} chars — too short` : n > 160 && `${n} chars — will be truncated`;
    }, { passMessage: 'All meta descriptions are a good length.' });
  },

  function metaDuplicate({ indexable, site }) {
    const def = { id: 'onpage.meta-duplicate', category: C, title: 'Meta descriptions are unique', weight: 4,
      fix: 'Write a separate description for each page. When descriptions repeat, Google usually ignores them and picks text from the page.' };
    return dupCheck(def, indexable.filter(p => p.metaDescription), p => p.metaDescription.toLowerCase(), 'meta description', site);
  },

  function metaQuality({ indexable }) {
    const def = { id: 'onpage.meta-quality', category: C, title: 'Meta descriptions are meaningful', weight: 2,
      fix: 'Write a real summary of the page with a reason to click — not placeholder text or a copy of the title.' };
    return pageCheck(def, indexable.filter(p => p.metaDescription), p => {
      const d = p.metaDescription;
      if (PLACEHOLDER_DESC.test(d)) return `Placeholder text: "${trunc(d, 60)}"`;
      if (p.title && d.toLowerCase() === p.title.toLowerCase()) return 'Identical to the title';
      if (d.split(/\s+/).length < 5) return `Only ${d.split(/\s+/).length} words`;
      return false;
    }, { passMessage: 'Meta descriptions look meaningful.' });
  },

  function h1Missing({ indexable }) {
    const def = { id: 'onpage.h1-missing', category: C, title: 'Every page has an H1 heading', weight: 6,
      fix: 'Give each page one <h1> that states its main topic — usually close to the page title.' };
    return pageCheck(def, indexable, p => !p.headings.some(h => h.level === 1) && 'No <h1>',
      { passMessage: 'Every page has an H1.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} no H1 heading.` });
  },

  function h1Multiple({ indexable }) {
    const def = { id: 'onpage.h1-multiple', category: C, title: 'One H1 per page', weight: 2,
      fix: 'Keep a single <h1> for the page\'s main topic and change the others to <h2>.' };
    return pageCheck(def, indexable, p => {
      const h1s = p.headings.filter(h => h.level === 1);
      return h1s.length > 1 && `${h1s.length} H1s: ${h1s.slice(0, 3).map(h => `"${trunc(h.text, 30)}"`).join(', ')}`;
    }, { passMessage: 'No page has more than one H1.' });
  },

  function headingEmpty({ indexable }) {
    const def = { id: 'onpage.heading-empty', category: C, title: 'No empty headings', weight: 2,
      fix: 'Remove empty heading tags or give them text. Use CSS, not empty headings, for spacing.' };
    return pageCheck(def, indexable, p => {
      const empty = p.headings.filter(h => !h.text);
      return empty.length && `${plural(empty.length, 'empty heading')} (${empty.map(h => `H${h.level}`).join(', ')})`;
    }, { passMessage: 'No empty headings.' });
  },

  function headingHierarchy({ indexable }) {
    const def = { id: 'onpage.heading-order', category: C, title: 'Headings follow a logical order', weight: 2,
      fix: 'Don\'t skip levels: an H2 should be followed by H3s, not H4s. Pick heading levels by structure, not by size.' };
    return pageCheck(def, indexable.filter(p => p.headings.length), p => {
      const hs = p.headings.filter(h => h.text);
      for (let i = 1; i < hs.length; i++) {
        if (hs[i].level > hs[i - 1].level + 1) return `H${hs[i - 1].level} → H${hs[i].level} ("${trunc(hs[i].text, 40)}")`;
      }
      return false;
    }, { passMessage: 'Heading levels are never skipped.' });
  },

  function headingStructure({ indexable }) {
    const def = { id: 'onpage.subheadings', category: C, title: 'Longer pages use subheadings', weight: 2,
      fix: 'Break pages over ~300 words into sections with <h2> subheadings. It helps readers scan and helps Google understand the topics.' };
    return pageCheck(def, indexable.filter(p => p.contentWordCount >= 300), p => !p.headings.some(h => h.level === 2) && `${p.contentWordCount} words, no H2`,
      { passMessage: 'All longer pages use H2 subheadings.' });
  },

  function orphanPages({ site, inbound, records }) {
    const def = { id: 'onpage.orphans', category: C, title: 'No orphan pages', weight: 5,
      fix: 'Link to these pages from relevant pages or the menu. Pages with no internal links are hard for visitors and Google to find.' };
    const fromSitemap = records.filter(r => r.via === 'sitemap' && r.isHtml && !r.aliasOf && !r.offsite);
    if (!site.sitemapUrls.length) return skip(def, 'Needs a sitemap to discover pages that nothing links to.');
    if (site.crawl.maxDepth < 3 && !fromSitemap.length) return skip(def, 'Crawl depth too shallow to tell orphans apart from deep pages.');
    const orphans = fromSitemap.filter(r => !(inbound.get(r.finalUrl) > 0));
    if (!orphans.length) return pass(def, 'Every sitemap page is linked from at least one crawled page.');
    const severity = site.crawl.limitHit ? 'warning' : 'critical';
    return result(def, { status: severity, score: 1 - orphans.length / Math.max(1, fromSitemap.length + inbound.size),
      message: `${plural(orphans.length, 'page')} in the sitemap that no crawled page links to${site.crawl.limitHit ? ' (the crawl hit its page limit, so some links may exist on uncrawled pages)' : ''}.`,
      affected: orphans.map(r => ({ url: r.finalUrl, detail: 'Only reachable through the sitemap' })) });
  },

  function fewInbound({ indexable, inbound, home, site }) {
    const def = { id: 'onpage.few-inbound', category: C, title: 'Pages receive enough internal links', weight: 2,
      fix: 'Add contextual links to these pages from related content. Internal links pass authority and tell Google which pages matter.' };
    if (site.crawl.limitHit) return skip(def, 'The crawl hit its page limit, so link counts would be incomplete. Re-run with a higher page limit.');
    return pageCheck(def, indexable.filter(p => p !== home && p.via !== 'sitemap'), p => (inbound.get(p.finalUrl) || 0) <= 1 && `${plural(inbound.get(p.finalUrl) || 0, 'page')} link here`,
      { passMessage: 'Every page is linked from at least two others.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'is' : 'are'} linked from only one page.` });
  },

  function importantUnlinked({ site, inbound, home }) {
    const def = { id: 'onpage.important-unlinked', category: C, title: 'Key pages receive internal links', weight: 4,
      fix: 'Link to your most important pages from the homepage or main menu.' };
    const important = site.sitemapUrls.filter(s => s.sameSite && s.priority >= 0.8 && s.url !== home?.finalUrl);
    if (!important.length) return skip(def, 'The sitemap marks no pages as high priority (0.8+), so key pages can\'t be identified automatically.');
    const missing = important.filter(s => !(inbound.get(s.url) > 0));
    if (!missing.length) return pass(def, `All ${important.length} high-priority sitemap pages receive internal links.`);
    return result(def, { status: 'critical', score: 1 - missing.length / important.length,
      message: `${plural(missing.length, 'high-priority page')} ${missing.length === 1 ? 'receives' : 'receive'} no internal links.`,
      affected: missing.map(s => ({ url: s.url, detail: `Sitemap priority ${s.priority}` })) });
  },

  function anchorText({ pages, site }) {
    const def = { id: 'onpage.anchor-text', category: C, title: 'Links use descriptive anchor text', weight: 3,
      fix: 'Replace "click here" / "read more" and empty links with text that says where the link goes, e.g. "see our website packages".' };
    return pageCheck(def, pages, p => {
      const bad = p.links.filter(l => l.internal && (l.generic || l.empty));
      return bad.length && bad.slice(0, 3).map(l => (l.empty ? `empty link → ${shortUrl(l.url, site.rootHost)}` : `"${l.text}" → ${shortUrl(l.url, site.rootHost)}`)).join(', ') + (bad.length > 3 ? ` +${bad.length - 3} more` : '');
    }, { passMessage: 'Internal links use descriptive text.', failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} vague or empty link text.` });
  },

  function deadEnds({ indexable, pages }) {
    const def = { id: 'onpage.dead-ends', category: C, title: 'Pages link onward to other pages', weight: 2,
      fix: 'Add navigation or contextual links so visitors (and crawlers) can continue from these pages.' };
    if (pages.length <= 1) return skip(def, 'Single-page site — there are no other pages to link to.');
    return pageCheck(def, indexable, p => {
      const n = new Set(p.links.filter(l => l.internal && l.url !== p.finalUrl).map(l => l.url)).size;
      return n === 0 ? 'No internal links' : false;
    }, { passMessage: 'Every page links to other pages on the site.' });
  },
];

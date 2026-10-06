import { pageCheck, pass, result, duplicates, plural } from './helpers.js';
import { shortUrl } from '../url.js';

const C = 'content';
// Pages that are legitimately short; thin-content checks skip them.
const UTILITY_PAGE = /\/(contact|contact-us|privacy|privacy-policy|terms|terms-and-conditions|cookie|cookies|login|log-in|signin|sign-in|register|cart|checkout|account|thank-you|thanks|search|404|sitemap)\b/i;

/** a, b: { list: number[], set: Set<number> } — sets are built once per page. */
function jaccard(a, b) {
  if (!a.list.length || !b.list.length) return 0;
  const [small, big] = a.list.length < b.list.length ? [a.list, b.set] : [b.list, a.set];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.list.length + b.list.length - inter);
}

export const contentChecks = [

  function thinContent({ indexable }) {
    const def = { id: 'content.thin', category: C, title: 'No extremely thin pages', weight: 8,
      fix: 'Expand these pages with genuinely useful content (what you offer, who it\'s for, prices, FAQs, examples) — or merge them into a related page.' };
    return pageCheck(def, indexable.filter(p => !UTILITY_PAGE.test(new URL(p.finalUrl).pathname)), p => p.wordCount < 100 && `${p.wordCount} words on the whole page`,
      { severity: 'critical', passMessage: 'No page has under 100 words.', failMessage: n => `${plural(n, 'page')} have under 100 words — Google rarely ranks pages this thin.` });
  },

  function lowWordCount({ indexable }) {
    const def = { id: 'content.low-word-count', category: C, title: 'Pages have substantial content', weight: 4,
      fix: 'Aim for at least ~300 words of unique main content on pages you want to rank, written for your customers\' questions.' };
    return pageCheck(def, indexable.filter(p => !UTILITY_PAGE.test(new URL(p.finalUrl).pathname) && p.wordCount >= 100), p => p.contentWordCount < 300 && `${p.contentWordCount} words of main content`,
      { passMessage: 'Every page has 300+ words of main content.', failMessage: n => `${plural(n, 'page')} have less than 300 words of main content.` });
  },

  function exactDuplicates({ indexable, site }) {
    const def = { id: 'content.duplicate', category: C, title: 'No duplicate page content', weight: 6,
      fix: 'Rewrite one of each pair so it targets a different topic, or merge them and 301-redirect the old URL.' };
    const groups = duplicates(indexable.filter(p => p.contentWordCount >= 50), p => p.contentHash);
    if (!groups.length) return pass(def, 'No two pages have identical main content.');
    const affected = groups.flatMap(g => g.map(p => ({ url: p.finalUrl, detail: `Same text as ${g.filter(o => o !== p).map(o => shortUrl(o.finalUrl, site.rootHost)).slice(0, 3).join(', ')}` })));
    return result(def, { status: 'warning', score: 1 - affected.length / indexable.length, message: `${affected.length} pages share identical main content.`, affected });
  },

  function nearDuplicates({ indexable, site }) {
    const def = { id: 'content.near-duplicate', category: C, title: 'No near-duplicate pages', weight: 4,
      fix: 'Make each similar page clearly different (unique intro, details, examples, FAQs), or consolidate them into one stronger page.' };
    const pool = indexable.filter(p => p.shingles.length >= 40).slice(0, 250);
    const sh = pool.map(p => ({ list: p.shingles, set: new Set(p.shingles) }));
    const pairs = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[i].contentHash === pool[j].contentHash) continue; // exact duplicates are reported separately
        // Size ratio caps similarity: skip pairs that can't reach the threshold.
        const [x, y] = [pool[i].shingles.length, pool[j].shingles.length];
        if (Math.min(x, y) / Math.max(x, y) < 0.8) continue;
        const s = jaccard(sh[i], sh[j]);
        if (s >= 0.8) pairs.push([pool[i], pool[j], s]);
      }
    }
    if (!pairs.length) return pass(def, `Compared ${pool.length} pages — none are near-duplicates.`);
    const affected = pairs.map(([a, b, s]) => ({ url: a.finalUrl, detail: `${Math.round(s * 100)}% the same as ${shortUrl(b.finalUrl, site.rootHost)}` }));
    const pages = new Set(pairs.flatMap(([a, b]) => [a, b]));
    return result(def, { status: 'warning', score: 1 - pages.size / indexable.length, message: `${plural(pairs.length, 'pair')} of pages are 80%+ the same.`, affected });
  },

  function keywordStuffing({ indexable }) {
    const def = { id: 'content.keyword-stuffing', category: C, title: 'No keyword stuffing', weight: 3,
      fix: 'Write naturally. Use the main phrase where it fits and vary it with synonyms — repeating it unnaturally can get a page demoted.' };
    return pageCheck(def, indexable.filter(p => p.contentWordCount >= 150), p => {
      const t = p.topTerms.find(t => (t.term.includes(' ') ? t.density > 3 : t.density > 5) && t.count >= 12);
      return t && `"${t.term}" is ${t.density}% of the text (${t.count} times)`;
    }, { passMessage: 'No term is overused.' });
  },

  function readability({ indexable }) {
    const def = { id: 'content.readability', category: C, title: 'Text is easy to read', weight: 2,
      fix: 'Shorten long sentences (aim for under 20 words), prefer everyday words, and break up long paragraphs.' };
    const measured = indexable.filter(p => p.readability);
    if (!measured.length) return pass(def, 'Not enough paragraph text on any page to measure readability.');
    return pageCheck(def, measured, p => p.readability.score < 30 && `Flesch reading ease ${p.readability.score} (very hard) · ${p.readability.wordsPerSentence} words per sentence`,
      { passMessage: `Readability is fine on all ${measured.length} measured pages (English Flesch score).` });
  },

  function semanticStructure({ indexable }) {
    const def = { id: 'content.semantic-html', category: C, title: 'Pages use semantic HTML structure', weight: 2,
      fix: 'Wrap the main content in <main>, navigation in <nav>, and use <header>, <footer>, <article> and <section> where they fit.' };
    return pageCheck(def, indexable, p => {
      const s = p.semantic;
      const missing = ['main', 'nav', 'header', 'footer'].filter(t => !s[t]);
      return missing.length >= 2 && `Missing <${missing.join('>, <')}>`;
    }, { passMessage: 'Pages use semantic landmarks.' });
  },
];

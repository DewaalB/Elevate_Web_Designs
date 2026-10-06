/* Turns one fetched HTML document into the facts every check needs.
   DOMParser builds an inert document: no scripts run and nothing loads,
   so this reads the raw HTML exactly like a non-rendering crawler does. */
import { normalizeUrl, isSameSite } from './url.js';

const GENERIC_ANCHORS = new Set([
  'click here', 'here', 'read more', 'more', 'learn more', 'this', 'link', 'this link', 'go', 'click',
  'details', 'more info', 'more information', 'continue', 'continue reading', 'see more', 'view more', 'find out more',
]);
const STOPWORDS = new Set(('a an and are as at be but by for from has have he her his i in is it its of on or our ' +
  'she that the their them they this to was we were what when which who will with you your yours us not can all ' +
  'any do does if into more most no so than then there these those up out about also just only very get got how ' +
  'my me one two new use used using may like make made over such some each other own same few both why where ' +
  'van die en het nie vir met op te is wat ons jou').split(' '));
const MAPS_LINK = /(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page\/)/i;
const PHONE = /(?:\+?27|\b0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}\b|\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,4}/g;

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 32-bit FNV-1a hash — compact fingerprints for duplicate detection. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function readability(text) {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => /[A-Za-z]/.test(s)).length;
  if (words.length < 80 || sentences < 3) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length);
  return { score: Math.round(Math.max(-50, Math.min(120, score))), words: words.length, sentences, wordsPerSentence: +(words.length / sentences).toFixed(1) };
}

function topTerms(words) {
  const counts = new Map();
  const add = t => counts.set(t, (counts.get(t) || 0) + 1);
  const content = words.filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  content.forEach(add);
  for (let i = 0; i < content.length - 1; i++) add(content[i] + ' ' + content[i + 1]);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([term, count]) => ({ term, count, density: words.length ? +(count / words.length * 100).toFixed(2) : 0 }));
}

function shingles(words) {
  const set = new Set();
  for (let i = 0; i + 5 <= words.length && set.size < 4000; i++) set.add(hash32(words.slice(i, i + 5).join(' ')));
  return [...set];
}

/** Flattens JSON-LD (arrays, @graph, nested objects) into typed nodes. */
export function jsonLdNodes(data) {
  const out = [];
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 12) return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    if (v['@type']) out.push(v);
    for (const [k, x] of Object.entries(v)) if (k !== '@context') walk(x, depth + 1);
  };
  walk(data, 0);
  return out;
}
export const typesOf = node => [].concat(node['@type'] || []).map(String);

/**
 * @param {string} html
 * @param {string} url  final URL of the document
 * @param {string} rootHost  host of the audited site
 */
export function extractPage(html, url, rootHost) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  const base = (baseHref && normalizeUrl(baseHref, url)) || url;
  const abs = v => (v ? normalizeUrl(v, base) : null);
  const meta = name => [...doc.querySelectorAll(`meta[name="${name}" i]`)].map(m => clean(m.getAttribute('content')));
  const prop = p => clean(doc.querySelector(`meta[property="${p}" i], meta[name="${p}" i]`)?.getAttribute('content')) || null;
  const isHttps = url.startsWith('https:');

  // ── Head ──
  const titles = [...doc.querySelectorAll('title')].filter(t => !t.closest('svg'));
  const descriptions = meta('description');
  const robots = [...meta('robots'), ...meta('googlebot')].join(', ').toLowerCase() || null;
  const canonicals = [...doc.querySelectorAll('link[rel~="canonical" i]')].map(l => ({
    raw: l.getAttribute('href') || '', url: abs(l.getAttribute('href')), inHead: !!l.closest('head'),
  }));
  const charsetMeta = doc.querySelector('meta[charset]')?.getAttribute('charset')
    || doc.querySelector('meta[http-equiv="content-type" i]')?.getAttribute('content')?.match(/charset=([\w-]+)/i)?.[1] || null;
  const favicons = [...doc.querySelectorAll('link[rel~="icon" i], link[rel="apple-touch-icon" i]')]
    .map(l => (l.getAttribute('href') || '').trim()).filter(Boolean)
    .map(h => (h.startsWith('data:') ? 'inline data: icon' : abs(h))).filter(Boolean);
  const hreflang = [...doc.querySelectorAll('link[rel="alternate" i][hreflang]')].map(l => ({ lang: l.getAttribute('hreflang'), url: abs(l.getAttribute('href')) }));

  const og = {};
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name']) og[p.slice(3)] = prop(p);
  const twitterCard = prop('twitter:card');

  const headScripts = [...doc.querySelectorAll('head script[src]')];
  const renderBlockingScripts = headScripts.filter(s => !s.hasAttribute('async') && !s.hasAttribute('defer') &&
    !/module/i.test(s.getAttribute('type') || '')).map(s => abs(s.getAttribute('src'))).filter(Boolean);
  const stylesheets = doc.querySelectorAll('link[rel~="stylesheet" i]').length;

  // ── Structured data ──
  const jsonLd = [...doc.querySelectorAll('script[type="application/ld+json" i]')].map(s => {
    const raw = s.textContent.trim();
    try { return { ok: true, data: JSON.parse(raw) }; }
    catch (e) { return { ok: false, error: e.message, snippet: raw.slice(0, 160) }; }
  });
  const schemaNodes = jsonLd.filter(j => j.ok).flatMap(j => jsonLdNodes(j.data));
  // Top-level items only (each block, or each @graph entry). Nested nodes like a
  // "provider" are references, so Google doesn't require their full properties.
  const schemaRoots = jsonLd.filter(j => j.ok)
    .flatMap(j => [].concat(j.data).flatMap(d => (d && d['@graph'] ? [].concat(d['@graph']) : [d])))
    .filter(n => n && typeof n === 'object' && n['@type']);
  const microdataTypes = [...new Set([...doc.querySelectorAll('[itemscope][itemtype]')]
    .map(e => e.getAttribute('itemtype').split('/').pop()))];

  // ── Headings ──
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({
    level: Number(h.tagName[1]),
    text: clean(h.textContent) || clean([...h.querySelectorAll('img[alt]')].map(i => i.getAttribute('alt')).join(' ')),
  }));

  // ── Links ──
  const links = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href').trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel|sms|data):/i.test(href)) continue;
    const target = abs(href);
    if (!target) continue;
    const imgAlt = clean([...a.querySelectorAll('img')].map(i => i.getAttribute('alt') || '').join(' '));
    const text = clean(a.textContent) || imgAlt || clean(a.getAttribute('aria-label')) || clean(a.getAttribute('title'));
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    links.push({
      url: target, text: text.slice(0, 200), internal: isSameSite(target, rootHost),
      nofollow: /\bnofollow\b/.test(rel), generic: GENERIC_ANCHORS.has(text.toLowerCase()), empty: !text,
    });
  }
  const telLinks = [...doc.querySelectorAll('a[href^="tel:" i]')].map(a => a.getAttribute('href').slice(4).replace(/[^\d+]/g, ''));
  const mapsLink = [...doc.querySelectorAll('a[href], iframe[src]')].some(e => MAPS_LINK.test(e.getAttribute('href') || e.getAttribute('src') || ''));

  // ── Images ──
  const images = [...doc.querySelectorAll('img')].map(img => {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
      (srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : null);
    const link = img.closest('a[href]');
    return {
      src: raw && !raw.startsWith('data:') ? abs(raw) : null,
      inline: !!raw && raw.startsWith('data:'),
      alt: img.hasAttribute('alt') ? clean(img.getAttribute('alt')) : null,
      hasDims: img.hasAttribute('width') && img.hasAttribute('height'),
      lazy: (img.getAttribute('loading') || '').toLowerCase() === 'lazy' || img.hasAttribute('data-src'),
      inLinkWithoutText: !!link && !clean(link.textContent) && !clean(link.getAttribute('aria-label')),
      decorative: img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true',
    };
  });

  // ── Mixed content ──
  const mixedContent = isHttps ? [...new Set([...doc.querySelectorAll('img[src], script[src], iframe[src], link[rel~="stylesheet" i][href], source[src], video[src], audio[src]')]
    .map(e => e.getAttribute('src') || e.getAttribute('href')).filter(v => /^http:\/\//i.test(v || '')))] : [];

  // ── Text & content ──
  const body = doc.body || doc.documentElement;
  const bodyClone = body.cloneNode(true);
  bodyClone.querySelectorAll('script, style, noscript, template, svg, iframe, canvas').forEach(e => e.remove());
  const bodyText = clean(bodyClone.textContent);
  const words = bodyText.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];

  const mainEl = bodyClone.querySelector('main, [role="main"]');
  const contentEl = mainEl || (() => {
    const c = bodyClone.cloneNode(true);
    c.querySelectorAll('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(e => e.remove());
    return c;
  })();
  contentEl.querySelectorAll('button, select, option, label, input, textarea, [role="button"]').forEach(e => e.remove());
  const contentText = clean(contentEl.textContent);
  const contentWords = contentText.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const paragraphText = [...contentEl.querySelectorAll('p, li, blockquote, td')].map(p => clean(p.textContent))
    .filter(t => t.split(' ').length >= 4).join(' ');

  const phones = [...new Set((bodyText.match(PHONE) || []).map(p => p.replace(/[^\d+]/g, '')).filter(p => p.replace(/\D/g, '').length >= 9))].slice(0, 10);

  const scriptCount = doc.querySelectorAll('script').length;
  const appShell = !!doc.querySelector('#root:empty, #app:empty, #__next:empty, [ng-app], app-root:empty');

  return {
    isHtml: true,
    title: titles.length ? clean(titles[0].textContent) : null,
    titleCount: titles.length,
    metaDescription: descriptions.length ? descriptions[0] : null,
    metaDescriptionCount: descriptions.length,
    metaRobots: robots,
    canonicals,
    hreflang,
    lang: clean(doc.documentElement.getAttribute('lang')) || null,
    charsetMeta,
    viewport: clean(doc.querySelector('meta[name="viewport" i]')?.getAttribute('content')) || null,
    favicons,
    og, twitterCard,
    renderBlockingScripts, stylesheets, scriptCount, appShell,
    jsonLdBlocks: jsonLd.length,
    jsonLdErrors: jsonLd.filter(j => !j.ok).map(j => ({ error: j.error, snippet: j.snippet })),
    schemaNodes,
    schemaRoots,
    schemaTypes: [...new Set(schemaNodes.flatMap(typesOf))],
    microdataTypes,
    headings,
    links,
    telLinks, mapsLink,
    hasAddressTag: !!doc.querySelector('address'),
    contactSection: !!doc.querySelector('[id*="contact" i], form input[type="email" i], form input[type="tel" i]'),
    images,
    mixedContent,
    semantic: Object.fromEntries(['main', 'header', 'nav', 'footer', 'article', 'section'].map(t => [t, !!doc.querySelector(t)])),
    wordCount: words.length,
    contentWordCount: contentWords.length,
    contentHash: contentWords.length ? hash32(contentWords.join(' ')) : null,
    shingles: shingles(contentWords),
    topTerms: topTerms(contentWords),
    readability: readability(paragraphText),
    phones,
    bodyTextSample: bodyText.slice(0, 20000),
  };
}

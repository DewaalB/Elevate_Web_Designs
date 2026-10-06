import { pageCheck, pass, skip, info, result, plural, trunc } from './helpers.js';
import { isBroken } from '../crawler.js';

const C = 'images';
const FILENAME_ALT = /(\.(jpe?g|png|gif|webp|avif|svg)$|^(img|image|dsc|dcim|photo|pic|screenshot|untitled)[\s_-]*\d*$|^[\w-]*\d{4,}[\w-]*$)/i;
const BAD_FILENAME = /\/(img|image|dsc|dscn|pxl|photo|pic|screenshot|screen-shot|untitled|whatsapp-image)[\s_-]*[\d_-]*\.(jpe?g|png|gif|webp|avif)$|\/[a-f0-9]{16,}\.(jpe?g|png|gif|webp|avif)$/i;
const fileName = src => { try { return decodeURIComponent(new URL(src).pathname.split('/').pop()); } catch { return src; } };
const kb = bytes => `${Math.round(bytes / 1024)} KB`;

export const imageChecks = [

  function altMissing({ primary: pages }) {
    const def = { id: 'images.alt-missing', category: C, title: 'Images have alt text', weight: 6,
      fix: 'Add an alt attribute to every <img> describing what it shows (e.g. alt="Plumber fixing a geyser in Durbanville"). Use alt="" only for purely decorative images.' };
    const withImgs = pages.filter(p => p.images.length);
    if (!withImgs.length) return skip(def, 'No images found.');
    const total = withImgs.reduce((n, p) => n + p.images.length, 0);
    const r = pageCheck(def, withImgs, p => {
      const miss = p.images.filter(i => i.alt === null && !i.decorative);
      return miss.length && `${plural(miss.length, 'image')}: ${miss.slice(0, 3).map(i => (i.src ? fileName(i.src) : 'inline image')).join(', ')}`;
    }, { passMessage: `All ${total} images have an alt attribute.`, failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} images with no alt attribute.` });
    const missingCount = withImgs.reduce((n, p) => n + p.images.filter(i => i.alt === null && !i.decorative).length, 0);
    if (missingCount) r.score = 1 - missingCount / total;
    return r;
  },

  function altEmptyLinked({ primary: pages }) {
    const def = { id: 'images.alt-empty-link', category: C, title: 'Linked images have alt text', weight: 3,
      fix: 'When an image is the only content of a link, its alt text is the link\'s text — describe where the link goes.' };
    return pageCheck(def, pages.filter(p => p.images.length), p => {
      const bad = p.images.filter(i => i.alt === '' && i.inLinkWithoutText);
      return bad.length && `${plural(bad.length, 'linked image')} with empty alt`;
    }, { passMessage: 'Every image used as a link has alt text.' });
  },

  function altQuality({ primary: pages }) {
    const def = { id: 'images.alt-quality', category: C, title: 'Alt text is descriptive and concise', weight: 2,
      fix: 'Describe the image in plain words (under ~125 characters). Don\'t use file names or stuff keywords.' };
    return pageCheck(def, pages.filter(p => p.images.some(i => i.alt)), p => {
      const issues = [];
      for (const i of p.images.filter(i => i.alt)) {
        if (i.alt.length > 125) issues.push(`${i.alt.length}-char alt on ${i.src ? fileName(i.src) : 'image'}`);
        else if (FILENAME_ALT.test(i.alt.trim())) issues.push(`alt looks like a file name: "${trunc(i.alt, 40)}"`);
      }
      return issues.length && issues.slice(0, 3).join('; ');
    }, { passMessage: 'Alt text is descriptive and concise.' });
  },

  function brokenImages({ primary: pages, checks, site }) {
    const def = { id: 'images.broken', category: C, title: 'No broken images', weight: 6,
      fix: 'Re-upload the missing images or fix their paths.' };
    if (!site.checkLimits.images.total) return skip(def, 'No images found.');
    const r = pageCheck(def, pages.filter(p => p.images.length), p => {
      const broken = [...new Set(p.images.filter(i => i.src && isBroken(checks.images.get(i.src))).map(i => i.src))];
      return broken.length && broken.slice(0, 3).map(u => `${fileName(u)} (${checks.images.get(u).error || checks.images.get(u).status})`).join(', ');
    }, { severity: 'critical', passMessage: `Checked ${site.checkLimits.images.checked} images — none broken.`, failMessage: n => `${plural(n, 'page')} ${n === 1 ? 'shows' : 'show'} broken images.` });
    const lim = site.checkLimits.images;
    if (lim.total > lim.checked) r.message += ` (${lim.total - lim.checked} images not checked — limit ${lim.checked}.)`;
    return r;
  },

  function largeImages({ checks, pages }) {
    const def = { id: 'images.large', category: C, title: 'Images are reasonably sized', weight: 4,
      fix: 'Resize images to the size they display at and compress them (e.g. squoosh.app). Most photos should be under 200 KB.' };
    const sized = [...checks.images].filter(([, r]) => !r.error && r.status < 400 && Number(r.headers?.['content-length']) > 0);
    if (!sized.length) return skip(def, 'Image servers did not report file sizes, so sizes can\'t be measured.');
    const big = sized.filter(([, r]) => Number(r.headers['content-length']) > 300 * 1024)
      .sort((a, b) => b[1].headers['content-length'] - a[1].headers['content-length']);
    if (!big.length) return pass(def, `All ${sized.length} measured images are under 300 KB.`);
    const usedOn = src => pages.find(p => p.images.some(i => i.src === src))?.finalUrl;
    return result(def, { status: 'warning', score: 1 - big.length / sized.length,
      message: `${plural(big.length, 'image')} over 300 KB (largest ${kb(big[0][1].headers['content-length'])}).`,
      affected: big.map(([src, r]) => ({ url: src, detail: `${kb(r.headers['content-length'])}${usedOn(src) ? ` · on ${new URL(usedOn(src)).pathname}` : ''}` })) });
  },

  function dimensions({ primary: pages }) {
    const def = { id: 'images.dimensions', category: C, title: 'Images declare width and height', weight: 2,
      fix: 'Add width and height attributes to <img> tags so the browser reserves space and the layout doesn\'t jump (Cumulative Layout Shift).' };
    return pageCheck(def, pages.filter(p => p.images.length), p => {
      const miss = p.images.filter(i => !i.hasDims && !i.inline);
      return miss.length && `${miss.length} of ${p.images.length} images`;
    }, { passMessage: 'All images declare their dimensions.' });
  },

  function modernFormats({ checks }) {
    const def = { id: 'images.format', category: C, title: 'Large images use modern formats', weight: 0,
      fix: 'Serve WebP or AVIF versions of large JPEG/PNG images — typically 25–50% smaller at the same quality.' };
    const old = [...checks.images].filter(([src, r]) => /\.(jpe?g|png)(\?|$)/i.test(src) && Number(r.headers?.['content-length']) > 100 * 1024);
    if (!old.length) return pass(def, 'No large JPEG/PNG images found.');
    return info(def, `${plural(old.length, 'JPEG/PNG image')} over 100 KB could be converted to WebP/AVIF.`,
      { affected: old.map(([src, r]) => ({ url: src, detail: kb(r.headers['content-length']) })) });
  },

  function lazyLoading({ primary: pages }) {
    const def = { id: 'images.lazy', category: C, title: 'Image-heavy pages lazy-load images', weight: 0,
      fix: 'Add loading="lazy" to images below the fold (not the main hero image) so pages load faster.' };
    const r = pageCheck(def, pages.filter(p => p.images.length > 6), p => !p.images.some(i => i.lazy) && `${p.images.length} images, none lazy-loaded`,
      { passMessage: 'Pages with many images use lazy loading.' });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },

  function fileNames({ primary: pages }) {
    const def = { id: 'images.filenames', category: C, title: 'Image file names are descriptive', weight: 0,
      fix: 'Name image files after what they show, e.g. "bathroom-renovation-somerset-west.jpg" instead of "IMG_4032.jpg".' };
    const r = pageCheck(def, pages.filter(p => p.images.some(i => i.src)), p => {
      const bad = [...new Set(p.images.filter(i => i.src && BAD_FILENAME.test(new URL(i.src).pathname)).map(i => fileName(i.src)))];
      return bad.length && bad.slice(0, 4).join(', ');
    }, { passMessage: 'Image file names look descriptive.' });
    if (r.status === 'warning' || r.status === 'critical') r.status = 'info';
    return r;
  },
];

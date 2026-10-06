/* Building blocks for checks. Every check returns the same shape:
     { id, category, title, weight, status, score, message, affected, fix, data? }
   status: 'critical' | 'warning' | 'info' | 'pass' | 'skipped'
   score:  0..1 (share of the check that passed); ignored for info/skipped
   weight: importance inside its category; 0 = informational only */

export const CATEGORIES = [
  { id: 'technical', name: 'Technical SEO', weight: 20 },
  { id: 'onpage', name: 'On-Page SEO', weight: 20 },
  // Without a Lighthouse result the crawl-only speed checks aren't enough to score speed honestly.
  { id: 'performance', name: 'Performance', weight: 15, requires: 'perf.lighthouse' },
  { id: 'content', name: 'Content', weight: 15 },
  { id: 'images', name: 'Images', weight: 10 },
  { id: 'local', name: 'Local SEO', weight: 10 },
  { id: 'schema', name: 'Structured Data', weight: 10 },
];

const MAX_AFFECTED = 200;

export function result(def, r) {
  const affected = (r.affected || []).slice(0, MAX_AFFECTED);
  return {
    id: def.id, category: def.category, title: def.title, weight: def.weight ?? 0, fix: def.fix || '',
    status: r.status, score: r.score ?? (r.status === 'pass' ? 1 : 0),
    message: r.message || '', affected, affectedTotal: (r.affected || []).length, data: r.data,
  };
}

export const pass = (def, message, extra = {}) => result(def, { status: 'pass', score: 1, message, ...extra });
export const skip = (def, message, extra = {}) => result(def, { status: 'skipped', message, ...extra });
export const info = (def, message, extra = {}) => result(def, { status: 'info', message, ...extra });
export const fail = (def, severity, message, extra = {}) => result(def, { status: severity, score: 0, message, ...extra });

/** Runs `test` on each page; a truthy return (string detail) marks the page affected.
 *  Score is the share of applicable pages that passed. */
export function pageCheck(def, pages, test, { severity = def.severity || 'warning', passMessage, failMessage } = {}) {
  if (!pages.length) return skip(def, 'No pages this check applies to.');
  const affected = [];
  for (const p of pages) {
    const detail = test(p);
    if (detail) affected.push({ url: p.finalUrl, detail: detail === true ? '' : String(detail) });
  }
  if (!affected.length) return pass(def, passMessage || `All ${pages.length} pages pass.`);
  return result(def, {
    status: severity,
    score: 1 - affected.length / pages.length,
    message: failMessage ? failMessage(affected.length, pages.length) : `${affected.length} of ${pages.length} pages affected.`,
    affected,
  });
}

/** Groups pages by a key; groups larger than one are duplicates. */
export function duplicates(pages, keyFn) {
  const groups = new Map();
  for (const p of pages) {
    const k = keyFn(p);
    if (k == null || k === '') continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const trunc = (s, n = 90) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

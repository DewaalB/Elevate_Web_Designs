/* Saved audits live in Firestore (collection "seoAudits", admin-only rules).
   The full report is stored as one JSON string so nested arrays are fine;
   it's trimmed if needed to stay under Firestore's 1 MiB document limit. */
import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc, updateDoc, query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const COLLECTION = 'seoAudits';
const MAX_REPORT_BYTES = 750_000;
const bytes = s => new TextEncoder().encode(s).length;

function shrink(report) {
  let json = JSON.stringify(report);
  if (bytes(json) <= MAX_REPORT_BYTES) return json;

  const r = structuredClone(report);
  r.trimmed = true;
  const steps = [
    () => { r.pages.forEach(p => { delete p.headings; }); r.checks.forEach(c => { c.affected = c.affected.slice(0, 60); }); },
    () => { if (r.site.robots) r.site.robots.text = null; r.checks.forEach(c => { c.affected = c.affected.slice(0, 20); }); },
    () => { r.pages.forEach(p => { p.issues = p.issues.slice(0, 15).map(i => ({ ...i, detail: (i.detail || '').slice(0, 120) })); delete p.metaDescription; }); },
    () => { r.checks.forEach(c => { c.affected = c.affected.slice(0, 5); }); r.pages.forEach(p => { p.issues = p.issues.slice(0, 5); }); },
  ];
  for (const step of steps) {
    step();
    json = JSON.stringify(r);
    if (bytes(json) <= MAX_REPORT_BYTES) return json;
  }
  throw new Error('This audit is too large to save. Try a lower page limit.');
}

export function createStore(db) {
  const col = collection(db, COLLECTION);
  return {
    async save(report) {
      const ref = await addDoc(col, {
        url: report.homeUrl,
        host: report.rootHost,
        overall: report.overall ?? -1,
        scores: Object.fromEntries(report.categories.map(c => [c.id, c.score ?? -1])),
        counts: report.counts,
        pageCount: report.pages.length,
        version: report.version,
        createdAt: serverTimestamp(),
        report: shrink(report),
      });
      return ref.id;
    },

    async list(max = 30) {
      const snap = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(max)));
      return snap.docs.map(d => {
        const x = d.data();
        return { id: d.id, url: x.url, host: x.host, overall: x.overall, counts: x.counts, pageCount: x.pageCount, createdAt: x.createdAt?.toDate?.() || null };
      });
    },

    async load(id) {
      const snap = await getDoc(doc(db, COLLECTION, id));
      if (!snap.exists()) throw new Error('That audit no longer exists.');
      const x = snap.data();
      const report = JSON.parse(x.report);
      report.ai = x.ai ? JSON.parse(x.ai) : null;
      report.id = id;
      return report;
    },

    async saveAi(id, ai) {
      await updateDoc(doc(db, COLLECTION, id), { ai: JSON.stringify(ai) });
    },

    remove: id => deleteDoc(doc(db, COLLECTION, id)),
  };
}

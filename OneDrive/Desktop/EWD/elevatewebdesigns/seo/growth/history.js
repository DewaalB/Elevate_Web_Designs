/* Scan history and before/after comparison.
   Signed in (admin): full scans are saved to Firestore (seoAudits, existing
   admin-only rules) and can be reopened. Visitors: a compact summary of each
   scan is kept in this browser only, enough for score trends and
   "what was fixed" — nothing is sent anywhere. */
import { healthScores } from './scoring.js';

const LOCAL_KEY = 'ewd_growth_history_v1';
const MAX_LOCAL = 30;

export function summarize(report, health, perf) {
  return {
    host: report.rootHost, url: report.homeUrl, date: report.createdAt,
    overall: health.overall, areas: health.areas, groups: health.groups,
    perfScore: perf?.score ?? null,
    failing: report.checks.filter(c => c.status === 'critical' || c.status === 'warning').map(c => ({ id: c.id, title: c.title, status: c.status })),
  };
}

/** Summary for an older saved report that predates Website Growth. */
export function summarizeSaved(report) {
  const perf = report.growth?.perf || null;
  return summarize(report, report.growth?.health || healthScores(report, perf), perf);
}

/* ── Visitor history (this browser) ── */
export function localHistory() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
}
export function saveLocal(summary) {
  try {
    const list = [summary, ...localHistory()].slice(0, MAX_LOCAL);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch { /* storage full or blocked — history is a convenience only */ }
}
export function clearLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch {} }

/** Most recent earlier scan of the same site. */
export function previousFor(list, summary) {
  return list.find(s => s.host === summary.host && s.date < summary.date) || null;
}

/** What changed between two scans of the same site. */
export function beforeAfter(prev, cur) {
  const delta = (a, b) => (a != null && b != null ? b - a : null);
  const prevIds = new Map(prev.failing.map(f => [f.id, f]));
  const curIds = new Map(cur.failing.map(f => [f.id, f]));
  return {
    prevDate: prev.date, curDate: cur.date,
    overall: { before: prev.overall, after: cur.overall, change: delta(prev.overall, cur.overall) },
    areas: Object.fromEntries(['seo', 'performance', 'technical'].map(k => [k, { before: prev.areas?.[k] ?? null, after: cur.areas?.[k] ?? null, change: delta(prev.areas?.[k], cur.areas?.[k]) }])),
    fixed: [...prevIds.values()].filter(f => !curIds.has(f.id)),
    newIssues: [...curIds.values()].filter(f => !prevIds.has(f.id)),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   WEBSITE GROWTH SCORING — the one place where every weight lives.
   ════════════════════════════════════════════════════════════════════════

   How a score is built
   --------------------
   1. Every check (seo/checks/*) returns a status and a 0–1 score: the share of
      pages/items that passed. A check's `weight` says how much it matters
      inside its group. Info/skipped checks and weight-0 checks don't count.
   2. Each check belongs to one HEALTH GROUP (GROUP_OF / PREFIX_GROUP below).
      group score = Σ(weight × score) / Σ(weight)  → 0–100
   3. Performance is scored by the Performance Analyzer instead
      (PERF_WEIGHTS below, from measured resource sizes, compression, caching,
      server response time — plus Lighthouse when PageSpeed data is available).
   4. OVERALL HEALTH = weighted average of the groups (HEALTH_WEIGHTS). Groups
      that couldn't be measured are left out and the rest re-weighted, so a
      missing measurement never counts as a zero or a full mark.
   5. The four headline areas:
        SEO              = SEO group
        Performance      = Performance group
        Technical Health = Technical + Security + Mobile (TECH_HEALTH_WEIGHTS)
        Competitive Pos. = only after a competitor scan (competitivePosition)
   6. Page SEO score = 100 minus a penalty per issue on that page
      (PAGE_PENALTY), floored at 0.
   ════════════════════════════════════════════════════════════════════════ */

export const HEALTH_GROUPS = [
  { id: 'seo', name: 'SEO', weight: 30 },
  { id: 'performance', name: 'Performance', weight: 20 },
  { id: 'technical', name: 'Technical', weight: 15 },
  { id: 'content', name: 'Content', weight: 10 },
  { id: 'mobile', name: 'Mobile', weight: 10 },
  { id: 'security', name: 'Security', weight: 10 },
  { id: 'images', name: 'Images', weight: 5 },
];
export const HEALTH_WEIGHTS = Object.fromEntries(HEALTH_GROUPS.map(g => [g.id, g.weight]));
export const TECH_HEALTH_WEIGHTS = { technical: 15, security: 10, mobile: 10 };

/** Performance Analyzer sub-scores and their share of the performance score. */
export const PERF_WEIGHTS = { loading: 30, images: 25, javascript: 20, css: 10, caching: 15 };
/** When Lighthouse (PageSpeed Insights) data exists it's blended in at this share. */
export const LIGHTHOUSE_SHARE = 0.5;

export const PAGE_PENALTY = { critical: 15, warning: 6, info: 2 };

const GROUP_OF = {
  'tech.https': 'security', 'tech.http-redirect': 'security', 'tech.mixed-content': 'security',
  'sec.hsts': 'security', 'sec.headers': 'security',
  'tech.viewport': 'mobile', 'images.dimensions': 'mobile', 'local.click-to-call': 'mobile',
};
const PREFIX_GROUP = { tech: 'technical', onpage: 'seo', schema: 'seo', local: 'seo', content: 'content', images: 'images', perf: 'performance', sec: 'security' };

export const groupOf = id => GROUP_OF[id] || PREFIX_GROUP[id.split('.')[0]] || 'technical';

const scored = c => ['pass', 'warning', 'critical'].includes(c.status) && c.weight > 0;
const clamp01 = x => Math.max(0, Math.min(1, x));

function weightedChecks(checks, extra = []) {
  const items = [...checks.filter(scored).map(c => ({ w: c.weight, s: clamp01(c.score) })), ...extra];
  const w = items.reduce((n, i) => n + i.w, 0);
  return w ? Math.round(items.reduce((n, i) => n + i.w * i.s, 0) / w * 100) : null;
}

export function weightedAverage(scores, weights) {
  const parts = Object.entries(weights).filter(([k]) => scores[k] != null);
  const w = parts.reduce((n, [, v]) => n + v, 0);
  return w ? Math.round(parts.reduce((n, [k, v]) => n + v * scores[k], 0) / w) : null;
}

/**
 * @param {object} report  output of analyze()
 * @param {object|null} perf  output of analyzePerformance(), or null
 */
export function healthScores(report, perf) {
  const groups = {};
  for (const g of HEALTH_GROUPS) {
    if (g.id === 'performance') { groups.performance = perf?.score ?? null; continue; }
    const mine = report.checks.filter(c => groupOf(c.id) === g.id);
    // Lighthouse's mobile score is real mobile evidence when we have it.
    const extra = g.id === 'mobile' && perf?.psi?.score != null ? [{ w: 6, s: perf.psi.score / 100 }] : [];
    groups[g.id] = weightedChecks(mine, extra);
  }
  const counts = { critical: 0, warning: 0, recommendation: 0, passed: 0, notChecked: 0 };
  for (const c of report.checks) {
    if (c.status === 'critical') counts.critical++;
    else if (c.status === 'warning') counts.warning++;
    else if (c.status === 'info') counts.recommendation++;
    else if (c.status === 'pass') counts.passed++;
    else counts.notChecked++;
  }
  return {
    overall: weightedAverage(groups, HEALTH_WEIGHTS),
    groups,
    areas: {
      seo: groups.seo,
      performance: groups.performance,
      technical: weightedAverage(groups, TECH_HEALTH_WEIGHTS),
      competitive: null,
    },
    counts,
  };
}

export function pageScore(row) {
  if (row.error || row.status >= 400) return 0;
  const seen = new Set();
  let penalty = 0;
  for (const i of row.issues || []) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    penalty += PAGE_PENALTY[i.status] || 0;
  }
  return Math.max(0, 100 - penalty);
}

/** 0–100 where 50 = level with the competitors scanned; each point you lead or
 *  trail by (averaged over areas and competitors) moves it one point. */
export function competitivePosition(you, competitors) {
  const keys = ['overall', 'seo', 'performance', 'technical', 'content'];
  const diffs = [];
  for (const c of competitors) {
    for (const k of keys) {
      const a = k === 'overall' ? you.health.overall : k === 'content' ? you.health.groups.content : you.health.areas[k];
      const b = k === 'overall' ? c.health.overall : k === 'content' ? c.health.groups.content : c.health.areas[k];
      if (a != null && b != null) diffs.push(a - b);
    }
  }
  if (!diffs.length) return null;
  return Math.round(Math.max(0, Math.min(100, 50 + diffs.reduce((n, d) => n + d, 0) / diffs.length)));
}

/** Linear 0–100: 100 at or below `good`, 0 at or above `bad`. */
export function lin(value, good, bad) {
  if (value == null || Number.isNaN(value)) return null;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round(100 * (bad - value) / (bad - good));
}

export const tone = s => (s == null ? 'none' : s >= 90 ? 'good' : s >= 50 ? 'ok' : 'bad');

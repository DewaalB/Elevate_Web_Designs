/* Rendering for the Website Growth page. Everything from scanned sites is
   escaped with esc(); numbers that weren't measured render as "Not available". */
import { esc, ring, pageDetailHtml } from '../render.js';
import { shortUrl } from '../url.js';
import { CATEGORIES } from '../checks/helpers.js';
import { HEALTH_GROUPS, groupOf, pageScore, tone } from './scoring.js';
import { explain } from './explain.js';
import { fmtBytes } from './performance.js';

const CAT_NAME = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));
const GROUP_NAME = Object.fromEntries(HEALTH_GROUPS.map(g => [g.id, g.name]));
const SEV = {
  critical: ['🔴', 'Critical', 'critical'], warning: ['🟠', 'Warning', 'warning'],
  info: ['🔵', 'Recommendation', 'recommendation'], pass: ['🟢', 'Passed', 'pass'], skipped: ['⚪', 'Not checked', 'skipped'],
};
const NA = '<span class="muted">Not available</span>';
const link = (url, label = url) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>` : esc(label));
const bar = (label, s, sub = '') => `<div class="g-bar tone-${tone(s)}"><span>${esc(label)}</span><span class="track"><span class="fill" style="width:${s ?? 0}%"></span></span><span class="val">${s ?? 'n/a'}</span>${sub}</div>`;
const fmtDate = d => new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const deltaHtml = d => (d == null ? '<span class="g-delta flat">—</span>' : `<span class="g-delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d}</span>`);

/** Opportunities from failed checks + performance findings, ranked by impact. */
export function topOpportunities(report, perf) {
  const fromChecks = report.recommendations.map(r => ({ impact: r.impact, severity: r.status, title: explain(r).problem, detail: r.fix, id: r.id }));
  const fromPerf = (perf?.recommendations || []).map(r => ({ impact: r.impact, severity: r.severity, title: r.title, detail: r.detail }));
  return [...fromChecks, ...fromPerf].sort((a, b) => b.impact - a.impact);
}

/* ── Health dashboard ── */
export function healthHtml(s) {
  const { report, health, perf, beforeAfter, isAdmin } = s;
  const area = (label, v, sub) => `<div class="g-area tone-${tone(v)}"><span class="lbl">${label}</span><span class="num">${v ?? '—'}${v != null ? '<small> / 100</small>' : ''}</span><span class="sub">${sub}</span></div>`;
  const opps = topOpportunities(report, perf).slice(0, 6);
  const c = health.counts;
  const pagesAnalysed = report.pages.filter(p => p.title !== undefined).length;
  const notes = [];
  if (report.site.crawl.limitHit) notes.push(`The scan stopped at its ${report.site.crawl.maxPages}-page limit${isAdmin ? '' : ' for free scans'}, so some pages weren't checked.`);
  if (report.site.crawl.blockedByRobots?.length) notes.push(`${report.site.crawl.blockedByRobots.length} pages were skipped because the website's robots.txt asks crawlers not to visit them.`);
  if (report.site.crawl.budgetHit) notes.push('The free scan reached its request limit, so some links and images weren\'t checked.');
  if (report.checks.find(x => x.id === 'tech.js-content' && x.status === 'info')) notes.push('Some pages build their content with JavaScript, so content results for those pages may be incomplete.');

  return `
    <div class="panel g-head">
      <div class="g-head-main">${ring(health.overall, 132)}<div>
        <span class="eyebrow">Overall website health</span>
        <h2>${link(report.homeUrl, report.rootHost)}</h2>
        <p class="muted small">${esc(fmtDate(report.createdAt))} · ${pagesAnalysed} pages analysed · ${Math.round((report.durationMs || 0) / 1000)}s</p>
      </div></div>
      <button class="btn primary small" data-action="report" type="button">⬇ Download report</button>
    </div>
    ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
    <div class="g-areas">
      ${area('SEO', health.areas.seo, 'Titles, content structure, links, local & structured data')}
      ${area('Performance', health.areas.performance, perf?.psi ? 'Measured files + Google Lighthouse' : 'Measured from your homepage files')}
      ${area('Technical Health', health.areas.technical, 'Crawlability, security & mobile setup')}
      ${area('Competitive Position', health.areas.competitive, health.areas.competitive == null ? 'Run a competitor scan to compare' : '50 = level with your competitors')}
    </div>
    <div class="g-two">
      <div class="panel"><h3 class="g-h">Health by category</h3>
        <div class="g-bars">${HEALTH_GROUPS.map(g => bar(g.name, health.groups[g.id])).join('')}</div>
        <div class="g-counts">
          <div class="g-count c-crit"><b>${c.critical}</b><span>🔴 Critical</span></div>
          <div class="g-count c-warn"><b>${c.warning}</b><span>🟠 Warnings</span></div>
          <div class="g-count c-rec"><b>${c.recommendation}</b><span>🔵 Recommendations</span></div>
          <div class="g-count c-pass"><b>${c.passed}</b><span>🟢 Passed</span></div>
        </div>
      </div>
      <div class="panel"><h3 class="g-h">Top opportunities</h3>
        ${opps.length ? `<ol class="g-opps">${opps.map(o => `<li><strong>${esc(o.title)}</strong>${esc(o.detail)}</li>`).join('')}</ol>` : '<p class="muted">No significant problems found — nice work.</p>'}
      </div>
    </div>
    ${beforeAfter ? beforeAfterHtml(beforeAfter) : ''}`;
}

export function beforeAfterHtml(ba) {
  const row = (label, x) => `<div><span class="muted small">${label}</span><b>${x.before ?? '—'} → ${x.after ?? '—'}</b>${deltaHtml(x.change)}</div>`;
  return `<div class="panel"><h3 class="g-h">Before / after — compared with your scan on ${esc(fmtDate(ba.prevDate))}</h3>
    <div class="g-ba">${row('Overall', ba.overall)}${row('SEO', ba.areas.seo)}${row('Performance', ba.areas.performance)}${row('Technical', ba.areas.technical)}</div>
    <div class="g-adv">
      <div class="yours"><strong>Fixed since last scan (${ba.fixed.length})</strong><ul>${ba.fixed.map(f => `<li>${esc(f.title)}</li>`).join('') || '<li class="muted">Nothing new fixed yet</li>'}</ul></div>
      <div class="theirs"><strong>New issues (${ba.newIssues.length})</strong><ul>${ba.newIssues.map(f => `<li>${esc(f.title)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
    </div></div>`;
}

/* ── SEO auditor ── */
function issueHtml(check, rootHost) {
  const [icon, label, cls] = SEV[check.status];
  const e = explain(check);
  const failing = check.status !== 'pass' && check.status !== 'skipped';
  const rows = check.affected.map(a => `<tr><td class="mono">${link(a.url, shortUrl(a.url, rootHost))}</td><td>${esc(a.detail)}</td></tr>`).join('');
  return `<details class="issue g-issue sev-${check.status}" data-group="${groupOf(check.id)}">
    <summary><span class="badge ${cls}">${icon} ${label}</span><span class="issue-title">${esc(failing ? e.problem : check.title)}</span><span class="issue-cat">${esc(GROUP_NAME[groupOf(check.id)])}</span>${check.affectedTotal ? `<span class="issue-count">${check.affectedTotal}</span>` : ''}</summary>
    <div class="issue-body">
      <p class="what"><strong>What we found:</strong> ${esc(check.message)}</p>
      ${failing && e.why ? `<p class="why"><strong>Why it matters:</strong> ${esc(e.why)}</p>` : ''}
      ${failing && check.fix ? `<p class="fix"><strong>How to fix:</strong> ${esc(check.fix)}</p>` : ''}
      <details class="g-tech"><summary>Technical details</summary><div>
        <p class="mono small">${esc(check.id)} · ${esc(check.title)} · ${esc(CAT_NAME[check.category] || check.category)} · weight ${check.weight}</p>
        ${rows ? `<div class="table-wrap"><table class="affected"><tbody>${rows}</tbody></table></div>${check.affectedTotal > check.affected.length ? `<p class="muted small">Showing ${check.affected.length} of ${check.affectedTotal}.</p>` : ''}` : ''}
      </div></details>
    </div></details>`;
}

export function seoHtml(s) {
  const { report } = s;
  const order = ['critical', 'warning', 'info', 'pass', 'skipped'];
  const groups = order.map(st => [st, report.checks.filter(c => c.status === st)]).filter(([, l]) => l.length);
  const rows = report.pages.map((p, i) => {
    const html = p.title !== undefined;
    const score = html ? pageScore(p) : null;
    const sev = { critical: 0, warning: 0 }; p.issues.forEach(x => { if (sev[x.status] != null) sev[x.status]++; });
    return `<tr class="page-row" data-i="${i}" tabindex="0">
      <td class="mono">${esc(shortUrl(p.url, report.rootHost))}</td>
      <td class="page-score num tone-${tone(score)}">${p.error ? `<span class="badge critical">${esc(p.error)}</span>` : score ?? `<span class="muted">${esc(p.status)}</span>`}</td>
      <td>${html ? esc(p.title ?? '— missing —') : p.aliasOf ? '<span class="muted">duplicate URL</span>' : ''}</td>
      <td>${html ? (p.metaDescription ? '✓' : '<span class="sev-text-warning">missing</span>') : ''}</td>
      <td>${html ? esc(p.h1?.[0] ?? '— none —') : ''}</td>
      <td class="num">${p.words ?? ''}</td><td class="num">${p.images ?? ''}</td><td class="num">${p.internalLinks ?? ''}</td>
      <td class="num">${sev.critical ? `<span class="dot critical">${sev.critical}</span>` : ''}${sev.warning ? `<span class="dot warning">${sev.warning}</span>` : ''}${!sev.critical && !sev.warning && html ? '🟢' : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="panel">
      <div class="filter-chips" role="group" aria-label="Filter by area"><button class="chip active" data-gfilter="all">All</button>${HEALTH_GROUPS.filter(g => g.id !== 'performance').map(g => `<button class="chip" data-gfilter="${g.id}">${g.name}</button>`).join('')}</div>
      ${groups.map(([st, list]) => `<h3 class="g-sev sev-text-${st === 'info' ? 'info' : st}">${SEV[st][0]} ${st === 'info' ? 'Recommendations' : st === 'pass' ? 'Passed' : st === 'skipped' ? 'Not checked' : SEV[st][1] + (st === 'critical' ? '' : 's')} (${list.length})</h3>
        <div class="issue-list">${list.map(c => issueHtml(c, report.rootHost)).join('')}</div>`).join('')}
    </div>
    <div class="panel"><h3 class="g-h">Page-by-page analysis</h3>
      <div class="table-wrap"><table class="g-ptable">
        <thead><tr><th>URL</th><th class="num">SEO score</th><th>Title</th><th>Meta description</th><th>H1</th><th class="num">Words</th><th class="num">Images</th><th class="num">Internal links</th><th class="num">Issues</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">Click a page for details. Page score = 100 minus 15 per critical issue, 6 per warning and 2 per recommendation on that page.</p>
    </div>`;
}
export const pageDetail = (p, host) => pageDetailHtml(p, host);

/* ── Performance ── */
export function perfHtml(s) {
  const { perf } = s;
  if (!perf) return '<div class="panel"><p class="muted">Performance data isn\'t available for this scan.</p></div>';
  const t = perf.totals, m = perf.metrics;
  const metric = (label, v) => `<div class="g-metric ${v == null ? 'na' : ''}"><span>${label}</span><b>${v ?? 'Not available'}</b></div>`;
  const kinds = ['image', 'script', 'stylesheet', 'font', 'document', 'other'];
  const labels = { image: 'Images', script: 'JavaScript', stylesheet: 'CSS', font: 'Fonts', document: 'HTML', other: 'Other' };
  const lab = perf.psi?.lab || {};
  const field = perf.psi?.field;
  const pct = x => (x == null ? null : `${Math.round(x * 100)}%`);
  const rows = perf.resources.map(r => `<tr>
    <td class="res-name">${link(r.url, r.name)}</td><td>${labels[r.kind] || r.kind}</td>
    <td>${r.size == null ? NA : fmtBytes(r.size)}${r.size != null && !r.sizeIsTransfer && r.kind !== 'document' ? '<span class="muted small"> *</span>' : ''}</td>
    <td>${r.ms == null ? NA : `${(r.ms / 1000).toFixed(2)}s`}</td>
    <td>${(r.problems || []).map(([sv, txt]) => `<span class="prob ${sv}">${sv === 'critical' ? '🔴' : sv === 'warning' ? '🟠' : '🔵'} ${esc(txt)}</span>`).join('') || '<span class="muted small">—</span>'}</td>
  </tr>`).join('');
  return `
    <div class="panel g-head"><div class="g-head-main">${ring(perf.score, 120)}<div>
      <span class="eyebrow">Performance score</span><h2>${esc(new URL(perf.url).hostname)}</h2>
      <p class="muted small">${perf.psi ? `Blend of measured files (${perf.resourceScore ?? '—'}) and Google Lighthouse mobile (${perf.psi.score}).` : `From measured homepage files. Google Lighthouse: not available${perf.psiError ? ` (${esc(perf.psiError)})` : ''}.`}</p>
    </div></div></div>
    <div class="g-two">
      <div class="panel"><h3 class="g-h">Breakdown</h3><div class="g-bars">
        ${bar('Loading', perf.subscores.loading)}${bar('Images', perf.subscores.images)}${bar('JavaScript', perf.subscores.javascript)}${bar('CSS', perf.subscores.css)}${bar('Caching', perf.subscores.caching)}
      </div></div>
      <div class="panel"><h3 class="g-h">Page weight by type</h3>
        <div class="g-stack">${kinds.filter(k => t[k]).map(k => `<span class="k-${k}" style="width:${(t[k] / t.bytes * 100).toFixed(1)}%" title="${labels[k]} ${fmtBytes(t[k])}"></span>`).join('')}</div>
        <div class="g-legend">${kinds.filter(k => t[k]).map(k => `<span><i class="k-${k}"></i>${labels[k]} ${fmtBytes(t[k])}</span>`).join('')}</div>
        <p class="muted small" style="margin-top:.6rem">${fmtBytes(t.bytes)} across ${t.requests} files${t.notMeasured ? ` (${t.notMeasured} more not measured)` : ''}.</p>
      </div>
    </div>
    <div class="panel"><h3 class="g-h">Key measurements</h3><div class="g-metrics">
      ${metric('Server response (TTFB)', m.ttfbMs != null ? `${m.ttfbMs} ms` : null)}
      ${metric('Total page weight', fmtBytes(t.bytes))}
      ${metric('Files (requests)', t.requests)}
      ${metric('JavaScript', `${fmtBytes(t.script)} · ${t.scripts} files`)}
      ${metric('CSS', `${fmtBytes(t.stylesheet)} · ${t.stylesheets} files`)}
      ${metric('Images', `${fmtBytes(t.image)} · ${t.images} files`)}
      ${metric('Fonts', t.fonts ? `${fmtBytes(t.font)} · ${t.fonts} files` : '0 found')}
      ${metric('Render-blocking scripts', m.blockingScripts)}
      ${metric('Text files compressed', pct(m.compressionShare))}
      ${metric('Files cached ≥ 7 days', pct(m.cachingShare))}
      ${metric('Images lazy-loaded', pct(m.lazyShare))}
      ${metric('Page load (Lighthouse LCP)', lab['largest-contentful-paint']?.display || null)}
      ${metric('Speed Index (Lighthouse)', lab['speed-index']?.display || null)}
      ${metric('Core Web Vitals (real users)', field?.overall ? `${field.overall}${Object.keys(field.metrics).length ? ` · ${Object.entries(field.metrics).map(([k, v]) => `${k} ${v.category}`).join(', ')}` : ''}` : null)}
    </div><p class="muted small" style="margin-top:.6rem">Times are measured from our scanning server. "Not available" means the figure can't be measured reliably without Google PageSpeed data for this site.</p></div>
    <div class="panel"><h3 class="g-h">Recommendations</h3>
      ${perf.recommendations.length ? `<ol class="g-opps">${perf.recommendations.map(r => `<li><strong>${esc(r.title)}</strong>${esc(r.detail)}</li>`).join('')}</ol>` : '<p class="muted">No performance problems found in the measured files.</p>'}</div>
    <div class="panel"><h3 class="g-h">Resources</h3>
      <div class="table-wrap"><table class="res-table"><thead><tr><th>Resource</th><th>Type</th><th>Size</th><th>Load time</th><th>Potential problem</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">* Downloaded size — the server didn't report a transfer size, so compressed size isn't known.</p></div>`;
}

/* ── Competitors ── */
export function competeFormHtml(s) {
  const n = s.isAdmin ? 3 : 2;
  return `<form class="panel g-cform" id="g-cform" novalidate>
      <h3 class="g-h full">Competitor Analyzer</h3>
      <label class="field full"><span>My website</span><input id="gc-me" value="${esc(s.report?.homeUrl || '')}" placeholder="https://example.com"></label>
      ${Array.from({ length: n }, (_, i) => `<label class="field"><span>Competitor ${i + 1}${i ? ' (optional)' : ''}</span><input class="gc-comp" placeholder="https://competitor${i + 1}.com"></label>`).join('')}
      <button class="btn primary full" type="submit" id="gc-btn">Analyse Competitors</button>
      <p class="muted small full">Each competitor is scanned the same way (up to ${s.isAdmin ? 25 : 10} pages each). ${s.isAdmin ? '' : 'Free scans compare up to 2 competitors.'}</p>
      <p class="error-text full" id="gc-error" role="alert"></p>
    </form>`;
}

export function competeHtml(s) {
  const c = s.comparison;
  if (!c) return competeFormHtml(s);
  const sites = [s.compYou, ...s.compSites];
  const fmt = (v, unit) => (v == null ? '—' : unit === 'pct' ? `${v}%` : unit === 'ms' ? `${v} ms` : unit === 'bytes' ? fmtBytes(v) : v);
  const better = { score: 'max', pct: 'max', count: 'max', ms: 'min', bytes: 'min' };
  const rows = c.table.map(r => {
    const nums = r.values.filter(v => typeof v === 'number');
    const best = better[r.unit] === 'min' ? Math.min(...nums) : Math.max(...nums);
    return `<tr><td>${esc(r.label)}</td>${r.values.map(v => `<td class="${nums.length > 1 && v === best ? 'best' : ''}">${esc(fmt(v, r.unit))}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <div class="panel g-head"><div class="g-head-main"><div class="g-area tone-${tone(c.position)}" style="min-width:200px"><span class="lbl">Competitive position</span><span class="num">${c.position ?? '—'}<small> / 100</small></span><span class="sub">50 = level with competitors</span></div>
      <p class="muted small" style="max-width:520px">Compared using the same checks on every site: ${sites.map(x => esc(x.label)).join(', ')}. Green marks the best value in each row.</p></div>
      <button class="btn ghost small" data-action="new-compare" type="button">New comparison</button></div>
    <div class="panel"><div class="table-wrap"><table class="cmp-table"><thead><tr><th></th>${sites.map((x, i) => `<th class="${i ? '' : 'you'}">${i ? esc(x.label) : 'You'}<br><span class="muted small">${esc(new URL(x.url).hostname)}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="g-adv">
      <div class="panel yours"><h3 class="g-h">Your advantages</h3><ul>${c.yours.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No clear advantages found in this comparison.</li>'}</ul></div>
      <div class="panel theirs"><h3 class="g-h">Competitor advantages</h3><ul>${c.theirs.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">None — you match or beat them on everything measured.</li>'}</ul></div>
    </div>
    <div class="panel"><h3 class="g-h">Opportunities</h3>${c.opportunities.length ? `<ol class="g-opps">${c.opportunities.map(o => `<li>${esc(o)}</li>`).join('')}</ol>` : '<p class="muted">No specific opportunities found from this comparison.</p>'}</div>`;
}

/* ── History ── */
export function historyHtml(s) {
  const list = s.history || [];
  if (!list.length) return `<div class="panel"><p class="muted">No previous scans${s.isAdmin ? '' : ' in this browser'} yet. Scan a site again later to see how it changes.</p></div>`;
  const byHost = new Map();
  for (const h of list) { if (!byHost.has(h.host)) byHost.set(h.host, []); byHost.get(h.host).push(h); }
  const rows = list.map(h => {
    const same = byHost.get(h.host);
    const prev = same[same.indexOf(h) + 1];
    const change = prev && h.overall != null && prev.overall != null ? h.overall - prev.overall : null;
    return `<tr class="hist-row"><td><strong>${esc(h.host)}</strong></td><td>${h.date ? esc(fmtDate(h.date)) : 'saving…'}</td>
      <td class="num">${prev?.overall ?? '—'}</td><td class="num">${h.overall ?? '—'}</td><td class="num">${deltaHtml(change)}</td>
      <td>${h.id ? `<button class="btn ghost small" data-open="${esc(h.id)}" type="button">Open</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="panel"><h3 class="g-h">Scan history${s.isAdmin ? '' : ' (this browser)'}</h3>
    <div class="table-wrap"><table><thead><tr><th>Website</th><th>Scan date</th><th class="num">Previous</th><th class="num">Score</th><th class="num">Change</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${s.isAdmin ? '' : '<p class="muted small">Free scans keep a summary in this browser only. <button class="btn ghost small" data-action="clear-history" type="button">Clear</button></p>'}</div>`;
}

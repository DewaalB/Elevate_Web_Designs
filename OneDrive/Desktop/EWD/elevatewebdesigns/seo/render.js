/* Report rendering. All text that came from audited websites passes through
   esc() — titles, URLs and descriptions are untrusted input. */
import { CATEGORIES } from './checks/helpers.js';
import { shortUrl } from './url.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CAT_NAME = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));
const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info', pass: 'Pass', skipped: 'Not checked' };
export const tone = s => (s == null ? 'none' : s >= 90 ? 'good' : s >= 50 ? 'ok' : 'bad');
const link = (url, label = url) => (/^https?:\/\//i.test(url)
  ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>` : esc(label));

export function ring(score, size = 132) {
  const r = 52, c = 2 * Math.PI * r, pct = score == null ? 0 : score / 100;
  return `<svg class="ring tone-${tone(score)}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="SEO score ${score ?? 'not available'} out of 100">
    <circle cx="60" cy="60" r="${r}" class="ring-track"/>
    <circle cx="60" cy="60" r="${r}" class="ring-value" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" class="ring-num">${score ?? '—'}</text><text x="60" y="80" class="ring-sub">/ 100</text></svg>`;
}

function issueCard(check, rootHost, open = false) {
  const n = check.affectedTotal;
  const rows = check.affected.map(a => `<tr><td class="mono">${link(a.url, shortUrl(a.url, rootHost))}</td><td>${esc(a.detail)}</td></tr>`).join('');
  const more = n > check.affected.length ? `<p class="muted small">Showing ${check.affected.length} of ${n}.</p>` : '';
  return `<details class="issue sev-${check.status}" ${open ? 'open' : ''} data-cat="${check.category}">
    <summary>
      <span class="badge ${check.status}">${SEV_LABEL[check.status]}</span>
      <span class="issue-title">${esc(check.title)}</span>
      <span class="issue-cat">${esc(CAT_NAME[check.category] || check.category)}</span>
      ${n ? `<span class="issue-count">${n}</span>` : ''}
    </summary>
    <div class="issue-body">
      <p>${esc(check.message)}</p>
      ${check.fix && check.status !== 'pass' ? `<p class="fix"><strong>How to fix:</strong> ${esc(check.fix)}</p>` : ''}
      ${rows ? `<div class="table-wrap"><table class="affected"><tbody>${rows}</tbody></table></div>${more}` : ''}
      <p class="check-id mono">${esc(check.id)}</p>
    </div>
  </details>`;
}

function overviewTab(report) {
  const groups = ['critical', 'warning', 'info', 'skipped', 'pass'].map(s => [s, report.checks.filter(c => c.status === s)]);
  const titles = { critical: 'Critical issues', warning: 'Warnings', info: 'For your information', skipped: 'Not checked', pass: 'Passed checks' };
  return `<div class="filter-chips" role="group" aria-label="Filter by category">
      <button class="chip active" data-filter="all">All</button>
      ${CATEGORIES.map(c => `<button class="chip" data-filter="${c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    ${groups.filter(([, list]) => list.length).map(([s, list]) => `
      <h3 class="group-title sev-text-${s}">${titles[s]} <span class="muted">(${list.length})</span></h3>
      <div class="issue-list">${list.map(c => issueCard(c, report.rootHost, false)).join('')}</div>`).join('')}`;
}

function recommendationsTab(report) {
  if (!report.recommendations.length) return '<p class="empty">No improvements needed — every scored check passed.</p>';
  return `<p class="muted">Ranked by expected impact: how important the check is, how much of the site it affects, and how much its category counts toward the score.</p>
    <ol class="recs">${report.recommendations.map(r => `<li class="rec sev-${r.status}">
      <div class="rec-head"><span class="badge ${r.status}">${SEV_LABEL[r.status]}</span><strong>${esc(r.title)}</strong><span class="issue-cat">${esc(CAT_NAME[r.category])}</span></div>
      <p>${esc(r.message)}</p>
      <p class="fix"><strong>Do this:</strong> ${esc(r.fix)}</p>
    </li>`).join('')}</ol>`;
}

export function aiTabHtml(report, state = {}) {
  const ai = report.ai;
  if (state.loading) return '<div class="ai-loading"><span class="spinner"></span> Asking Claude to review the findings… this can take a minute.</div>';
  const err = state.error ? `<p class="error-text">${esc(state.error)}</p>` : '';
  if (!ai) {
    return `<div class="ai-empty">
      <p>Claude reads this audit's findings (scores, failed checks, page titles and headings — not the full pages) and writes prioritised advice, quick wins and content ideas.</p>
      ${state.notConfigured ? `<div class="note"><strong>AI isn't switched on yet.</strong> Add your Claude API key to the worker:<pre class="code">cd cf-seo-worker\nnpx wrangler secret put ANTHROPIC_API_KEY</pre>Then click the button again.</div>` : ''}
      ${err}
      <button class="btn primary" id="ai-btn" type="button">Generate AI recommendations</button>
    </div>`;
  }
  const r = ai.recommendations;
  return `${err}<p class="muted small">Generated ${esc(new Date(ai.generatedAt).toLocaleString())} by ${esc(ai.model)}. AI advice is based on the audit findings — review it before acting.</p>
    <div class="ai-summary">${esc(r.summary)}</div>
    <h3 class="group-title">Priorities</h3>
    <ol class="recs">${r.priorities.map(p => `<li class="rec">
      <div class="rec-head"><strong>${esc(p.title)}</strong><span class="pill">Impact: ${esc(p.impact)}</span><span class="pill">Effort: ${esc(p.effort)}</span></div>
      <p>${esc(p.why)}</p><p class="fix"><strong>How:</strong> ${esc(p.how)}</p>
      ${p.relatedChecks.length ? `<p class="check-id mono">${p.relatedChecks.map(esc).join(' · ')}</p>` : ''}
    </li>`).join('')}</ol>
    ${r.quickWins.length ? `<h3 class="group-title">Quick wins</h3><ul class="bullets">${r.quickWins.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    ${r.contentIdeas.length ? `<h3 class="group-title">Content ideas</h3><div class="ideas">${r.contentIdeas.map(c => `<div class="idea"><strong>${esc(c.title)}</strong><span class="pill">${esc(c.targetKeyword)}</span><p>${esc(c.rationale)}</p></div>`).join('')}</div>` : ''}
    <button class="btn ghost small" id="ai-btn" type="button">Regenerate</button>`;
}

function pagesTab(report) {
  const rows = report.pages.map((p, i) => {
    const sev = { critical: 0, warning: 0, info: 0 };
    p.issues.forEach(x => sev[x.status]++);
    const statusCell = p.error ? `<span class="badge critical">${esc(p.error)}</span>` : `<span class="status s${String(p.status)[0]}">${esc(p.status)}</span>`;
    const note = p.aliasOf ? `<span class="muted small">same page as ${esc(shortUrl(p.aliasOf, report.rootHost))}</span>` : p.offsite ? '<span class="muted small">redirects off-site</span>' : esc(p.title ?? '');
    return `<tr class="page-row" data-i="${i}" data-search="${esc(`${p.finalUrl} ${p.title || ''}`.toLowerCase())}" data-issues="${sev.critical + sev.warning}" data-error="${p.error || p.status >= 400 ? 1 : 0}" tabindex="0">
      <td class="mono">${esc(shortUrl(p.url, report.rootHost))}${p.redirects ? ` <span class="muted small">↪ ${p.redirects}</span>` : ''}</td>
      <td>${statusCell}</td><td class="title-cell">${note}</td>
      <td class="num">${p.words ?? ''}</td><td class="num">${p.inbound ?? ''}</td>
      <td class="num">${sev.critical ? `<span class="dot critical">${sev.critical}</span>` : ''}${sev.warning ? `<span class="dot warning">${sev.warning}</span>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="pages-tools">
      <input type="search" id="page-filter" placeholder="Filter by URL or title…" aria-label="Filter pages">
      <select id="page-view" aria-label="Show"><option value="all">All URLs (${report.pages.length})</option><option value="issues">With issues</option><option value="errors">Errors only</option></select>
    </div>
    <div class="table-wrap"><table class="pages-table">
      <thead><tr><th>URL</th><th>Status</th><th>Title</th><th class="num">Words</th><th class="num" title="Pages linking here">In-links</th><th class="num">Issues</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

export function pageDetailHtml(p, rootHost) {
  const facts = [
    ['Final URL', link(p.finalUrl)], ['HTTP status', esc(p.error ? `${p.error}` : p.status)],
    ['Found via', esc(p.via === 'sitemap' ? 'sitemap only' : p.via === 'start' ? 'start URL' : `links (depth ${p.depth})`)],
    ['Response', p.ttfbMs ? `${p.ttfbMs} ms · ${Math.round(p.bytes / 1024)} KB` : '—'],
  ];
  if (p.title !== undefined) facts.push(
    ['Title', esc(p.title == null ? '— missing —' : p.title || '— empty —') + (p.title ? ` <span class="muted">(${p.title.length})</span>` : '')],
    ['Meta description', esc(p.metaDescription == null ? '— missing —' : p.metaDescription || '— empty —') + (p.metaDescription ? ` <span class="muted">(${p.metaDescription.length})</span>` : '')],
    ['H1', esc(p.h1.join(' | ') || '— none —')],
    ['Canonical', p.canonical ? link(p.canonical, shortUrl(p.canonical, rootHost)) : '— none —'],
    ['Indexable', p.noindex ? '<span class="sev-text-critical">No (noindex)</span>' : 'Yes'],
    ['Words / readability', `${p.words}${p.readability != null ? ` · Flesch ${p.readability}` : ''}`],
    ['Links', `${p.internalLinks} internal out · ${p.inbound} internal in · ${p.externalLinks} external`],
    ['Images', `${p.images}${p.imagesNoAlt ? ` (${p.imagesNoAlt} without alt)` : ''}`],
    ['Structured data', esc(p.schemaTypes?.join(', ') || 'none')],
  );
  const outline = p.headings?.length ? `<details class="outline"><summary>Heading outline (${p.headings.length})</summary><ul>${p.headings.map(h => `<li style="margin-left:${(h.level - 1) * 14}px"><span class="muted mono">H${h.level}</span> ${esc(h.text || '(empty)')}</li>`).join('')}</ul></details>` : '';
  const issues = p.issues.length ? `<ul class="page-issues">${p.issues.map(x => `<li><span class="badge ${x.status}">${SEV_LABEL[x.status]}</span> <strong>${esc(x.title)}</strong>${x.detail ? ` — ${esc(x.detail)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">No issues on this page.</p>';
  return `<div class="page-detail"><dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${outline}<h4>Issues</h4>${issues}</div>`;
}

function fixesTab(report) {
  if (!report.fixes.length) return '<p class="empty">No generated fixes needed for this site.</p>';
  return `<p class="muted">Generated from this crawl. Values the audit couldn't know are marked <code>FILL IN</code>. Review everything before publishing.</p>
    ${report.fixes.map((f, i) => `<article class="fix-card">
      <div class="fix-head"><h3>${esc(f.title)}</h3><div class="fix-actions">
        <button class="btn ghost small" data-copy="${i}" type="button">Copy</button>
        ${f.filename ? `<button class="btn ghost small" data-download="${i}" type="button">Download ${esc(f.filename)}</button>` : ''}
      </div></div>
      <p class="muted small">${esc(f.description)}</p>
      <pre class="code"><code>${esc(f.content)}</code></pre>
    </article>`).join('')}`;
}

function crawlNotes(report) {
  const c = report.site.crawl;
  const notes = [];
  if (c.limitHit) notes.push(`The crawl stopped at the ${c.maxPages}-page limit, so some pages weren't audited.`);
  if (c.blockedByRobots?.length) notes.push(`${c.blockedByRobots.length} URLs were skipped because robots.txt disallows crawling them.`);
  if (report.trimmed) notes.push('This saved report was trimmed to fit storage limits; some long lists are shortened.');
  if (report.psi?.error) notes.push(report.psi.error);
  return notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : '';
}

export function reportHtml(report) {
  const date = new Date(report.createdAt);
  const pagesAnalysed = report.pages.filter(p => p.title !== undefined).length;
  return `<div class="panel report-head">
      <div class="score-block">${ring(report.overall)}<div>
        <div class="eyebrow">SEO score</div>
        <h2 class="report-url">${link(report.homeUrl, report.rootHost)}</h2>
        <p class="muted small">${esc(date.toLocaleString())} · ${pagesAnalysed} pages analysed · ${report.pages.length} URLs fetched · ${Math.round((report.durationMs || 0) / 1000)}s</p>
        <div class="counts">
          <span class="count critical">${report.counts.critical} critical</span>
          <span class="count warning">${report.counts.warning} warnings</span>
          <span class="count pass">${report.counts.pass} passed</span>
        </div>
      </div></div>
      <div class="report-actions">
        <button class="btn ghost small" id="print-btn" type="button">Print / PDF</button>
        <button class="btn ghost small" id="csv-btn" type="button">Issues CSV</button>
        <button class="btn ghost small" id="json-btn" type="button">JSON</button>
      </div>
    </div>
    <div class="cat-grid">${report.categories.map(c => `<button class="cat tone-${tone(c.score)}" data-cat-jump="${c.id}" type="button">
      <span class="cat-name">${esc(c.name)}</span>
      <span class="cat-score">${c.score ?? '—'}</span>
      <span class="cat-meta">${c.score == null ? 'not measured' : `${c.counts.critical ? `${c.counts.critical} critical · ` : ''}${c.counts.warning} warn · ${c.counts.pass} pass`}</span>
      <span class="cat-bar"><span style="width:${c.score ?? 0}%"></span></span>
    </button>`).join('')}</div>
    ${crawlNotes(report)}
    <div class="panel">
      <div class="tabs" role="tablist">
        ${[['overview', 'Issues'], ['recs', 'Recommendations'], ['ai', 'AI Insights'], ['pages', 'Pages'], ['fixes', `Fixes (${report.fixes.length})`]]
          .map(([id, label], i) => `<button role="tab" class="tab ${i ? '' : 'active'}" data-tab="${id}" aria-selected="${!i}">${label}</button>`).join('')}
      </div>
      <div class="tab-panel" data-panel="overview">${overviewTab(report)}</div>
      <div class="tab-panel" data-panel="recs" hidden>${recommendationsTab(report)}</div>
      <div class="tab-panel" data-panel="ai" hidden>${aiTabHtml(report)}</div>
      <div class="tab-panel" data-panel="pages" hidden>${pagesTab(report)}</div>
      <div class="tab-panel" data-panel="fixes" hidden>${fixesTab(report)}</div>
    </div>`;
}

export function issuesCsv(report) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Severity', 'Category', 'Check', 'Finding', 'URL', 'Detail', 'How to fix'].map(cell).join(',')];
  for (const c of report.checks) {
    if (!['critical', 'warning', 'info'].includes(c.status)) continue;
    const base = [SEV_LABEL[c.status], CAT_NAME[c.category], c.title, c.message];
    if (!c.affected.length) lines.push([...base, '', '', c.fix].map(cell).join(','));
    for (const a of c.affected) lines.push([...base, a.url, a.detail, c.fix].map(cell).join(','));
  }
  return lines.join('\r\n');
}

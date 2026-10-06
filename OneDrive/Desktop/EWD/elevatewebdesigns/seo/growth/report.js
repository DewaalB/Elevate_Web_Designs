/* Branded, printable client report. Opens in a new tab and triggers the
   browser's print dialog, where "Save as PDF" produces the PDF — no PDF
   library needed. All site-derived text is escaped. */
import { esc } from '../render.js';
import { explain } from './explain.js';
import { HEALTH_GROUPS } from './scoring.js';
import { fmtBytes } from './performance.js';

const tone = s => (s == null ? '#7a8fa8' : s >= 90 ? '#2e9e48' : s >= 50 ? '#c98a00' : '#d0392b');
const sc = s => (s == null ? '—' : s);

function scoreBox(label, s) {
  return `<div class="box"><div class="lbl">${esc(label)}</div><div class="num" style="color:${tone(s)}">${sc(s)}</div></div>`;
}

export function reportDocument({ report, health, perf, opportunities, comparison, competitors }) {
  const date = new Date(report.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  const crit = report.checks.filter(c => c.status === 'critical');
  const warn = report.checks.filter(c => c.status === 'warning');
  const passed = report.checks.filter(c => c.status === 'pass');
  const issue = c => { const e = explain(c); return `<li><strong>${esc(e.problem)}</strong><br><span class="muted">${esc(c.message)}</span>${e.why ? `<br><em>Why it matters:</em> ${esc(e.why)}` : ''}<br><em>How to fix:</em> ${esc(c.fix)}</li>`; };

  const compTable = comparison ? `
    <h2>Competitor comparison</h2>
    <table><thead><tr><th></th><th>You</th>${competitors.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${comparison.table.filter(r => r.unit === 'score' || r.unit === 'count').slice(0, 9).map(r => `<tr><td>${esc(r.label)}</td>${r.values.map(v => `<td>${v ?? '—'}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    ${comparison.yours.length ? `<h3>Your advantages</h3><ul class="plain">${comparison.yours.map(x => `<li>✓ ${esc(x)}</li>`).join('')}</ul>` : ''}
    ${comparison.theirs.length ? `<h3>Competitor advantages</h3><ul class="plain">${comparison.theirs.map(x => `<li>⚠ ${esc(x)}</li>`).join('')}</ul>` : ''}` : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Website report — ${esc(report.rootHost)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #18212e; margin: 0; font-size: 12.5px; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #00b8de; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: 2px; } .brand span { color: #00a6c9; }
  .muted { color: #5b6b80; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 22px 0 8px; border-bottom: 1px solid #dde4ec; padding-bottom: 4px; } h3 { font-size: 13.5px; margin: 14px 0 6px; }
  .hero { display: flex; gap: 22px; align-items: center; margin: 10px 0 6px; }
  .big { font-size: 54px; font-weight: 800; line-height: 1; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
  .box { border: 1px solid #dde4ec; border-radius: 8px; padding: 8px 10px; } .lbl { font-size: 11px; color: #5b6b80; } .num { font-size: 22px; font-weight: 700; }
  ul { padding-left: 18px; margin: 6px 0; } ul.plain { list-style: none; padding-left: 0; } li { margin-bottom: 7px; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #e6ebf1; padding: 5px 6px; text-align: left; } th { font-size: 11px; color: #5b6b80; }
  .crit { color: #d0392b; } .warn { color: #c98a00; } .ok { color: #2e9e48; }
  .foot { margin-top: 26px; border-top: 1px solid #dde4ec; padding-top: 10px; font-size: 11px; }
</style></head><body>
  <div class="head"><div class="brand">ELEVATE <span>WEB DESIGN</span></div><div class="muted">elevatewebdesign.co.za · 082 536 8312</div></div>
  <h1>Website health report</h1>
  <div class="muted">${esc(report.homeUrl)} · scanned ${esc(date)} · ${report.pages.filter(p => p.title !== undefined).length} pages analysed</div>

  <div class="hero"><div><div class="lbl">Overall website health</div><div class="big" style="color:${tone(health.overall)}">${sc(health.overall)}<span style="font-size:20px;color:#7a8fa8">/100</span></div></div>
    <div class="grid" style="flex:1">${scoreBox('SEO', health.areas.seo)}${scoreBox('Performance', health.areas.performance)}${scoreBox('Technical health', health.areas.technical)}${scoreBox('Competitive position', health.areas.competitive)}</div></div>
  <div class="grid">${HEALTH_GROUPS.map(g => scoreBox(g.name, health.groups[g.id])).join('')}</div>
  <p><span class="crit">● ${crit.length} critical</span> &nbsp; <span class="warn">● ${warn.length} warnings</span> &nbsp; <span class="ok">● ${passed.length} checks passed</span></p>

  <h2>Top opportunities</h2>
  <ol>${opportunities.slice(0, 8).map(o => `<li><strong>${esc(o.title)}</strong><br><span class="muted">${esc(o.detail)}</span></li>`).join('')}</ol>

  ${crit.length ? `<h2 class="crit">Critical issues</h2><ul>${crit.map(issue).join('')}</ul>` : ''}
  ${warn.length ? `<h2 class="warn">Warnings</h2><ul>${warn.map(issue).join('')}</ul>` : ''}

  ${perf ? `<h2>Performance</h2>
    <p>Performance score <strong>${sc(perf.score)}</strong>. Homepage weight ${fmtBytes(perf.totals.bytes)} across ${perf.totals.requests} files; server response ${perf.metrics.ttfbMs ?? '—'} ms.
    ${perf.psi ? `Google Lighthouse (mobile): <strong>${perf.psi.score}</strong>.` : 'Google Lighthouse data was not available for this scan.'}</p>
    ${perf.recommendations.length ? `<ul>${perf.recommendations.slice(0, 5).map(r => `<li><strong>${esc(r.title)}</strong> — ${esc(r.detail)}</li>`).join('')}</ul>` : ''}` : ''}

  ${compTable}

  <h2 class="ok">What's working</h2>
  <ul class="plain" style="columns:2">${passed.slice(0, 30).map(c => `<li>✓ ${esc(c.title)}</li>`).join('')}</ul>

  <div class="foot"><strong>Want help fixing these?</strong> Elevate Web Design builds and improves websites for South African businesses.
    Contact us on 082 536 8312, WhatsApp, or elevatewebdesign.co.za.<br>
    <span class="muted">Automated scan of up to ${report.settings?.maxPages ?? '—'} pages. Speed figures are measured from our scanning server; Lighthouse figures come from Google PageSpeed Insights where available.</span></div>
</body></html>`;
}

export function openReport(data, w = window.open('', '_blank')) {
  if (!w) throw new Error('Your browser blocked the report window — allow pop-ups for this site and try again.');
  w.document.open();
  w.document.write(reportDocument(data));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

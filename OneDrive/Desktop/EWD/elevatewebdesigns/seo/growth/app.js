/* Website Growth page controller (website-growth.html).
   Two modes on one page:
   - Visitors: free scans behind Turnstile, with a per-scan request budget
     enforced by the worker (smaller page caps, 2 competitors), history kept
     in this browser, report download offered in exchange for contact details.
   - Admin (signed in with the existing Firebase admin login): full-size
     scans, 3 competitors, history saved to Firestore, direct report download. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createApi, WORKER_URL, DEV_MODE } from '../api.js';
import { crawlSite } from '../crawler.js';
import { analyze } from '../analyze.js';
import { createStore } from '../store.js';
import { pathOf, siteKey } from '../url.js';
import { analyzePerformance } from './performance.js';
import { healthScores } from './scoring.js';
import { siteFacts, buildComparison } from './compare.js';
import * as History from './history.js';
import * as UI from './ui.js';
import { openReport } from './report.js';

/* ── Configuration ── */
const ADMIN_EMAIL = 'dewaalb3@gmail.com';
const TURNSTILE_SITE_KEY = '0x4AAAAAAFPkEwLNejfWeOAy';
const TURNSTILE_TEST_KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass key, local dev only
/* Optional: a free Google PageSpeed Insights API key (Google Cloud → APIs →
   PageSpeed Insights API → Credentials), restricted to this site's domain.
   Without it, Lighthouse/Core Web Vitals show as "Not available". */
const PAGESPEED_KEY = '';
const NOTIFY_WORKER_URL = 'https://elevate-lead-notify.dewaalb3.workers.dev';
const NOTIFY_SITE_KEY = '2fe506792f6ef59b03293f39b7acaed63e76bb7e26af8737';

const MODES = {
  public: { pages: [5, 10, 15], defPages: 15, depth: [1, 2, 3], defDepth: 3, compPages: 15, compDepth: 2, maxComps: 2,
    crawlLimits: { internalChecks: 25, imageChecks: 25, canonicalChecks: 10, externalChecks: 0 }, checkExternal: false },
  admin: { pages: [25, 50, 100, 250], defPages: 50, depth: [1, 2, 3, 5], defDepth: 3, compPages: 25, compDepth: 2, maxComps: 3,
    crawlLimits: undefined, checkExternal: true },
};

const app = initializeApp({
  apiKey: 'AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg',
  authDomain: 'elevatewebdesigns-1fc3d.firebaseapp.com',
  projectId: 'elevatewebdesigns-1fc3d',
  storageBucket: 'elevatewebdesigns-1fc3d.firebasestorage.app',
  messagingSenderId: '778173951248',
  appId: '1:778173951248:web:5922c9dcd1623b9e658995',
});
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

const S = {
  isAdmin: DEV_MODE && new URLSearchParams(location.search).has('admin'),
  report: null, health: null, perf: null, beforeAfter: null,
  comparison: null, compYou: null, compSites: [],
  history: [], session: null, running: null,
};
let store = null;
const mode = () => MODES[S.isAdmin ? 'admin' : 'public'];
const psiKey = () => { try { return localStorage.getItem('ewd_seo_psi_key') || PAGESPEED_KEY; } catch { return PAGESPEED_KEY; } };
const api = createApi(() => auth.currentUser.getIdToken(), { getSession: () => (S.isAdmin ? null : S.session) });

function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('error', err); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4500);
}

/* ── Mode (visitor / admin) ── */
function applyMode() {
  const m = mode();
  $('g-pages').innerHTML = m.pages.map(n => `<option ${n === m.defPages ? 'selected' : ''}>${n}</option>`).join('');
  $('g-depth').innerHTML = m.depth.map(n => `<option ${n === m.defDepth ? 'selected' : ''}>${n}</option>`).join('');
  $('g-mode').textContent = S.isAdmin ? 'Signed in · full scans & saved history' : 'Free tools · No sign-up';
  $('g-limits').textContent = S.isAdmin ? 'Full mode: up to 250 pages, external link checks and saved history.'
    : 'Free scans check up to 15 pages and 2 competitors, 3 scans a day. Need a deeper audit? We can help.';
  $('g-turnstile').hidden = S.isAdmin;
  if (!S.isAdmin) loadTurnstile();
  if (S.report) renderAll();
}


/* ── Turnstile (visitors only) ── */
let captchaToken = null, widgetId = null, turnstileLoading = false;
function loadTurnstile() {
  if (turnstileLoading) return;
  turnstileLoading = true;
  window.onGrowthTurnstile = () => {
    widgetId = window.turnstile.render('#g-turnstile', {
      sitekey: DEV_MODE ? TURNSTILE_TEST_KEY : TURNSTILE_SITE_KEY, theme: 'dark', appearance: 'interaction-only',
      callback: t => { captchaToken = t; }, 'expired-callback': () => { captchaToken = null; }, 'error-callback': () => { captchaToken = null; },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onGrowthTurnstile';
  s.async = true;
  s.onerror = () => { $('g-error').textContent = 'The "I\'m human" check couldn\'t load. Disable any blocker for this page and refresh.'; };
  document.head.append(s);
}
async function freshToken() {
  const until = Date.now() + 20000;
  while (!captchaToken && Date.now() < until) await new Promise(r => setTimeout(r, 200));
  const t = captchaToken;
  captchaToken = null;
  if (widgetId != null) window.turnstile?.reset(widgetId); // tokens are single-use
  if (!t) throw new Error('Please complete the "I\'m human" check, then try again.');
  return t;
}

/** Starts a budgeted visitor session for these sites (no-op when signed in). */
async function startSession(urls) {
  if (S.isAdmin) return;
  setProgress('Checking you\'re human…', 0);
  const token = await freshToken();
  const res = await fetch(`${WORKER_URL}/public/growth/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls, turnstileToken: token }),
  }).catch(() => { throw new Error('Couldn\'t reach the scanner. Check your connection and try again.'); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'The scan couldn\'t start. Please try again.');
  S.session = data.session;
}

/* ── Progress ── */
const live = { done: [], now: new Map(), queued: 0 };
const label = url => { const p = pathOf(url); return p === '/' ? 'Homepage' : decodeURIComponent(p); };
function setProgress(title, pct) {
  $('g-progress-title').textContent = title;
  if (pct != null) $('g-bar').style.width = `${Math.max(2, Math.min(100, pct))}%`;
}
function renderLive() {
  const items = [
    ...live.done.slice(-7).map(d => `<li class="${d.bad ? 'bad' : 'done'}">${d.text}</li>`),
    ...[...live.now.values()].map(t => `<li class="now">${t}</li>`),
    ...(live.queued ? [`<li class="queued">${live.queued} more queued</li>`] : []),
  ];
  $('g-live').innerHTML = items.join('');
}
function progressHandler(prefix, base, span) {
  return p => {
    if (p.phase === 'page') {
      const text = UI_escape(label(p.url));
      if (p.state === 'start') live.now.set(p.url, text);
      else { live.now.delete(p.url); live.done.push({ text: `${text} <span class="muted">${UI_escape(String(p.status))}</span>`, bad: typeof p.status !== 'number' || p.status >= 400 }); live.queued = p.queued ?? live.queued; }
      renderLive();
      return;
    }
    const titles = { start: 'Loading the website', robots: 'Reading robots.txt & sitemap', crawl: 'Scanning pages', checks: 'Checking links & images', pagespeed: 'Waiting for Google PageSpeed' };
    const within = p.total ? p.done / p.total : 0;
    const phaseShare = { start: 0, robots: 0.05, crawl: 0.1, checks: 0.6, pagespeed: 0.8 }[p.phase] ?? 0.85;
    const nextShare = { start: 0.05, robots: 0.1, crawl: 0.6, checks: 0.8, pagespeed: 0.85 }[p.phase] ?? 0.9;
    setProgress(`${prefix}${titles[p.phase] || p.phase}${p.total ? ` — ${p.done} of ${p.total}` : ''}…`, base + span * (phaseShare + (nextShare - phaseShare) * within));
  };
}
const UI_escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function begin() {
  S.running = new AbortController();
  live.done = []; live.now.clear(); live.queued = 0; renderLive();
  $('g-btn').disabled = true;
  $('g-progress').hidden = false;
  $('g-error').textContent = '';
  return S.running.signal;
}
function end() {
  S.running = null; S.session = null;
  $('g-btn').disabled = false;
  $('g-progress').hidden = true;
  const b = $('gc-btn'); if (b) b.disabled = false;
}
$('g-cancel').addEventListener('click', () => S.running?.abort());
window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });

const normalizeInput = u => (/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
const looksLikeUrl = u => /^(https?:\/\/)?[^\s/$.?#]+\.[^\s]+$/i.test(u.trim());
const sameHost = (a, b) => { try { return siteKey(new URL(normalizeInput(a)).hostname) === siteKey(new URL(normalizeInput(b)).hostname); } catch { return false; } };

/** Crawl + performance + scoring for one site. */
async function scanSite(url, { maxPages, maxDepth }, signal, prefix = '', base = 0, span = 100) {
  const m = mode();
  const settings = {
    maxPages, maxDepth, respectRobots: true, checkExternal: m.checkExternal,
    pageSpeed: !!psiKey(), psiKey: psiKey(), limits: m.crawlLimits,
  };
  const crawl = await crawlSite({ startUrl: url, settings, api, signal, onProgress: progressHandler(prefix, base, span * 0.85) });
  const home = crawl.byFinal.get(crawl.site.homeUrl);
  let perf = null;
  if (home) {
    setProgress(`${prefix}Measuring homepage files…`, base + span * 0.86);
    perf = await analyzePerformance({ page: home, api, psi: crawl.psi, signal,
      onProgress: p => setProgress(`${prefix}Measuring homepage files — ${p.done} of ${p.total}…`, base + span * (0.86 + 0.12 * p.done / p.total)) });
  }
  const report = analyze(crawl);
  const health = healthScores(report, perf);
  report.growth = { version: 1, health, perf };
  return { crawl, report, perf, health };
}

/* ── Main scan ── */
$('g-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (S.running) return;
  const raw = $('g-url').value;
  if (!looksLikeUrl(raw)) { $('g-error').textContent = 'Enter a website address like https://example.com'; return; }
  const url = normalizeInput(raw);
  const signal = begin();
  try {
    await startSession([url]);
    const r = await scanSite(url, { maxPages: Number($('g-pages').value), maxDepth: Number($('g-depth').value) }, signal);
    Object.assign(S, { report: r.report, health: r.health, perf: r.perf, lastRecords: r.crawl.records, comparison: null, compYou: null, compSites: [] });
    const summary = History.summarize(r.report, r.health, r.perf);
    await recordHistory(summary);
    renderAll();
    switchTab('health');
    $('g-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err.name === 'AbortError') toast('Scan cancelled.');
    else { console.warn(err); $('g-error').textContent = err.status === 401 ? 'Your admin sign-in has expired — refresh the page.' : err.message; }
  } finally { end(); }
});

async function recordHistory(summary) {
  if (S.isAdmin && store) {
    try {
      const list = await loadAdminHistory();
      const prevItem = list.find(h => h.host === summary.host);
      if (prevItem) {
        const prevReport = await store.load(prevItem.id);
        S.beforeAfter = History.beforeAfter(History.summarizeSaved(prevReport), summary);
      } else S.beforeAfter = null;
      S.report.id = await store.save(S.report);
      toast('Scan saved to your history.');
      await loadAdminHistory();
    } catch (err) { console.error(err); toast(`Scan finished but couldn't be saved: ${err.message}`, true); }
  } else {
    const prev = History.previousFor(History.localHistory(), summary);
    S.beforeAfter = prev ? History.beforeAfter(prev, summary) : null;
    History.saveLocal(summary);
    S.history = History.localHistory();
  }
}

async function loadAdminHistory() {
  if (!store) return [];
  const items = await store.list(40);
  S.history = items.map(i => ({ id: i.id, host: i.host, date: i.createdAt?.toISOString?.() || null, overall: i.overall < 0 ? null : i.overall }));
  return S.history;
}

/* ── Competitors ── */
async function runCompetitors(meRaw, compRaws) {
  const m = mode();
  const me = normalizeInput(meRaw);
  const comps = compRaws.map(normalizeInput);
  // Reuse your latest scan only if it used the same limits, so every site is measured alike.
  const reuse = S.report && S.lastRecords && sameHost(S.report.homeUrl, me) && S.report.settings.maxPages === m.compPages && S.report.settings.maxDepth === m.compDepth;
  const toScan = [...(reuse ? [] : [me]), ...comps];
  const signal = begin();
  $('gc-btn').disabled = true;
  try {
    await startSession(toScan);
    const step = 100 / toScan.length;
    const results = [];
    for (let i = 0; i < toScan.length; i++) {
      const isMe = !reuse && i === 0;
      const name = isMe ? 'your website' : `competitor ${results.filter(x => !x.isMe).length + 1}`;
      live.done.push({ text: `<strong>${UI_escape(new URL(toScan[i]).hostname)}</strong> (${name})` }); renderLive();
      try {
        const r = await scanSite(toScan[i], { maxPages: m.compPages, maxDepth: m.compDepth }, signal, `Site ${i + 1} of ${toScan.length}: `, i * step, step);
        results.push({ ...r, url: toScan[i], isMe });
      } catch (err) {
        if (err.name === 'AbortError' || err.status === 401) throw err;
        if (isMe) throw err;
        toast(`Skipped ${new URL(toScan[i]).hostname}: ${err.message}`, true);
      }
    }
    const mine = reuse ? { report: S.report, perf: S.perf, health: S.health, records: S.lastRecords } : results.find(x => x.isMe);
    if (!reuse) mine.records = mine.crawl.records;
    const others = results.filter(x => !x.isMe);
    if (!others.length) throw new Error('None of the competitor websites could be scanned.');
    const pack = (x, lbl) => ({
      label: lbl, url: x.report.homeUrl, report: x.report, perf: x.perf, health: { ...x.health, areas: { ...x.health.areas } },
      facts: siteFacts({ pages: x.records || x.crawl.records, limitHit: x.report.site.crawl.limitHit, perf: x.perf }),
    });
    S.compYou = pack(mine, 'You');
    S.compSites = others.map((x, i) => pack(x, `Competitor ${i + 1}`));
    S.comparison = buildComparison(S.compYou, S.compSites);
    if (!S.report || !sameHost(S.report.homeUrl, me)) {
      Object.assign(S, { report: mine.report, health: mine.health, perf: mine.perf, beforeAfter: null, lastRecords: mine.records });
    }
    S.health.areas.competitive = S.comparison.position;
    renderAll();
    switchTab('compete');
  } catch (err) {
    if (err.name === 'AbortError') toast('Comparison cancelled.');
    else { console.warn(err); const el = $('gc-error') || $('g-error'); el.textContent = err.message; }
  } finally { end(); }
}

/* ── Rendering & interactions ── */
const panel = name => $('g-results').querySelector(`[data-panel="${name}"]`);
function renderAll() {
  if (!S.report) return;
  panel('health').innerHTML = UI.healthHtml(S);
  panel('seo').innerHTML = UI.seoHtml(S);
  panel('perf').innerHTML = UI.perfHtml(S);
  panel('compete').innerHTML = UI.competeHtml(S);
  panel('history').innerHTML = UI.historyHtml(S);
  $('g-results').hidden = false;
}
function switchTab(name) {
  $('g-results').querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $('g-results').querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}

$('g-results').addEventListener('click', async e => {
  const t = e.target.closest('button, tr.page-row');
  if (!t) return;
  if (t.dataset.tab) {
    switchTab(t.dataset.tab);
    if (t.dataset.tab === 'history' && S.isAdmin) { await loadAdminHistory().catch(() => {}); panel('history').innerHTML = UI.historyHtml(S); }
    return;
  }
  if (t.dataset.gfilter) {
    const f = t.dataset.gfilter;
    panel('seo').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === t));
    panel('seo').querySelectorAll('.g-issue').forEach(i => { i.hidden = f !== 'all' && i.dataset.group !== f; });
    panel('seo').querySelectorAll('.issue-list').forEach(l => { const v = [...l.children].some(c => !c.hidden); l.hidden = !v; l.previousElementSibling.hidden = !v; });
    return;
  }
  if (t.dataset.action === 'report') return downloadReport();
  if (t.dataset.action === 'new-compare') { S.comparison = null; panel('compete').innerHTML = UI.competeHtml(S); return; }
  if (t.dataset.action === 'clear-history') { History.clearLocal(); S.history = []; panel('history').innerHTML = UI.historyHtml(S); return; }
  if (t.dataset.open) return openSaved(t.dataset.open);
  if (t.classList.contains('page-row')) togglePage(t);
});
$('g-results').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('page-row')) { e.preventDefault(); togglePage(e.target); }
});
$('g-results').addEventListener('submit', e => {
  if (e.target.id !== 'g-cform') return;
  e.preventDefault();
  const me = $('gc-me').value;
  const comps = [...document.querySelectorAll('.gc-comp')].map(i => i.value.trim()).filter(Boolean);
  $('gc-error').textContent = '';
  if (!looksLikeUrl(me)) { $('gc-error').textContent = 'Enter your website address.'; return; }
  if (!comps.length) { $('gc-error').textContent = 'Enter at least one competitor.'; return; }
  const bad = comps.find(c => !looksLikeUrl(c));
  if (bad) { $('gc-error').textContent = `"${bad}" doesn't look like a website address.`; return; }
  if (comps.some(c => sameHost(c, me))) { $('gc-error').textContent = 'A competitor can\'t be the same website as yours.'; return; }
  runCompetitors(me, comps.slice(0, mode().maxComps));
});

function togglePage(row) {
  const next = row.nextElementSibling;
  if (next?.classList.contains('detail-row')) { next.remove(); row.classList.remove('open'); return; }
  row.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="9">${UI.pageDetail(S.report.pages[row.dataset.i], S.report.rootHost)}</td></tr>`);
  row.classList.add('open');
}

async function openSaved(id) {
  try {
    const report = await store.load(id);
    const perf = report.growth?.perf || null;
    Object.assign(S, { report, perf, health: report.growth?.health || healthScores(report, perf), comparison: null, compSites: [], beforeAfter: null, lastRecords: null });
    renderAll();
    switchTab('health');
    window.scrollTo({ top: $('g-results').offsetTop - 80, behavior: 'smooth' });
  } catch (err) { toast(err.message, true); }
}

/* ── Report download ── */
function reportData() {
  return { report: S.report, health: S.health, perf: S.perf, opportunities: UI.topOpportunities(S.report, S.perf),
    comparison: S.comparison, competitors: S.compSites };
}
function downloadReport() {
  if (S.isAdmin) { try { openReport(reportData()); } catch (err) { toast(err.message, true); } return; }
  $('g-lead').hidden = false;
  $('gl-name').focus();
}
$('gl-cancel').addEventListener('click', () => { $('g-lead').hidden = true; });
$('g-lead').addEventListener('click', e => { if (e.target.id === 'g-lead') $('g-lead').hidden = true; });
$('g-lead-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('gl-name').value.trim(), email = $('gl-email').value.trim(), phone = $('gl-phone').value.trim();
  $('gl-error').textContent = '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('gl-error').textContent = 'Please enter your name and a valid email.'; return; }
  const w = window.open('', '_blank'); // open now, inside the click, so pop-up blockers allow it
  $('gl-btn').disabled = true;
  try {
    const h = S.health;
    const message = `Website Growth report downloaded.\nWebsite: ${S.report.homeUrl}\nOverall health: ${h.overall ?? 'n/a'}/100 (SEO ${h.areas.seo ?? '—'}, Performance ${h.areas.performance ?? '—'}, Technical ${h.areas.technical ?? '—'})\n${h.counts.critical} critical, ${h.counts.warning} warnings.\nTop opportunities:\n${UI.topOpportunities(S.report, S.perf).slice(0, 6).map(o => `- ${o.title}`).join('\n')}${S.comparison ? `\nCompared with: ${S.compSites.map(c => new URL(c.url).hostname).join(', ')}` : ''}`.slice(0, 4900);
    if (!DEV_MODE) {
      await addDoc(collection(db, 'leads'), { name, email, phone, package: 'Website Growth Report', message, source: 'website_seo_check', createdAt: serverTimestamp() });
      fetch(`${NOTIFY_WORKER_URL}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-key': NOTIFY_SITE_KEY }, body: JSON.stringify({ name, package: 'Website Growth Report' }) }).catch(() => {});
    }
    openReport(reportData(), w);
    $('g-lead').hidden = true;
    toast('Thanks! Your report has opened — use "Save as PDF" in the print dialog.');
  } catch (err) {
    console.error(err);
    w?.close();
    $('gl-error').textContent = err.message.includes('pop-up') ? err.message : 'Couldn\'t prepare the report right now — please try again.';
  } finally { $('gl-btn').disabled = false; }
});

/* ── Start-up (last, so everything above is initialised) ── */
if (!DEV_MODE) {
  // Same Firebase login as the admin dashboard: signing in there unlocks full mode here.
  onAuthStateChanged(auth, user => {
    S.isAdmin = !!user && user.email?.toLowerCase() === ADMIN_EMAIL;
    store = S.isAdmin ? createStore(db) : null;
    applyMode();
  });
} else {
  applyMode();
}

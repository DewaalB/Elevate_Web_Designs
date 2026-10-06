/* SEO Audit dashboard — wiring between the UI, the crawler and storage. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createApi, DEV_MODE } from './api.js';
import { crawlSite } from './crawler.js';
import { analyze, aiSummary } from './analyze.js';
import { createStore } from './store.js';
import { reportHtml, aiTabHtml, pageDetailHtml, issuesCsv, esc } from './render.js';

const ADMIN_EMAIL = 'dewaalb3@gmail.com';
const firebaseConfig = {
  apiKey: 'AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg',
  authDomain: 'elevatewebdesigns-1fc3d.firebaseapp.com',
  projectId: 'elevatewebdesigns-1fc3d',
  storageBucket: 'elevatewebdesigns-1fc3d.firebasestorage.app',
  messagingSenderId: '778173951248',
  appId: '1:778173951248:web:5922c9dcd1623b9e658995',
};

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const store = DEV_MODE ? null : createStore(getFirestore(app));
const api = createApi(() => auth.currentUser.getIdToken());

let current = null;      // report on screen
let aiState = {};
let running = null;      // AbortController of the audit in progress

/* ── Toast ── */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ── Auth ── */
function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('dev-badge').hidden = !DEV_MODE;
  loadHistory();
}

if (DEV_MODE) {
  showApp();
} else {
  onAuthStateChanged(auth, user => {
    if (user && user.email?.toLowerCase() === ADMIN_EMAIL) return showApp();
    if (user) signOut(auth);
    $('app-view').hidden = true;
    $('login-view').hidden = false;
  });
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('login-email').value.trim(), $('login-password').value);
  } catch (err) {
    $('login-error').textContent = /invalid-credential|wrong-password|user-not-found/.test(err.code) ? 'Incorrect email or password.'
      : err.code === 'auth/too-many-requests' ? 'Too many attempts — try again later.' : 'Sign-in failed. Check your connection.';
  } finally { $('login-btn').disabled = false; }
});
$('logout-btn').addEventListener('click', () => (DEV_MODE ? location.reload() : signOut(auth)));

/* ── Settings ── */
const PSI_KEY = 'ewd_seo_psi_key';
const OPTS_KEY = 'ewd_seo_opts';
const safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
$('psi-key').value = safeGet(PSI_KEY) || '';
$('psi-key').addEventListener('change', () => safeSet(PSI_KEY, $('psi-key').value.trim()));
try {
  const o = JSON.parse(safeGet(OPTS_KEY) || '{}');
  if (o.pages) $('opt-pages').value = o.pages;
  if (o.depth) $('opt-depth').value = o.depth;
  for (const [k, id] of [['robots', 'opt-robots'], ['external', 'opt-external'], ['psi', 'opt-psi']]) if (k in o) $(id).checked = o[k];
} catch {}

/* ── Progress ── */
const PHASES = [
  ['start', 'Load site'], ['robots', 'robots.txt & sitemap'], ['crawl', 'Crawl pages'],
  ['checks', 'Check links & images'], ['pagespeed', 'PageSpeed'], ['analyse', 'Score & report'],
];
function setPhase(phase, { done, total, message } = {}) {
  const idx = PHASES.findIndex(([id]) => id === phase);
  $('phases').innerHTML = PHASES.map(([id, label], i) =>
    `<li class="${i < idx ? 'done' : i === idx ? 'active' : ''}">${label}</li>`).join('');
  $('progress-title').textContent = PHASES[idx]?.[1] + (total ? ` — ${done} of ${total}` : '') + '…';
  $('progress-detail').textContent = message || '';
  const base = idx / PHASES.length;
  const within = total ? Math.min(1, done / total) / PHASES.length : 0;
  $('bar-fill').style.width = `${Math.round((base + within) * 100)}%`;
}

/* ── Run an audit ── */
$('scan-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (running) return;
  const url = $('url-input').value.trim();
  $('scan-error').textContent = '';
  if (!url || !/^(https?:\/\/)?[^\s/$.?#]+\.[^\s]+$/i.test(url)) { $('scan-error').textContent = 'Enter a website address like example.co.za'; return; }

  const settings = {
    maxPages: Number($('opt-pages').value), maxDepth: Number($('opt-depth').value),
    respectRobots: $('opt-robots').checked, checkExternal: $('opt-external').checked,
    pageSpeed: $('opt-psi').checked, psiKey: $('psi-key').value.trim(),
  };
  safeSet(OPTS_KEY, JSON.stringify({ pages: settings.maxPages, depth: settings.maxDepth, robots: settings.respectRobots, external: settings.checkExternal, psi: settings.pageSpeed }));

  running = new AbortController();
  $('run-btn').disabled = true;
  $('progress-panel').hidden = false;
  $('report').hidden = true;
  setPhase('start', { message: url });
  keepAwake(true);

  try {
    const crawl = await crawlSite({ startUrl: url, settings, api, signal: running.signal, onProgress: p => setPhase(p.phase, p) });
    setPhase('analyse', { message: 'Running checks and scoring' });
    await new Promise(r => setTimeout(r, 30)); // let the UI paint before the heavy loop
    const report = analyze(crawl);
    aiState = {};
    showReport(report);
    if (store) {
      try { report.id = await store.save(report); toast('Audit saved.'); loadHistory(); }
      catch (err) { console.error(err); toast(`Audit finished but couldn't be saved: ${err.message}`, true); }
    }
  } catch (err) {
    if (err.name === 'AbortError') { toast('Audit cancelled.'); }
    else {
      console.error(err);
      $('scan-error').textContent = err.status === 401 ? `Your sign-in was rejected by the audit worker: ${err.message}` : err.message;
    }
  } finally {
    running = null;
    keepAwake(false);
    $('run-btn').disabled = false;
    $('progress-panel').hidden = true;
  }
});
$('cancel-btn').addEventListener('click', () => running?.abort());

/* ── Phone-friendly scanning ──
   Keep the screen on while a scan runs (the browser releases the lock when
   the tab is hidden, so re-request it on return), and warn before leaving. */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* unsupported or refused (e.g. battery saver) — the scan still works */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !running) return;
  keepAwake(true);
  $('progress-detail').textContent = 'Welcome back — resuming the scan…';
});
window.addEventListener('beforeunload', e => {
  if (running) { e.preventDefault(); e.returnValue = ''; }
});

/* ── Report view & interactions ── */
function showReport(report) {
  current = report;
  const root = $('report');
  root.innerHTML = reportHtml(report);
  root.hidden = false;
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchTab(name) {
  const root = $('report');
  root.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  root.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}

function filterCategory(cat) {
  const root = $('report');
  root.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === cat));
  root.querySelectorAll('[data-panel="overview"] .issue').forEach(i => { i.hidden = cat !== 'all' && i.dataset.cat !== cat; });
  root.querySelectorAll('[data-panel="overview"] .issue-list').forEach(list => {
    const visible = [...list.children].some(c => !c.hidden);
    list.hidden = !visible;
    list.previousElementSibling.hidden = !visible;
  });
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileStem = () => `seo-audit-${current.rootHost}-${current.createdAt.slice(0, 10)}`;

$('report').addEventListener('click', async e => {
  const t = e.target.closest('button, tr.page-row');
  if (!t || !current) return;
  if (t.dataset.tab) return switchTab(t.dataset.tab);
  if (t.dataset.filter) return filterCategory(t.dataset.filter);
  if (t.dataset.catJump) { switchTab('overview'); filterCategory(t.dataset.catJump); return; }
  if (t.id === 'print-btn') return printReport();
  if (t.id === 'csv-btn') return download(`${fileStem()}.csv`, '﻿' + issuesCsv(current), 'text/csv;charset=utf-8');
  if (t.id === 'json-btn') return download(`${fileStem()}.json`, JSON.stringify(current, null, 2), 'application/json');
  if (t.id === 'ai-btn') return generateAi();
  if (t.dataset.copy != null) {
    try { await navigator.clipboard.writeText(current.fixes[t.dataset.copy].content); toast('Copied.'); } catch { toast('Copy failed — select the text manually.', true); }
    return;
  }
  if (t.dataset.download != null) { const f = current.fixes[t.dataset.download]; return download(f.filename, f.content, 'text/plain'); }
  if (t.classList.contains('page-row')) togglePageDetail(t);
});
$('report').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('page-row')) { e.preventDefault(); togglePageDetail(e.target); }
});

function togglePageDetail(row) {
  const next = row.nextElementSibling;
  if (next?.classList.contains('detail-row')) { next.remove(); row.classList.remove('open'); return; }
  const p = current.pages[row.dataset.i];
  row.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="6">${pageDetailHtml(p, current.rootHost)}</td></tr>`);
  row.classList.add('open');
}

$('report').addEventListener('input', e => { if (e.target.id === 'page-filter') filterPages(); });
$('report').addEventListener('change', e => { if (e.target.id === 'page-view') filterPages(); });
function filterPages() {
  const q = $('page-filter').value.trim().toLowerCase();
  const view = $('page-view').value;
  $('report').querySelectorAll('.detail-row').forEach(r => r.remove());
  $('report').querySelectorAll('tr.page-row').forEach(r => {
    r.classList.remove('open');
    r.hidden = (q && !r.dataset.search.includes(q)) || (view === 'issues' && r.dataset.issues === '0') || (view === 'errors' && r.dataset.error === '0');
  });
}

function printReport() {
  const root = $('report');
  const opened = [...root.querySelectorAll('details:not([open])')];
  const hiddenPanels = [...root.querySelectorAll('.tab-panel[hidden]')].filter(p => ['recs', 'overview', 'ai'].includes(p.dataset.panel));
  opened.forEach(d => { d.open = true; });
  hiddenPanels.forEach(p => { p.hidden = false; });
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
  opened.forEach(d => { d.open = false; });
  hiddenPanels.forEach(p => { p.hidden = true; });
}

/* ── AI ── */
function renderAi() {
  const panel = $('report').querySelector('[data-panel="ai"]');
  if (panel) panel.innerHTML = aiTabHtml(current, aiState);
}
async function generateAi() {
  aiState = { loading: true };
  renderAi();
  try {
    const res = await api.ai(aiSummary(current));
    current.ai = { ...res, generatedAt: new Date().toISOString() };
    aiState = {};
    if (store && current.id) { try { await store.saveAi(current.id, current.ai); } catch (e) { console.error(e); toast('AI advice generated but not saved.', true); } }
  } catch (err) {
    aiState = err.code === 'ai_not_configured' ? { notConfigured: true } : { error: err.message };
  }
  renderAi();
}

/* ── History ── */
async function loadHistory() {
  const list = $('history-list');
  if (!store) { list.innerHTML = '<p class="muted small">History is disabled in dev mode.</p>'; return; }
  try {
    const items = await store.list();
    list.innerHTML = items.length ? items.map(a => `<div class="history-item" data-id="${esc(a.id)}">
        <button class="history-open" data-open="${esc(a.id)}" type="button">
          <span class="history-score tone-${a.overall < 0 ? 'none' : a.overall >= 90 ? 'good' : a.overall >= 50 ? 'ok' : 'bad'}">${a.overall < 0 ? '—' : a.overall}</span>
          <span class="history-meta"><strong>${esc(a.host)}</strong><span class="muted small">${a.createdAt ? esc(a.createdAt.toLocaleString()) : 'saving…'} · ${a.pageCount} URLs · ${a.counts?.critical ?? 0} critical</span></span>
        </button>
        <button class="btn ghost small" data-delete="${esc(a.id)}" type="button" aria-label="Delete audit of ${esc(a.host)}">✕</button>
      </div>`).join('') : '<p class="muted small">No saved audits yet.</p>';
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="error-text">Couldn't load saved audits: ${esc(err.message)}</p>`;
  }
}
$('history-refresh').addEventListener('click', loadHistory);
$('history-list').addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  const del = e.target.closest('[data-delete]');
  if (open) {
    try { aiState = {}; showReport(await store.load(open.dataset.open)); }
    catch (err) { toast(err.message, true); }
  } else if (del) {
    if (!confirm('Delete this saved audit?')) return;
    try { await store.remove(del.dataset.delete); if (current?.id === del.dataset.delete) { $('report').hidden = true; current = null; } loadHistory(); }
    catch (err) { toast(`Delete failed: ${err.message}`, true); }
  }
});

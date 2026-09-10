import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

/* ── Fill these in once the Cloudflare relay is deployed (see cf-worker/README.md) ── */
const NOTIFY_WORKER_URL = 'https://elevate-lead-notify.dewaalb3.workers.dev';
const VAPID_PUBLIC_KEY  = 'BHQloe6RWA8-h5ZHMtBFWJ2e2qxcJa2DSHuUII5s-mCz-ODt3wKYXzrBoyKSFjJ5-vuFqAHl7v96J6DavzFJs-Q';

const firebaseConfig = {
  apiKey:            "AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg",
  authDomain:        "elevatewebdesigns-1fc3d.firebaseapp.com",
  projectId:         "elevatewebdesigns-1fc3d",
  storageBucket:     "elevatewebdesigns-1fc3d.firebasestorage.app",
  messagingSenderId: "778173951248",
  appId:             "1:778173951248:web:5922c9dcd1623b9e658995"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const loginView   = document.getElementById('login-view');
const dashView    = document.getElementById('dash-view');
const loginForm   = document.getElementById('login-form');
const loginBtn    = document.getElementById('login-btn');
const loginError  = document.getElementById('login-error');
const forgotBtn   = document.getElementById('forgot-btn');
const logoutBtn   = document.getElementById('logout-btn');

let allLeads     = [];
let leadsUnsub   = null;
let hasLoadedOnce = false;

/* ── AUTH STATE ── */
onAuthStateChanged(auth, user => {
  if (user) {
    loginView.hidden = true;
    dashView.hidden  = false;
    // Land at the top of the dashboard — otherwise the browser keeps
    // whatever scroll position the login screen was left at.
    window.scrollTo(0, 0);
    loadLeads();
    startIdleTimer();
  } else {
    loginView.hidden = false;
    dashView.hidden  = true;
    window.scrollTo(0, 0);
    stopIdleTimer();
    if (leadsUnsub) { leadsUnsub(); leadsUnsub = null; }
    allLeads = [];
    hasLoadedOnce = false;
  }
});

/* ── AUTO-LOGOUT ON INACTIVITY ──
   Signs you out after 15 minutes of no activity, so a session left open
   on a shared or unattended device doesn't stay live indefinitely. */
const IDLE_LIMIT_MS = 15 * 60 * 1000;
let idleTimer = null;

function startIdleTimer() {
  resetIdleTimer();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, resetIdleTimer, { passive: true })
  );
}
function stopIdleTimer() {
  clearTimeout(idleTimer);
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt =>
    document.removeEventListener(evt, resetIdleTimer)
  );
}
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    signOut(auth);
  }, IDLE_LIMIT_MS);
}

const pwToggle = document.getElementById('pw-toggle');
const pwInput  = document.getElementById('login-password');
pwToggle.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  pwToggle.textContent = show ? '🙈' : '👁';
  pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  pwToggle.setAttribute('aria-pressed', String(show));
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';
  loginError.classList.remove('success');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = friendlyAuthError(err.code);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

forgotBtn.addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    loginError.textContent = 'Enter your email above first, then click "Forgot password?"';
    loginError.classList.remove('success');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    loginError.textContent = 'Password reset email sent — check your inbox.';
    loginError.classList.add('success');
  } catch (err) {
    loginError.textContent = friendlyAuthError(err.code);
    loginError.classList.remove('success');
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

function friendlyAuthError(code) {
  switch (code) {
    case 'auth/invalid-email': return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Incorrect email or password.';
    case 'auth/too-many-requests': return 'Too many attempts — try again in a few minutes.';
    default: return 'Something went wrong. Please try again.';
  }
}

/* ── LEADS (live) ──
   A real-time Firestore listener instead of a one-time fetch, so new leads
   (from the contact form or the estimator) appear here the instant they're
   submitted — no refresh needed — and can trigger the alerts below. */
function loadLeads() {
  const emptyState = document.getElementById('empty-state');
  emptyState.textContent = 'Loading leads…';
  emptyState.style.display = 'block';

  if (leadsUnsub) leadsUnsub();

  leadsUnsub = onSnapshot(collection(db, 'leads'), snap => {
    const prevIds = new Set(allLeads.map(l => l.id));
    const nextLeads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    nextLeads.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // Only treat leads as "new arrivals" (chime/popup/flash) once we've
    // already loaded once — the initial batch on login shouldn't alert.
    const newOnes = hasLoadedOnce ? nextLeads.filter(l => !prevIds.has(l.id)) : [];

    allLeads = nextLeads;
    hasLoadedOnce = true;

    renderStats();
    renderLeads();
    updateUnreadBadge();

    newOnes.forEach(notifyNewLead);
  }, err => {
    emptyState.textContent = 'Failed to load leads: ' + err.message;
  });
}

/* ══════════════════════════════════════════
   FREE IN-PORTAL NOTIFICATIONS
   No server, no paid plan — works while this dashboard tab is open
   (including in the background/minimized). Four layers, in order of
   how easy they are to miss:
     1. Unread badge on the bell — persists across visits on this device
     2. A sound + slide-in toast the moment a lead arrives
     3. A flashing browser tab title while you're looking elsewhere
     4. An OS-level desktop notification, if you've enabled it
══════════════════════════════════════════ */
const LAST_SEEN_KEY  = 'ewd_admin_last_seen';
let lastSeenAt        = Number(localStorage.getItem(LAST_SEEN_KEY) || Date.now());
let unreadCount       = 0;
let audioCtx          = null;
let titleFlashTimer   = null;
const originalTitle   = document.title;

const bellBtn    = document.getElementById('bell-btn');
const unreadBadge = document.getElementById('unread-badge');
const alertsBtn  = document.getElementById('alerts-btn');
const leadToast  = document.getElementById('lead-toast');

function updateUnreadBadge() {
  unreadCount = allLeads.filter(l => (l.createdAt?.seconds || 0) * 1000 > lastSeenAt).length;
  if (unreadCount > 0) {
    unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    unreadBadge.hidden = false;
  } else {
    unreadBadge.hidden = true;
  }
}

function markAllSeen() {
  lastSeenAt = Date.now();
  localStorage.setItem(LAST_SEEN_KEY, String(lastSeenAt));
  updateUnreadBadge();
  renderLeads();
  stopFlashTitle();
}

bellBtn.addEventListener('click', markAllSeen);

// If you're actually looking at the tab, don't leave it flashing/unread.
window.addEventListener('focus', () => {
  if (!dashView.hidden) { stopFlashTitle(); markAllSeen(); }
});

function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [880, 1320].forEach((freq, i) => {
      setTimeout(() => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start();
        o.stop(audioCtx.currentTime + 0.35);
      }, i * 150);
    });
  } catch { /* audio not available in this browser — safe to skip */ }
}

function flashTitle() {
  clearInterval(titleFlashTimer);
  let on = false;
  titleFlashTimer = setInterval(() => {
    document.title = on ? originalTitle : `🔴 New Lead! (${unreadCount})`;
    on = !on;
  }, 1200);
}
function stopFlashTitle() {
  clearInterval(titleFlashTimer);
  titleFlashTimer = null;
  document.title = originalTitle;
}

function showLeadToast(lead) {
  document.getElementById('lead-toast-title').textContent = 'New lead! 🎉';
  document.getElementById('lead-toast-msg').textContent =
    `${lead.name || 'Someone'} · ${(lead.package || 'General enquiry').split(' — ')[0]}`;
  leadToast.hidden = false;
  requestAnimationFrame(() => leadToast.classList.add('show'));
  clearTimeout(leadToast._hideTimer);
  leadToast._hideTimer = setTimeout(() => {
    leadToast.classList.remove('show');
    setTimeout(() => { leadToast.hidden = true; }, 350);
  }, 6000);
}

function notifyNewLead(lead) {
  playChime();
  showLeadToast(lead);
  if (document.hidden || !document.hasFocus()) flashTitle();

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('New lead — Elevate Admin', {
        body: `${lead.name || 'Someone'} · ${(lead.package || 'General enquiry').split(' — ')[0]}`,
        tag: lead.id
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* some browsers restrict this — the toast/sound still fired */ }
  }
}

/* ── Desktop alert opt-in (must be a click, browsers block auto-prompts) ── */
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  alertsBtn.hidden = false;
  alertsBtn.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      alertsBtn.textContent = '🔔 Desktop Alerts On';
      alertsBtn.disabled = true;
    } else {
      alertsBtn.textContent = '🔕 Alerts Blocked — check browser settings';
    }
  });
}

/* ══════════════════════════════════════════
   PUSH NOTIFICATIONS — WORKS EVEN WHEN CLOSED
   Uses Firebase Cloud Messaging plus a small free Cloudflare Worker
   relay (see cf-worker/) instead of a paid Firebase Cloud Function.
   Registers this browser's push token with the relay so it knows
   where to deliver the next "new lead" push.
══════════════════════════════════════════ */
const pushBtn = document.getElementById('push-btn');

if (!('serviceWorker' in navigator) || !('PushManager' in window) || NOTIFY_WORKER_URL.includes('REPLACE-ME')) {
  // Not set up yet, or unsupported browser — hide rather than offer a dead button.
  pushBtn.hidden = true;
} else {
  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    pushBtn.textContent = 'Enabling...';
    try {
      let adminKey = localStorage.getItem('ewd_admin_push_key');
      if (!adminKey) {
        adminKey = prompt('Enter the admin push key (set up once when the relay was deployed):');
        if (!adminKey) throw new Error('Admin key is required to register this device.');
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');

      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const messaging     = getMessaging(app);
      const fcmToken       = await getToken(messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration
      });
      if (!fcmToken) throw new Error('Could not get a push token from Firebase.');

      const res = await fetch(`${NOTIFY_WORKER_URL}/register-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ fcmToken })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Registration failed — check the admin key.');

      localStorage.setItem('ewd_admin_push_key', adminKey);
      pushBtn.textContent = '📲 Push Enabled ✓';
      pushBtn.disabled = true;

      // Foreground pushes (tab open) reuse the existing toast/sound/badge.
      onMessage(messaging, payload => {
        notifyNewLead({
          name:    payload.notification?.body?.split(' · ')[0] || 'Someone',
          package: payload.notification?.body?.split(' · ')[1] || ''
        });
      });
    } catch (err) {
      console.error('Push setup failed:', err);
      pushBtn.disabled = false;
      pushBtn.textContent = '📲 Enable Push (failed — tap to retry)';
    }
  });
}

/* ══════════════════════════════════════════
   QUOTE CALCULATOR & GENERATOR
   Uses the same shared pricing engine as the public estimator
   (pricing.js), so a quote you send can never disagree with what a
   visitor was shown on the site.
══════════════════════════════════════════ */
const PRICING = window.EWD_PRICING;
const qFmt = PRICING.fmt;

const quoteToggle  = document.getElementById('quote-toggle');
const quoteBody    = document.getElementById('quote-body');
const quoteChevron = document.getElementById('quote-chevron');
const qFinal       = document.getElementById('q-final');
const qResetBtn    = document.getElementById('q-reset');
let finalTouched   = false;

quoteToggle.addEventListener('click', () => {
  const open = quoteBody.hidden;
  quoteBody.hidden = !open;
  quoteChevron.classList.toggle('open', open);
  quoteToggle.setAttribute('aria-expanded', String(open));
});

/* Build the feature checkboxes and care-plan dropdown from the price list */
document.getElementById('q-features').innerHTML = PRICING.FEATURES.map(f => `
  <label class="quote-feature" data-id="${f.id}">
    <input type="checkbox" value="${f.id}">
    <span>${f.label}</span>
    <span class="quote-feature-price">${qFmt(f.price)}</span>
  </label>
`).join('');

document.getElementById('q-care').innerHTML = PRICING.CARE_PLANS.map(c =>
  `<option value="${c.id}">${c.id === 'none' ? 'None' : `${c.shortLabel} — ${qFmt(c.price)}/mo`}</option>`
).join('');

/* Pre-fills the quote calculator from an estimator-sourced lead's saved
   message (script.js builds that text in a consistent, parseable shape —
   see the estCtaBtn handler there). Best-effort: falls back to leaving
   whatever's already in the calculator if a field isn't found, rather
   than clobbering it with a wrong guess. */
function applyEstimatorMessageToQuote(message) {
  const pages     = message.match(/Pages:\s*(\d+)/);
  const revisions = message.match(/Rounds of changes:\s*(\d+)/);
  const urgency   = message.match(/Timeline:\s*(\d+)\s*week/);
  const features  = message.match(/Extra features:\s*(.+)/);
  const care      = message.match(/Care plan:\s*([^(\n]+)/);

  if (pages)     document.getElementById('q-pages').value     = pages[1];
  if (revisions) document.getElementById('q-revisions').value = revisions[1];
  if (urgency)   document.getElementById('q-urgency').value   = urgency[1];

  if (features && features[1].trim() !== 'None selected') {
    const wanted = features[1].split(',').map(s => s.trim().toLowerCase());
    document.querySelectorAll('#q-features input').forEach(cb => {
      const label = PRICING.FEATURES.find(f => f.id === cb.value)?.label.toLowerCase();
      const on = wanted.includes(label);
      cb.checked = on;
      cb.closest('.quote-feature').classList.toggle('on', on);
    });
  }

  if (care) {
    const wanted = care[1].trim().toLowerCase();
    const plan = PRICING.CARE_PLANS.find(c => c.shortLabel.toLowerCase() === wanted);
    if (plan) document.getElementById('q-care').value = plan.id;
  }
}

function readQuoteForm() {
  return {
    client:     document.getElementById('q-client').value.trim(),
    phone:      document.getElementById('q-phone').value.trim(),
    pages:      Number(document.getElementById('q-pages').value) || 1,
    revisions:  Number(document.getElementById('q-revisions').value) || 0,
    urgency:    Number(document.getElementById('q-urgency').value) || 4,
    featureIds: [...document.querySelectorAll('#q-features input:checked')].map(i => i.value),
    carePlanId: document.getElementById('q-care').value,
    firstTimeDiscount: document.getElementById('q-discount').checked,
  };
}

function buildQuoteText(form, q, finalAmount) {
  const B = PRICING.BUSINESS;
  const today = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [];

  lines.push(`QUOTE — ${B.name}`);
  if (form.client) lines.push(`For: ${form.client}`);
  lines.push(`Date: ${today}`);
  lines.push('');
  lines.push('WEBSITE BUILD');
  lines.push(`${form.pages} page website${form.pages === 1 ? '' : ''} — ${qFmt(q.baseAmt)}`);
  q.features.forEach(f => lines.push(`${f.label} — ${qFmt(f.price)}`));
  if (q.revAmt > 0) lines.push(`Extra rounds of changes (${form.revisions}) — ${qFmt(q.revAmt)}`);
  if (q.urgencyAmt > 0) lines.push(`Faster delivery (${form.urgency} week${form.urgency === 1 ? '' : 's'}) — ${qFmt(q.urgencyAmt)}`);
  if (q.discount > 0) lines.push(`First-time client discount — -${qFmt(q.discount)}`);
  lines.push('');
  lines.push(`TOTAL (once-off): ${qFmt(finalAmount)}`);

  if (q.carePrice > 0) {
    lines.push('');
    lines.push('MONTHLY CARE PLAN (optional)');
    lines.push(`${q.careLabel} — ${qFmt(q.carePrice)}/month`);
  }

  lines.push('');
  lines.push(`Timeline: around ${form.urgency} week${form.urgency === 1 ? '' : 's'} from go-ahead.`);
  lines.push('Quote valid for 30 days.');
  lines.push('');
  lines.push(B.name);
  lines.push(`${B.phone} · ${B.email}`);
  lines.push(B.website);

  return lines.join('\n');
}

function updateQuote() {
  const form = readQuoteForm();
  const q = PRICING.calculate(form);

  /* Breakdown */
  const rows = [
    ['Website build (' + form.pages + ' page' + (form.pages === 1 ? '' : 's') + ')', qFmt(q.baseAmt), ''],
    ['Extra features (' + q.features.length + ')', qFmt(q.featureAmt), ''],
    ['Extra rounds of changes', qFmt(q.revAmt), ''],
    ['Rush fee' + (q.urgencyPct ? ` (+${Math.round(q.urgencyPct * 100)}%)` : ''), qFmt(q.urgencyAmt), ''],
  ];
  if (q.discount > 0) rows.push(['First-time client discount', '-' + qFmt(q.discount), 'discount']);
  if (q.carePrice > 0) rows.push([q.careLabel, qFmt(q.carePrice) + '/mo', 'care']);

  document.getElementById('q-breakdown').innerHTML = rows.map(([label, val, cls]) =>
    `<div class="quote-line ${cls}"><span>${label}</span><span>${val}</span></div>`
  ).join('');

  /* Final amount — auto-syncs until the admin types their own figure */
  if (!finalTouched) qFinal.value = q.low;
  qResetBtn.hidden = !finalTouched;

  const finalAmount = Number(qFinal.value) || 0;
  document.getElementById('q-range').textContent =
    `Calculated range: ${qFmt(q.low)} – ${qFmt(q.high)}` + (finalTouched ? ' (custom amount in use)' : '');

  document.getElementById('q-text').value = buildQuoteText(form, q, finalAmount);
}

/* Any input change recalculates */
['q-client', 'q-phone', 'q-pages', 'q-revisions', 'q-urgency', 'q-care', 'q-discount'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', updateQuote);
  el.addEventListener('change', updateQuote);
});
document.querySelectorAll('#q-features input').forEach(cb => {
  cb.addEventListener('change', () => {
    cb.closest('.quote-feature').classList.toggle('on', cb.checked);
    updateQuote();
  });
});
qFinal.addEventListener('input', () => { finalTouched = true; updateQuote(); });
qResetBtn.addEventListener('click', () => { finalTouched = false; updateQuote(); });

document.getElementById('q-copy').addEventListener('click', async () => {
  const btn = document.getElementById('q-copy');
  const text = document.getElementById('q-text').value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.getElementById('q-text').select();
    document.execCommand('copy');
  }
  const original = btn.textContent;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = original; }, 1800);
});

document.getElementById('q-whatsapp').addEventListener('click', () => {
  const phone = document.getElementById('q-phone').value.trim();
  const text  = document.getElementById('q-text').value;
  const num   = toWhatsAppNumber(phone);
  const base  = num ? `https://wa.me/${num}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(text)}`, '_blank');
});

document.getElementById('q-print').addEventListener('click', () => {
  document.getElementById('print-quote-output').textContent = document.getElementById('q-text').value;
  window.print();
});

/* 082 536 8312 / +27 82 536 8312 / 2782... all become 2782... */
function toWhatsAppNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0'))  return '27' + digits.slice(1);
  return '27' + digits;
}

updateQuote();

function renderStats() {
  const now = new Date();
  const weekAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const toDate = l => l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000) : null;

  document.getElementById('stat-total').textContent = allLeads.length;
  document.getElementById('stat-week').textContent  = allLeads.filter(l => { const d = toDate(l); return d && d >= weekAgo; }).length;
  document.getElementById('stat-month').textContent = allLeads.filter(l => { const d = toDate(l); return d && d >= monthAgo; }).length;

  const counts = {};
  allLeads.forEach(l => {
    const pkg = (l.package || 'Not specified').split(' — ')[0];
    counts[pkg] = (counts[pkg] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('stat-top-package').textContent = top ? top[0] : '—';

  const revenue = allLeads
    .filter(l => l.status === 'Won')
    .reduce((sum, l) => sum + (l.dealValue || 0), 0);
  document.getElementById('stat-revenue').textContent = qFmt(revenue);
}

function renderLeads() {
  const list       = document.getElementById('leads-list');
  const emptyState = document.getElementById('empty-state');
  const search     = document.getElementById('search-input').value.trim().toLowerCase();
  const statusF    = document.getElementById('status-filter').value;
  const sortBy     = document.getElementById('sort-select').value;

  const filtered = allLeads.filter(l => {
    const status = l.status || 'New';
    if (statusF && status !== statusF) return false;
    if (!search) return true;
    const hay = `${l.name || ''} ${l.email || ''} ${l.message || ''}`.toLowerCase();
    return hay.includes(search);
  });

  const bySeconds = l => l.createdAt?.seconds || 0;
  switch (sortBy) {
    case 'oldest': filtered.sort((a, b) => bySeconds(a) - bySeconds(b)); break;
    case 'value':  filtered.sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0)); break;
    case 'name':   filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    default:       filtered.sort((a, b) => bySeconds(b) - bySeconds(a)); // newest
  }

  list.querySelectorAll('.lead-card').forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyState.textContent = allLeads.length === 0
      ? 'No leads yet — they\'ll appear here as soon as someone submits the contact form.'
      : 'No leads match your search/filter.';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(lead => list.appendChild(buildLeadCard(lead)));
}

/* ── CONFIRMATION MODAL (replaces native confirm()) ──
   Reusable for any future destructive action, not just lead deletion. */
const confirmOverlay    = document.getElementById('confirm-overlay');
const confirmMessage    = document.getElementById('confirm-message');
const confirmOkBtn      = document.getElementById('confirm-ok-btn');
const confirmCancelBtn  = document.getElementById('confirm-cancel-btn');
let confirmResolve = null;

function showConfirm(message) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    confirmMessage.textContent = message;
    confirmOverlay.classList.add('open');
    confirmOkBtn.focus();
  });
}
function closeConfirm(result) {
  confirmOverlay.classList.remove('open');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
confirmOkBtn.addEventListener('click', () => closeConfirm(true));
confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirm(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && confirmOverlay.classList.contains('open')) closeConfirm(false);
});

function buildLeadCard(lead) {
  const card = document.createElement('div');
  const isNew = (lead.createdAt?.seconds || 0) * 1000 > lastSeenAt;
  card.className = 'lead-card' + (isNew ? ' is-new' : '');

  const date = lead.createdAt?.seconds
    ? new Date(lead.createdAt.seconds * 1000).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown date';

  const status = lead.status || 'New';

  card.innerHTML = `
    <div class="lead-top">
      <div>
        <div class="lead-name">${escapeHtml(lead.name || 'Unnamed')}${isNew ? '<span class="lead-new-tag">NEW</span>' : ''}</div>
        <div class="lead-meta">
          <a href="mailto:${escapeAttr(lead.email || '')}">${escapeHtml(lead.email || 'No email')}</a>
          ${lead.phone ? ' · <a href="tel:' + escapeAttr(lead.phone) + '">' + escapeHtml(lead.phone) + '</a>' : ''}
        </div>
        ${lead.package ? '<div class="lead-package">' + escapeHtml(lead.package) + '</div>' : ''}
        ${(lead.utm_source || lead.utm_medium || lead.utm_campaign) ? '<div class="lead-utm">🔗 ' + escapeHtml(lead.utm_source || '—') + ' · ' + escapeHtml(lead.utm_medium || '—') + ' · ' + escapeHtml(lead.utm_campaign || '—') + '</div>' : ''}
      </div>
      <div>
        <div class="lead-date">${date}</div>
        ${lead.dealValue != null ? `<button type="button" class="lead-value-badge" title="Click to edit deal value">💰 ${qFmt(lead.dealValue)}</button>` : ''}
      </div>
    </div>
    <div class="lead-message">${escapeHtml(lead.message || '')}</div>
    <div class="lead-controls">
      <select class="lead-status" data-status="${status}">
        <option value="New" ${status === 'New' ? 'selected' : ''}>New</option>
        <option value="Contacted" ${status === 'Contacted' ? 'selected' : ''}>Contacted</option>
        <option value="Won" ${status === 'Won' ? 'selected' : ''}>Won</option>
        <option value="Lost" ${status === 'Lost' ? 'selected' : ''}>Lost</option>
      </select>
      <input type="text" class="lead-notes" placeholder="Private notes..." value="${escapeAttr(lead.notes || '')}">
      <span class="save-hint">Saved ✓</span>
      <button class="lead-payment-btn">🧮 Quote</button>
      <button class="lead-delete">Delete</button>
    </div>
  `;

  const statusSel  = card.querySelector('.lead-status');
  const notesInput = card.querySelector('.lead-notes');
  const saveHint   = card.querySelector('.save-hint');
  const deleteBtn  = card.querySelector('.lead-delete');
  const quoteBtn   = card.querySelector('.lead-payment-btn');
  const valueBadge = card.querySelector('.lead-value-badge');

  statusSel.addEventListener('change', async () => {
    const newStatus = statusSel.value;
    const updates = { status: newStatus };

    // Moving to Won and no deal value recorded yet — ask for one, so
    // "Revenue Won" actually means something. Declining just skips it;
    // the badge/prompt can always be added later via the value badge.
    if (newStatus === 'Won' && lead.dealValue == null) {
      const raw = prompt(`Deal value for "${lead.name || 'this lead'}" (Rand, numbers only — leave blank to skip):`);
      const val = Number(raw);
      if (raw && !Number.isNaN(val) && val >= 0) updates.dealValue = val;
    }

    statusSel.dataset.status = newStatus;
    Object.assign(lead, updates);
    await updateDoc(doc(db, 'leads', lead.id), updates);
    flashSaved(saveHint);
    renderStats();
    if ('dealValue' in updates) renderLeads(); // redraw this card with its new value badge
  });

  if (valueBadge) {
    valueBadge.addEventListener('click', async () => {
      const raw = prompt(`Update deal value for "${lead.name || 'this lead'}" (Rand):`, String(lead.dealValue));
      if (raw === null) return;
      const val = Number(raw);
      if (Number.isNaN(val) || val < 0) { alert('Please enter a valid amount.'); return; }
      lead.dealValue = val;
      await updateDoc(doc(db, 'leads', lead.id), { dealValue: val });
      flashSaved(saveHint);
      renderStats();
      renderLeads();
    });
  }

  quoteBtn.addEventListener('click', () => {
    quoteBody.hidden = false;
    quoteChevron.classList.add('open');
    quoteToggle.setAttribute('aria-expanded', 'true');

    document.getElementById('q-client').value = lead.name || '';
    document.getElementById('q-phone').value  = lead.phone || '';
    if (lead.source === 'website_estimator') applyEstimatorMessageToQuote(lead.message || '');
    updateQuote();

    quoteToggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let notesTimer;
  notesInput.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      lead.notes = notesInput.value;
      await updateDoc(doc(db, 'leads', lead.id), { notes: notesInput.value });
      flashSaved(saveHint);
    }, 700);
  });

  deleteBtn.addEventListener('click', async () => {
    const ok = await showConfirm(`Delete the lead from "${lead.name || 'this contact'}"? This can't be undone.`);
    if (!ok) return;
    await deleteDoc(doc(db, 'leads', lead.id));
    allLeads = allLeads.filter(l => l.id !== lead.id);
    renderStats();
    renderLeads();
  });

  return card;
}

function flashSaved(el) {
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  // Full attribute-value encoding, not just quotes — a lead's name/email/
  // phone/notes are visitor-supplied and only checked for type/length by
  // Firestore rules, never for content, so this is a real XSS boundary,
  // not a formality. & must be encoded first so the later replacements
  // don't get double-escaped.
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

document.getElementById('search-input').addEventListener('input', renderLeads);
document.getElementById('status-filter').addEventListener('change', renderLeads);
document.getElementById('sort-select').addEventListener('change', renderLeads);
document.getElementById('refresh-btn').addEventListener('click', loadLeads);

/* ── EXPORT TO CSV ──
   Always exports every lead, regardless of the current search/filter/sort
   — this button is a full backup, not "export what's on screen." */
function csvField(val) {
  const s = String(val ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

document.getElementById('export-btn').addEventListener('click', () => {
  const columns = [
    'Name', 'Email', 'Phone', 'Package', 'Status', 'Deal Value (ZAR)',
    'Source', 'UTM Source', 'UTM Medium', 'UTM Campaign',
    'Message', 'Notes', 'Created At',
  ];
  const rows = allLeads.map(l => [
    l.name || '', l.email || '', l.phone || '', l.package || '', l.status || 'New',
    l.dealValue != null ? l.dealValue : '',
    l.source || '', l.utm_source || '', l.utm_medium || '', l.utm_campaign || '',
    l.message || '', l.notes || '',
    l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000).toLocaleString('en-ZA') : '',
  ]);

  const csv = [columns, ...rows].map(row => row.map(csvField).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `elevate-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

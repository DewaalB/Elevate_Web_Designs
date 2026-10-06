/* Public Free SEO Check (free-seo-check.html). Same analysis engine as the
   admin tool, fed by the worker's one-shot /public/quick scan. Visitors see
   the score and top issues; the full report is offered as a lead. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { WORKER_URL, DEV_MODE } from './api.js';
import { buildQuickCrawl } from './quick.js';
import { analyze } from './analyze.js';
import { esc, ring, tone } from './render.js';

/* Cloudflare dashboard → Turnstile → Add widget (domain elevatewebdesign.co.za)
   → paste the *site key* here. The secret key goes on the worker. */
const TURNSTILE_SITE_KEY = '0x4AAAAAAFPkEwLNejfWeOAy';
const TURNSTILE_TEST_KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass key, local testing only
const SITE_KEY = DEV_MODE ? TURNSTILE_TEST_KEY : TURNSTILE_SITE_KEY;

const NOTIFY_WORKER_URL = 'https://elevate-lead-notify.dewaalb3.workers.dev';
const NOTIFY_SITE_KEY = '2fe506792f6ef59b03293f39b7acaed63e76bb7e26af8737';

const db = getFirestore(initializeApp({
  apiKey: 'AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg',
  authDomain: 'elevatewebdesigns-1fc3d.firebaseapp.com',
  projectId: 'elevatewebdesigns-1fc3d',
  storageBucket: 'elevatewebdesigns-1fc3d.firebasestorage.app',
  messagingSenderId: '778173951248',
  appId: '1:778173951248:web:5922c9dcd1623b9e658995',
}));

const $ = id => document.getElementById(id);
let report = null;
let captchaToken = null;
let widgetId = null;

/* ── Turnstile ── */
function loadTurnstile() {
  if (!SITE_KEY) {
    $('qc-btn').disabled = true;
    $('qc-unavailable').hidden = false;
    return;
  }
  window.onTurnstileLoad = () => {
    widgetId = window.turnstile.render('#qc-turnstile', {
      sitekey: SITE_KEY, theme: 'dark', appearance: 'interaction-only',
      callback: t => { captchaToken = t; },
      'expired-callback': () => { captchaToken = null; },
      'error-callback': () => { captchaToken = null; },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
  s.async = true;
  s.onerror = () => { $('qc-error').textContent = 'The "I\'m human" check couldn\'t load. Disable any blocker for this page and refresh.'; };
  document.head.append(s);
}

async function waitForToken(ms = 15000) {
  const until = Date.now() + ms;
  while (!captchaToken && Date.now() < until) await new Promise(r => setTimeout(r, 200));
  return captchaToken;
}

/* ── Run the check ── */
$('qc-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('qc-url').value.trim();
  $('qc-error').textContent = '';
  if (!/^(https?:\/\/)?[^\s/$.?#]+\.[^\s]+$/i.test(url)) { $('qc-error').textContent = 'Enter a website address like yourbusiness.co.za'; return; }

  $('qc-btn').disabled = true;
  $('qc-result').hidden = true;
  $('qc-progress').hidden = false;
  $('qc-status').textContent = 'Checking you\'re human…';
  try {
    const token = await waitForToken();
    if (!token) throw new Error('Please complete the "I\'m human" check above, then try again.');
    $('qc-status').textContent = `Scanning ${url}…`;
    const res = await fetch(`${WORKER_URL}/public/quick`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, turnstileToken: token }),
    }).catch(() => { throw new Error('Couldn\'t reach the checker. Check your connection and try again.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'The check failed. Please try again.');

    $('qc-status').textContent = 'Scoring…';
    await new Promise(r => setTimeout(r, 20));
    report = analyze(buildQuickCrawl(data));
    renderResult(report);
  } catch (err) {
    $('qc-error').textContent = err.message;
  } finally {
    // Turnstile tokens are single-use.
    captchaToken = null;
    if (widgetId != null) window.turnstile?.reset(widgetId);
    $('qc-progress').hidden = true;
    $('qc-btn').disabled = false;
  }
});

/* ── Results ── */
function verdict(score, critical) {
  if (score == null) return 'We couldn\'t score this site.';
  if (critical && score >= 70) return `A good score overall, but we found ${critical === 1 ? 'a critical issue' : `${critical} critical issues`} that could hurt your Google rankings — see below.`;
  if (score >= 90) return 'Your website is in great shape. A few refinements could still win you more traffic.';
  if (score >= 70) return 'A solid foundation — fixing the issues below is the quickest way to climb in Google.';
  if (score >= 50) return 'Several issues are holding your website back in Google search.';
  return 'Serious issues are likely stopping customers from finding you on Google.';
}

function renderResult(r) {
  const top = r.recommendations.slice(0, 5);
  const totalIssues = r.counts.critical + r.counts.warning;
  const bars = r.categories.filter(c => c.score != null).map(c => `
    <div class="qc-bar tone-${tone(c.score)}"><span>${esc(c.name)}</span>
      <span class="track"><span class="fill" style="width:${c.score}%"></span></span><span class="num">${c.score}</span></div>`).join('');

  $('qc-result').innerHTML = `
    <div class="panel">
      <div class="qc-score">${ring(r.overall, 120)}<div>
        <span class="eyebrow">SEO score</span>
        <h2>${esc(r.rootHost)}</h2>
        <p class="qc-verdict">${esc(verdict(r.overall, r.counts.critical))}</p>
      </div></div>
      <div class="qc-bars">${bars}</div>
    </div>
    <div class="panel qc-issues">
      <h3>${top.length ? 'Top issues to fix first' : 'No major issues found'}</h3>
      ${top.map(i => `<div class="qc-issue sev-${i.status}"><strong>${esc(i.title)}</strong><p>${esc(i.message)}</p><p class="muted small"><strong>Fix:</strong> ${esc(i.fix)}</p></div>`).join('')}
      ${totalIssues > top.length ? `<p class="qc-more">+ ${totalIssues - top.length} more ${totalIssues - top.length === 1 ? 'issue' : 'issues'} found. ${r.counts.pass} checks passed.</p>` : top.length ? '' : `<p class="qc-good">${r.counts.pass} checks passed.</p>`}
    </div>
    <div class="panel qc-cta" id="qc-cta">
      <h3>Want the full report and a fix plan?</h3>
      <p>We'll run a complete audit of ${esc(r.rootHost)} — every page, link and image, plus real-world speed — and send you the results with clear next steps. Free, no obligation.</p>
      <form class="qc-lead-form" id="qc-lead" novalidate>
        <label class="field"><span>Name</span><input id="ql-name" autocomplete="name" required maxlength="150"></label>
        <label class="field"><span>Email</span><input id="ql-email" type="email" autocomplete="email" required maxlength="150"></label>
        <label class="field wide"><span>WhatsApp / phone (optional)</span><input id="ql-phone" type="tel" autocomplete="tel" maxlength="40"></label>
        <button class="btn primary wide" id="ql-btn" type="submit">Send me the full report</button>
        <p class="error-text wide" id="ql-error" role="alert"></p>
      </form>
    </div>
    <button class="btn ghost small" id="qc-again" type="button">Check another website</button>`;
  $('qc-result').hidden = false;
  $('qc-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('qc-result').addEventListener('click', e => {
  if (e.target.id === 'qc-again') {
    $('qc-result').hidden = true;
    $('qc-url').value = '';
    $('qc-url').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

/* ── Lead capture ── */
function leadMessage(r) {
  const cats = r.categories.filter(c => c.score != null).map(c => `${c.name} ${c.score}`).join(', ');
  const issues = r.recommendations.slice(0, 8).map(i => `- ${i.title}`).join('\n');
  return `Free SEO check requested a full report.\nWebsite: ${r.homeUrl}\nQuick-check score: ${r.overall ?? 'n/a'}/100\n${cats}\n\nTop issues:\n${issues || '- none'}\n\n${r.counts.critical} critical, ${r.counts.warning} warnings, ${r.counts.pass} passed.`.slice(0, 4900);
}

$('qc-result').addEventListener('submit', async e => {
  if (e.target.id !== 'qc-lead') return;
  e.preventDefault();
  const name = $('ql-name').value.trim();
  const email = $('ql-email').value.trim();
  const phone = $('ql-phone').value.trim();
  $('ql-error').textContent = '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('ql-error').textContent = 'Please enter your name and a valid email.'; return; }

  $('ql-btn').disabled = true;
  $('ql-btn').textContent = 'Sending…';
  try {
    if (DEV_MODE) {
      console.info('[dev] lead not saved', { name, email, phone, message: leadMessage(report) });
    } else {
      await addDoc(collection(db, 'leads'), {
        name, email, phone, package: 'Free SEO Check', message: leadMessage(report),
        source: 'website_seo_check', createdAt: serverTimestamp(),
      });
      fetch(`${NOTIFY_WORKER_URL}/notify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-key': NOTIFY_SITE_KEY },
        body: JSON.stringify({ name, package: 'Free SEO Check' }),
      }).catch(() => {});
    }
    $('qc-cta').innerHTML = `<h3>Thanks, ${esc(name)}! 🎉</h3><p class="qc-sent">We'll be in touch at ${esc(email)} with the full SEO report for ${esc(report.rootHost)}.</p>`;
  } catch (err) {
    console.error(err);
    $('ql-error').textContent = 'Couldn\'t send right now — please try again or use the contact form on our homepage.';
    $('ql-btn').disabled = false;
    $('ql-btn').textContent = 'Send me the full report';
  }
});

loadTurnstile();

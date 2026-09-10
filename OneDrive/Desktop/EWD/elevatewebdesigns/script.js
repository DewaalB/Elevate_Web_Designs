/* =========================================
   ELEVATE WEB DESIGN — script.js (mobile-fixed)
   ========================================= */

/* ── SCROLL PROGRESS ── */
const prog = document.getElementById('scroll-progress');
window.addEventListener('scroll', () => {
  const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100;
  prog.style.width = pct + '%';
}, { passive: true });

/* ── BACK TO TOP ── */
const backToTop = document.getElementById('back-to-top');
window.addEventListener('scroll', () => {
  backToTop.classList.toggle('show', window.scrollY > window.innerHeight);
}, { passive: true });
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ── COPY TO CLIPBOARD (phone / email) ── */
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const originalLabel = btn.getAttribute('aria-label');
    btn.classList.add('copied');
    btn.setAttribute('aria-label', 'Copied!');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.setAttribute('aria-label', originalLabel);
    }, 1600);
  });
});

/* ── CUSTOM CURSOR (desktop only) ── */
const isMobile = () => window.matchMedia('(max-width: 900px)').matches || ('ontouchstart' in window);
const cursor   = document.getElementById('cursor');
const ring     = document.getElementById('cursor-ring');
let mx = 0, my = 0, rx = 0, ry = 0;

if (!isMobile()) {
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cursor.style.left = mx + 'px'; cursor.style.top = my + 'px';
  });

  function animRing() {
    rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
    ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
    requestAnimationFrame(animRing);
  }
  animRing();

  document.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });
}

/* ── NAV SCROLL ── */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

/* ── MOBILE MENU ── */
const hamburger  = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const closeMenu  = document.getElementById('close-menu');

hamburger.addEventListener('click', () => mobileMenu.classList.add('open'));
closeMenu.addEventListener('click', () => mobileMenu.classList.remove('open'));
document.querySelectorAll('.mm-link').forEach(l => {
  l.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

/* ── PRIVACY POLICY MODAL ── */
const privacyLink    = document.getElementById('privacy-link');
const privacyOverlay = document.getElementById('privacy-overlay');
const privacyClose   = document.getElementById('privacy-close');

if (privacyLink && privacyOverlay && privacyClose) {
  privacyLink.addEventListener('click', () => privacyOverlay.classList.add('open'));
  privacyClose.addEventListener('click', () => privacyOverlay.classList.remove('open'));
  privacyOverlay.addEventListener('click', e => {
    if (e.target === privacyOverlay) privacyOverlay.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') privacyOverlay.classList.remove('open');
  });
}

/* ── SMOOTH SCROLL ── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

/* ── TYPING EFFECT ── */
const words = ['ONLINE.', 'GROWING.', 'THRIVING.', 'FOUND.', 'ELEVATED.'];
let wi = 0, ci = 0, deleting = false;
const typingEl = document.getElementById('typing-el');

function type() {
  const word = words[wi];
  if (!deleting) {
    typingEl.textContent = word.slice(0, ci + 1); ci++;
    if (ci === word.length) { deleting = true; setTimeout(type, 1800); return; }
  } else {
    typingEl.textContent = word.slice(0, ci - 1); ci--;
    if (ci === 0) { deleting = false; wi = (wi + 1) % words.length; }
  }
  setTimeout(type, deleting ? 60 : 100);
}
setTimeout(type, 1500);

/* ── PARTICLES (debounced resize, only on non-reduced-motion) ── */
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('particles-canvas');

if (canvas && !prefersReduced) {
  const ctx = canvas.getContext('2d');
  let pts = [];
  let resizeTimer;

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }

  function initPts() {
    pts = [];
    const n = Math.min(80, Math.floor(canvas.width * canvas.height / 12000));
    for (let i = 0; i < n; i++) {
      pts.push({
        x:  Math.random() * canvas.width,
        y:  Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r:  Math.random() * 1.5 + 0.5,
        a:  Math.random()
      });
    }
  }

  resize(); initPts();

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); initPts(); }, 200);
  }, { passive: true });

  let mousePt = { x: -9999, y: -9999 };
  const heroSection = document.getElementById('hero');
  if (heroSection) {
    heroSection.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mousePt = { x: e.clientX - r.left, y: e.clientY - r.top };
    }, { passive: true });
    heroSection.addEventListener('mouseleave', () => {
      mousePt = { x: -9999, y: -9999 };
    });
  }

  function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,212,255,${0.3 + p.a * 0.4})`;
      ctx.fill();
    });

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d  = Math.hypot(dx, dy);
        if (d < 120) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(0,212,255,${0.12 * (1 - d / 120)})`;
          ctx.lineWidth   = 0.5;
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
      const dx = pts[i].x - mousePt.x, dy = pts[i].y - mousePt.y;
      const d  = Math.hypot(dx, dy);
      if (d < 160) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0,212,255,${0.3 * (1 - d / 160)})`;
        ctx.lineWidth   = 0.8;
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(mousePt.x, mousePt.y);
        ctx.stroke();
      }
    }
    requestAnimationFrame(drawParticles);
  }
  drawParticles();
}

/* ── SERVICE CARD TILT (desktop only) ── */
if (!isMobile()) {
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top)  / r.height;
      card.style.transform = `perspective(600px) rotateY(${(x - 0.5) * 6}deg) rotateX(${(0.5 - y) * 6}deg)`;
      card.style.setProperty('--mx', x * 100 + '%');
      card.style.setProperty('--my', y * 100 + '%');
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}

/* ── SCROLL REVEAL ── */
const revealEls = document.querySelectorAll('.reveal');
const ro = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('visible'), i * 60);
      ro.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });
revealEls.forEach(el => ro.observe(el));

/* ── STAT COUNTERS ── */
const counters = document.querySelectorAll('[data-count]');
const co = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el     = entry.target;
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '+';
    let current  = 0;
    const step   = Math.max(1, Math.ceil(target / 40));
    const timer  = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current + suffix;
      if (current >= target) clearInterval(timer);
    }, 35);
    co.unobserve(el);
  });
}, { threshold: 0.5 });
counters.forEach(c => co.observe(c));

/* ── Fill NOTIFY_WORKER_URL in once the Cloudflare relay is deployed
   (see cf-worker/README.md) — NOTIFY_SITE_KEY must match the SITE_SECRET
   set on that Worker. Both are safe to ship in public JS: this only ever
   triggers a push to the admin's own device, it can't read or change
   anything, and the Worker rate-limits it regardless. ── */
const NOTIFY_WORKER_URL = 'https://elevate-lead-notify.dewaalb3.workers.dev';
const NOTIFY_SITE_KEY   = '2fe506792f6ef59b03293f39b7acaed63e76bb7e26af8737';

function notifyAdmin(name, pkg) {
  if (NOTIFY_WORKER_URL.includes('REPLACE-ME')) return; // relay not deployed yet
  fetch(`${NOTIFY_WORKER_URL}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-site-key': NOTIFY_SITE_KEY },
    body: JSON.stringify({ name, package: pkg })
  }).catch(() => { /* best-effort — the lead is already saved either way */ });
}

/* ══════════════════════════════════════════
   COST ESTIMATOR LOGIC
   All prices and the calculation itself live in pricing.js, shared with
   the manager app's quote calculator so the two can never disagree.
══════════════════════════════════════════ */
const PRICING = window.EWD_PRICING;
const fmt = PRICING.fmt;

/* Build the feature and care-plan pickers from the shared price list. */
function renderEstimatorOptions() {
  const check = '<div class="ft-check"><svg viewBox="0 0 10 8"><polyline points="1,4 3.5,7 9,1"/></svg></div>';

  document.getElementById('feature-grid').innerHTML = PRICING.FEATURES.map(f => `
    <div class="feature-toggle" data-id="${f.id}">
      ${check}
      <div class="ft-text"><span class="ft-label">${f.label}</span><span class="ft-desc">${f.desc}</span></div>
    </div>
  `).join('');

  document.getElementById('care-grid').innerHTML = PRICING.CARE_PLANS.map((c, i) => `
    <div class="care-toggle${i === 0 ? ' selected' : ''}" data-id="${c.id}">
      ${check}
      <div class="ft-text"><span class="ft-label">${c.id === 'none' ? c.shortLabel : c.label}</span><span class="ft-desc">${c.desc}</span></div>
    </div>
  `).join('');
}
renderEstimatorOptions();

// Kept up to date on every estimator change, so the contact form's
// "Custom Quote" option can show the figure without recalculating it.
let lastEstimate = { low: 0, high: 0, carePrice: 0, careLabel: 'No care plan' };

function updateCustomQuoteHint() {
  const pkgSelect = document.getElementById('package');
  const hint      = document.getElementById('custom-quote-hint');
  if (!pkgSelect || !hint) return;
  if (pkgSelect.value === 'Custom Quote') {
    const careSuffix = lastEstimate.carePrice > 0
      ? ` + ${fmt(lastEstimate.carePrice)}/mo care plan`
      : '';
    document.getElementById('custom-quote-amount').textContent =
      `${fmt(lastEstimate.low)} – ${fmt(lastEstimate.high)}${careSuffix}`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function calcEstimate() {
  const pages     = +document.getElementById('sl-pages').value;
  const revisions = +document.getElementById('sl-revisions').value;
  const urgency   = +document.getElementById('sl-urgency').value;

  const featureIds = [...document.querySelectorAll('.feature-toggle.selected')].map(ft => ft.dataset.id);
  const careEl     = document.querySelector('.care-toggle.selected');
  const carePlanId = careEl ? careEl.dataset.id : 'none';

  const q = PRICING.calculate({ pages, revisions, urgency, featureIds, carePlanId });

  // Care plan is billed monthly, separate from the once-off build cost —
  // kept out of the low/high total so the two never get added together.
  const careLine = document.getElementById('est-care-line');
  if (q.carePrice > 0) {
    document.getElementById('est-care-val').textContent = fmt(q.carePrice) + '/mo';
    careLine.hidden = false;
  } else {
    careLine.hidden = true;
  }

  document.getElementById('est-low').textContent          = fmt(q.low);
  document.getElementById('est-high').textContent         = fmt(q.high);
  document.getElementById('est-base-val').textContent     = fmt(q.baseAmt);
  document.getElementById('est-features-val').textContent = q.featureAmt > 0 ? fmt(q.featureAmt) : 'R0';
  document.getElementById('est-rev-val').textContent      = q.revAmt > 0 ? fmt(q.revAmt) : 'R0';
  document.getElementById('est-urgency-val').textContent  = q.urgencyAmt > 0 ? fmt(q.urgencyAmt) + ' (rush)' : 'R0';
  document.getElementById('est-total-val').textContent    = fmt(q.low) + ' – ' + fmt(q.high);

  document.getElementById('val-pages').textContent     = pages;
  document.getElementById('val-revisions').textContent = revisions;
  document.getElementById('val-urgency').textContent   = urgency + (urgency === 1 ? ' wk' : ' wks');

  lastEstimate = { low: q.low, high: q.high, carePrice: q.carePrice, careLabel: q.careLabel };
  updateCustomQuoteHint();

  return {
    low: q.low, high: q.high, pages, revisions, urgency,
    features: q.features.map(f => f.label), carePrice: q.carePrice, careLabel: q.careLabel
  };
}

['sl-pages', 'sl-revisions', 'sl-urgency'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcEstimate);
});

document.querySelectorAll('.feature-toggle').forEach(ft => {
  ft.addEventListener('click', () => { ft.classList.toggle('selected'); calcEstimate(); });
});

document.querySelectorAll('.care-toggle').forEach(ct => {
  ct.addEventListener('click', () => {
    document.querySelectorAll('.care-toggle').forEach(o => o.classList.remove('selected'));
    ct.classList.add('selected');
    calcEstimate();
  });
});

document.getElementById('package').addEventListener('change', updateCustomQuoteHint);

const estCtaBtn = document.getElementById('est-cta-btn');

estCtaBtn.addEventListener('click', () => {
  const nameEl  = document.getElementById('est-name');
  const phoneEl = document.getElementById('est-phone');
  const name    = nameEl.value.trim();
  const phone   = phoneEl.value.trim();

  if (!name || !phone) {
    showToast('Missing details', 'Please add your name and WhatsApp number so I can send your quote.', true);
    return;
  }

  const est        = calcEstimate();
  const featureStr = est.features.length ? est.features.join(', ') : 'None selected';
  const msgParts   = [
    `Hi! I'm ${name}, I used the cost estimator on your site.`,
    `Pages: ${est.pages}`,
    `Extra features: ${featureStr}`,
    `Rounds of changes: ${est.revisions}`,
    `Timeline: ${est.urgency} week(s)`,
    `Estimate: ${fmt(est.low)} – ${fmt(est.high)} (once-off)`,
    `Care plan: ${est.carePrice > 0 ? `${est.careLabel} (${fmt(est.carePrice)}/mo)` : 'None'}`,
    "I'd love a confirmed quote!"
  ];
  const summary = msgParts.join('\n');

  // Open WhatsApp immediately, synchronously in the click handler — browsers
  // block window.open() once it happens after an awaited call, so this must
  // fire before the Firestore save below, not after it.
  window.open(`https://wa.me/27825368312?text=${encodeURIComponent(summary)}`, '_blank');
  showToast('Quote sent! 🎉', "I'll message you on WhatsApp and get back within 24 hours.");

  // Log the quote to the manager dashboard in the background (best-effort —
  // a visitor's quote and WhatsApp message are never blocked by this).
  if (window.__db) {
    window.__add(window.__col(window.__db, 'leads'), {
      name,
      phone,
      email:     'Not provided',
      package:   'Custom Estimate',
      message:   summary,
      source:    'website_estimator',
      createdAt: window.__ts()
    }).catch(err => console.error('Could not save estimator quote to dashboard:', err));
  }

  notifyAdmin(name, 'Custom Estimate');
});

calcEstimate();

/* ── TOAST ── */
function showToast(title, msg, isError = false) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-msg').textContent   = msg;
  toast.classList.toggle('error', isError);
  const iconSVG = isError
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e74c3c" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--cyan)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  toast.querySelector('.toast-icon').innerHTML = iconSVG;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4500);
}

/* ── CONTACT FORM ── */
const submitBtn = document.getElementById('submit-btn');
if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    const name  = document.getElementById('name')?.value.trim();
    const phone = document.getElementById('phone')?.value.trim();
    const email = document.getElementById('email')?.value.trim();
    const pkg   = document.getElementById('package')?.value;
    const msg   = document.getElementById('message')?.value.trim();

    if (!name || !email || !msg) {
      showToast('Missing fields', 'Please fill in your name, email and message.', true);
      return;
    }
    if (!window.__db) {
      showToast('Not connected', 'Firebase is not configured yet. Please add your Firebase config.', true);
      return;
    }

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Sending...';

    // Carry the live estimator figure along when "Custom Quote" is picked,
    // so it lands in the manager dashboard without cluttering what the
    // visitor actually typed in the message box.
    const estimateNote = pkg === 'Custom Quote'
      ? `\n\n(Instant estimate when submitted: ${fmt(lastEstimate.low)} – ${fmt(lastEstimate.high)})`
      : '';

    try {
      await window.__add(window.__col(window.__db, 'leads'), {
        name,
        phone:     phone || '',
        email,
        package:   pkg || 'Not specified',
        message:   msg + estimateNote,
        source:    'website_contact_form',
        createdAt: window.__ts()
      });

      submitBtn.innerHTML = '✓ Message Sent! ' + sendIcon();
      submitBtn.classList.add('sent');
      showToast('Message received! 🎉', "I'll get back to you within 24 hours.");
      notifyAdmin(name, pkg || 'General enquiry');

      ['name', 'phone', 'email', 'message'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('package').value = '';

      setTimeout(() => {
        submitBtn.innerHTML = 'Send Message ' + sendIcon();
        submitBtn.classList.remove('sent');
        submitBtn.disabled  = false;
      }, 4000);
    } catch (err) {
      console.error(err);
      showToast('Something went wrong', 'Please try WhatsApp or email instead.', true);
      submitBtn.innerHTML = 'Send Message ' + sendIcon();
      submitBtn.disabled  = false;
    }
  });
}

function sendIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}
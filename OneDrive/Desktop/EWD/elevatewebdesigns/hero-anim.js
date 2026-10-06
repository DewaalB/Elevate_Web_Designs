/* ── HERO ANIMATION ──
   Vanilla port of the "Hero Animation" Claude Design composition.
   One 940×720 stage rendered as a pure function of time T on an 8s loop:
   Build (0s) → Click (3.5s) → Reset (7s). */
(function () {
  const root = document.getElementById('hero-anim');
  if (!root) return;

  const W = 940, H = 720;
  const CUES = { Build: 0, Click: 3.5, Reset: 7 };
  const TOTAL = 8;

  const Ease = {
    outCubic: t => (--t) * t * t + 1,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    outBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  };
  const ease = (T, s, d, e = Ease.outCubic) => e(Math.min(1, Math.max(0, (T - s) / d)));
  const type = (txt, p) => txt.slice(0, Math.round(txt.length * p));

  root.innerHTML = `
    <div class="ha-stage" data-k="stage">
      <div class="ha-browser" data-k="browser">
        <div class="ha-chrome">
          <div class="ha-dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
          <div class="ha-url" data-k="url"></div>
        </div>
        <div class="ha-body" data-k="body">
          <div class="ha-head"><span data-k="line1"></span><br><span class="ha-accent" data-k="line2"></span><span class="ha-caret" data-k="caret"></span></div>
          <div class="ha-sub" data-k="sub"><div style="width:380px"></div><div style="width:280px"></div></div>
          <div class="ha-cta-wrap">
            <div class="ha-ripple" data-k="ripple"></div>
            <div class="ha-cta" data-k="btn">Get a Quote</div>
          </div>
        </div>
      </div>
      <svg class="ha-cursor" data-k="cursor" width="28" height="34" viewBox="0 0 28 34">
        <path d="M2 2 L2 28 L9 21 L14 32 L19 30 L14 19 L24 19 Z" fill="#fff" stroke="#0a0f1c" stroke-width="2" stroke-linejoin="round" />
      </svg>
    </div>`;

  const $ = {};
  root.querySelectorAll('[data-k]').forEach(el => { $[el.dataset.k] = el; });

  function render(T) {
    const b = CUES.Build, k = CUES.Click, r = CUES.Reset;
    const out = 1 - ease(T, r, 0.8, Ease.inOutCubic);
    const float = Math.sin((T / TOTAL) * Math.PI * 4) * 4;

    // Build — URL types, headline writes itself, button pops in
    const hero = ease(T, b + 0.6, 0.7);
    const head = ease(T, b + 1.0, 1.0, Ease.inOutCubic);
    const btn = ease(T, b + 2.4, 0.5, Ease.outBack);
    $.browser.style.top = `${130 + float}px`;
    $.url.style.opacity = out;
    $.url.textContent = type('yourbusiness.co.za', ease(T, b + 0.2, 0.8));
    $.body.style.opacity = out * hero;
    $.body.style.transform = `translateY(${(1 - hero) * 14}px)`;
    $.line1.textContent = type('YOUR BUSINESS,', Math.min(1, head * 2));
    $.line2.textContent = type('ONLINE.', Math.max(0, head * 2 - 1));
    $.caret.style.opacity = T > b + 1 && T < b + 2.2 && Math.floor(T * 3) % 2 === 0 ? 1 : 0;
    $.sub.style.opacity = ease(T, b + 2.0, 0.6);

    // Click — cursor presses Get a Quote, button turns to Request sent
    const move = ease(T, k, 1.0, Ease.inOutCubic);
    const press = T > k + 1.05 && T < k + 1.25 ? 0.94 : 1;
    const ripple = ease(T, k + 1.1, 0.7);
    const done = ease(T, k + 1.3, 0.5, Ease.outBack) > 0.01;
    $.ripple.style.opacity = ripple > 0 ? 1 - ripple : 0;
    $.ripple.style.transform = `scale(${1 + ripple * 0.35})`;
    $.btn.style.transform = `scale(${btn * press})`;
    $.btn.classList.toggle('is-done', done);
    $.btn.textContent = done ? '✓ Request sent' : 'Get a Quote';
    const cursor = ease(T, k, 0.3) * (1 - ease(T, k + 2.4, 0.4));
    $.cursor.style.left = `${720 - 506 * move}px`;
    $.cursor.style.top = `${660 - 176 * move + float}px`;
    $.cursor.style.opacity = cursor * out;
    $.cursor.style.transform = `scale(${press})`;
  }

  // Fit the fixed-size stage into the hero-visual column
  function fit() {
    const s = Math.min(root.clientWidth / W, root.clientHeight / H);
    $.stage.style.transform = `translate(-50%, -50%) scale(${s || 0})`;
  }
  new ResizeObserver(fit).observe(root);
  fit();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render(6.5); // static frame: headline written, request sent
    return;
  }

  // Loop only while the hero is on screen
  let raf = 0, visible = true, last = performance.now(), T = 0;
  function frame(now) {
    T = (T + Math.min(0.1, (now - last) / 1000)) % TOTAL;
    last = now;
    render(T);
    raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
    if (!e.isIntersecting && visible) cancelAnimationFrame(raf);
    visible = e.isIntersecting;
  }).observe(root);
  render(0);
  raf = requestAnimationFrame(frame);
})();

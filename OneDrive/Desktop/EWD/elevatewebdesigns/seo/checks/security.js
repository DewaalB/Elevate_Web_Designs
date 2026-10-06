import { pass, skip, fail, result } from './helpers.js';

// Reported under Technical SEO in the classic report; grouped as "Security"
// in the Website Growth health dashboard (see seo/growth/scoring.js).
const C = 'technical';

export const securityChecks = [

  function hsts({ home }) {
    const def = { id: 'sec.hsts', category: C, title: 'Browsers are told to always use HTTPS (HSTS)', weight: 2,
      fix: 'Send the header "Strict-Transport-Security: max-age=31536000; includeSubDomains" from your host or CDN.' };
    if (!home) return skip(def, 'Homepage not analysed.');
    if (!home.finalUrl.startsWith('https:')) return skip(def, 'Only applies to HTTPS sites.');
    const v = home.headers?.['strict-transport-security'];
    const maxAge = Number(v?.match(/max-age=(\d+)/i)?.[1] || 0);
    if (!v) return fail(def, 'warning', 'No Strict-Transport-Security header, so a visitor\'s first request can still be made over insecure HTTP.');
    if (maxAge < 15552000) return result(def, { status: 'warning', score: 0.5, message: `HSTS max-age is ${maxAge}s — use at least 6 months (15552000).` });
    return pass(def, `HSTS enabled (max-age ${maxAge}s).`);
  },

  function securityHeaders({ home }) {
    const def = { id: 'sec.headers', category: C, title: 'Basic security headers are set', weight: 2,
      fix: 'Add "X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin" and clickjacking protection ("X-Frame-Options: DENY" or a Content-Security-Policy frame-ancestors rule) at your host or CDN.' };
    if (!home) return skip(def, 'Homepage not analysed.');
    const h = home.headers || {};
    const checks = {
      'X-Content-Type-Options': /nosniff/i.test(h['x-content-type-options'] || ''),
      'Referrer-Policy': !!h['referrer-policy'],
      'Clickjacking protection': !!h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] || ''),
      'Content-Security-Policy': !!h['content-security-policy'],
    };
    const missing = Object.keys(checks).filter(k => !checks[k]);
    if (!missing.length) return pass(def, 'All basic security headers are present.');
    const score = (4 - missing.length) / 4;
    return result(def, { status: missing.length >= 3 ? 'warning' : 'info', score, message: `Missing: ${missing.join(', ')}.`,
      data: { present: Object.keys(checks).filter(k => checks[k]) } });
  },
];

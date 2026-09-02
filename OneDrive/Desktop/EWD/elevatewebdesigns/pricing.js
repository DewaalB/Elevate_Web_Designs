/* =========================================================
   ELEVATE — SHARED PRICING
   =========================================================
   Single source of truth for every price on the site. Both the public
   estimator (script.js) and the manager app's quote calculator
   (admin.js) read from here, so a price only ever gets changed in
   one place and the two can never quote different numbers.

   Loaded as a plain script before both, exposing window.EWD_PRICING.
   ========================================================= */
window.EWD_PRICING = {
  /* Build cost */
  BASE_PER_PAGE:  700,    // per page
  BASE_FLOOR:     2500,   // minimum build cost, however few the pages
  REV_COST:       200,    // per round of changes beyond the free ones
  FREE_REVISIONS: 2,
  HIGH_MULT:      1.2,    // upper end of the quoted range
  FIRST_CLIENT_DISCOUNT: 500,

  /* Rush fee as a share of the subtotal, keyed by delivery weeks */
  URGENCY_MULT: { 1: 0.30, 2: 0.15, 3: 0.10, 4: 0.05, 5: 0, 6: 0, 7: 0, 8: 0 },

  /* Once-off add-ons */
  FEATURES: [
    { id: 'contact_form',   label: 'Contact Form',          price: 800,  desc: 'A form so visitors can message you directly from the site' },
    { id: 'booking',        label: 'Booking System',        price: 1200, desc: 'Let customers book appointments or sessions online' },
    { id: 'whatsapp',       label: 'WhatsApp Integration',  price: 600,  desc: 'A one-tap button so visitors can chat to you on WhatsApp' },
    { id: 'maps',           label: 'Google Maps & Business',price: 900,  desc: 'Shows your location and opening hours so people can find you' },
    { id: 'seo',            label: 'SEO Package',           price: 1500, desc: 'Helps your site show up higher when people search Google' },
    { id: 'gallery',        label: 'Photo Gallery',         price: 700,  desc: 'A gallery page to show off your products, work or space' },
    { id: 'blog',           label: 'Blog / News Section',   price: 1000, desc: 'A place to post updates, news or articles over time' },
    { id: 'analytics',      label: 'Google Analytics',      price: 800,  desc: 'See how many people visit your site and what they look at' },
    { id: 'data_storage',   label: 'Online Data Storage',   price: 1100, desc: 'Powers things like saved bookings, forms or a login area' },
    { id: 'social',         label: 'Social Media Links',    price: 500,  desc: 'Buttons linking to your Facebook, Instagram and more' },
  ],

  /* Monthly care plans */
  CARE_PLANS: [
    { id: 'none',          label: 'No care plan',            shortLabel: 'No thanks',              price: 0,   desc: "I'll sort hosting and updates myself, or decide later" },
    { id: 'website_care',  label: 'Website Care — R299/mo',  shortLabel: 'Website Care',           price: 299, desc: 'Hosting, SSL, backups, security updates & minor content changes' },
    { id: 'business_care', label: 'Business Care — R499/mo', shortLabel: 'Business Care',          price: 499, desc: 'Everything in Website Care, plus priority support & monthly updates' },
  ],

  /* Headline packages (display only — the estimator prices per page) */
  PACKAGES: [
    { label: 'Starter',      price: 3500 },
    { label: 'Professional', price: 7500 },
    { label: 'Premium',      price: 14000 },
  ],

  /* Business details used on generated quotes */
  BUSINESS: {
    name:    'Elevate Web Design',
    phone:   '082 536 8312',
    email:   'elevatewebdesigns26@gmail.com',
    website: 'www.elevatewebdesign.co.za',
  },
};

/* Format a number as Rands, e.g. 3500 -> "R3,500" */
window.EWD_PRICING.fmt = function (n) {
  return 'R' + Math.round(n).toLocaleString('en-ZA');
};

/* The one calculation both the public estimator and the manager app use.
   Takes the raw selections, returns every line of the breakdown. */
window.EWD_PRICING.calculate = function (opts) {
  const P = window.EWD_PRICING;
  const pages      = Number(opts.pages) || 1;
  const revisions  = Number(opts.revisions) || 0;
  const urgency    = Number(opts.urgency) || 5;
  const featureIds = opts.featureIds || [];
  const carePlanId = opts.carePlanId || 'none';
  const applyDiscount = !!opts.firstTimeDiscount;

  const baseAmt = Math.max(P.BASE_FLOOR, pages * P.BASE_PER_PAGE);
  const revAmt  = Math.max(0, revisions - P.FREE_REVISIONS) * P.REV_COST;

  const features = P.FEATURES.filter(f => featureIds.includes(f.id));
  const featureAmt = features.reduce((sum, f) => sum + f.price, 0);

  const subtotal   = baseAmt + revAmt + featureAmt;
  const urgencyPct = P.URGENCY_MULT[urgency] || 0;
  const urgencyAmt = subtotal * urgencyPct;

  const discount = applyDiscount ? P.FIRST_CLIENT_DISCOUNT : 0;
  const total    = Math.max(0, subtotal + urgencyAmt - discount);

  const care = P.CARE_PLANS.find(c => c.id === carePlanId) || P.CARE_PLANS[0];

  return {
    pages, revisions, urgency,
    baseAmt, revAmt, featureAmt, urgencyAmt, urgencyPct, discount,
    features,
    low:  Math.round(total),
    high: Math.round(total * P.HIGH_MULT),
    carePrice: care.price,
    careLabel: care.shortLabel,
    careId: care.id,
  };
};

/* ============================================================
   LITPAX SERVICE HUB — config.js
   Sirf yahan URLs aur constants rakho. Baaki files ko chhedna nahi.
   ============================================================ */
const CONFIG = {
  // --- Repair / Service Management backend ---
  REPAIR_URL:  'https://script.google.com/macros/s/AKfycbz05ys0ja2A0uqDJyoHc_oblv8jljmKZaZkrdez0z1RwTpMIou0CN2SIIqLnPcOEZYo/exec',

  // --- Enquiry Management backend ---
  ENQUIRY_URL: 'https://script.google.com/macros/s/AKfycbzTZU0YyV8wTfaPcUhUj7C041nxgZz2nrVIlJEiVE9adF35-KuwoBczI22DXbLa7B2z/exec',

  // Admin config panel PIN (dropdown options edit karne ke liye)
  ADMIN_PIN: '2468',

  // Client cache time-to-live (ms). Iske baad background refresh.
  CACHE_TTL_MS: 5 * 60 * 1000,

  // JSONP request timeout (ms)
  JSONP_TIMEOUT_MS: 20000
};

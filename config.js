/* ============================================================
   LITPAX SERVICE HUB v2 — config.js
   ============================================================ */
const CONFIG = {
  // GAS Web App URL (Deploy → Web app → paste the URL here)
  API_URL: 'https://script.google.com/macros/s/AKfycbyJMFTLJYjfWDcII6NLCAdcP-jNxqKkPLQuDTTVT5NLSCMqV7Yc1GytClVOkTWQlk_oHw/exec',

  JSONP_TIMEOUT_MS: 25000,
  POST_TIMEOUT_MS: 90000,      // builty upload / Mark Received
  BUILTY_MAX_MB: 5,
  CACHE_TTL_MS: 60000,

  // nav = sidebar items for the role (the first one opens after login)
  ROLES: {
    attendant: { label: 'Call Attendant', icon: '📞', nav: ['newTicket', 'tickets'] },
    service:   { label: 'Service Team',   icon: '🎧', nav: ['tickets', 'newTicket'] },
    repair:    { label: 'Repair Team',    icon: '🔧', nav: ['board', 'dispatch', 'tickets'] },
    admin:     { label: 'Admin',          icon: '👑', nav: ['tickets', 'newTicket', 'board', 'dispatch', 'masters'] }
  },

  // ⚠️ Keep in sync with ROLE_PERMS in Code.gs
  PERMS: {
    attendant: ['create'],
    service:   ['create', 'service'],
    repair:    ['repair'],
    admin:     ['create', 'service', 'repair', 'admin']
  },

  // ⚠️ Must EXACTLY match PURCHASE_AGE in Code.gs
  PURCHASE_AGE: ['Less than 6 months', '6 months - 1 year', 'More than 1 year'],

  // ⚠️ Must EXACTLY match REPAIR_STAGES in Code.gs (same order) — last = Final QC & Pack
  STAGES: ['Diagnosis', 'Cell Testing', 'Repair Work', 'Charging Test', 'Final QC & Pack']
};

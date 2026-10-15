/* ============================================================
   LITPAX SERVICE HUB v2 — config.js
   ============================================================ */
const CONFIG = {
  // GAS Web App URL (Deploy → Web app → URL yahan)
  API_URL: 'https://script.google.com/macros/s/AKfycbyJMFTLJYjfWDcII6NLCAdcP-jNxqKkPLQuDTTVT5NLSCMqV7Yc1GytClVOkTWQlk_oHw/exec',

  JSONP_TIMEOUT_MS: 25000,
  CACHE_TTL_MS: 60000,

  // nav = sidebar me kya dikhega (pehla wala login ke baad khulega)
  ROLES: {
    attendant: { label: 'Call Attendant', icon: '📞', nav: ['newTicket', 'tickets'] },
    service:   { label: 'Service Team',   icon: '🎧', nav: ['tickets', 'newTicket'] },
    repair:    { label: 'Repair Team',    icon: '🔧', nav: ['board', 'dispatch', 'tickets'] },
    admin:     { label: 'Admin',          icon: '👑', nav: ['tickets', 'newTicket', 'board', 'dispatch'] }
  },

  // ⚠️ Code.gs ke ROLE_PERMS se same rakho
  PERMS: {
    attendant: ['create'],
    service:   ['create', 'service'],
    repair:    ['repair'],
    admin:     ['create', 'service', 'repair']
  },

  // ⚠️ Code.gs ke PURCHASE_AGE se EXACT same
  PURCHASE_AGE: ['Less than 6 months', '6 months - 1 year', 'More than 1 year'],

  // ⚠️ Code.gs ke REPAIR_STAGES se EXACT same order — last = Final QC & Pack
  STAGES: ['Diagnosis', 'Cell Testing', 'Repair Work', 'Charging Test', 'Final QC & Pack']
};

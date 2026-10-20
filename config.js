/* ============================================================
   LITPAX SERVICE HUB v2 — config.js
   ============================================================ */
const CONFIG = {
  // GAS Web App URL (Deploy → Web app → paste the URL here)
  API_URL: 'https://script.google.com/macros/s/AKfycbyleqQRWuTjCvQj4mQ9hswMDtWIY-s67UqZBP6QZm0o7Kurfsi7VHUggWLIByQVRakzbQ/exec',

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
  STAGES: ['Diagnosis', 'Cell Testing', 'Repair Work', 'Charging Test', 'Final QC & Pack'],

  // ── Customer tracking page + WhatsApp (click-to-send) ──
  TRACK_URL: 'https://mis-darpan.github.io/YOUR-REPO/track/',   // ⚠️ apna repo naam daalo, end mein / zaroori
  WA_COUNTRY: '91',
  FEEDBACK_AFTER_DAYS: 3,

  // {placeholder} khaali ho toh wo poori line message se hat jaati hai
  WA_TEMPLATES: {
    created:    'Hello {name},\nThank you for contacting Litpax Service. Your request has been registered.\nTicket ID: {id}\nTrack your service status: {link}',
    pickup:     'Hello {name},\nPickup for your Ticket {id} has been arranged.\nPickup date: {date}\nTransport: {transport}\nLR No: {lr}\nTrack status: {link}',
    received:   'Hello {name},\nWe have received your {items} at the Litpax Service Center.\nTicket ID: {id}\nTrack repair status: {link}',
    dispatched: 'Hello {name},\nYour {items} (Ticket {id}) has been dispatched.\nDispatch date: {date}\nTransport: {transport}\nTrack status: {link}',
    feedback:   'Hello {name},\nWe hope your battery is working well after the service (Ticket {id}).\nPlease share your feedback, it takes less than a minute:\n{flink}\nThank you, Team Litpax'
  }
};

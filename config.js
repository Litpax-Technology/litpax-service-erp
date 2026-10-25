/* ============================================================
   LITPAX SERVICE HUB v2 — config.js
   ============================================================ */
const CONFIG = {
  // GAS Web App URL (Deploy → Web app → paste the URL here)
  API_URL: 'https://script.google.com/macros/s/AKfycbwB3a3K21PmIV1s7ET4TyzTNbga6Ko_Vg-DPts7HICpHP5cXXMnc7WBIZFncyLNEqfi2g/exec',

  JSONP_TIMEOUT_MS: 25000,
  POST_TIMEOUT_MS: 90000,      // builty upload / Mark Received
  BUILTY_MAX_MB: 5,
  CACHE_TTL_MS: 60000,

  // nav = sidebar items for the role (the first one opens after login)
  ROLES: {
    attendant: { label: 'Call Attendant', icon: '📞', nav: ['newTicket', 'tracker'] },
    service:   { label: 'Service Team',   icon: '🎧', nav: ['tickets', 'tracker', 'newTicket'] },
    repair:    { label: 'Repair Team',    icon: '🔧', nav: ['board', 'dispatch', 'tickets'] },
    admin:     { label: 'Admin',          icon: '👑', nav: ['tickets', 'tracker', 'newTicket', 'board', 'dispatch', 'masters'] }
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

  // ── Customer tracking page (track/ folder also reads this file) + WhatsApp (click-to-send) ──
  COMPANY: 'Litpax Technology Pvt. Ltd.',
  SUPPORT_PHONE: '',                         // optional — toll-free / support number in the tracking page footer
  TRACK_LOGO_URL: '../assets/logo-white.png', // logo on the tracking page header
  TRACK_URL: 'https://litpax-technology.github.io/litpax-service-erp/track/',   // customer tracking page (end mein / zaroori)
  WA_COUNTRY: '91',
  FEEDBACK_AFTER_DAYS: 3,
  // ⚠️ Must EXACTLY match WARRANTY in Code.gs
  WARRANTY: ['In Warranty', 'Out of Warranty', 'Not Sure'],

  // New Ticket → State dropdown
  STATES: ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
           'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
           'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
           'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman & Nicobar', 'Chandigarh',
           'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'],
   // New Ticket → Scooty Brand dropdown (add new brands here)
  SCOOTY_BRANDS: ['Evey', 'Warivo', 'Zelio', 'YBK', 'Urban', 'Maxim', 'Jiva', 'Yakuza', 'J Bros', 'Neovolt',
                  'Navix', 'G Byke', 'Electric Pay', 'GenZ', 'Mega Green', 'Durasol', 'Ampfuel', 'Marudhar'],
     SLA_HOURS: {
    firstCall: 4,    // ticket created → first service call
    transit:   72,   // pickup arranged → received
    queue:     24,   // received → repair planned
    repair:    72,   // repair planned → Final QC & Pack
    dispatch:  24    // Final QC → dispatched
  },

  // {placeholder} khaali ho toh wo poori line message se hat jaati hai
  WA_TEMPLATES: {
    created:    'Hello {name},\nThank you for contacting Litpax Service. Your request has been registered.\nTicket ID: {id}\nTrack your service status: {link}',
    pickup:     'Hello {name},\nPickup for your Ticket {id} has been arranged.\nPickup date: {date}\nTransport: {transport}\nLR No: {lr}\nTrack status: {link}',
    received:   'Hello {name},\nWe have received your {items} at the Litpax Service Center.\nTicket ID: {id}\nTrack repair status: {link}',
    dispatched: 'Hello {name},\nYour {items} (Ticket {id}) has been dispatched.\nDispatch date: {date}\nTransport: {transport}\nTrack status: {link}',
    feedback:   'Hello {name},\nWe hope your battery is working well after the service (Ticket {id}).\nPlease share your feedback, it takes less than a minute:\n{flink}\nThank you, Team Litpax'
  }
};

/* ============================================================
   LITPAX SERVICE HUB — config.js
   Sab settings yahan. Backend/GAS ko haath nahi lagta.
   ============================================================ */
const CONFIG = {
  // --- Backend URLs (existing, untouched) ---
  REPAIR_URL:  'https://script.google.com/macros/s/AKfycbz05ys0ja2A0uqDJyoHc_oblv8jljmKZaZkrdez0z1RwTpMIou0CN2SIIqLnPcOEZYo/exec',
  ENQUIRY_URL: 'https://script.google.com/macros/s/AKfycbzTZU0YyV8wTfaPcUhUj7C041nxgZz2nrVIlJEiVE9adF35-KuwoBczI22DXbLa7B2z/exec',

  // --- Login roles (ERP-jaisa, sessionStorage-based — koi GAS nahi) ---
  // pin: login PIN | modules: ye role kya-kya dekh sakta
  ROLES: {
    repair:  { label: 'Repair',  icon: '\u{1F6E0}\u{FE0F}', pin: '1111', modules: ['repair'] },
    service: { label: 'Service', icon: '\u{1F4DE}', pin: '2222', modules: ['enquiry'] },
    admin:   { label: 'Admin',   icon: '\u{1F451}', pin: '2468', modules: ['repair', 'enquiry'] }
  },

  // --- Dropdown options (hardcoded — add/remove yahin se) ---
  DROPDOWNS: {
    repair: {
      BatteryType:  ['2 Wheeler Battery', '3 Wheeler Battery', 'Inverter Battery', 'Solar Battery', 'E-Rikshaw Battery', 'E Cycle Soft Pack', 'E Cycle Hard Pack', 'Other'],
      ChargerType:  ['Indian Charger', 'Chinese Charger', 'Other'],
      ReceivedMode: ['Dropped by Customer', 'Picked Up', 'Courier Received'],
      ProblemType:  ['Voltage Issue', 'Average Issue', 'Charger Issue', 'Connectivity / App Issue', 'Cell Issue', 'BMS Issue', 'Parameter / Calibration', 'Hardware Issue (Physical)', 'Inverter Issue', 'General Inquiry', 'Dispatch / Tracking', 'Internal / Handover', 'Battery Issue', 'Other'],
      ActualProblem:['No issue', 'Disbalance', 'Water damage', 'BMS fault', 'BMS + cell change', 'Dead cell', 'Low capacity', 'Seal opened', 'Series wire', 'Spot / laser issue', 'Output wire +ve , -ve', 'Thimble short / burnt', 'Transportation damage', 'Battery burnt (fire case)', 'Cells leak', 'Not repair / Rejected', 'Out of warranty'],
      RepairStatus: ['Repaired \u2014 Full', 'Repaired \u2014 Partial', 'Not Repairable', 'Replaced'],
      WarrantyClaim:['Claim Approved', 'Claim Rejected', 'Claim Pending', 'No Claim']
    },
    enquiry: {
      OEM:          ['Wariwo', 'Zelio', 'Urban', 'Other'],
      AttendedBy:   ['Sukhpal', 'Kuldeep'],
      EnquiryAbout: ['Service', 'Repairing', 'Sales', 'Technical Support', 'General Inquiry', 'Other'],
      Response:     ['Voltage Issue', 'Average Issue', 'Charger Issue', 'Connectivity / App Issue', 'Cell Issue', 'BMS Issue', 'Parameter / Calibration Issue', 'Hardware Issue (Wire / Connector)', 'Inverter Issue', 'General Inquiry', 'Dispatch / Tracking', 'Internal / Handover', 'Battery Issue', 'Other']
    }
  },

  CACHE_TTL_MS: 5 * 60 * 1000,
  JSONP_TIMEOUT_MS: 20000
};

/* ============================================================
   LITPAX SERVICE TRACKING — app.js
   Public page (no login): Ticket ID + Track Code (QR / WhatsApp link)
   or Ticket ID + last 4 digits of phone → timeline + feedback
   ============================================================ */

const $ = id => document.getElementById(id);
let _seq = 0;
let STATE = null; // { ticket, items, steps }

/* ---------- UTILS ---------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : String(s || '');
}
// "45" / "ltx-r-45" / "LTXR0045" → "LTX-R-0045"
function normId(v) {
  v = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = v.match(/^(?:LTX-?R-?)?0*(\d+)$/);
  if (!m) return v;
  const n = m[1];
  return 'LTX-R-' + (n.length < 4 ? ('0000' + n).slice(-4) : n);
}
function qtyText(b, c) {
  b = parseInt(b, 10) || 0; c = parseInt(c, 10) || 0;
  const a = [];
  if (b) a.push(b + ' batter' + (b === 1 ? 'y' : 'ies'));
  if (c) a.push(c + ' charger' + (c === 1 ? '' : 's'));
  return a.join(', ');
}

/* ---------- API (JSONP, no token) ---------- */
function api(params) {
  return new Promise((res, rej) => {
    const cb = '__trk' + (++_seq) + '_' + Date.now();
    const s = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => { if (!done) { cleanup(); rej('timeout'); } }, (CONFIG.JSONP_TIMEOUT_MS || 20000));
    function cleanup() { done = true; clearTimeout(timer); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
    window[cb] = d => { cleanup(); res(d); };
    s.onerror = () => { if (!done) { cleanup(); rej('network'); } };
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    s.src = CONFIG.API_URL + '?' + qs + '&callback=' + cb + '&t=' + Date.now();
    document.body.appendChild(s);
  });
}

/* ---------- BOOT ---------- */
window.addEventListener('load', () => {
  $('fCompany').textContent = '© ' + CONFIG.COMPANY;
  if (CONFIG.SUPPORT_PHONE) {
    $('fSupport').innerHTML = ' · Support: <a href="tel:' + esc(CONFIG.SUPPORT_PHONE) + '">' + esc(CONFIG.SUPPORT_PHONE) + '</a>';
  }
  // company name + support phone from the Settings tab of the sheet
  api({ action: 'getSite' }).then(r => {
    if (!r || !r.ok) return;
    if (r.company) $('fCompany').textContent = '© ' + r.company;
    $('fSupport').innerHTML = r.supportPhone ? ' · Support: <a href="tel:' + esc(r.supportPhone) + '">' + esc(r.supportPhone) + '</a>' : '';
  }).catch(() => {});
  if (CONFIG.TRACK_LOGO_URL) {
    const im = $('brandLogo');
    im.onload = () => { im.hidden = false; $('brandText').hidden = true; };
    im.src = CONFIG.TRACK_LOGO_URL;
  }

  const q = new URLSearchParams(location.search);
  const t = q.get('t') ? normId(q.get('t')) : '';
  const c = (q.get('c') || '').trim();
  if (t) $('inId').value = t;
  if (t && c) load({ ticketId: t, code: c }, q.get('fb') === '1');
  else (t ? $('inPh') : $('inId')).focus();
});

function showOnly(id) { ['lookup', 'loading', 'result'].forEach(k => { $(k).hidden = k !== id; }); }
function lkErr(m) { const e = $('lkErr'); e.textContent = m; e.hidden = false; }

function lookup() {
  const id = normId($('inId').value), ph = $('inPh').value.trim();
  $('lkErr').hidden = true;
  if (!/^LTX-R-\d+$/.test(id)) return lkErr('Enter a valid Ticket ID, e.g. LTX-R-0001');
  if (!/^\d{4}$/.test(ph)) return lkErr('Enter the last 4 digits of your phone number');
  $('inId').value = id;
  load({ ticketId: id, last4: ph }, false);
}

async function load(params, focusFb) {
  showOnly('loading');
  let r;
  try { r = await api(Object.assign({ action: 'getTracking' }, params)); }
  catch (e) { showOnly('lookup'); return lkErr('Network error — please check your connection and try again'); }
  if (!r || !r.ok) { showOnly('lookup'); return lkErr((r && r.msg) || 'Could not find this ticket'); }

  STATE = r;
  // keep a shareable link in the address bar (refresh-safe)
  try {
    const u = new URL(location.href);
    u.searchParams.set('t', r.ticket.id);
    if (r.ticket.trackCode) u.searchParams.set('c', r.ticket.trackCode);
    u.searchParams.delete('fb');
    history.replaceState(null, '', u);
  } catch (e) {}

  render();
  showOnly('result');
  if (focusFb && !$('fbCard').hidden) setTimeout(() => $('fbCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  else window.scrollTo(0, 0);
}

function resetLookup() {
  STATE = null; $('inPh').value = ''; $('lkErr').hidden = true;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  showOnly('lookup'); $('inId').focus();
}

/* ---------- RENDER ---------- */
const STATUS_PUBLIC = {
  'New':              ['Registered', 'blue'],
  'In Follow-up':     ['Service team in touch', 'amber'],
  'In Transit':       ['On the way to us', 'violet'],
  'Received':         ['Received', 'teal'],
  'In Repair':        ['Under repair', 'teal'],
  'Partial Dispatch': ['Partially dispatched', 'amber'],
  'Closed':           ['Completed', 'green'],
  'Cancelled':        ['Cancelled', 'gray']
};

function render() {
  const t = STATE.ticket, items = STATE.items || [];
  const solved = t.outcome === 'Solved on Call';
  const st = STATUS_PUBLIC[t.status] || [t.status || '—', 'blue'];
  $('rId').textContent = t.id;
  $('rStatus').textContent = solved ? 'Resolved on call' : st[0];
  $('rStatus').className = 'pill pill-' + (solved ? 'green' : st[1]);
  $('rCompany').textContent = t.company || '';
  $('rMeta').textContent = 'Registered on ' + fmtDate(t.createdAt);
  renderTimeline(t, items);
  renderItems(items);
  renderFeedback(t);
}

// s: 'done' | 'now' | ''
function buildSteps(t, items) {
  if (t.status === 'Cancelled') {
    return [
      { l: 'Complaint Registered', d: t.createdAt, s: 'done' },
      { l: 'Request Cancelled', d: t.closedAt, x: 'Please contact our service team if you still need help', s: 'done' }
    ];
  }
  if (t.outcome === 'Solved on Call') {
    return [
      { l: 'Complaint Registered', d: t.createdAt, s: 'done' },
      { l: 'Resolved on Call', d: t.closedAt, s: 'done' }
    ];
  }
  const total = items.length;
  const disp = items.filter(i => i.step === (STATE.steps || []).length - 1).length;
  const received = !!t.receivedDate;
  const closed = t.status === 'Closed';
  const shipKnown = !!t.pickupDate || t.batterySent === 'Yes';
  const shipLabel = t.pickupBy === 'Company' ? 'Pickup Arranged'
    : (t.pickupBy === 'Customer' || t.batterySent === 'Yes' ? 'Items Sent by You' : 'Pickup / Shipping');

  return [
    { l: 'Complaint Registered', d: t.createdAt, s: 'done' },
    {
      l: shipLabel, d: t.pickupDate,
      x: [t.pickupTransport && 'Transport: ' + t.pickupTransport, t.pickupLr && 'LR No: ' + t.pickupLr].filter(Boolean).join(' · ')
        || (!shipKnown && !received ? 'Our service team will contact you for pickup details' : ''),
      s: received ? 'done' : (shipKnown ? 'now' : '')
    },
    {
      l: 'Received at Service Center', d: t.receivedDate,
      x: received ? qtyText(t.batteryQty, t.chargerQty) : '',
      s: received ? 'done' : ''
    },
    {
      l: 'Inspection & Repair', d: '',
      x: received && total && disp < total ? (total - disp) + ' of ' + total + ' item(s) in progress' : '',
      s: !received ? '' : (closed || (total && disp === total) ? 'done' : 'now')
    },
    {
      l: disp && disp < total ? 'Partially Dispatched' : 'Dispatched', d: closed ? t.closedAt : '',
      x: disp ? disp + ' of ' + total + ' item(s) dispatched' : '',
      s: closed ? 'done' : (disp ? 'now' : '')
    }
  ];
}

function renderTimeline(t, items) {
  $('timeline').innerHTML = buildSteps(t, items).map(s =>
    '<li class="tl ' + s.s + '"><span class="tl-dot"></span><div class="tl-body">' +
      '<div class="tl-head"><span class="tl-label">' + esc(s.l) + '</span>' +
        (s.d ? '<span class="tl-date">' + esc(fmtDate(s.d)) + '</span>' : '') + '</div>' +
      (s.x ? '<div class="tl-x">' + esc(s.x) + '</div>' : '') +
    '</div></li>'
  ).join('');
}

function renderItems(items) {
  const repl = (STATE.replacements || []);
  if (!items.length && !repl.length) { $('itemsCard').hidden = true; return; }
  const steps = STATE.steps || [], last = steps.length - 1, cnt = {};
  $('itemsCard').hidden = false;
  // new batteries sent as replacement (may go out before the old one reaches us)
  const rHtml = repl.map((r, i) => '<div class="item repl' + (r.sent ? ' done' : '') + '">' +
    '<div class="it-top"><span class="it-name">🔁 Replacement battery' + (repl.length > 1 ? ' #' + (i + 1) : '') + '</span>' +
      '<span class="it-stage">' + (r.sent ? 'Dispatched' : 'Being arranged') + '</span></div>' +
    (r.model ? '<div class="it-desc">' + esc(r.model) + '</div>' : '') +
    (r.sent ? '<div class="it-disp">Dispatched ' + esc(fmtDate(r.dispatchDate)) + (r.transport ? ' · ' + esc(r.transport) : '') + (r.lr ? ' · LR ' + esc(r.lr) : '') + '</div>' : '') +
    (r.sent && !r.oldReceived ? '<div class="it-note">Please send your old battery back — our team will arrange the pickup.</div>' : '') +
  '</div>').join('');
  $('items').innerHTML = rHtml + items.map(it => {
    const isChg = /charg/i.test(it.type || ''), k = isChg ? 'Charger' : 'Battery';
    cnt[k] = (cnt[k] || 0) + 1;
    const done = it.step === last;
    const desc = [it.category, it.model].filter(Boolean).join(' · ');
    return '<div class="item' + (done ? ' done' : '') + '">' +
      '<div class="it-top"><span class="it-name">' + (isChg ? '⚡ ' : '🔋 ') + k + ' #' + cnt[k] + (it.exchanged ? ' (old)' : '') + '</span>' +
        '<span class="it-stage">' + esc(it.label) + '</span></div>' +
      (desc ? '<div class="it-desc">' + esc(desc) + '</div>' : '') +
      (it.exchanged ? '' : '<div class="it-steps">' + steps.map((s, i) =>
        '<span class="' + (i < it.step ? 'p' : (i === it.step ? 'c' : '')) + '" title="' + esc(s) + '"></span>').join('') + '</div>' +
      '<div class="it-step-lbl">Step ' + (it.step + 1) + ' of ' + steps.length + '</div>') +
      (done && !it.exchanged ? '<div class="it-disp">Dispatched ' + esc(fmtDate(it.dispatchDate)) + (it.transport ? ' · ' + esc(it.transport) : '') + '</div>' : '') +
    '</div>';
  }).join('');
}

/* ---------- FEEDBACK ---------- */
let fbRating = 0, fbSolved = '';
const STAR_LBL = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];
const starStr = n => '★★★★★'.slice(0, n) + '<span class="off">' + '★★★★★'.slice(n) + '</span>';

function renderFeedback(t) {
  const c = $('fbCard');
  if (t.rating) {
    c.hidden = false;
    c.innerHTML = '<div class="card-title">Your feedback</div>' +
      '<div class="fb-done"><div class="stars big">' + starStr(parseInt(t.rating, 10) || 0) + '</div>' +
      '<div>Thank you for your feedback!</div></div>';
    return;
  }
  if (!t.canFeedback) { c.hidden = true; return; }

  fbRating = 0; fbSolved = '';
  c.hidden = false;
  c.innerHTML =
    '<div class="card-title">How was our service?</div>' +
    '<p class="sub">Your feedback helps us improve. It takes less than a minute.</p>' +
    '<div class="star-pick" id="starPick">' + [1, 2, 3, 4, 5].map(n =>
      '<button type="button" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '" data-n="' + n + '" onclick="pickStar(' + n + ')">★</button>').join('') + '</div>' +
    '<div id="starLbl" class="star-lbl">Tap a star to rate</div>' +
    '<div class="field"><label>Is your problem solved?</label><div class="seg" id="fbSolved">' +
      '<button type="button" data-v="Yes" onclick="pickSolved(this)">👍 Yes</button>' +
      '<button type="button" data-v="No" onclick="pickSolved(this)">👎 No</button></div></div>' +
    '<div class="field"><label for="fbComment">Anything else? (optional)</label>' +
      '<textarea id="fbComment" maxlength="500" placeholder="Tell us what went well, or what we can do better"></textarea></div>' +
    '<button id="fbBtn" class="btn btn-primary btn-block" onclick="fbSubmit()">Submit feedback</button>';
}

function pickStar(n) {
  fbRating = n;
  document.querySelectorAll('#starPick button').forEach(b => b.classList.toggle('on', +b.dataset.n <= n));
  $('starLbl').textContent = STAR_LBL[n];
}
function pickSolved(btn) {
  fbSolved = btn.dataset.v;
  document.querySelectorAll('#fbSolved button').forEach(b => b.classList.toggle('on', b === btn));
}

async function fbSubmit() {
  if (!fbRating) return toast('Please select a star rating');
  if (!fbSolved) return toast('Please tell us if your problem is solved');
  const btn = $('fbBtn');
  btn.disabled = true; btn.textContent = 'Submitting...';
  const reset = () => { btn.disabled = false; btn.textContent = 'Submit feedback'; };
  let r;
  try {
    r = await api({
      action: 'submitFeedback', ticketId: STATE.ticket.id, code: STATE.ticket.trackCode,
      rating: fbRating, solved: fbSolved, comment: $('fbComment').value.trim()
    });
  } catch (e) { reset(); return toast('Network error — please try again'); }
  if (!r || !r.ok) { reset(); return toast((r && r.msg) || 'Could not submit feedback'); }
  STATE.ticket.rating = fbRating; STATE.ticket.canFeedback = false;
  renderFeedback(STATE.ticket);
  toast('Thank you for your feedback!');
}

/* ============================================================
   HELP BOT — rule-based assistant (no AI, no API key)
   Everything is answered INSIDE the chat (status card, items, dispatch, pickup, expected date,
   call-back, feedback). The page behind is not changed unless the customer taps "Open full details".
   English + हिंदी.
   ============================================================ */
const BOT = { open: false, lang: 'en', step: '', fails: 0, cred: null, data: null, site: null, cbSlot: '', started: false, pendingId: '' };
const SLOTS = ['Morning (10 AM – 1 PM)', 'Afternoon (1 – 4 PM)', 'Evening (4 – 7 PM)', 'Anytime'];
const BI = {   // Lucide-style icons
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  status: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  items: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  swap: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  repl: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'
};
const bi = (k, c) => '<svg class="bi' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (BI[k] || '') + '</svg>';

const T = {
  en: {
    title: 'Litpax Assistant', sub: 'Online · replies instantly', ph: 'Type your message…',
    hello: 'Hi! I can tell you where your battery is, when it will be dispatched, and arrange a call back.',
    askId: 'Please type your <b>Ticket ID</b>, e.g. <b>LTX-R-0012</b> (or just <b>12</b>). It is on your receiving slip and in our WhatsApp message.',
    askIdTip: 'Tip: you can send the ID and the last 4 digits of your phone together, e.g. <b>12 9876</b>.',
    askPh: id => 'Thanks. To confirm it is you, type the <b>last 4 digits</b> of the phone number given for <b>' + id + '</b>.',
    badId: 'That doesn\'t look like a Ticket ID. It looks like <b>LTX-R-0012</b>, or just type the number, e.g. <b>12</b>.',
    badPh: 'Please type the last <b>4 digits</b> of your phone number (only numbers).',
    notFound: 'I couldn\'t find a ticket with these details. Please check the Ticket ID and the phone digits.',
    verified: 'Here is your service status:',
    noId: 'No problem. The Ticket ID is on the receiving slip and in the WhatsApp message we sent. You can also ask us to call you.',
    menu: 'What else would you like to know?',
    chips: { status: 'Status', items: 'My items', dispatch: 'Dispatch details', eta: 'When will I get it?', pickup: 'Pickup', callback: 'Call me back',
      feedback: 'Give feedback', other: 'Another ticket', noid: 'I don\'t have the Ticket ID', talk: 'Talk to us', page: 'Open full details', menu: 'Menu', skip: 'Skip' },
    lbl: { reg: 'Registered', items: 'Items', eta: 'Expected dispatch', done: 'Completed', disp: 'Dispatched', pickup: 'Pickup', trans: 'Transport', lr: 'LR No', now: 'Now', step: 'Step' },
    itemsHead: n => 'We have <b>' + n + '</b> item' + (n === 1 ? '' : 's') + ' from you:',
    noItems: 'We haven\'t received any items yet.',
    notDisp: n => 'Nothing has been dispatched yet. ' + n + ' item' + (n === 1 ? ' is' : 's are') + ' with us:',
    dispHead: 'Dispatched to you:', dispMore: n => n + ' more item' + (n === 1 ? ' is' : 's are') + ' still with us.',
    allDone: 'All your items have been dispatched.',
    replSent: 'Your <b>replacement battery</b> has been dispatched:',
    etaClosed: 'Your service is complete.',
    etaWait: 'We\'ll give you a date as soon as your items reach us.',
    etaDate: d => 'Expected dispatch around <b>' + d + '</b> (approx.).',
    etaLate: 'It is taking a little longer than usual. I can ask our team to call you with an exact date.',
    pickupNone: 'No pickup has been arranged yet. Our service team will call you to arrange it.',
    pickupBy: { Company: 'Our team will collect the items', Customer: 'You are sending the items yourself' },
    cbAsk: 'Sure. When should we call you?',
    cbMsg: 'Anything you\'d like us to know? (optional, or tap Skip)',
    cbDone: (id, s) => 'Done. Request <b>' + id + '</b> is with our service team. We\'ll call you <b>' + s + '</b>.',
    cbAlready: (id, s) => 'You already have a call-back request (<b>' + id + '</b>, ' + s + '). Our team will call you soon.',
    cbFail: 'Sorry, I couldn\'t register that. Please call us instead.',
    fbOpen: 'Thank you! Tap below to rate our service.',
    fbDone: r => 'You already rated us <b>' + r + '/5</b>. Thank you!',
    fbLater: 'Feedback opens once your items are dispatched.',
    talk: p => p ? 'You can call us on <a href="tel:' + p + '"><b>' + p + '</b></a>, or I can ask our team to call you.' : 'I can ask our team to call you.',
    newComplaint: p => 'To register a new complaint, please call us' + (p ? ' on <a href="tel:' + p + '"><b>' + p + '</b></a>' : '') + '.',
    thanks: 'You\'re welcome! Anything else?',
    dunno: 'Sorry, I didn\'t get that. You can pick one of these:',
    dunno2: 'I may not be able to answer that. Shall I ask our team to call you?',
    tooMany: 'Too many attempts. Please try again after some time, or ask us to call you.',
    netErr: 'I couldn\'t connect. Please check your internet and try again.',
    stepNames: ['Received', 'Under inspection', 'Under repair', 'Testing', 'Ready for dispatch', 'Dispatched'],
    status: { 'Registered': 'Registered', 'Service team in touch': 'Service team in touch', 'On the way to us': 'On the way to us', 'Received': 'Received',
      'Under repair': 'Under repair', 'Partially dispatched': 'Partially dispatched', 'Completed': 'Completed', 'Cancelled': 'Cancelled', 'Resolved on call': 'Resolved on call' },
    flow: ['Registered', 'Pickup', 'Received', 'Repair', 'Dispatched'],
    battery: 'Battery', charger: 'Charger', exchanged: 'exchanged', newBattery: 'New battery'
  },
  hi: {
    title: 'Litpax सहायक', sub: 'ऑनलाइन · तुरंत जवाब', ph: 'मैसेज लिखें…',
    hello: 'नमस्ते! मैं बता सकता हूँ आपकी बैटरी कहाँ है, कब भेजी जाएगी, और कॉल-बैक भी लगवा सकता हूँ।',
    askId: 'कृपया अपना <b>Ticket ID</b> लिखें, जैसे <b>LTX-R-0012</b> (या सिर्फ़ <b>12</b>)। यह रसीद पर और हमारे WhatsApp मैसेज में मिलेगा।',
    askIdTip: 'आप ID और फ़ोन के आख़िरी 4 अंक एक साथ भी लिख सकते हैं, जैसे <b>12 9876</b>।',
    askPh: id => 'धन्यवाद। पुष्टि के लिए <b>' + id + '</b> में दिए फ़ोन नंबर के <b>आख़िरी 4 अंक</b> लिखें।',
    badId: 'यह Ticket ID नहीं लग रहा। यह <b>LTX-R-0012</b> जैसा होता है, या सिर्फ़ नंबर लिखें, जैसे <b>12</b>।',
    badPh: 'कृपया फ़ोन नंबर के आख़िरी <b>4 अंक</b> लिखें (सिर्फ़ नंबर)।',
    notFound: 'इन जानकारियों से कोई टिकट नहीं मिला। कृपया Ticket ID और फ़ोन के अंक जाँच लें।',
    verified: 'आपकी सर्विस का स्टेटस:',
    noId: 'कोई बात नहीं। Ticket ID रसीद पर और हमारे WhatsApp मैसेज में होता है। आप हमें कॉल करने के लिए भी कह सकते हैं।',
    menu: 'और क्या जानना चाहेंगे?',
    chips: { status: 'स्टेटस', items: 'मेरे आइटम', dispatch: 'डिस्पैच', eta: 'कब मिलेगा?', pickup: 'पिकअप', callback: 'मुझे कॉल करें',
      feedback: 'फ़ीडबैक दें', other: 'दूसरा टिकट', noid: 'Ticket ID नहीं है', talk: 'बात करें', page: 'पूरी जानकारी देखें', menu: 'मेन्यू', skip: 'Skip' },
    lbl: { reg: 'दर्ज', items: 'आइटम', eta: 'अनुमानित डिस्पैच', done: 'पूरा', disp: 'डिस्पैच', pickup: 'पिकअप', trans: 'ट्रांसपोर्ट', lr: 'LR No', now: 'अभी', step: 'स्टेप' },
    itemsHead: n => 'आपके <b>' + n + '</b> आइटम हमारे पास हैं:',
    noItems: 'अभी तक कोई आइटम हमारे पास नहीं पहुँचा।',
    notDisp: n => 'अभी कुछ भी डिस्पैच नहीं हुआ। ' + n + ' आइटम हमारे पास हैं:',
    dispHead: 'आपको भेजा गया:', dispMore: n => n + ' आइटम अभी हमारे पास हैं।',
    allDone: 'आपके सभी आइटम भेज दिए गए हैं।',
    replSent: 'आपकी <b>नई (रिप्लेसमेंट) बैटरी</b> भेज दी गई है:',
    etaClosed: 'आपकी सर्विस पूरी हो गई है।',
    etaWait: 'आइटम हमारे पास पहुँचते ही हम तारीख़ बता देंगे।',
    etaDate: d => 'लगभग <b>' + d + '</b> तक डिस्पैच होने की उम्मीद है।',
    etaLate: 'थोड़ा ज़्यादा समय लग रहा है। मैं टीम से कहकर आपको सही तारीख़ के लिए कॉल करवा सकता हूँ।',
    pickupNone: 'अभी पिकअप तय नहीं हुआ है। सर्विस टीम आपको कॉल करके तय करेगी।',
    pickupBy: { Company: 'हमारी टीम आइटम लेकर आएगी', Customer: 'आप ख़ुद आइटम भेज रहे हैं' },
    cbAsk: 'ज़रूर। आपको कब कॉल करें?',
    cbMsg: 'कुछ बताना चाहें? (वैकल्पिक, या Skip दबाएँ)',
    cbDone: (id, s) => 'हो गया। रिक्वेस्ट <b>' + id + '</b> सर्विस टीम को मिल गई है। हम आपको <b>' + s + '</b> कॉल करेंगे।',
    cbAlready: (id, s) => 'आपकी कॉल-बैक रिक्वेस्ट पहले से है (<b>' + id + '</b>, ' + s + ')। टीम जल्द कॉल करेगी।',
    cbFail: 'माफ़ कीजिए, रिक्वेस्ट दर्ज नहीं हो पाई। कृपया हमें कॉल करें।',
    fbOpen: 'धन्यवाद! नीचे टैप करके हमारी सर्विस को रेट करें।',
    fbDone: r => 'आप पहले ही <b>' + r + '/5</b> रेटिंग दे चुके हैं। धन्यवाद!',
    fbLater: 'आइटम डिस्पैच होने के बाद फ़ीडबैक दे सकते हैं।',
    talk: p => p ? 'हमें <a href="tel:' + p + '"><b>' + p + '</b></a> पर कॉल करें, या मैं टीम से आपको कॉल करवा सकता हूँ।' : 'मैं टीम से आपको कॉल करवा सकता हूँ।',
    newComplaint: p => 'नई शिकायत दर्ज करने के लिए कृपया हमें कॉल करें' + (p ? ', <a href="tel:' + p + '"><b>' + p + '</b></a>' : '') + '।',
    thanks: 'आपका स्वागत है! और कुछ?',
    dunno: 'माफ़ कीजिए, समझ नहीं पाया। इनमें से चुन सकते हैं:',
    dunno2: 'शायद मैं इसका जवाब न दे पाऊँ। क्या टीम से आपको कॉल करवा दूँ?',
    tooMany: 'बहुत ज़्यादा कोशिशें हो गईं। थोड़ी देर बाद फिर कोशिश करें, या हमें कॉल करने को कहें।',
    netErr: 'कनेक्ट नहीं हो पाया। कृपया इंटरनेट जाँचकर फिर कोशिश करें।',
    stepNames: ['प्राप्त', 'जाँच में', 'रिपेयर में', 'टेस्टिंग में', 'डिस्पैच के लिए तैयार', 'डिस्पैच हो गया'],
    status: { 'Registered': 'दर्ज', 'Service team in touch': 'सर्विस टीम संपर्क में', 'On the way to us': 'हमारे पास आ रहा है', 'Received': 'प्राप्त',
      'Under repair': 'रिपेयर में', 'Partially dispatched': 'आंशिक डिस्पैच', 'Completed': 'पूरा', 'Cancelled': 'रद्द', 'Resolved on call': 'कॉल पर हल' },
    flow: ['दर्ज', 'पिकअप', 'प्राप्त', 'रिपेयर', 'डिस्पैच'],
    battery: 'बैटरी', charger: 'चार्जर', exchanged: 'बदली गई', newBattery: 'नई बैटरी'
  }
};
const L = () => T[BOT.lang];

// keyword → intent (English, Hinglish, हिंदी)
const INTENTS = [
  ['thanks', /\b(thanks?|thank you|thx|ty|shukriya|dhanyavaad|dhanyawad)\b|धन्यवाद|शुक्रिया/i],
  ['newComplaint', /\b(new complaint|naya complaint|nayi complaint|new ticket|naya ticket|register)\b|नई शिकायत/i],
  ['callback', /\b(call ?back|call me|callback|phone (me|kar|karo)|call kar|call karo|call krna|baat kar|baat karni|baat krni|contact me)\b|कॉल|फ़ोन करो|बात कर/i],
  ['feedback', /\b(feedback|rating|rate|review)\b|फ़ीडबैक|रेटिंग/i],
  ['pickup', /\b(pick ?up|uthaya|uthana|uthayenge|collect|le jao|le jaenge)\b|पिकअप/i],
  ['dispatch', /\b(dispatch|dispatched|bhej|bheja|bheji|bhejo|bhejenge|sent|send|courier|transport|lr|docket|tracking no|delivery|deliver)\b|भेज|डिस्पैच|कूरियर/i],
  ['eta', /\b(when|kab|kitne din|how long|eta|date|time lagega|kab tak|kab milegi|kab milega|kab aayegi|kab aaega)\b|कब|कितने दिन/i],
  ['items', /\b(items?|battery|batteries|batteri|charger|kitni|how many|serial)\b|बैटरी|चार्जर|आइटम/i],
  ['page', /\b(full details|details|page|timeline|poori jankari|puri jankari)\b|पूरी जानकारी/i],
  ['talk', /\b(human|agent|insaan|person|support|helpline|number|customer care)\b|इंसान|नंबर/i],
  ['status', /\b(status|where|kahan|kaha|update|progress|kya hua|stage|repair|theek hui|thik hui)\b|स्टेटस|कहाँ|कहां|क्या हुआ/i],
  ['hello', /\b(hi|hello|hey|namaste|namaskar|hii+|helo)\b|नमस्ते|नमस्कार/i],
  ['other', /\b(another|other|dusra|doosra|new id|change ticket)\b|दूसरा/i],
  ['menu', /\b(menu|options|help)\b|मेन्यू/i]
];
const intentOf = s => { for (const [k, re] of INTENTS) if (re.test(s)) return k; return ''; };
// "LTX-R-12", "ltxr0012", "R-12" → normalised ID
const ID_RE = /(?:\bLTX[\s-]*R|\bR)[\s-]*0*(\d{1,6})\b/;
const idIn = s => { const m = String(s).toUpperCase().match(ID_RE); return m ? normId(m[1]) : ''; };
// read ID + last 4 digits from one message ("12 9876", "LTX-R-0012, 9876543210")
function parseCred(s) {
  const txt = String(s);
  let id = idIn(txt), rest = txt;
  if (id) rest = txt.toUpperCase().replace(ID_RE, ' ');
  const nums = (rest.match(/\d+/g) || []);
  if (!id) {
    const first = nums.find(n => n.length <= 6 && !(nums.length > 1 && n.length === 4 && nums.indexOf(n) === nums.length - 1));
    if (first && (nums.length > 1 || /^\s*\d{1,6}\s*$/.test(txt))) { id = normId(first); nums.splice(nums.indexOf(first), 1); }
  }
  const ph = nums.find(n => n.length === 4 || n.length >= 10);
  return { id, last4: ph ? ph.slice(-4) : '' };
}

/* ---------- data (the bot keeps its own copy) ---------- */
const D = () => BOT.data || (STATE && STATE.ticket ? STATE : null);
function botPublicStatus(t) {
  const solved = t.outcome === 'Solved on Call';
  const st = solved ? ['Resolved on call', 'green'] : (STATUS_PUBLIC[t.status] || [t.status || '—', 'blue']);
  return { label: L().status[st[0]] || st[0], tone: st[1] };
}

/* ---------- UI ---------- */
function botBoot() {
  if ($('botFab')) return;
  const w = document.createElement('div');
  w.innerHTML =
    '<button id="botFab" class="bot-fab" onclick="botToggle()" aria-label="Open help chat">' + bi('chat') + '<span class="bot-fab-txt">Need help?</span></button>' +
    '<section id="bot" class="bot" hidden role="dialog" aria-label="Help chat">' +
      '<header class="bot-head"><div class="bot-av">L<i></i></div><div class="bot-hd"><b id="botTitle"></b><span id="botSub"></span></div>' +
        '<div class="bot-lang" role="group" aria-label="Language"><button type="button" data-l="en" onclick="botLang(\'en\')">EN</button><button type="button" data-l="hi" onclick="botLang(\'hi\')">हिं</button></div>' +
        '<button class="bot-x" onclick="botToggle(false)" aria-label="Close">' + bi('x') + '</button></header>' +
      '<div id="botLog" class="bot-log" aria-live="polite"></div>' +
      '<div id="botChips" class="bot-chips"></div>' +
      '<form class="bot-in" onsubmit="botSend(event)"><input id="botInput" autocomplete="off" maxlength="300" aria-label="Message">' +
        '<button type="submit" aria-label="Send">' + bi('send') + '</button></form>' +
    '</section>';
  document.body.appendChild(w);
  api({ action: 'getSite' }).then(r => { if (r && r.ok) BOT.site = r; }).catch(() => {});
  setTimeout(() => { const f = $('botFab'); if (f && !BOT.open) f.classList.add('peek'); }, 1200);
}
function botToggle(force) {
  BOT.open = typeof force === 'boolean' ? force : !BOT.open;
  $('bot').hidden = !BOT.open; $('botFab').classList.toggle('on', BOT.open); $('botFab').classList.remove('peek');
  document.body.classList.toggle('bot-open', BOT.open);
  if (BOT.open && !BOT.started) { BOT.started = true; botHeader(); botStart(); }
  if (BOT.open && window.innerWidth > 520) setTimeout(() => $('botInput').focus(), 50);
}
function botHeader() {
  $('botTitle').textContent = L().title; $('botSub').textContent = L().sub; $('botInput').placeholder = L().ph;
  document.querySelectorAll('.bot-lang button').forEach(b => b.classList.toggle('on', b.dataset.l === BOT.lang));
}
function botLang(l) { if (l === BOT.lang) return; BOT.lang = l; botHeader(); botSay(L().menu, botMenu); }
function botScroll() { const g = $('botLog'); g.scrollTop = g.scrollHeight; }
function botAdd(html, who, cls) {
  const d = document.createElement('div');
  d.className = 'bot-msg b-' + (who || 'bot') + (cls ? ' ' + cls : '');
  d.innerHTML = html;
  $('botLog').appendChild(d); botScroll();
  return d;
}
// "typing…" then the message (short, natural delay); cls 'card' for status / item cards
function botSay(html, cb, cls) {
  const ty = botAdd('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
  setTimeout(() => { ty.innerHTML = html; if (cls) ty.classList.add(cls); botScroll(); cb && cb(); }, 300 + Math.min(String(html).replace(/<[^>]+>/g, '').length * 4, 500));
}
function botChips(list) {
  $('botChips').innerHTML = list.map(([k, label, ico]) => '<button type="button" data-k="' + esc(k) + '" onclick="botChip(this)">' + (ico ? bi(ico) : '') + '<span>' + label + '</span></button>').join('');
  $('botChips').scrollLeft = 0;
}
function botChip(el) { const k = el.dataset.k; botAdd(esc(el.textContent), 'me'); $('botChips').innerHTML = ''; botAct(k); }
function botMenu() {
  const c = L().chips, d = D();
  if (!d) return botChips([['noid', c.noid, 'help'], ['talk', c.talk, 'phone']]);
  const t = d.ticket, list = [['status', c.status, 'status'], ['items', c.items, 'items'], ['dispatch', c.dispatch, 'truck'], ['eta', c.eta, 'clock']];
  if (t.pickupBy || t.status === 'In Transit') list.push(['pickup', c.pickup, 'pin']);
  list.push(['callback', c.callback, 'phone']);
  if (t.canFeedback || t.rating) list.push(['feedback', c.feedback, 'star']);
  list.push(['page', c.page, 'open'], ['other', c.other, 'swap']);
  botChips(list);
}

/* ---------- cards (rendered inside the chat) ---------- */
function botFlow(t, items) {
  // 0 registered · 1 pickup · 2 received · 3 repair · 4 dispatched
  const steps = (D() && D().steps) || [], last = steps.length - 1;
  const disp = items.filter(i => i.step === last).length;
  let at = 0;
  if (t.pickupDate || t.batterySent === 'Yes' || t.status === 'In Transit') at = 1;
  if (t.receivedDate) at = 2;
  if (t.receivedDate && items.some(i => i.step > 0)) at = 3;
  if (disp) at = 4;
  const done = t.status === 'Closed';
  return { at, done };
}
function botEta(t, items) {
  if (t.status === 'Closed' || t.status === 'Cancelled') return { kind: 'closed' };
  const s = (BOT.site && BOT.site.sla) || {}, rest = (s.queue || 24) + (s.repair || 72) + (s.dispatch || 24);
  let due = null;
  if (t.receivedDate) due = addHours(t.receivedDate, rest);
  else if (t.pickupDate) due = addHours(t.pickupDate, (s.transit || 72) + rest);
  if (!due) return { kind: 'wait' };
  const ds = due.getFullYear() + '-' + ('0' + (due.getMonth() + 1)).slice(-2) + '-' + ('0' + due.getDate()).slice(-2);
  return { kind: due.getTime() < Date.now() ? 'late' : 'date', date: fmtDate(ds) };
}
function addHours(dateStr, h) { const d = new Date(String(dateStr).substring(0, 10) + 'T10:00:00'); d.setHours(d.getHours() + h); return d; }
const stepName = i => L().stepNames[i] || '';
function itemsLine(items) {
  const b = items.filter(i => !/charg/i.test(i.type || '')).length, c = items.length - b;
  return [b && b + ' ' + L().battery.toLowerCase() + (b > 1 && BOT.lang === 'en' ? 's' : ''), c && c + ' ' + L().charger.toLowerCase() + (c > 1 && BOT.lang === 'en' ? 's' : '')].filter(Boolean).join(' · ');
}
function botStatusCard() {
  const d = D(), t = d.ticket, items = d.items || [], c = L(), st = botPublicStatus(t);
  const steps = d.steps || [], last = steps.length - 1, disp = items.filter(i => i.step === last).length;
  const f = botFlow(t, items), eta = botEta(t, items);
  const flow = t.status === 'Cancelled' || t.outcome === 'Solved on Call' ? '' :
    '<div class="bc-flow">' + c.flow.map((s, i) => '<div class="' + (f.done || i < f.at ? 'p' : i === f.at ? 'c' : '') + '"><i></i><span>' + esc(s) + '</span></div>').join('') + '</div>';
  const rows = [[c.lbl.reg, fmtDate(t.createdAt)]];
  if (items.length) rows.push([c.lbl.items, itemsLine(items) + (disp ? ' · ' + disp + '/' + items.length + ' ' + c.lbl.disp.toLowerCase() : '')]);
  if (eta.kind === 'date') rows.push([c.lbl.eta, '~ ' + eta.date]);
  if (t.status === 'Closed' && t.closedAt) rows.push([c.lbl.done, fmtDate(t.closedAt)]);
  return '<div class="bc"><div class="bc-top"><span class="bc-id">' + esc(t.id) + '</span><span class="pill pill-' + st.tone + '">' + esc(st.label) + '</span></div>' +
    (t.company ? '<div class="bc-co">' + esc(t.company) + '</div>' : '') + flow +
    '<dl class="bc-dl">' + rows.map(r => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl></div>';
}
function botItemRow(i, n, total) {
  const ch = /charg/i.test(i.type || ''), steps = (D().steps || []), last = steps.length - 1;
  const desc = [i.category, i.model].filter(Boolean).join(' · ');
  return '<li class="bc-it' + (i.step === last ? ' done' : '') + '">' + bi(ch ? 'bolt' : 'items') +
    '<div><b>' + (ch ? L().charger : L().battery) + ' ' + n + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : '') +
    (i.exchanged ? '' : '<span class="bc-bar"><i style="width:' + Math.round((i.step + 1) / (last + 1) * 100) + '%"></i></span>') + '</div>' +
    '<span class="bc-st">' + esc(i.exchanged ? (BOT.lang === 'hi' ? L().exchanged : i.label) : stepName(i.step)) + '</span></li>';
}
function botItemsCard(list) {
  const cnt = {};
  return '<ul class="bc-items">' + list.map(i => { const k = /charg/i.test(i.type || '') ? 'c' : 'b'; cnt[k] = (cnt[k] || 0) + 1; return botItemRow(i, '#' + cnt[k]); }).join('') + '</ul>';
}

/* ---------- conversation ---------- */
function botStart() {
  botSay(L().hello, () => {
    if (D()) { BOT.cred = BOT.cred || botCredFromPage(); botSay(L().verified, () => botSay(botStatusCard(), botMenu, 'card')); }
    else { BOT.step = 'id'; botSay(L().askId, () => botSay(L().askIdTip, botMenu)); }
  });
}
function botCredFromPage() {
  const q = new URLSearchParams(location.search), t = D().ticket;
  if (t.trackCode) return { ticketId: t.id, code: t.trackCode };
  return { ticketId: t.id, last4: q.get('l4') || '' };
}
function botSend(e) {
  e.preventDefault();
  const v = $('botInput').value.trim();
  if (!v) return;
  $('botInput').value = ''; $('botChips').innerHTML = '';
  botAdd(esc(v), 'me');
  botText(v);
}
function botText(v) {
  const c = L();
  if (BOT.step === 'id') {
    const p = parseCred(v);
    if (p.id && p.last4) return botVerify({ ticketId: p.id, last4: p.last4 });
    if (p.id) { BOT.pendingId = p.id; BOT.step = 'ph'; return botSay(c.askPh(esc(p.id))); }
    const it = intentOf(v);
    if (it === 'talk' || it === 'callback' || it === 'newComplaint' || it === 'thanks' || it === 'hello') return botAct(it === 'callback' ? 'talk' : it);
    return botSay(c.badId, botMenu);
  }
  if (BOT.step === 'ph') {
    const p = parseCred(v), digits = v.replace(/\D/g, '');
    if (p.id && p.id !== BOT.pendingId && p.last4) return botVerify({ ticketId: p.id, last4: p.last4 });
    if (digits.length === 4 || digits.length >= 10) return botVerify({ ticketId: BOT.pendingId, last4: digits.slice(-4) });
    const it = intentOf(v);
    if (it === 'other') return botAct('other');
    return botSay(c.badPh);
  }
  if (BOT.step === 'cbmsg') return botCallback(v);
  // a Ticket ID typed any time → switch to that ticket
  const p = parseCred(v), d = D();
  if (idIn(v) && (!d || d.ticket.id !== p.id)) {
    if (p.last4) return botVerify({ ticketId: p.id, last4: p.last4 });
    BOT.pendingId = p.id; BOT.step = 'ph'; return botSay(c.askPh(esc(p.id)));
  }
  const it = intentOf(v);
  if (!it) {
    BOT.fails++;
    if (BOT.fails >= 2) { BOT.fails = 0; return botSay(c.dunno2, () => botChips([['callback', c.chips.callback, 'phone'], ['talk', c.chips.talk, 'help'], ['menu', c.chips.menu, 'menu']])); }
    return botSay(c.dunno, botMenu);
  }
  BOT.fails = 0;
  botAct(it);
}
async function botVerify(cred) {
  BOT.step = '';
  const wait = botAdd('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
  let r, net = false;
  try { r = await api(Object.assign({ action: 'getTracking' }, cred)); } catch (e) { r = null; net = true; }
  wait.remove();
  if (!r || !r.ok) {
    BOT.step = 'id';
    if (net) return botSay(L().netErr, botMenu);
    if (r && /too many/i.test(r.msg || '')) return botSay(L().tooMany, () => botChips([['talk', L().chips.talk, 'phone']]));
    return botSay(L().notFound, () => botSay(L().askId, botMenu));
  }
  BOT.cred = cred; BOT.data = r;           // the bot's own copy — the page behind stays as it is
  botSay(L().verified, () => botSay(botStatusCard(), botMenu, 'card'));
}

function botAct(k) {
  const c = L(), d = D(), t = d && d.ticket, items = (d && d.items) || [];
  if (d && !BOT.cred) BOT.cred = botCredFromPage();
  if (k === 'menu' || k === 'hello') return botSay(d ? c.menu : c.askId, botMenu);
  if (k === 'thanks') return botSay(c.thanks, botMenu);
  if (k === 'noid') return botSay(c.noId, () => botChips([['talk', c.chips.talk, 'phone']]));
  if (k === 'talk') return botSay(c.talk(botPhone()), () => botChips(t ? [['callback', c.chips.callback, 'phone'], ['menu', c.chips.menu, 'menu']] : [['menu', c.chips.menu, 'menu']]));
  if (k === 'newComplaint') return botSay(c.newComplaint(botPhone()), botMenu);
  if (k === 'other') { BOT.cred = null; BOT.data = null; BOT.step = 'id'; return botSay(c.askId, () => botSay(c.askIdTip, botMenu)); }
  if (!t) { BOT.step = 'id'; return botSay(c.askId); }

  if (k === 'status') return botSay(botStatusCard(), botMenu, 'card');
  if (k === 'page') {   // show the same ticket on the page (timeline, items, feedback form)
    STATE = d; render(); showOnly('result'); botToggle(false); window.scrollTo(0, 0);
    try { const u = new URL(location.href); u.searchParams.set('t', t.id); if (t.trackCode) u.searchParams.set('c', t.trackCode); history.replaceState(null, '', u); } catch (e) {}
    return;
  }
  if (k === 'items') {
    if (!items.length) return botSay(c.noItems, botMenu);
    return botSay(c.itemsHead(items.length) + botItemsCard(items), botMenu, 'card');
  }
  if (k === 'dispatch') {
    const last = (d.steps || []).length - 1, rs = (d.replacements || []).filter(r => r.sent);
    const rList = rs.length ? '<ul class="bc-disp">' + rs.map(r => '<li>' + bi('repl') + '<div><b>' + esc(r.model || c.newBattery) + '</b><small>' +
      esc([fmtDate(r.dispatchDate), r.transport, r.lr && 'LR ' + r.lr].filter(Boolean).join(' · ')) + '</small></div></li>').join('') + '</ul>' : '';
    const out = items.filter(i => i.step === last && !i.exchanged), left = items.filter(i => i.step !== last).length;
    if (rs.length && !out.length) return botSay(c.replSent + rList, botMenu, 'card');
    if (!items.length) return botSay(c.noItems, botMenu);
    if (!out.length) return botSay(c.notDisp(left) + botItemsCard(items.filter(i => i.step !== last)), botMenu, 'card');
    const by = {};
    out.forEach(i => { const key = (i.dispatchDate || '') + '|' + (i.transport || ''); (by[key] = by[key] || []).push(i); });
    return botSay(c.dispHead + '<ul class="bc-disp">' + Object.keys(by).map(key => { const [dt, tr] = key.split('|');
      return '<li>' + bi('truck') + '<div><b>' + esc(itemsLine(by[key])) + '</b><small>' + esc([fmtDate(dt), tr].filter(Boolean).join(' · ')) + '</small></div></li>'; }).join('') + '</ul>' +
      rList + '<p class="bc-note">' + (left ? c.dispMore(left) : c.allDone) + '</p>', botMenu, 'card');
  }
  if (k === 'eta') {
    const e = botEta(t, items);
    if (e.kind === 'closed') return botSay(c.etaClosed, botMenu);
    if (e.kind === 'wait') return botSay(c.etaWait, botMenu);
    if (e.kind === 'late') return botSay(c.etaLate, () => botChips([['callback', c.chips.callback, 'phone'], ['menu', c.chips.menu, 'menu']]));
    return botSay(c.etaDate(esc(e.date)), botMenu);
  }
  if (k === 'pickup') {
    if (!t.pickupBy) return botSay(c.pickupNone, botMenu);
    const rows = [[c.lbl.pickup, c.pickupBy[t.pickupBy] || t.pickupBy], [BOT.lang === 'hi' ? 'तारीख़' : 'Date', fmtDate(t.pickupDate)], [c.lbl.trans, t.pickupTransport], [c.lbl.lr, t.pickupLr]].filter(r => r[1]);
    return botSay('<dl class="bc-dl">' + rows.map(r => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>', botMenu, 'card');
  }
  if (k === 'feedback') {
    if (t.rating) return botSay(c.fbDone(esc(t.rating)), botMenu);
    if (!t.canFeedback) return botSay(c.fbLater, botMenu);
    return botSay(c.fbOpen, () => botChips([['gofb', c.chips.feedback, 'star'], ['menu', c.chips.menu, 'menu']]));
  }
  if (k === 'gofb') {
    STATE = d; render(); showOnly('result'); botToggle(false);
    const f = $('fbCard'); if (f && !f.hidden) setTimeout(() => f.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    return;
  }
  if (k === 'callback') {
    if (d.callback) return botSay(c.cbAlready(esc(d.callback.id), esc(d.callback.slot)), botMenu);
    if (!BOT.cred || (!BOT.cred.code && !BOT.cred.last4)) { BOT.pendingId = t.id; BOT.step = 'ph'; return botSay(c.askPh(esc(t.id))); }
    return botSay(c.cbAsk, () => botChips(SLOTS.map((s, i) => ['slot' + i, s, 'clock'])));
  }
  if (/^slot\d$/.test(k)) { BOT.cbSlot = SLOTS[+k.slice(4)]; BOT.step = 'cbmsg'; return botSay(c.cbMsg, () => botChips([['skipmsg', c.chips.skip]])); }
  if (k === 'skipmsg') return botCallback('');
  botSay(c.dunno, botMenu);
}
function botPhone() { return (BOT.site && BOT.site.supportPhone) || CONFIG.SUPPORT_PHONE || ''; }
async function botCallback(msg) {
  BOT.step = '';
  const wait = botAdd('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
  let r;
  try { r = await api(Object.assign({ action: 'requestCallback', slot: BOT.cbSlot, message: msg }, BOT.cred)); } catch (e) { r = null; }
  wait.remove();
  if (!r || !r.ok) return botSay(r && r.msg ? esc(r.msg) : L().cbFail, botMenu);
  D().callback = { id: r.id, slot: r.slot };
  botSay(r.already ? L().cbAlready(esc(r.id), esc(r.slot)) : L().cbDone(esc(r.id), esc(r.slot)), botMenu);
}
window.addEventListener('load', botBoot);

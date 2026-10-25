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
  if (!items.length) { $('itemsCard').hidden = true; return; }
  const steps = STATE.steps || [], last = steps.length - 1, cnt = {};
  $('itemsCard').hidden = false;
  $('items').innerHTML = items.map(it => {
    const isChg = /charg/i.test(it.type || ''), k = isChg ? 'Charger' : 'Battery';
    cnt[k] = (cnt[k] || 0) + 1;
    const done = it.step === last;
    const desc = [it.category, it.model].filter(Boolean).join(' · ');
    return '<div class="item' + (done ? ' done' : '') + '">' +
      '<div class="it-top"><span class="it-name">' + (isChg ? '⚡ ' : '🔋 ') + k + ' #' + cnt[k] + '</span>' +
        '<span class="it-stage">' + esc(it.label) + '</span></div>' +
      (desc ? '<div class="it-desc">' + esc(desc) + '</div>' : '') +
      '<div class="it-steps">' + steps.map((s, i) =>
        '<span class="' + (i < it.step ? 'p' : (i === it.step ? 'c' : '')) + '" title="' + esc(s) + '"></span>').join('') + '</div>' +
      '<div class="it-step-lbl">Step ' + (it.step + 1) + ' of ' + steps.length + '</div>' +
      (done ? '<div class="it-disp">Dispatched ' + esc(fmtDate(it.dispatchDate)) + (it.transport ? ' · ' + esc(it.transport) : '') + '</div>' : '') +
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
   Answers from the same tracking data: status, items, dispatch, pickup, expected date,
   call-back request, feedback. English + हिंदी.
   ============================================================ */
const BOT = { open: false, lang: 'en', step: '', fails: 0, cred: null, site: null, cbSlot: '', started: false };
const SLOTS = ['Morning (10 AM – 1 PM)', 'Afternoon (1 – 4 PM)', 'Evening (4 – 7 PM)', 'Anytime'];
const T = {
  en: {
    title: 'Litpax Assistant', sub: 'Usually replies instantly',
    hello: n => 'Hi' + (n ? ' ' + n : '') + '! 👋 I can tell you where your battery is, when it will be sent, and arrange a call back.',
    askId: 'Please type your <b>Ticket ID</b> (e.g. LTX-R-0012). You will find it on your receiving slip or our WhatsApp message.',
    askPh: 'Thanks. Now the <b>last 4 digits</b> of the phone number you gave us.',
    badId: 'That doesn\'t look like a Ticket ID. It looks like <b>LTX-R-0012</b> — or just type the number, e.g. 12.',
    badPh: 'Please type exactly 4 digits.',
    checking: 'Checking…',
    notFound: 'I couldn\'t find a ticket with these details. Please check the Ticket ID and phone digits.',
    verified: (id, c) => 'Found it ✅ <b>' + id + '</b>' + (c ? ' — ' + c : '') + '. What would you like to know?',
    noId: 'No problem. The Ticket ID is on the receiving slip and in the WhatsApp message we sent. You can also ask us to call you.',
    menu: 'What would you like to know?',
    chips: { status: '📦 Status', items: '🔋 My items', dispatch: '🚚 Dispatch details', eta: '⏰ When will I get it?', pickup: '📍 Pickup', callback: '📞 Call me back', feedback: '⭐ Feedback', other: '🔁 Another ticket', noid: 'I don\'t have the Ticket ID', talk: '☎️ Talk to us' },
    status: (s, n) => 'Your request is <b>' + s + '</b>' + (n ? '. ' + n : '.'),
    itemsHead: n => 'We have <b>' + n + '</b> item' + (n === 1 ? '' : 's') + ' from you:',
    noItems: 'We haven\'t received any items yet.',
    notDisp: (n, w) => 'Nothing has been dispatched yet. ' + n + ' item' + (n === 1 ? ' is' : 's are') + ' with us — ' + w + '.',
    dispHead: 'Dispatched to you:', dispMore: n => n + ' more item' + (n === 1 ? ' is' : 's are') + ' still with us.',
    allDone: 'All your items have been dispatched. ✅',
    etaClosed: 'Your service is complete. ✅',
    etaWait: 'We\'ll give you a date as soon as your items reach us.',
    etaDate: (d, w) => 'Expected dispatch around <b>' + d + '</b> (approx.). Right now: ' + w + '.',
    etaLate: w => 'It is taking a little longer than usual — ' + w + '. I can ask our team to call you with an exact date.',
    pickupNone: 'No pickup has been arranged yet. Our service team will call you to arrange it.',
    pickup: (by, d, tr, lr) => 'Pickup by <b>' + by + '</b>' + (d ? ' on ' + d : '') + (tr ? ' · ' + tr : '') + (lr ? ' · LR ' + lr : '') + '.',
    cbAsk: 'Sure. When should we call you?',
    cbMsg: 'Anything you\'d like us to know? (optional — or tap Skip)',
    skip: 'Skip',
    cbDone: (id, s) => 'Done ✅ Request <b>' + id + '</b> is with our service team. We\'ll call you <b>' + s + '</b>.',
    cbAlready: (id, s) => 'You already have a call-back request (<b>' + id + '</b>, ' + s + '). Our team will call you soon.',
    cbFail: 'Sorry, I couldn\'t register that. Please call us instead.',
    fbOpen: 'Thank you! Tap below to rate our service.', fbGo: '⭐ Give feedback',
    fbDone: r => 'You already rated us ' + r + '/5 — thank you! 🙏',
    fbLater: 'Feedback opens once your items are dispatched.',
    talk: p => p ? 'You can call us on <a href="tel:' + p + '"><b>' + p + '</b></a>, or I can ask our team to call you.' : 'I can ask our team to call you.',
    newComplaint: p => 'To register a new complaint, please call us' + (p ? ' on <a href="tel:' + p + '"><b>' + p + '</b></a>' : '') + '.',
    thanks: 'You\'re welcome! 😊 Anything else?',
    dunno: 'Sorry, I didn\'t get that. Please pick one of these:',
    dunno2: 'I\'m still learning 🙂 Shall I ask our team to call you?',
    stepNames: ['Received', 'Under inspection', 'Under repair', 'Testing', 'Ready for dispatch', 'Dispatched']
  },
  hi: {
    title: 'Litpax सहायक', sub: 'तुरंत जवाब',
    hello: n => 'नमस्ते' + (n ? ' ' + n : '') + '! 👋 मैं बता सकता हूँ आपकी बैटरी कहाँ है, कब भेजी जाएगी, और कॉल-बैक भी लगवा सकता हूँ।',
    askId: 'कृपया अपना <b>Ticket ID</b> लिखें (जैसे LTX-R-0012)। यह रसीद पर या हमारे WhatsApp मैसेज में मिलेगा।',
    askPh: 'धन्यवाद। अब अपने फ़ोन नंबर के <b>आख़िरी 4 अंक</b> लिखें।',
    badId: 'यह Ticket ID नहीं लग रहा। यह <b>LTX-R-0012</b> जैसा होता है — या सिर्फ़ नंबर लिखें, जैसे 12।',
    badPh: 'कृपया ठीक 4 अंक लिखें।',
    checking: 'देख रहा हूँ…',
    notFound: 'इन जानकारियों से कोई टिकट नहीं मिला। कृपया Ticket ID और फ़ोन के अंक जाँच लें।',
    verified: (id, c) => 'मिल गया ✅ <b>' + id + '</b>' + (c ? ' — ' + c : '') + '। आप क्या जानना चाहते हैं?',
    noId: 'कोई बात नहीं। Ticket ID रसीद पर और हमारे WhatsApp मैसेज में होता है। आप हमें कॉल करने के लिए भी कह सकते हैं।',
    menu: 'आप क्या जानना चाहते हैं?',
    chips: { status: '📦 स्टेटस', items: '🔋 मेरे आइटम', dispatch: '🚚 डिस्पैच', eta: '⏰ कब मिलेगा?', pickup: '📍 पिकअप', callback: '📞 मुझे कॉल करें', feedback: '⭐ फ़ीडबैक', other: '🔁 दूसरा टिकट', noid: 'Ticket ID नहीं है', talk: '☎️ बात करें' },
    status: (s, n) => 'आपका रिक्वेस्ट <b>' + s + '</b> है' + (n ? '। ' + n : '।'),
    itemsHead: n => 'आपके <b>' + n + '</b> आइटम हमारे पास हैं:',
    noItems: 'अभी तक कोई आइटम हमारे पास नहीं पहुँचा।',
    notDisp: (n, w) => 'अभी कुछ भी डिस्पैच नहीं हुआ। ' + n + ' आइटम हमारे पास हैं — ' + w + '।',
    dispHead: 'आपको भेजा गया:', dispMore: n => n + ' आइटम अभी हमारे पास हैं।',
    allDone: 'आपके सभी आइटम भेज दिए गए हैं। ✅',
    etaClosed: 'आपकी सर्विस पूरी हो गई है। ✅',
    etaWait: 'आइटम हमारे पास पहुँचते ही हम तारीख़ बता देंगे।',
    etaDate: (d, w) => 'लगभग <b>' + d + '</b> तक डिस्पैच होने की उम्मीद है। अभी: ' + w + '।',
    etaLate: w => 'थोड़ा ज़्यादा समय लग रहा है — ' + w + '। मैं टीम से कहकर आपको सही तारीख़ के लिए कॉल करवा सकता हूँ।',
    pickupNone: 'अभी पिकअप तय नहीं हुआ है। सर्विस टीम आपको कॉल करके तय करेगी।',
    pickup: (by, d, tr, lr) => 'पिकअप: <b>' + by + '</b>' + (d ? ' · ' + d : '') + (tr ? ' · ' + tr : '') + (lr ? ' · LR ' + lr : '') + '।',
    cbAsk: 'ज़रूर। आपको कब कॉल करें?',
    cbMsg: 'कुछ बताना चाहें? (वैकल्पिक — या Skip दबाएँ)',
    skip: 'Skip',
    cbDone: (id, s) => 'हो गया ✅ रिक्वेस्ट <b>' + id + '</b> सर्विस टीम को मिल गई है। हम आपको <b>' + s + '</b> कॉल करेंगे।',
    cbAlready: (id, s) => 'आपकी कॉल-बैक रिक्वेस्ट पहले से है (<b>' + id + '</b>, ' + s + ')। टीम जल्द कॉल करेगी।',
    cbFail: 'माफ़ कीजिए, रिक्वेस्ट दर्ज नहीं हो पाई। कृपया हमें कॉल करें।',
    fbOpen: 'धन्यवाद! नीचे टैप करके हमारी सर्विस को रेट करें।', fbGo: '⭐ फ़ीडबैक दें',
    fbDone: r => 'आप पहले ही ' + r + '/5 रेटिंग दे चुके हैं — धन्यवाद! 🙏',
    fbLater: 'आइटम डिस्पैच होने के बाद फ़ीडबैक दे सकते हैं।',
    talk: p => p ? 'हमें <a href="tel:' + p + '"><b>' + p + '</b></a> पर कॉल करें, या मैं टीम से आपको कॉल करवा सकता हूँ।' : 'मैं टीम से आपको कॉल करवा सकता हूँ।',
    newComplaint: p => 'नई शिकायत दर्ज करने के लिए कृपया हमें कॉल करें' + (p ? ' — <a href="tel:' + p + '"><b>' + p + '</b></a>' : '') + '।',
    thanks: 'आपका स्वागत है! 😊 और कुछ?',
    dunno: 'माफ़ कीजिए, समझ नहीं पाया। इनमें से चुनें:',
    dunno2: 'मैं अभी सीख रहा हूँ 🙂 क्या टीम से आपको कॉल करवा दूँ?',
    stepNames: ['प्राप्त', 'जाँच में', 'रिपेयर में', 'टेस्टिंग में', 'डिस्पैच के लिए तैयार', 'डिस्पैच हो गया']
  }
};
const L = () => T[BOT.lang];
const STATUS_HI = { 'Registered': 'दर्ज', 'Service team in touch': 'सर्विस टीम संपर्क में', 'On the way to us': 'हमारे पास आ रहा है', 'Received': 'प्राप्त',
  'Under repair': 'रिपेयर में', 'Partially dispatched': 'आंशिक डिस्पैच', 'Completed': 'पूरा', 'Cancelled': 'रद्द', 'Resolved on call': 'कॉल पर हल' };

// keyword → intent (English, Hinglish, हिंदी)
const INTENTS = [
  ['thanks', /\b(thanks?|thank you|thx|ok(ay)?|shukriya|dhanyavaad|dhanyawad)\b|धन्यवाद|शुक्रिया/i],
  ['callback', /\b(call ?back|call me|callback|phone (me|kar)|call kar|call karo|baat kar|baat karni|contact)\b|कॉल|फ़ोन करो|बात कर/i],
  ['dispatch', /\b(dispatch|dispatched|bhej|bheja|bhejo|sent|send|courier|transport|lr|docket|tracking no|delivery|deliver)\b|भेज|डिस्पैच|कूरियर/i],
  ['eta', /\b(when|kab|kitne din|how long|eta|date|time lagega|kab tak|kab milegi|kab milega)\b|कब|कितने दिन/i],
  ['pickup', /\b(pick ?up|uthaya|uthana|collect)\b|पिकअप/i],
  ['items', /\b(items?|battery|batteries|charger|kitni|how many|serial)\b|बैटरी|चार्जर|आइटम/i],
  ['feedback', /\b(feedback|rating|rate|review)\b|फ़ीडबैक|रेटिंग/i],
  ['newComplaint', /\b(new complaint|naya complaint|new ticket|naya ticket|register)\b|नई शिकायत/i],
  ['talk', /\b(human|agent|insaan|person|support|helpline|number)\b|इंसान|नंबर/i],
  ['status', /\b(status|where|kahan|kaha|update|progress|kya hua|stage|repair)\b|स्टेटस|कहाँ|कहां|क्या हुआ/i],
  ['hello', /\b(hi|hello|hey|namaste|namaskar|hii+)\b|नमस्ते|नमस्कार/i],
  ['other', /\b(another|other|dusra|doosra|new id|change)\b|दूसरा/i]
];
const intentOf = s => { for (const [k, re] of INTENTS) if (re.test(s)) return k; return ''; };
const idIn = s => { const m = String(s).toUpperCase().match(/LTX[\s-]*R[\s-]*0*(\d{1,6})/); return m ? normId(m[1]) : ''; };

/* ---------- UI ---------- */
function botBoot() {
  if ($('botFab')) return;
  const w = document.createElement('div');
  w.innerHTML =
    '<button id="botFab" class="bot-fab" onclick="botToggle()" aria-label="Help"><span class="bot-fab-ico">💬</span><span class="bot-fab-txt">Need help?</span></button>' +
    '<section id="bot" class="bot" hidden aria-live="polite">' +
      '<header class="bot-head"><div class="bot-av">L</div><div class="bot-hd"><b id="botTitle"></b><span><i class="bot-dot"></i><span id="botSub"></span></span></div>' +
        '<button class="bot-lang" onclick="botLang()" title="Language">EN / हिं</button><button class="bot-x" onclick="botToggle(false)" aria-label="Close">✕</button></header>' +
      '<div id="botLog" class="bot-log"></div>' +
      '<div id="botChips" class="bot-chips"></div>' +
      '<form class="bot-in" onsubmit="botSend(event)"><input id="botInput" autocomplete="off" placeholder="Type a message…" maxlength="300">' +
        '<button type="submit" aria-label="Send">➤</button></form>' +
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
  if (BOT.open) setTimeout(() => $('botInput').focus(), 50);
}
function botHeader() { $('botTitle').textContent = L().title; $('botSub').textContent = L().sub; $('botInput').placeholder = BOT.lang === 'hi' ? 'मैसेज लिखें…' : 'Type a message…'; }
function botLang() { BOT.lang = BOT.lang === 'en' ? 'hi' : 'en'; botHeader(); botSay(L().menu); botMenu(); }
function botAdd(html, who) {
  const d = document.createElement('div');
  d.className = 'bot-msg b-' + (who || 'bot');
  d.innerHTML = html;
  $('botLog').appendChild(d);
  $('botLog').scrollTop = $('botLog').scrollHeight;
  return d;
}
// bot "typing…" then the message (short, natural delay)
function botSay(html, cb) {
  const ty = botAdd('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
  setTimeout(() => { ty.innerHTML = html; $('botLog').scrollTop = $('botLog').scrollHeight; cb && cb(); }, 350 + Math.min(String(html).length * 4, 600));
}
function botChips(list) {
  $('botChips').innerHTML = list.map(([k, label]) => '<button type="button" data-k="' + esc(k) + '" onclick="botChip(this)">' + label + '</button>').join('');
}
function botChip(el) { const k = el.dataset.k; botAdd(esc(el.textContent), 'me'); $('botChips').innerHTML = ''; botAct(k); }
function botMenu() {
  const c = L().chips;
  if (!BOT.cred) return botChips([['noid', c.noid], ['talk', c.talk]]);
  const t = STATE && STATE.ticket, list = [['status', c.status], ['items', c.items], ['dispatch', c.dispatch], ['eta', c.eta]];
  if (t && (t.pickupBy || t.status === 'In Transit')) list.push(['pickup', c.pickup]);
  list.push(['callback', c.callback]);
  if (t && (t.canFeedback || t.rating)) list.push(['feedback', c.feedback]);
  list.push(['other', c.other]);
  botChips(list);
}

/* ---------- conversation ---------- */
function botStart() {
  if (STATE && STATE.ticket) {      // already tracking on the page → no need to ask again
    BOT.cred = BOT.cred || botCredFromPage();
    botSay(L().hello(''), () => botSay(L().verified(esc(STATE.ticket.id), esc(STATE.ticket.company)), botMenu));
  } else {
    botSay(L().hello(''), () => { BOT.step = 'id'; botSay(L().askId, botMenu); });
  }
}
function botCredFromPage() {
  const q = new URLSearchParams(location.search), t = STATE.ticket;
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
  if (BOT.step === 'id') {
    const id = idIn(v) || (/^\s*\d{1,6}\s*$/.test(v) ? normId(v) : '');
    if (id) { BOT.pendingId = id; BOT.step = 'ph'; return botSay(L().askPh); }
    const it = intentOf(v);
    if (it === 'talk' || it === 'callback' || it === 'newComplaint') return botAct(it === 'callback' ? 'talk' : it);
    return botSay(L().badId, botMenu);
  }
  if (BOT.step === 'ph') {
    const m = v.replace(/\D/g, '');
    if (m.length !== 4) return botSay(L().badPh);
    return botVerify({ ticketId: BOT.pendingId, last4: m });
  }
  if (BOT.step === 'cbmsg') return botCallback(v);
  // a Ticket ID typed any time → switch to that ticket
  const id = idIn(v);
  if (id && (!STATE || STATE.ticket.id !== id)) { BOT.pendingId = id; BOT.step = 'ph'; return botSay(L().askPh); }
  const it = intentOf(v);
  if (!it) {
    BOT.fails++;
    if (BOT.fails >= 2) { BOT.fails = 0; return botSay(L().dunno2, () => botChips([['callback', L().chips.callback], ['talk', L().chips.talk], ['menu', '☰ Menu']])); }
    return botSay(L().dunno, botMenu);
  }
  BOT.fails = 0;
  botAct(it);
}
async function botVerify(cred) {
  BOT.step = '';
  const wait = botAdd('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
  let r;
  try { r = await api(Object.assign({ action: 'getTracking' }, cred)); } catch (e) { r = null; }
  wait.remove();
  if (!r || !r.ok) { BOT.step = 'id'; return botSay(L().notFound + '<br><br>' + L().askId, botMenu); }
  BOT.cred = cred;
  // show the same result on the page behind the chat
  STATE = r; render(); showOnly('result');
  try { const u = new URL(location.href); u.searchParams.set('t', r.ticket.id); if (r.ticket.trackCode) u.searchParams.set('c', r.ticket.trackCode); history.replaceState(null, '', u); } catch (e) {}
  botSay(L().verified(esc(r.ticket.id), esc(r.ticket.company)), botMenu);
}

const stepName = i => L().stepNames[i] || '';
function whereNow(items) {
  const left = items.filter(i => i.step < 5), by = {};
  left.forEach(i => { by[i.step] = (by[i.step] || 0) + 1; });
  return Object.keys(by).sort().map(k => by[k] + ' ' + stepName(+k).toLowerCase()).join(', ');
}
function addHours(dateStr, h) { const d = new Date(String(dateStr).substring(0, 10) + 'T10:00:00'); d.setHours(d.getHours() + h); return d; }

function botAct(k) {
  if (STATE && STATE.ticket && (!BOT.cred || BOT.cred.ticketId !== STATE.ticket.id)) BOT.cred = botCredFromPage();   // ticket opened from the page form
  const c = L(), t = STATE && STATE.ticket, items = (STATE && STATE.items) || [];
  if (k === 'menu' || k === 'hello') return botSay(c.menu, botMenu);
  if (k === 'thanks') return botSay(c.thanks, botMenu);
  if (k === 'noid') return botSay(c.noId, () => botChips([['talk', c.chips.talk]]));
  if (k === 'talk') return botSay(c.talk(botPhone()), () => botChips(t ? [['callback', c.chips.callback], ['menu', '☰ Menu']] : [['menu', '☰ Menu']]));
  if (k === 'newComplaint') return botSay(c.newComplaint(botPhone()), botMenu);
  if (k === 'other') { BOT.cred = null; BOT.step = 'id'; return botSay(c.askId); }
  if (!t) { BOT.step = 'id'; return botSay(c.askId); }

  if (k === 'status') {
    const solved = t.outcome === 'Solved on Call', st = solved ? 'Resolved on call' : (STATUS_PUBLIC[t.status] || [t.status])[0];
    const label = BOT.lang === 'hi' ? (STATUS_HI[st] || st) : st;
    const w = whereNow(items), done = items.filter(i => i.step === 5).length;
    const note = items.length ? (done ? done + '/' + items.length + (BOT.lang === 'hi' ? ' डिस्पैच' : ' dispatched') + (w ? ' · ' + w : '') : w) : '';
    return botSay(c.status(esc(label), esc(note)), botMenu);
  }
  if (k === 'items') {
    if (!items.length) return botSay(c.noItems, botMenu);
    return botSay(c.itemsHead(items.length) + '<ul class="bot-list">' + items.map(i =>
      '<li>' + (i.type === 'Charger' ? '⚡' : '🔋') + ' ' + esc([i.category, i.model].filter(Boolean).join(' · ')) + ' — <b>' + esc(stepName(i.step)) + '</b></li>').join('') + '</ul>', botMenu);
  }
  if (k === 'dispatch') {
    const out = items.filter(i => i.step === 5), left = items.length - out.length;
    if (!items.length) return botSay(c.noItems, botMenu);
    if (!out.length) return botSay(c.notDisp(left, esc(whereNow(items))), botMenu);
    const by = {};
    out.forEach(i => { const key = (i.dispatchDate || '') + '|' + (i.transport || ''); by[key] = (by[key] || 0) + 1; });
    return botSay(c.dispHead + '<ul class="bot-list">' + Object.keys(by).map(key => { const [d, tr] = key.split('|');
      return '<li>📦 <b>' + by[key] + '</b> · ' + esc(fmtDate(d)) + (tr ? ' · ' + esc(tr) : '') + '</li>'; }).join('') + '</ul>' + (left ? c.dispMore(left) : c.allDone), botMenu);
  }
  if (k === 'eta') {
    if (t.status === 'Closed') return botSay(c.etaClosed, botMenu);
    const s = (BOT.site && BOT.site.sla) || {}, rest = (s.queue || 24) + (s.repair || 72) + (s.dispatch || 24);
    let due = null;
    if (t.receivedDate) due = addHours(t.receivedDate, rest);
    else if (t.pickupDate) due = addHours(t.pickupDate, (s.transit || 72) + rest);
    if (!due) return botSay(c.etaWait, botMenu);
    const w = esc(whereNow(items) || (BOT.lang === 'hi' ? 'हमारे पास आ रहा है' : 'on the way to us'));
    if (due.getTime() < Date.now()) return botSay(c.etaLate(w), () => botChips([['callback', c.chips.callback], ['menu', '☰ Menu']]));
    return botSay(c.etaDate(esc(fmtDate(due.getFullYear() + '-' + ('0' + (due.getMonth() + 1)).slice(-2) + '-' + ('0' + due.getDate()).slice(-2))), w), botMenu);
  }
  if (k === 'pickup') {
    if (!t.pickupBy) return botSay(c.pickupNone, botMenu);
    const by = t.pickupBy === 'Company' ? (BOT.lang === 'hi' ? 'कंपनी' : 'our team') : (BOT.lang === 'hi' ? 'आप स्वयं' : 'you (self)');
    return botSay(c.pickup(by, esc(fmtDate(t.pickupDate)), esc(t.pickupTransport || ''), esc(t.pickupLr || '')), botMenu);
  }
  if (k === 'feedback') {
    if (t.rating) return botSay(c.fbDone(esc(t.rating)), botMenu);
    if (!t.canFeedback) return botSay(c.fbLater, botMenu);
    return botSay(c.fbOpen, () => botChips([['gofb', c.fbGo], ['menu', '☰ Menu']]));
  }
  if (k === 'gofb') { botToggle(false); const f = $('fbCard'); if (f && !f.hidden) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (k === 'callback') {
    if (STATE.callback) return botSay(c.cbAlready(esc(STATE.callback.id), esc(STATE.callback.slot)), botMenu);
    if (!BOT.cred || (!BOT.cred.code && !BOT.cred.last4)) { BOT.pendingId = t.id; BOT.step = 'ph'; return botSay(c.askPh); }
    return botSay(c.cbAsk, () => botChips(SLOTS.map((s, i) => ['slot' + i, s])));
  }
  if (/^slot\d$/.test(k)) { BOT.cbSlot = SLOTS[+k.slice(4)]; BOT.step = 'cbmsg'; return botSay(c.cbMsg, () => botChips([['skipmsg', c.skip]])); }
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
  STATE.callback = { id: r.id, slot: r.slot };
  botSay(r.already ? L().cbAlready(esc(r.id), esc(r.slot)) : L().cbDone(esc(r.id), esc(r.slot)), botMenu);
}
window.addEventListener('load', botBoot);

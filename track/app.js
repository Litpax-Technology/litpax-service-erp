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
    : (t.pickupBy === 'Customer' || t.batterySent === 'Yes' ? 'Battery Sent by You' : 'Pickup / Shipping');

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

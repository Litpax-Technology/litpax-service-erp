/* ============================================================
   LITPAX SERVICE HUB v2 — app.js
   One Ticket ID → Phase 1 (Basic) → Phase 2 (Service/CRM) → Phase 3 (Repair)
   ============================================================ */

/* ---------- CORE: JSONP / API ---------- */
let _seq = 0;
function jsonp(params, onData, onErr) {
  params = Object.assign({}, params || {});
  const tk = localStorage.getItem('hub_token');
  if (tk && params.action !== 'login') params.token = tk;
  const cb = '__cb' + (++_seq) + '_' + Date.now();
  const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const s = document.createElement('script');
  let done = false;
  const timer = setTimeout(() => { if (!done) { cleanup(); onErr && onErr('timeout'); } }, CONFIG.JSONP_TIMEOUT_MS);
  function cleanup() { done = true; clearTimeout(timer); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
  window[cb] = function (d) {
    cleanup();
    if (d && d.auth === false) { sessionExpired(d.msg); onErr && onErr('auth'); return; }
    onData && onData(d);
  };
  s.onerror = () => { if (!done) { cleanup(); onErr && onErr('network'); } };
  s.src = CONFIG.API_URL + '?' + qs + '&callback=' + cb + '&t=' + Date.now();
  document.body.appendChild(s);
}
function api(params) { return new Promise((res, rej) => jsonp(params, res, rej)); }

// POST (JSON as text/plain → no CORS preflight). Used for file upload and large payloads.
async function apiPost(params) {
  const body = Object.assign({}, params || {});
  const tk = localStorage.getItem('hub_token');
  if (tk) body.token = tk;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.POST_TIMEOUT_MS);
  let d;
  try {
    const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal });
    d = await res.json();
  } catch (e) { throw 'network'; }
  finally { clearTimeout(timer); }
  if (d && d.auth === false) { sessionExpired(d.msg); throw 'auth'; }
  return d;
}

// button busy state + error toast; returns the response on success, otherwise null
async function run(params, btn, post, busyText) {
  let old = '';
  if (btn) { old = btn.innerHTML; btn.disabled = true; btn.textContent = busyText || '⏳ ...'; }
  try {
    const r = await (post ? apiPost(params) : api(params));
    if (!r || !r.ok) { toast('❌ ' + ((r && r.msg) || 'Something went wrong')); return null; }
    return r;
  } catch (e) {
    if (e !== 'auth') toast('❌ Network error — please try again');
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
}

/* ---------- UTILS ---------- */
const $ = id => document.getElementById(id);
const pad2 = n => ('0' + n).slice(-2);
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const idNum = id => parseInt(String(id || '').replace(/\D/g, ''), 10) || 0;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function segPick(btn) {
  btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}
function segVal(id) { const b = document.querySelector('#' + id + ' button.on'); return b ? b.dataset.v : ''; }

/* ---------- MASTERS (dropdown lists: sheet-driven + admin UI) ---------- */
let MASTERS = null;
const EMPTY_MASTERS = { attendedBy: [], dispatchedBy: [], batteryType: [], chargerType: [], dealer: [], faultCode: [], complaint: [],
  customerType: [], source: [], checks: [], callFix: [], condition: [], accessory: [] };
const M = () => MASTERS || EMPTY_MASTERS;

async function ensureMasters(force) {
  if (!force && MASTERS) return MASTERS;
  if (!force) { const c = cacheGet('masters'); if (c && c.fresh) { MASTERS = c.val; return MASTERS; } }
  try {
    const r = await api({ action: 'getMasters' });
    if (r && r.ok) { MASTERS = r.masters; cacheSet('masters', MASTERS); }
  } catch (e) {}
  return M();
}

// <option> list; keeps an old value selectable even if it was removed from the list
function optList(list, sel, ph) {
  list = list || [];
  const all = sel && list.indexOf(sel) === -1 ? list.concat([sel]) : list;
  if (!all.length) return '<option value="">' + esc(ph || '-- Select --') + ' — none set, ask admin</option>';
  return '<option value="">' + esc(ph || '-- Select --') + '</option>' +
    all.map(v => '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
}

function fileToB64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej('read');
    fr.readAsDataURL(file);
  });
}
const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? String(u) : '';

// sessionStorage cache (TTL)
function cacheSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), v })); } catch (e) {} }
function cacheGet(k) {
  try { const o = JSON.parse(sessionStorage.getItem(k)); if (!o) return null; return { fresh: Date.now() - o.ts < CONFIG.CACHE_TTL_MS, val: o.v }; }
  catch (e) { return null; }
}
function cacheDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

const STATUS_TONE = {
  'New': 'blue', 'In Follow-up': 'amber', 'In Transit': 'violet', 'Received': 'teal',
  'In Repair': 'teal', 'Partial Dispatch': 'amber', 'Closed': 'green',
  'In Planning': 'amber', 'Dispatched': 'green', 'Cancelled': 'gray'
};
function pill(s) { return '<span class="pill pill-' + (STATUS_TONE[s] || 'blue') + '">' + esc(s || '—') + '</span>'; }
const dealerOf = t => t['Dealer'] || t['Scooty Brand'] || '';
const isEnded = s => s === 'Closed' || s === 'Cancelled';
const rupee = v => v === '' || v == null ? '' : '₹' + Number(v).toLocaleString('en-IN');
function repeatTag(n) { n = parseInt(n, 10) || 0; return n ? '<span class="tag tag-red" title="This serial number came before">🔁 Repeat ×' + n + '</span>' : ''; }

/* ---------- TRACKING LINK + WHATSAPP (click-to-send) ---------- */
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function niceDate(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : String(s || ''); }

function trackLink(t, fb) {
  const id = t && t['Ticket ID'], c = t && t['Track Code'];
  if (!id || !c || !CONFIG.TRACK_URL) return '';
  return CONFIG.TRACK_URL + '?t=' + encodeURIComponent(id) + '&c=' + encodeURIComponent(c) + (fb ? '&fb=1' : '');
}
function itemsText(nb, nc) {
  const a = [];
  if (nb) a.push(nb + ' batter' + (nb === 1 ? 'y' : 'ies'));
  if (nc) a.push(nc + ' charger' + (nc === 1 ? '' : 's'));
  return a.join(' and ') || 'items';
}
// fills {placeholders}; a line whose placeholder is empty is dropped
function waFill(tpl, v) {
  return String(tpl || '').split('\n').filter(line =>
    (line.match(/\{(\w+)\}/g) || []).every(k => String(v[k.slice(1, -1)] == null ? '' : v[k.slice(1, -1)]).trim() !== '')
  ).map(line => line.replace(/\{(\w+)\}/g, (m, k) => v[k])).join('\n');
}
function waUrl(phone, text) {
  const p = String(phone || '').replace(/\D/g, '').slice(-10);
  if (p.length !== 10) return '';
  return 'https://wa.me/' + (CONFIG.WA_COUNTRY || '91') + p + '?text=' + encodeURIComponent(text);
}
function waLog(t) { try { const a = JSON.parse(t['WA Log'] || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function waBtn(ticketId, ev, url, label, sentAt) {
  if (!url) return '<button class="btn btn-ghost btn-sm" disabled>📲 ' + label + ' — no valid phone</button>';
  return '<a class="btn btn-wa btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener" data-t="' + esc(ticketId) +
    '" data-e="' + ev + '" onclick="waMark(this)"><span>📲 ' + label + '</span>' +
    (sentAt ? '<span class="wa-sent">✓ ' + esc(sentAt) + '</span>' : '') + '</a>';
}
// link click → WhatsApp opens in a new tab; log it in the background
function waMark(el) {
  const t = el.dataset.t, e = el.dataset.e;
  if (!t || !e) return;
  jsonp({ action: 'markWa', ticketId: t, event: e }, r => {
    if (!r || !r.ok) return;
    toast('✅ WhatsApp marked as sent'); cacheDel('tickets');
    if (CUR && CUR.ticket['Ticket ID'] === t) {
      CUR.ticket['WA Log'] = JSON.stringify(r.log || []);
      if (e === 'feedback' && !CUR.ticket['Feedback Asked At']) CUR.ticket['Feedback Asked At'] = 'just now';
      if ($('drawer').classList.contains('open')) drawerRender();
    }
  }, () => {});
}
function qrImg(text, size) {
  if (typeof QRCode === 'undefined' || !text) return '';
  try {
    const d = document.createElement('div');
    new QRCode(d, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
    const c = d.querySelector('canvas');
    const src = c ? c.toDataURL('image/png') : ((d.querySelector('img') || {}).src || '');
    return src ? '<img class="slip-qr" src="' + src + '" alt="Track QR" width="' + size + '" height="' + size + '">' : '';
  } catch (e) { return ''; }
}
const fbOpen = t => t['Status'] === 'Closed' && !!t['Received Date'] && !t['Rating'];

function waSection() {
  const t = CUR.ticket, items = CUR.items || [], log = waLog(t), T = CONFIG.WA_TEMPLATES;
  if (!T) return '';
  const sentAt = e => { const x = log.filter(l => l.e === e).pop(); return x ? x.t : ''; };
  const base = { name: t['Contact Person'], id: t['Ticket ID'], link: trackLink(t), flink: trackLink(t, true) };
  const mk = (e, label, extra) => waBtn(t['Ticket ID'], e, waUrl(t['Phone'], waFill(T[e], Object.assign({}, base, extra || {}))), label, sentAt(e));

  const b = [mk('created', 'Ticket Created')];
  if (t['Pickup By']) b.push(mk('pickup', 'Pickup Details', { date: niceDate(t['Pickup Date']), transport: t['Transport Name'], lr: t['LR No'] }));
  if (t['Received Date']) b.push(mk('received', 'Items Received', { items: itemsText(+t['Battery Qty'] || 0, +t['Charger Qty'] || 0) }));
  const disp = items.filter(i => String(i['Item Status']).toLowerCase() === 'dispatched');
  if (disp.length) {
    const lastDate = disp.map(i => String(i['Dispatch Date'] || '')).sort().pop();
    const batch = disp.filter(i => String(i['Dispatch Date'] || '') === lastDate);
    const nb = batch.filter(i => i['Item Type'] === 'Battery').length;
    b.push(mk('dispatched', 'Dispatched', { items: itemsText(nb, batch.length - nb), date: niceDate(lastDate), transport: batch[0]['Transport (Outward)'] }));
  }
  if (fbOpen(t)) b.push(mk('feedback', 'Ask Feedback'));
  return sec('📲 WhatsApp Updates', '<div class="wa-list">' + b.join('') + '</div>' +
    '<div class="muted-sm">Opens WhatsApp with the message ready — just press Send.</div>');
}

/* ---------- SCREENS / NAV ---------- */
const SCREENS = {
  newTicket: { id: 'scrNew',      icon: '➕', label: 'New Ticket',   title: 'New Ticket',   sub: 'Phase 1 — basic record for a call or walk-in', open: openNew },
  tickets:   { id: 'scrTickets',  icon: '📋', label: 'Tickets',      title: 'Tickets',      sub: 'All tickets — status, call log and actions', open: openTickets },
  board:     { id: 'scrBoard',    icon: '🔧', label: 'Repair Board', title: 'Repair Board', sub: 'Phase 3 — item-wise planning and stages', open: openBoard },
  dispatch:  { id: 'scrDispatch', icon: '🚚', label: 'Dispatch',     title: 'Dispatch',     sub: 'Send out items that passed Final QC & Pack', open: openDispatch },
  masters:   { id: 'scrMasters',  icon: '⚙️', label: 'Masters',      title: 'Masters',      sub: 'Dropdown lists — names and battery / charger types', open: openMasters },
  tracker:   { id: 'scrTracker',  icon: '🛰️', label: 'Ticket Tracker', title: 'Ticket Tracker', sub: 'Where every ticket and battery is right now — with SLA', open: openTracker },
  settings:  { id: 'scrSettings', icon: '🛠️', label: 'Settings',     title: 'Settings',     sub: 'SLA targets, lists, WhatsApp messages and screens per role', open: openSettings }
};
let CURRENT = '';

function role() { return localStorage.getItem('hub_role') || ''; }
function can(p) { return (CONFIG.PERMS[role()] || []).indexOf(p) !== -1; }

function go(key) {
  const S = SCREENS[key]; if (!S) return;
  CURRENT = key;
  document.querySelectorAll('.sb-item').forEach(b => b.classList.toggle('active', b.dataset.nav === key));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(S.id).classList.add('active');
  $('hdrTitle').textContent = S.title; $('hdrSub').textContent = S.sub;
  toggleSidebar(false); window.scrollTo(0, 0);
  S.open();
}
function toggleSidebar(force) {
  const open = typeof force === 'boolean' ? force : !$('sidebar').classList.contains('open');
  $('sidebar').classList.toggle('open', open); $('sbOverlay').classList.toggle('show', open);
}

/* ---------- AUTH ---------- */
window.addEventListener('load', () => {
  const r = role();
  if (r && CONFIG.ROLES[r] && localStorage.getItem('hub_token')) enterApp(r); else showLogin();
});

function clearSession() {
  ['hub_role', 'hub_token', 'hub_user'].forEach(k => localStorage.removeItem(k));
  try { sessionStorage.clear(); } catch (e) {}
  MASTERS = null;
}
function sessionExpired(msg) { clearSession(); toast('🔒 ' + (msg || 'Session expired — please sign in again')); showLogin(); }

function showLogin() {
  $('loginScreen').style.display = 'flex'; $('appWrap').style.display = 'none';
  drawerClose(); modalClose();
  const h = new Date().getHours();
  $('loginHello').textContent = h < 12 ? 'Good morning 👋' : (h < 17 ? 'Good afternoon 👋' : 'Good evening 👋');
  const saved = localStorage.getItem('hub_remember_user') || '';
  $('loginUser').value = saved; $('rememberUser').checked = !!saved;
  $('loginPass').value = ''; $('loginPass').type = 'password'; $('capsWarn').style.display = 'none';
  setTimeout(() => (saved ? $('loginPass') : $('loginUser')).focus(), 50);
}
function loginTogglePass(el) { const p = $('loginPass'); p.type = p.type === 'password' ? 'text' : 'password'; el.style.opacity = p.type === 'text' ? '1' : '.5'; }
function capsCheck(e) { if (e.getModifierState) $('capsWarn').style.display = e.getModifierState('CapsLock') ? 'block' : 'none'; }

async function authLogin() {
  const u = $('loginUser').value.trim().toLowerCase(), p = $('loginPass').value.trim();
  if (!u || !p) return toast('⚠️ Enter username and PIN');
  const r = await run({ action: 'login', username: u, pin: p }, $('loginBtn'));
  if (!r) return;
  if (!CONFIG.ROLES[r.role]) return toast('❌ Role not found in config.js: ' + r.role);
  localStorage.setItem('hub_role', r.role); localStorage.setItem('hub_token', r.token); localStorage.setItem('hub_user', u);
  if ($('rememberUser').checked) localStorage.setItem('hub_remember_user', u); else localStorage.removeItem('hub_remember_user');
  enterApp(r.role);
}

function enterApp(r) {
  const R = CONFIG.ROLES[r];
  $('loginScreen').style.display = 'none'; $('appWrap').style.display = 'flex';
  $('sbRole').textContent = R.icon + ' ' + R.label + ' · ' + (localStorage.getItem('hub_user') || '');
  $('sbNav').innerHTML = R.nav.map(k =>
    '<button class="sb-item" data-nav="' + k + '" onclick="go(this.dataset.nav)"><span class="sb-ico">' + SCREENS[k].icon + '</span>' + SCREENS[k].label + '</button>'
  ).join('');
  if ($('hdrDate')) $('hdrDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  ensureMasters();           // preload dropdown lists in the background
  ensureSettings().then(applySettings);   // SLA, lists, WhatsApp text, screens — from the Settings tab
  go(R.nav[0]);
}

function logout() {
  if (localStorage.getItem('hub_token')) jsonp({ action: 'logout' }, () => {}, () => {});
  clearSession(); toggleSidebar(false); showLogin();
}

// clear stale cached data after any change
function afterChange() {
  ['tickets', 'board_items', 'tracker'].forEach(cacheDel);
  if (CURRENT === 'tickets') tkLoad(true);
}

/* ============================================================
   PHASE 1 — NEW TICKET
   ============================================================ */
function openNew() { newReset(); }

function dealerList() { const l = M().dealer || []; return l.length ? l : (CONFIG.SCOOTY_BRANDS || []); }
function brandOptions() {
  const sel = $('n_brand'), cur = sel.value;
  sel.innerHTML = '<option value="">-- Select dealer (optional) --</option>' +
    dealerList().map(b => '<option' + (b === cur ? ' selected' : '') + '>' + esc(b) + '</option>').join('');
}
function dealerAddToggle(show) {
  $('dealerAddRow').style.display = show ? 'flex' : 'none';
  if (show) { $('n_dealerNew').value = ''; $('n_dealerNew').focus(); }
}
function dealerSelect(v) {
  const o = Array.from($('n_brand').options).find(x => x.value.toLowerCase() === v.toLowerCase());
  if (o) $('n_brand').value = o.value;
  return !!o;
}
async function dealerAdd(btn) {
  const v = $('n_dealerNew').value.trim();
  if (!v) return toast('⚠️ Enter dealer name');
  if (dealerSelect(v)) { dealerAddToggle(false); return toast('ℹ️ "' + v + '" is already in the list — selected'); }
  const r = await run({ action: 'addDealer', value: v }, btn);
  if (!r) return;
  MASTERS = r.masters; cacheSet('masters', MASTERS);
  brandOptions(); dealerSelect(v); dealerAddToggle(false);
  toast('✅ Dealer "' + v + '" added');
}

function newSelects() {
  brandOptions();
  const keep = id => $(id).value;
  const cpl = keep('n_complaint'), st = keep('n_state'), ct = keep('n_ctype'), src = keep('n_source');
  $('n_complaint').innerHTML = optList(M().complaint, cpl, '-- Select complaint (optional) --');
  $('n_state').innerHTML = optList(CONFIG.STATES || [], st, '-- Select state --');
  $('n_ctype').innerHTML = optList(M().customerType, ct, '-- Select --');
  $('n_source').innerHTML = optList(M().source, src, '-- Select --');
}
function newReset() {
  ['n_company', 'n_person', 'n_phone', 'n_brand', 'n_city', 'n_state', 'n_complaint', 'n_ctype', 'n_source',
   'n_vehicle', 'n_invoice', 'n_pdate', 'n_expB', 'n_expC'].forEach(id => { $(id).value = ''; });
  $('n_phoneInfo').style.display = 'none'; $('n_phoneInfo').innerHTML = '';
  newSelects();
  ensureMasters().then(newSelects);
  dealerAddToggle(false);
  document.querySelectorAll('#n_sentSeg button').forEach(b => b.classList.remove('on'));
  $('newForm').style.display = 'block'; $('newSuccess').style.display = 'none';
}

async function ticketCreate() {
  const v = id => $(id).value.trim();
  const d = { action: 'createTicket', company: v('n_company'), person: v('n_person'), phone: v('n_phone'), brand: v('n_brand'),
    city: v('n_city'), state: v('n_state'), complaint: v('n_complaint'), customerType: v('n_ctype'), source: v('n_source'),
    vehicle: v('n_vehicle'), invoice: v('n_invoice'), purchaseDate: v('n_pdate'), expB: v('n_expB'), expC: v('n_expC'),
    batterySent: segVal('n_sentSeg') };
  if (!d.company || !d.person || !d.phone) return toast('⚠️ Please fill all required fields');
  if (!/^\d{10}$/.test(d.phone)) return toast('⚠️ Phone must be 10 digits');
  if (d.purchaseDate && d.purchaseDate > todayStr()) return toast('⚠️ Purchase date cannot be in the future');
  if (!d.batterySent) return toast('⚠️ Select whether the items have been sent');
  const r = await run(d, $('n_submit'));
  if (!r) return;
  afterChange();
  $('newForm').style.display = 'none'; $('newSuccess').style.display = 'block';
  $('newId').textContent = r.id; $('newOpenBtn').dataset.id = r.id;
  const wa = $('newWa'), url = waUrl(d.phone, waFill((CONFIG.WA_TEMPLATES || {}).created,
    { name: d.person, id: r.id, link: trackLink({ 'Ticket ID': r.id, 'Track Code': r.code }) }));
  wa.dataset.t = r.id; wa.dataset.e = 'created';
  if (url) { wa.href = url; wa.style.display = ''; } else wa.style.display = 'none';
  window.scrollTo(0, 0);
}
function openTicketFromNew(id) { go('tickets'); drawerOpen(id); }

// phone typed → earlier tickets of this customer + fill the empty fields from the last one
let _phoneSeq = 0;
async function phoneCheck() {
  const ph = $('n_phone').value.replace(/\D/g, ''), box = $('n_phoneInfo'), seq = ++_phoneSeq;
  if (ph.length !== 10) { box.style.display = 'none'; box.innerHTML = ''; return; }
  let r;
  try { r = await api({ action: 'lookupPhone', phone: ph }); } catch (e) { return; }
  if (seq !== _phoneSeq || !r || !r.ok) return;
  if (!r.count) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const L = r.last || {}, filled = [];
  const fill = (id, v) => { if (v && !$(id).value) { $(id).value = v; if ($(id).value === v) filled.push(id); } };
  fill('n_company', L.company); fill('n_person', L.person); fill('n_city', L.city); fill('n_vehicle', L.vehicle);
  fill('n_state', L.state); fill('n_ctype', L.customerType);
  if (L.dealer && !$('n_brand').value && dealerSelect(L.dealer)) filled.push('n_brand');
  box.innerHTML = '<div class="note">🔁 <b>Repeat customer</b> — ' + r.count + ' earlier ticket' + (r.count > 1 ? 's' : '') +
    '. Last: <b>' + esc(L.id) + '</b> (' + esc(L.status) + ', ' + esc(niceDate(L.created)) + ').' + (filled.length ? ' Empty fields filled from it — please check.' : '') + '</div>' +
    ((r.open || []).length ? '<div class="note note-red">⚠️ Open ticket already: ' + r.open.map(o => '<b>' + esc(o.id) + '</b> (' + esc(o.status) + (o.complaint ? ' · ' + esc(o.complaint) : '') + ')').join(', ') +
      ' — check it before creating a new one.</div>' : '');
  box.style.display = 'block';
}

/* ============================================================
   TICKETS LIST
   ============================================================ */
let TK = [];
let tkFilter = 'open';
const TK_CHIPS = [
  ['open', 'Open'], ['New', 'New'], ['In Follow-up', 'Follow-up'], ['In Transit', 'In Transit'],
  ['repair', 'In Repair'], ['due', '📅 Follow-up Due'], ['fb', '⭐ Feedback Due'], ['lowfb', '🔴 Low Feedback'],
  ['Closed', 'Closed'], ['Cancelled', 'Cancelled'], ['all', 'All']
];
const REPAIR_SET = ['Received', 'In Repair', 'Partial Dispatch'];

function isDue(t) { const f = t['Next Follow-up']; return !!f && !isEnded(t['Status']) && f.substring(0, 10) <= todayStr(); }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isFbDue(t) {
  const c = String(t['Closed At'] || '').substring(0, 10);
  return fbOpen(t) && !t['Feedback Asked At'] && !!c && c <= daysAgoStr(CONFIG.FEEDBACK_AFTER_DAYS || 3);
}
function tkMatch(t, f) {
  const s = t['Status'];
  if (f === 'all') return true;
  if (f === 'open') return !isEnded(s);
  if (f === 'repair') return REPAIR_SET.indexOf(s) !== -1;
   if (f === 'due') return isDue(t);
  if (f === 'fb') return isFbDue(t);
  if (f === 'lowfb') return t['Feedback Flag'] === 'Low';
  return s === f;
}

function openTickets() { tkLoad(false); }

async function tkLoad(force) {
  const c = cacheGet('tickets');
  if (c && !force) { TK = c.val || []; tkRender(); if (c.fresh) return; }
  else if (!c || force) { if (!TK.length) $('tkList').innerHTML = '<div class="skeleton sk-card"></div>'.repeat(3); }
  try {
    const r = await api({ action: 'getTickets' });
    if (!r || !r.ok) { toast('❌ ' + ((r && r.msg) || 'Could not load tickets')); return; }
    TK = r.tickets || []; cacheSet('tickets', TK); tkRender();
  } catch (e) { if (e !== 'auth' && !TK.length) $('tkList').innerHTML = '<div class="empty">Could not load data ❌</div>'; }
}

function tkSetFilter(f) { tkFilter = f; tkRender(); }

function tkRender() {
  $('tkChips').innerHTML = TK_CHIPS.map(([k, l]) => {
    const n = TK.filter(t => tkMatch(t, k)).length;
   return '<button class="chip' + (k === tkFilter ? ' active' : '') + (['due', 'fb', 'lowfb'].indexOf(k) !== -1 && n ? ' chip-red' : '') +
      '" data-f="' + k + '" onclick="tkSetFilter(this.dataset.f)">' + l + ' <b>' + n + '</b></button>';
  }).join('');

  const q = $('tkSearch').value.toLowerCase().trim();
  const rows = TK.filter(t => tkMatch(t, tkFilter)).filter(t => !q ||
    [t['Ticket ID'], t['Company Name'], t['Contact Person'], t['Phone'], dealerOf(t), t['City'], t['Complaint'], t['Vehicle Model']].join(' ').toLowerCase().indexOf(q) !== -1
  ).sort((a, b) => idNum(b['Ticket ID']) - idNum(a['Ticket ID']));

  if (!rows.length) { $('tkList').innerHTML = '<div class="empty">' + (TK.length ? 'No matches 🔍' : 'No tickets yet ✅') + '</div>'; return; }

  $('tkList').innerHTML = rows.map(t => {
    const due = isDue(t), calls = parseInt(t['Total Calls'], 10) || 0, items = parseInt(t['Total Items'], 10) || 0;
    const tags = [];
    if (t['Battery Sent'] === 'Yes' && REPAIR_SET.indexOf(t['Status']) === -1 && !isEnded(t['Status'])) tags.push('<span class="tag tag-violet">🚚 Battery sent</span>');
    if (t['Complaint'] && !isEnded(t['Status'])) tags.push('<span class="tag">⚠️ ' + esc(t['Complaint']) + '</span>');
    if (+t['Previous Tickets']) tags.push('<span class="tag tag-amber" title="Earlier tickets from this phone">🔁 Repeat customer</span>');
    if (calls) tags.push('<span class="tag">📞 ' + calls + ' call' + (calls > 1 ? 's' : '') + '</span>');
    if (t['Next Follow-up'] && !isEnded(t['Status'])) tags.push('<span class="tag ' + (due ? 'tag-red' : '') + '">📅 ' + esc(t['Next Follow-up']) + '</span>');
    if (items) tags.push('<span class="tag tag-teal">📦 ' + items + ' items</span>');
  if (t['Outcome'] && t['Status'] === 'Closed') tags.push('<span class="tag tag-green">' + esc(t['Outcome']) + '</span>');
    if (isFbDue(t)) tags.push('<span class="tag tag-amber">⭐ Feedback due</span>');
    if (t['Rating']) tags.push('<span class="tag ' + (t['Feedback Flag'] === 'Low' ? 'tag-red' : 'tag-green') + '">⭐ ' + esc(t['Rating']) + '/5</span>');
    if (t['Feedback Flag'] === 'Low') tags.push('<span class="tag tag-red">🔴 Low feedback</span>');
    return '<div class="tk-card' + (due || t['Feedback Flag'] === 'Low' ? ' due' : '') + '" data-id="' + esc(t['Ticket ID']) + '" onclick="drawerOpen(this.dataset.id)">' +
      '<div class="tk-top"><span class="tk-id">' + esc(t['Ticket ID']) + '</span>' + pill(t['Status']) + '</div>' +
      '<div class="tk-company">' + esc(t['Company Name']) + '</div>' +
      '<div class="tk-meta">' + esc(t['Contact Person']) + ' · ' + esc(t['Phone']) + (dealerOf(t) ? ' · 🏪 ' + esc(dealerOf(t)) : '') + (t['City'] ? ' · 📍 ' + esc(t['City']) : '') + '</div>' +
      '<div class="tk-foot"><div class="tags">' + tags.join('') + '</div><span class="tk-date">' + esc(String(t['Created At'] || '').substring(0, 10)) + '</span></div>' +
    '</div>';
  }).join('');
}

/* ============================================================
   TICKET DRAWER (Phase 2 actions live here)
   ============================================================ */
let CUR = null; // {ticket, calls, items}

async function drawerOpen(id) {
  CUR = null;
  $('drTitle').textContent = id;
  const pre = TK.find(x => x['Ticket ID'] === id);
  $('drBody').innerHTML = (pre ? sec('📝 ' + esc(pre['Company Name']), kv([['Contact Person', pre['Contact Person']], ['Phone', pre['Phone']], ['Status', pre['Status']]])) : '') +
    '<div class="skeleton sk-block"></div><div class="skeleton sk-block"></div>';
  $('drawer').classList.add('open'); $('drawerOv').classList.add('show');
  try {
    const [r] = await Promise.all([api({ action: 'getTicket', ticketId: id }), ensureMasters()]);
    if (!r || !r.ok) { $('drBody').innerHTML = '<div class="empty">' + esc((r && r.msg) || 'Could not load') + '</div>'; return; }
    CUR = r; drawerRender();
  } catch (e) { if (e !== 'auth') $('drBody').innerHTML = '<div class="empty">Network error ❌</div>'; }
}
function drawerClose() { $('drawer').classList.remove('open'); $('drawerOv').classList.remove('show'); }
function drawerReload() { if (CUR) drawerOpen(CUR.ticket['Ticket ID']); }

function kv(rows) {
  return rows.map(r => '<div class="kv"><span>' + esc(r[0]) + '</span><span>' + esc(r[1] || '—') + '</span></div>').join('');
}
function sec(title, inner) { return '<div class="dsec"><div class="dsec-title">' + title + '</div>' + inner + '</div>'; }

function stepper(t) {
  const s = t['Status'], solved = t['Outcome'] === 'Solved on Call';
  const steps = solved
    ? [['New', 'New'], ['In Follow-up', 'Service Call'], ['Closed', 'Solved ✅']]
    : [['New', 'New'], ['In Follow-up', 'Service Call'], ['In Transit', 'In Transit'], ['Received', 'Received'], ['In Repair', 'Repair'], ['Closed', 'Closed']];
  const order = { 'New': 0, 'In Follow-up': 1, 'In Transit': 2, 'Received': 3, 'In Repair': 4, 'Partial Dispatch': 4, 'Closed': 9 };
  let cur = order[s] != null ? order[s] : 0;
  if (solved) cur = 9;
  return '<div class="stepper">' + steps.map(([k, l], i) => {
    const idx = solved ? i : (order[k] != null ? order[k] : i);
    const cls = idx < cur || (k === 'Closed' && s === 'Closed') ? 'done' : (idx === cur ? 'now' : '');
    return '<div class="step ' + cls + '"><span class="dot"></span><span class="lbl">' + l + '</span></div>';
  }).join('') + '</div>';
}

function drawerRender() {
  const t = CUR.ticket, s = t['Status'], sent = t['Battery Sent'] === 'Yes', open = !isEnded(s), cancelled = s === 'Cancelled';
  const early = s === 'New' || s === 'In Follow-up';
  $('drTitle').innerHTML = esc(t['Ticket ID']) + ' ' + pill(s);

  let h = cancelled ? '' : stepper(t);
  if (cancelled) h += '<div class="dsec actions"><div class="note note-gray">🚫 <b>Cancelled</b> on ' + esc(t['Closed At']) + '<br>Reason: ' + esc(t['Cancel Reason'] || '—') + '</div>' +
    (can('admin') ? '<button class="btn btn-ghost" onclick="ticketReopen(this)">↩️ Reopen ticket</button>' : '<div class="muted-sm">Only admin can reopen a cancelled ticket.</div>') + '</div>';

  // ---- actions (service team) ----
  const lowFb = t['Feedback Flag'] === 'Low';
  if (can('service') && (open || lowFb)) {
    const b = [];
    b.push('<button class="btn btn-primary" onclick="callFormToggle()">📞 Add Call Log</button>');
    if (!sent && early) b.push('<button class="btn btn-green" onclick="ticketSolve(this)">✅ Solved on Call</button>');
    if (early || s === 'In Transit') b.push('<button class="btn btn-violet" onclick="pickupOpen()">🚚 ' + (s === 'In Transit' ? 'Edit Pickup' : 'Arrange Pickup') + '</button>');
    if (s === 'In Transit' || (sent && early)) b.push('<button class="btn btn-teal" onclick="receiveOpen()">📥 Mark Received</button>');
    if (open) b.push('<button class="btn btn-ghost" onclick="editOpen()">✏️ Edit details</button>');
    if (early || s === 'In Transit') b.push('<button class="btn btn-ghost btn-danger" onclick="cancelOpen()">🚫 Cancel ticket</button>');
h += '<div class="dsec actions">' +
      (lowFb ? '<div class="note note-red">🔴 The customer gave low feedback. Call them and save a call log — that clears this flag.</div>' : '') +
      (sent && early ? '<div class="note">🚚 The customer has already sent the items — no troubleshooting needed. Just note the problem and fill in the pickup details.</div>' : '') +
      '<div class="btn-wrap">' + b.join('') + '</div>' + callFormHtml(t) + '</div>';
  }
  if (!cancelled) h += waSection();
  h += sec('📝 Phase 1 — Basic', kv([
    ['Company', t['Company Name']], ['Contact Person', t['Contact Person']], ['Phone', t['Phone']],
    ['Customer Type', t['Customer Type']], ['Source', t['Source']],
    ['Dealer', dealerOf(t)], ['City / State', [t['City'], t['State']].filter(Boolean).join(', ')], ['Complaint', t['Complaint']],
    ['Vehicle', t['Vehicle Model']], ['Invoice / Purchase', [t['Invoice No'], t['Purchase Date'] && niceDate(t['Purchase Date'])].filter(Boolean).join(' · ')],
    ['Items expected', (+t['Exp Battery Qty'] || +t['Exp Charger Qty']) ? itemsText(+t['Exp Battery Qty'] || 0, +t['Exp Charger Qty'] || 0) : ''],
    ['Earlier tickets', +t['Previous Tickets'] ? t['Previous Tickets'] + ' (repeat customer)' : ''],
    ['Items Sent', t['Battery Sent']],
    ['Created', t['Created At'] + (t['Created By'] ? ' · ' + t['Created By'] : '')]
  ]) + (t['Phone'] ? '<a class="call-link" href="tel:' + esc(t['Phone']) + '">📲 Call ' + esc(t['Phone']) + '</a>' : ''));

  h += sec('🎧 Phase 2 — Service', kv([
    ['Attended By', t['Attended By']], ['Purchase Age', t['Purchase Age']], ['Outcome', t['Outcome']],
    ['Next Follow-up', open ? t['Next Follow-up'] : ''], ['Total Calls', t['Total Calls']], ['Solved by', t['Call Fix']]
  ]));

  if (t['Pickup By']) h += sec('🚚 Pickup / Transport', kv([
    ['Arranged By', t['Pickup By']], ['No. of Boxes', t['No. of Boxes']], ['Place', t['Pickup Place']],
    ['Date', t['Pickup Date']], ['Transport', t['Transport Name']], ['LR No', t['LR No']]
  ]) + (safeUrl(t['Builty URL'])
    ? '<a class="call-link" href="' + esc(safeUrl(t['Builty URL'])) + '" target="_blank" rel="noopener">📎 View builty</a>'
    : '<div class="muted-sm">No builty uploaded</div>'));

  if (t['Received Date']) {
    const items = CUR.items || [];
    h += sec('📥 Received → Phase 3 Repair', kv([
      ['Received Date', t['Received Date']], ['Received By', t['Received By']],
      ['Batteries', t['Battery Qty'] || 0], ['Chargers', t['Charger Qty'] || 0],
      ['Accessories', t['Accessories']], ['Remarks', t['Receive Remarks']]
    ]) + (t['Qty Note'] ? '<div class="note note-red" style="margin-top:10px">⚠️ ' + esc(t['Qty Note']) + '</div>' : '') +
    (items.length ? '<div class="items-mini">' + items.map(it =>
      '<div class="im-row"><span class="im-id">' + esc(it['Item ID']) + '</span><span class="im-main">' + (it['Item Type'] === 'Charger' ? '⚡' : '🔋') + ' ' +
      esc([it['Category'], it['Model']].filter(Boolean).join(' · ')) +
      '<small>' + esc([it['Serial No'] && 'SN ' + it['Serial No'], it['Warranty'], it['Condition'] && 'Arrived: ' + it['Condition'], it['Voltage'] !== '' && it['Voltage'] != null && it['Voltage'] + ' V',
        it['Mfg Month'] && 'Mfg ' + it['Mfg Month'], it['Batch No'] && 'Batch ' + it['Batch No'], it['Usage Months'] !== '' && it['Usage Months'] != null && 'Used ' + it['Usage Months'] + ' mo',
        it['Fault Code'] && 'Fault: ' + it['Fault Code'], rupee(it['Repair Cost'])].filter(Boolean).join(' · ')) + '</small>' +
      repeatTag(it['Repeat Count']) +
      (can('service') ? '<button type="button" class="link-btn" data-id="' + esc(it['Item ID']) + '" onclick="itemEditOpen(this.dataset.id)">✏️ Correct details</button>' : '') +
      '</span>' + pill(it['Item Status']) + '</div>'
    ).join('') + '</div>' : '') +
    '<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="recvSlip()">🖨️ Receiving Slip</button>');
  }

  if (t['Rating']) h += sec('⭐ Customer Feedback', kv([
    ['Rating', t['Rating'] + ' / 5'], ['Problem Solved', t['Solved']], ['Comment', t['Feedback Comment']], ['Given On', t['Feedback At']],
    ['Flag', t['Feedback Flag'] === 'Low' ? '🔴 Low — call pending' : (t['Feedback Flag'] === 'Resolved' ? '✅ Called back' : '')]
  ]));
  else if (t['Feedback Asked At']) h += sec('⭐ Customer Feedback', kv([['Asked On', t['Feedback Asked At']], ['Status', 'Waiting for customer']]));

  const calls = CUR.calls || [];
  h += sec('🗒️ Call Log (' + calls.length + ')', calls.length ? '<div class="timeline">' + calls.map(c =>
    '<div class="tl-item"><div class="tl-head"><b>' + esc(c['Attended By'] || c['Logged By']) + '</b><span>' + esc(c['Time']) + '</span></div>' +
    '<div class="tl-body">' + esc(c['Notes']) + '</div>' +
    (c['Checks'] ? '<div class="tl-checks">🧰 ' + esc(c['Checks']) + '</div>' : '') +
    (c['Next Follow-up'] ? '<div class="tl-next">📅 Next follow-up: ' + esc(c['Next Follow-up']) + '</div>' : '') + '</div>'
  ).join('') + '</div>' : '<div class="empty sm">No call logs yet</div>');

  if (t['Closed At'] && !cancelled) h += sec('✅ Closed', kv([['Closed At', t['Closed At']], ['Outcome', t['Outcome']]]));

  const hist = CUR.history || [];
  if (hist.length) h += sec('🕘 Change History (' + hist.length + ')', '<div class="timeline">' + hist.map(x =>
    '<div class="tl-item"><div class="tl-head"><b>' + esc(x['Action']) + (x['Item ID'] ? ' · ' + esc(x['Item ID']) : '') + '</b><span>' + esc(x['Time']) + ' · ' + esc(x['User']) + '</span></div>' +
    '<div class="tl-body muted-txt">' + esc(x['Details']) + '</div></div>').join('') + '</div>');

  $('drBody').innerHTML = h;
}

/* ---- Edit / Cancel / Reopen ---- */
function editOpen() {
  const t = CUR.ticket;
  modalOpen('✏️ Edit ticket — ' + t['Ticket ID'],
    '<div class="form-grid">' +
      '<div class="fg full"><label>Customer Company Name <b>*</b></label><input id="e_company" maxlength="150" value="' + esc(t['Company Name']) + '"></div>' +
      fg('Contact Person <b>*</b>', 'e_person', 'text', t['Contact Person'], ' maxlength="100"') +
      fg('Phone <b>*</b>', 'e_phone', 'text', t['Phone'], ' maxlength="10" inputmode="numeric"') +
      '<div class="fg full"><label>Dealer</label><select id="e_brand">' + optList(dealerList(), dealerOf(t), '-- No dealer --') + '</select></div>' +
      fg('City', 'e_city', 'text', t['City'], ' maxlength="80"') +
      '<div class="fg"><label>State</label><select id="e_state">' + optList(CONFIG.STATES || [], t['State'] || '', '-- Select state --') + '</select></div>' +
      '<div class="fg full"><label>Complaint</label><select id="e_complaint">' + optList(M().complaint, t['Complaint'] || '', '-- Select complaint --') + '</select></div>' +
      '<div class="fg"><label>Customer Type</label><select id="e_ctype">' + optList(M().customerType, t['Customer Type'] || '', '-- Select --') + '</select></div>' +
      '<div class="fg"><label>Source</label><select id="e_source">' + optList(M().source, t['Source'] || '', '-- Select --') + '</select></div>' +
      fg('Vehicle Model', 'e_vehicle', 'text', t['Vehicle Model'], ' maxlength="80"') +
      fg('Invoice No', 'e_invoice', 'text', t['Invoice No'], ' maxlength="60"') +
      fg('Purchase Date', 'e_pdate', 'date', String(t['Purchase Date'] || '').substring(0, 10), ' max="' + todayStr() + '"') + '<div class="fg"></div>' +
      fg('Batteries expected', 'e_expB', 'number', t['Exp Battery Qty'], ' min="0" max="50"') +
      fg('Chargers expected', 'e_expC', 'number', t['Exp Charger Qty'], ' min="0" max="50"') +
    '</div><div class="muted-sm" style="margin:-4px 0 14px">Every change is saved in the ticket history.</div>' +
    '<button class="btn btn-primary btn-block" onclick="editSave(this)">Save changes ✓</button>');
}
async function editSave(btn) {
  const v = id => $(id).value.trim();
  const d = { action: 'editTicket', ticketId: CUR.ticket['Ticket ID'], company: v('e_company'), person: v('e_person'), phone: v('e_phone'),
    brand: v('e_brand'), city: v('e_city'), state: v('e_state'), complaint: v('e_complaint'),
    customerType: v('e_ctype'), source: v('e_source'), vehicle: v('e_vehicle'), invoice: v('e_invoice'), purchaseDate: v('e_pdate'),
    expB: v('e_expB'), expC: v('e_expC') };
  if (d.purchaseDate && d.purchaseDate > todayStr()) return toast('⚠️ Purchase date cannot be in the future');
  if (!d.company || !d.person) return toast('⚠️ Company and contact person are required');
  if (!/^\d{10}$/.test(d.phone)) return toast('⚠️ Phone must be 10 digits');
  const r = await run(d, btn); if (!r) return;
  modalClose(); toast(r.changed ? '✅ ' + r.changed + ' change(s) saved' : 'ℹ️ Nothing changed'); afterChange(); drawerReload();
}
function cancelOpen() {
  modalOpen('🚫 Cancel ticket — ' + CUR.ticket['Ticket ID'],
    '<div class="note note-red">Use this for duplicate or wrong tickets. The ticket stays in records as <b>Cancelled</b> and admin can reopen it.</div>' +
    '<div class="fg full" style="margin-bottom:14px"><label>Reason <b>*</b></label><textarea id="x_reason" maxlength="300" placeholder="e.g. Duplicate of LTX-R-0042 / customer called by mistake"></textarea></div>' +
    '<button class="btn btn-danger-solid btn-block" onclick="cancelSave(this)">Cancel this ticket</button>');
  setTimeout(() => $('x_reason').focus(), 50);
}
async function cancelSave(btn) {
  const reason = $('x_reason').value.trim();
  if (!reason) return toast('⚠️ Enter the reason');
  const r = await run({ action: 'cancelTicket', ticketId: CUR.ticket['Ticket ID'], reason }, btn); if (!r) return;
  modalClose(); toast('🚫 Ticket cancelled'); afterChange(); drawerReload();
}
async function ticketReopen(btn) {
  if (!confirm('Reopen this cancelled ticket?')) return;
  const r = await run({ action: 'reopenTicket', ticketId: CUR.ticket['Ticket ID'] }, btn); if (!r) return;
  toast('↩️ Reopened — status: ' + r.status); afterChange(); drawerReload();
}

/* ---- Call log ---- */
function callFormHtml(t) {
  const ages = CONFIG.PURCHASE_AGE.map(a => '<option' + (a === t['Purchase Age'] ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
  return '<div id="callForm" class="call-form" style="display:none"><div class="form-grid">' +
    '<div class="fg"><label>Attended By <b>*</b></label><select id="c_by">' + optList(M().attendedBy, t['Attended By'] || '', '-- Select name --') + '</select></div>' +
    '<div class="fg"><label>Battery Purchase Age</label><select id="c_age"><option value="">-- Select --</option>' + ages + '</select></div>' +
    '<div class="fg full"><label>Troubleshooting done</label><div id="c_checks" class="chk-list">' +
      ((M().checks || []).length ? M().checks.map(x => '<label class="set-chk"><input type="checkbox" value="' + esc(x) + '"> ' + esc(x) + '</label>').join('') : '<span class="muted-sm">No checklist — admin can add it in Masters → Troubleshooting</span>') + '</div></div>' +
    '<div class="fg full"><label>Call notes <b>*</b></label><textarea id="c_notes" maxlength="1000" placeholder="Problem, what the customer said, what you advised..."></textarea></div>' +
    '<div class="fg"><label>Next Follow-up</label><input type="date" id="c_next"></div>' +
    '</div><button class="btn btn-primary btn-block" onclick="callSave(this)">Save Call ✓</button></div>';
}
function callFormToggle() { const f = $('callForm'); if (f) { f.style.display = f.style.display === 'none' ? 'block' : 'none'; if (f.style.display === 'block') $('c_notes').focus(); } }

async function callSave(btn) {
  const d = {
    action: 'addCall', ticketId: CUR.ticket['Ticket ID'], attendedBy: $('c_by').value.trim(),
    purchaseAge: $('c_age').value, notes: $('c_notes').value.trim(), nextFollowUp: $('c_next').value,
    checks: Array.from(document.querySelectorAll('#c_checks input:checked')).map(i => i.value).join(',')
  };
  if (!d.attendedBy) return toast('⚠️ Select Attended By');
  if (!d.notes) return toast('⚠️ Please add call notes');
  const r = await run(d, btn); if (!r) return;
  toast('✅ Call log saved'); afterChange(); drawerReload();
}

function ticketSolve() {
  modalOpen('✅ Solved on Call — ' + CUR.ticket['Ticket ID'],
    '<div class="fg full" style="margin-bottom:8px"><label>What solved the problem? <b>*</b></label><select id="s_fix">' + optList(M().callFix, '', '-- Select --') + '</select></div>' +
    '<div class="muted-sm" style="margin:0 0 14px">The ticket will be closed. Save a call log first if you want to note details.</div>' +
    '<button class="btn btn-green btn-block" onclick="solveSave(this)">Close ticket — Solved on Call</button>');
}
async function solveSave(btn) {
  const fix = $('s_fix').value;
  if (!fix) return toast('⚠️ Select what solved the problem');
  const r = await run({ action: 'solveTicket', ticketId: CUR.ticket['Ticket ID'], fix }, btn); if (!r) return;
  modalClose(); toast('✅ Ticket closed — Solved on Call'); afterChange(); drawerReload();
}

/* ---- Modal ---- */
function modalOpen(title, body) { $('mdTitle').textContent = title; $('mdBody').innerHTML = body; $('modalOv').classList.add('show'); }
function modalClose() { $('modalOv').classList.remove('show'); }
function fg(label, id, type, val, extra) {
  return '<div class="fg"><label>' + label + '</label><input id="' + id + '" type="' + type + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></div>';
}

/* ---- Pickup ---- */
function pickupOpen() {
  const t = CUR.ticket, cur = safeUrl(t['Builty URL']);
  modalOpen('🚚 Pickup / Transport Details',
    '<div class="fg"><label>Pickup arranged by <b>*</b></label><div class="seg" id="p_bySeg">' +
      ['Company', 'Customer'].map(v => '<button type="button" data-v="' + v + '" class="' + (t['Pickup By'] === v ? 'on' : '') + '" onclick="segPick(this)">' +
        (v === 'Company' ? '🏢 Company' : '👤 Customer (self)') + '</button>').join('') + '</div></div>' +
    '<div class="form-grid">' +
      fg('No. of Boxes', 'p_boxes', 'number', t['No. of Boxes'], ' min="0" max="999"') +
      fg('Pickup Date <b>*</b>', 'p_date', 'date', t['Pickup Date'] || todayStr()) +
      fg('Place', 'p_place', 'text', t['Pickup Place'], ' maxlength="150"') +
      fg('Transport Name', 'p_transport', 'text', t['Transport Name'], ' maxlength="100"') +
      fg('LR No', 'p_lr', 'text', t['LR No'], ' maxlength="60"') +
      '<div class="fg full"><label>Builty (photo or PDF, max ' + CONFIG.BUILTY_MAX_MB + ' MB)</label>' +
        '<label class="file-drop" for="p_file"><span id="p_fileName">📎 ' + (cur ? 'Replace builty' : 'Choose file') + '</span>' +
        '<input type="file" id="p_file" accept="image/jpeg,image/png,image/webp,application/pdf" onchange="pickupFilePick(this)"></label>' +
        (cur ? '<a class="call-link" href="' + esc(cur) + '" target="_blank" rel="noopener">View current builty ↗</a>' : '') +
      '</div>' +
    '</div><button class="btn btn-primary btn-block" onclick="pickupSave(this)">Save — mark In Transit ✓</button>');
}
function pickupFilePick(inp) {
  const f = inp.files && inp.files[0];
  $('p_fileName').textContent = f ? '📎 ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)' : '📎 Choose file';
}
async function pickupSave(btn) {
  const id = CUR.ticket['Ticket ID'];
  const d = {
    action: 'arrangePickup', ticketId: id, pickupBy: segVal('p_bySeg'),
    boxes: $('p_boxes').value, pickupDate: $('p_date').value, place: $('p_place').value.trim(),
    transport: $('p_transport').value.trim(), lr: $('p_lr').value.trim()
  };
  if (!d.pickupBy) return toast('⚠️ Select Company or Customer');
  if (!d.pickupDate) return toast('⚠️ Enter pickup date');
  const file = $('p_file').files[0];
  if (file) {
    if (file.size > CONFIG.BUILTY_MAX_MB * 1048576) return toast('⚠️ Builty file is too large (max ' + CONFIG.BUILTY_MAX_MB + ' MB)');
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) return toast('⚠️ Builty must be a JPG, PNG, WEBP or PDF');
  }
  const r = await run(d, btn); if (!r) return;
  if (file) {
    let data = '';
    try { data = await fileToB64(file); } catch (e) { toast('⚠️ Pickup saved, but the builty file could not be read'); }
    if (data) {
      const u = await run({ action: 'uploadBuilty', ticketId: id, mimeType: file.type, data }, btn, true, '⏳ Uploading builty...');
      if (!u) { toast('⚠️ Pickup saved, but builty upload failed — use Edit Pickup to retry'); afterChange(); drawerReload(); return; }
    }
  }
  modalClose(); toast('✅ Pickup saved' + (file ? ' with builty' : '') + ' — status is now In Transit'); afterChange(); drawerReload();
}

/* ---- Received (one row per unit: type + model) ---- */
async function receiveOpen() {
  await ensureMasters();
  const t = CUR.ticket, eb = +t['Exp Battery Qty'] || 0, ec = +t['Exp Charger Qty'] || 0;
  modalOpen('📥 Mark Received',
    '<div class="form-grid">' +
      fg('Received Date <b>*</b>', 'r_date', 'date', todayStr()) +
      '<div class="fg"><label>Expected (from ticket)</label><div class="r-exp">' + ((eb || ec) ? esc(itemsText(eb, ec)) : 'Not given') + '</div></div>' +
      fg('Battery Qty', 'r_bq', 'number', eb, ' min="0" max="50" oninput="recvUnits()"') +
      fg('Charger Qty', 'r_cq', 'number', ec, ' min="0" max="50" oninput="recvUnits()"') +
    '</div>' +
    '<div id="r_units"></div>' +
    '<div class="fg full" style="margin-bottom:12px"><label>Received along with the items</label><div id="r_acc" class="chk-list">' +
      ((M().accessory || []).length ? M().accessory.map(x => '<label class="set-chk"><input type="checkbox" value="' + esc(x) + '"> ' + esc(x) + '</label>').join('') : '<span class="muted-sm">Admin can add these in Masters → Accessory</span>') + '</div></div>' +
    '<div class="fg full" style="margin-bottom:12px"><label>Remarks</label><textarea id="r_rem" maxlength="500"></textarea></div>' +
    '<div id="r_prev" class="note">Enter quantities — a detail row opens for every unit</div>' +
    '<button class="btn btn-teal btn-block" onclick="recvSave(this)">Mark Received ✓</button>');
  if (eb || ec) recvUnits();
}

const qtyVal = id => Math.max(0, Math.min(50, parseInt($(id).value, 10) || 0));

function recvUnits() {
  // keep what was already typed when quantities change
  const keep = k => Array.from(document.querySelectorAll('.u-row[data-u="' + k + '"]'))
    .map(r => ({ c: r.querySelector('.u-type').value, m: r.querySelector('.u-model').value, s: r.querySelector('.u-serial').value, w: r.querySelector('.u-war').value,
      cond: r.querySelector('.u-cond').value, v: r.querySelector('.u-volt').value, mfg: r.querySelector('.u-mfg').value, b: r.querySelector('.u-batch').value }));
  const kb = keep('B'), kc = keep('C');
  const bq = qtyVal('r_bq'), cq = qtyVal('r_cq');

  const block = (k, label, n, list, prev, ico) => {
    if (!n) return '';
    let s = '<div class="u-block"><div class="u-head"><span>' + ico + ' ' + (label === 'Battery' ? 'Batteries' : label + 's') + ' (' + n + ')</span>' +
      (n > 1 ? '<button type="button" class="link-btn" onclick="recvCopy(\'' + k + '\')">Copy #1 to all (not serial / voltage)</button>' : '') + '</div>' +
      '<div class="u-cols"><span></span><div><span>Type / Condition *</span><span>Model * / Voltage (V)</span><span>Serial No / Mfg month</span><span>Warranty / Batch No</span></div></div>';
    for (let i = 0; i < n; i++) {
      const p = prev[i] || {};
      s += '<div class="u-row u-card" data-u="' + k + '"><span class="u-no">#' + (i + 1) + '</span><div class="u-fields">' +
        '<select class="u-type">' + optList(list, p.c || '', '-- ' + label + ' type --') + '</select>' +
        '<input class="u-model" maxlength="100" placeholder="' + label + ' model *" value="' + esc(p.m || '') + '">' +
        '<input class="u-serial" maxlength="60" placeholder="Serial No" value="' + esc(p.s || '') + '">' +
        '<select class="u-war">' + optList(CONFIG.WARRANTY || [], p.w || '', 'Warranty?') + '</select>' +
        '<select class="u-cond">' + optList(M().condition, p.cond || '', 'Condition *') + '</select>' +
        '<input class="u-volt" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Voltage (V)" value="' + esc(p.v || '') + '">' +
        '<input class="u-mfg" type="month" title="Manufacturing month" value="' + esc(p.mfg || '') + '">' +
        '<input class="u-batch" maxlength="60" placeholder="Batch No" value="' + esc(p.b || '') + '"></div></div>';
    }
    return s + '</div>';
  };
  $('r_units').innerHTML =
    block('B', 'Battery', bq, M().batteryType, kb, '🔋') +
    block('C', 'Charger', cq, M().chargerType, kc, '⚡');

  const n = bq + cq, id = CUR.ticket['Ticket ID'], eb = +CUR.ticket['Exp Battery Qty'] || 0, ec = +CUR.ticket['Exp Charger Qty'] || 0;
  const miss = (eb || ec) && (eb !== bq || ec !== cq);
  $('r_prev').className = 'note' + (miss ? ' note-red' : '');
  $('r_prev').innerHTML = (n
    ? '📦 <b>' + n + '</b> items will be created: ' + esc(id) + '-01 … ' + esc(id) + '-' + pad2(n)
    : 'Enter quantities — a detail row opens for every unit') +
    (miss ? '<br>⚠️ Expected ' + esc(itemsText(eb, ec)) + ' — this will be noted on the ticket.' : '');
}

function recvCopy(k) {
  const rows = document.querySelectorAll('.u-row[data-u="' + k + '"]');
  if (!rows.length) return;
  ['.u-type', '.u-model', '.u-war', '.u-cond', '.u-mfg', '.u-batch'].forEach(sel => {
    const v = rows[0].querySelector(sel).value;
    rows.forEach(r => { r.querySelector(sel).value = v; });
  });
}

async function recvSave(btn) {
  const id = CUR.ticket['Ticket ID'];
  const items = [];
  for (const [k, type] of [['B', 'Battery'], ['C', 'Charger']]) {
    const rows = document.querySelectorAll('.u-row[data-u="' + k + '"]');
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i].querySelector('.u-type').value, m = rows[i].querySelector('.u-model').value.trim();
      const sn = rows[i].querySelector('.u-serial').value.trim(), w = rows[i].querySelector('.u-war').value;
      const cond = rows[i].querySelector('.u-cond').value, volt = rows[i].querySelector('.u-volt').value.trim();
      const mfg = rows[i].querySelector('.u-mfg').value, batch = rows[i].querySelector('.u-batch').value.trim();
      if (!c || !m) return toast('⚠️ ' + type + ' #' + (i + 1) + ': select type and enter model');
      if (!cond) return toast('⚠️ ' + type + ' #' + (i + 1) + ': select the condition it arrived in');
      if (volt !== '' && !(Number(volt) >= 0)) return toast('⚠️ ' + type + ' #' + (i + 1) + ': voltage must be a number');
      items.push({ type, category: c, model: m, serial: sn, warranty: w, condition: cond, voltage: volt, mfg, batch });
    }
  }
  if (!items.length) return toast('⚠️ Enter battery or charger quantity');
  if (!$('r_date').value) return toast('⚠️ Enter received date');
  if (!confirm(items.length + ' items will be received and sent to Repair. Continue?')) return;

  const accessories = Array.from(document.querySelectorAll('#r_acc input:checked')).map(i => i.value);
  const r = await run({ action: 'markReceived', ticketId: id, receivedDate: $('r_date').value, items, accessories, remarks: $('r_rem').value.trim() }, btn, true);
  if (!r) return;
  afterChange();
  const rep = r.repeats || [];
  toast(rep.length ? '🔁 ' + rep.length + ' repeat batter' + (rep.length > 1 ? 'ies' : 'y') + ' found: ' + rep.map(x => x.serial + ' (×' + x.count + ')').join(', ')
                   : r.qtyNote ? '⚠️ Received — ' + r.qtyNote : '✅ ' + r.items + ' items moved to Repair');
  try {
    const t = await api({ action: 'getTicket', ticketId: id });
    if (t && t.ok) { CUR = t; drawerRender(); recvSlip(); return; }
  } catch (e) {}
  modalClose(); drawerReload();
}

/* ---- Correct a received item (service) — type, model, serial, condition ... ---- */
function itemEditOpen(itemId) {
  const it = (CUR.items || []).find(x => x['Item ID'] === itemId);
  if (!it) return;
  const isC = it['Item Type'] === 'Charger';
  modalOpen('✏️ ' + itemId + ' — correct details',
    '<div class="form-grid">' +
      '<div class="fg"><label>Item <b>*</b></label><select id="ie_type" onchange="itemEditType()"><option' + (!isC ? ' selected' : '') + '>Battery</option><option' + (isC ? ' selected' : '') + '>Charger</option></select></div>' +
      '<div class="fg"><label>Type <b>*</b></label><select id="ie_cat">' + optList(isC ? M().chargerType : M().batteryType, it['Category'] || '', '-- Select --') + '</select></div>' +
      fg('Model <b>*</b>', 'ie_model', 'text', it['Model'], ' maxlength="100"') +
      fg('Serial No', 'ie_serial', 'text', it['Serial No'], ' maxlength="60"') +
      '<div class="fg"><label>Warranty</label><select id="ie_war">' + optList(CONFIG.WARRANTY || [], it['Warranty'] || '', '-- Select --') + '</select></div>' +
      '<div class="fg"><label>Condition at receipt</label><select id="ie_cond">' + optList(M().condition, it['Condition'] || '', '-- Select --') + '</select></div>' +
      fg('Voltage (V)', 'ie_volt', 'number', it['Voltage'], ' min="0" step="0.1"') +
      fg('Mfg month', 'ie_mfg', 'month', it['Mfg Month'], '') +
      fg('Batch No', 'ie_batch', 'text', it['Batch No'], ' maxlength="60"') +
    '</div><div class="muted-sm" style="margin:-4px 0 14px">Every change is saved in the ticket history.</div>' +
    '<button class="btn btn-primary btn-block" data-id="' + esc(itemId) + '" onclick="itemEditSave(this)">Save ✓</button>');
}
function itemEditType() {
  const list = $('ie_type').value === 'Charger' ? M().chargerType : M().batteryType;
  $('ie_cat').innerHTML = optList(list, '', '-- Select --');
}
async function itemEditSave(btn) {
  const v = id => $(id).value.trim();
  const d = { action: 'editItem', itemId: btn.dataset.id, type: v('ie_type'), category: v('ie_cat'), model: v('ie_model'), serial: v('ie_serial'),
    warranty: v('ie_war'), condition: v('ie_cond'), voltage: v('ie_volt'), mfg: v('ie_mfg'), batch: v('ie_batch') };
  if (!d.category || !d.model) return toast('⚠️ Select the type and enter the model');
  const r = await run(d, btn); if (!r) return;
  modalClose(); toast(r.changed ? '✅ ' + r.changed + ' change(s) saved' : 'ℹ️ Nothing changed');
  ['board_items', 'tracker'].forEach(cacheDel); drawerReload();
}

/* ---- Slips (receiving + dispatch) ---- */
function slipHead(title, date) {
  const logo = (document.querySelector('.card-logo') || {}).src || '';
  return '<div class="slip-head"><div>' +
    (logo ? '<img class="slip-logo-img" src="' + logo + '" alt="Litpax">' : '<div class="slip-logo">LITPAX</div>') +
    '<div class="slip-sub">Battery / Charger Service Center</div></div>' +
    '<div class="slip-right"><b>' + esc(title) + '</b><br>' + esc(date || '') + '</div></div>';
}

function recvSlip() {
  if (!CUR) return;
  const t = CUR.ticket, items = CUR.items || [];
const nb = items.filter(i => i['Item Type'] === 'Battery').length, nc = items.length - nb;
  const link = trackLink(t);
  const track = link ? '<div class="slip-track">' + qrImg(link, 110) +
    '<div><b>Track your service online</b><br>Scan the QR code, or open<br><span class="slip-url">' + esc(CONFIG.TRACK_URL) +
    '</span><br>and enter Ticket ID <b>' + esc(t['Ticket ID']) + '</b> + last 4 digits of your phone.</div></div>' : '';
  const wa = waBtn(t['Ticket ID'], 'received', waUrl(t['Phone'], waFill((CONFIG.WA_TEMPLATES || {}).received,
    { name: t['Contact Person'], id: t['Ticket ID'], items: itemsText(nb, nc), link })), 'Send "Items Received" on WhatsApp', '');
  const html =
    '<div class="slip" id="slip">' + slipHead('Receiving Slip', t['Received Date']) +
      '<div class="slip-sec">Ticket: <b>' + esc(t['Ticket ID']) + '</b></div>' +
      kv([
        ['Company', t['Company Name']], ['Contact', [t['Contact Person'], t['Phone']].filter(Boolean).join(' · ')],
        ['Dealer', dealerOf(t)], ['Received By', t['Received By']],
        ['Pickup By', t['Pickup By']], ['Transport', t['Transport Name']], ['LR No', t['LR No']],
        ['No. of Boxes', t['No. of Boxes']], ['Received with items', t['Accessories']], ['Quantity check', t['Qty Note']], ['Remarks', t['Receive Remarks']]
      ]) +
      '<table class="slip-table"><tr><th>#</th><th>Item ID</th><th>Item</th><th>Model</th><th>Serial No</th><th>Warranty</th><th>Condition</th><th>Volt</th></tr>' +
      items.map((it, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(it['Item ID']) + '</td><td>' + esc(it['Item Type'] + (it['Category'] ? ' · ' + it['Category'] : '')) +
        '</td><td>' + esc(it['Model'] || '—') + '</td><td>' + esc(it['Serial No'] || '—') +
        ((parseInt(it['Repeat Count'], 10) || 0) ? ' 🔁' : '') + '</td><td>' + esc(it['Warranty'] || '—') + '</td><td>' + esc(it['Condition'] || '—') +
        '</td><td>' + esc(it['Voltage'] === '' || it['Voltage'] == null ? '—' : it['Voltage']) + '</td></tr>').join('') +
      '</table>' +
      '<div class="slip-total">Total: ' + nb + ' batter' + (nb === 1 ? 'y' : 'ies') + ', ' + nc + ' charger' + (nc === 1 ? '' : 's') + '</div>' +
 track +
      '<div class="slip-sign"><div>Received by (Litpax)</div><div>Customer / Transporter</div></div>' +
    '</div><button class="btn btn-primary btn-block" onclick="slipPrint()">🖨️ Print Slip</button>' +
    '<div class="wa-after">' + wa + '</div>';
  modalOpen('📥 Receiving Slip — ' + t['Ticket ID'], html);
}

/* ============================================================
   PHASE 3 — REPAIR BOARD
   ============================================================ */
let boardItems = [];
let boardSel = {};
const STAGES = CONFIG.STAGES;

function mapItem(it) {
  return {
    itemId: it['Item ID'], ticketId: it['Ticket ID'], itemType: it['Item Type'], model: it['Model'],
    status: it['Item Status'], planDate: String(it['Plan Date'] || '').substring(0, 10), planned: it['Planned'] === 'Yes',
    stageAt: it['Stage Updated At'], customer: it['Customer'] || '', category: it['Category'] || '',
    serial: it['Serial No'] || '', warranty: it['Warranty'] || '', repeat: parseInt(it['Repeat Count'], 10) || 0,
    fault: it['Fault Code'] || '', cost: it['Repair Cost'] === '' || it['Repair Cost'] == null ? '' : it['Repair Cost']
  };
}
// "🔋 Battery · 2 Wheeler · LFP-48V"
const itemDesc = it => typeIco(it.itemType) + ' ' + esc([it.itemType, it.category, it.model].filter(Boolean).join(' · '));
const typeIco = t => String(t).toLowerCase().indexOf('charg') !== -1 ? '⚡' : '🔋';

function openBoard() { if (!$('boardDateFilter').value) $('boardDateFilter').value = todayStr(); boardLoad(true); }

async function boardLoad(force) {
  const c = cacheGet('board_items');
  if (c && !force) { boardItems = c.val || []; boardRender(); if (c.fresh) return; }
  else if (!boardItems.length) { $('boardPending').innerHTML = '<div class="skeleton sk-card"></div>'; $('boardActive').innerHTML = ''; }
  try {
    const r = await api({ action: 'getItems' });
    if (!r || !r.ok) { toast('❌ ' + ((r && r.msg) || 'Could not load items')); return; }
    boardItems = (r.items || []).map(mapItem); cacheSet('board_items', boardItems); boardRender();
  } catch (e) { if (e !== 'auth') $('boardPending').innerHTML = '<div class="empty">Could not load data ❌</div>'; }
}

function boardRender() {
  const live = it => String(it.status).toLowerCase() !== 'dispatched';
  const pending = boardItems.filter(it => live(it) && !it.planned);
  const df = $('boardDateFilter').value;
  const active = boardItems.filter(it => live(it) && it.planned && (!df || it.planDate === df));
  $('pendCount').textContent = pending.length; $('repairCount').textContent = active.length;

  // pending list
  if (!pending.length) $('boardPending').innerHTML = '<div class="empty">No pending items ✅</div>';
  else {
    const n = Object.keys(boardSel).filter(k => boardSel[k]).length;
    $('boardPending').innerHTML =
      '<div class="ms-list">' + pending.map(it =>
        '<label class="ms-opt"><input type="checkbox" data-id="' + esc(it.itemId) + '"' + (boardSel[it.itemId] ? ' checked' : '') + ' onchange="boardToggle(this)">' +
        '<span><b>' + esc(it.itemId) + '</b> · ' + esc(it.customer) + ' ' + repeatTag(it.repeat) + '<br><small>' + itemDesc(it) + (it.serial ? ' · SN ' + esc(it.serial) : '') + '</small></span></label>'
      ).join('') + '</div>' +
      '<div class="board-pick"><input type="date" id="boardPlanDate" value="' + todayStr() + '">' +
      '<button class="btn btn-primary" onclick="boardAddSelected(this)">➕ Plan (<span id="selN">' + n + '</span>)</button></div>';
  }

  // planned cards
  $('boardActive').innerHTML = active.length ? active.map(it => {
    const idx = STAGES.indexOf(it.status), inPlan = idx === -1, last = STAGES.length - 1;
    const pct = inPlan ? 0 : Math.round((idx + 1) / STAGES.length * 100);
    const opts = STAGES.map(s => '<option value="' + esc(s) + '"' + (s === it.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    return '<div class="board-card' + (idx === last ? ' ready' : '') + '">' +
      '<div class="bc-top"><span class="bc-id">' + esc(it.itemId) + '</span>' +
        '<button class="bc-remove" title="Move back to Pending" data-id="' + esc(it.itemId) + '" onclick="boardRemovePlan(this.dataset.id)">✕</button></div>' +
      '<div class="bc-cust">' + esc(it.customer || '—') + '</div>' +
      '<div class="bc-meta">' + itemDesc(it) + ' · 📅 ' + esc(it.planDate) + '</div>' +
      '<div class="bc-info">' + (it.serial ? '<span>SN ' + esc(it.serial) + '</span>' : '') + repeatTag(it.repeat) +
        (it.warranty ? '<span>' + esc(it.warranty) + '</span>' : '') + '</div>' +
      '<button type="button" class="bc-fault' + (it.fault ? '' : ' empty') + '" data-id="' + esc(it.itemId) + '" onclick="itemInfoOpen(this.dataset.id)">' +
        (it.fault ? '🔎 ' + esc(it.fault) + (it.cost !== '' ? ' · ' + rupee(it.cost) : '') : '＋ Add fault code &amp; cost') + '</button>' +
      '<div class="bc-prog"><div style="width:' + pct + '%"></div></div>' +
      '<div class="bc-lbl">' + (inPlan ? 'In Planning — pick a stage' : 'Stage ' + (idx + 1) + '/' + STAGES.length + (idx === last ? ' · Ready ✅' : '')) + '</div>' +
      '<select data-id="' + esc(it.itemId) + '" onchange="boardSetStage(this.dataset.id, this.value)">' +
        (inPlan ? '<option value="" selected disabled>-- Select stage --</option>' : '') + opts + '</select>' +
      (it.stageAt ? '<div class="bc-at">Updated: ' + esc(it.stageAt) + '</div>' : '') +
    '</div>';
  }).join('') : '<div class="empty">' + (df ? 'No items planned for this date 📅' : 'No planned items') + '</div>';
}

/* ---- item details: fault code, repair cost, serial, warranty ---- */
function itemInfoOpen(itemId) {
  const it = boardItems.find(x => x.itemId === itemId) || dispItems.find(x => x.itemId === itemId);
  if (!it) return;
  modalOpen('🔎 ' + it.itemId + ' — fault & cost',
    '<div class="muted-sm" style="margin:0 0 14px">' + itemDesc(it) + ' · ' + esc(it.customer) + '</div>' +
    '<div class="form-grid">' +
      '<div class="fg full"><label>Fault Code</label><select id="i_fault">' + optList(M().faultCode, it.fault, '-- Select fault found --') + '</select></div>' +
      fg('Repair Cost (₹)', 'i_cost', 'number', it.cost, ' min="0" step="1" inputmode="decimal" placeholder="0"') +
      '<div class="fg"><label>Warranty</label><select id="i_war">' + optList(CONFIG.WARRANTY || [], it.warranty, '-- Select --') + '</select></div>' +
      fg('Serial No', 'i_serial', 'text', it.serial, ' maxlength="60"') +
    '</div><button class="btn btn-primary btn-block" data-id="' + esc(it.itemId) + '" onclick="itemInfoSave(this)">Save ✓</button>');
}
async function itemInfoSave(btn) {
  const itemId = btn.dataset.id;
  const d = { action: 'setItemInfo', itemId, fault: $('i_fault').value, cost: $('i_cost').value.trim(), warranty: $('i_war').value, serial: $('i_serial').value.trim() };
  if (d.cost !== '' && !(Number(d.cost) >= 0)) return toast('⚠️ Repair cost must be a number');
  const r = await run(d, btn); if (!r) return;
  [boardItems, dispItems].forEach(list => {
    const it = list.find(x => x.itemId === itemId);
    if (it) Object.assign(it, { fault: d.fault, cost: d.cost === '' ? '' : Number(d.cost), warranty: d.warranty, serial: d.serial, repeat: r.repeat !== undefined && d.serial !== it.serial ? r.repeat : it.repeat });
  });
  modalClose(); cacheDel('board_items'); cacheDel('tracker');
  toast(r.changed ? '✅ Saved' + (r.repeat ? ' — 🔁 this serial came ' + r.repeat + ' time(s) before' : '') : 'ℹ️ Nothing changed');
  if (CURRENT === 'board') boardRender(); else if (CURRENT === 'dispatch') dispRender();
}

function boardToggle(el) {
  boardSel[el.dataset.id] = el.checked;
  const s = $('selN'); if (s) s.textContent = Object.keys(boardSel).filter(k => boardSel[k]).length;
}

async function boardAddSelected(btn) {
  const ids = Object.keys(boardSel).filter(k => boardSel[k]);
  if (!ids.length) return toast('⚠️ Select at least one item');
  const planDate = $('boardPlanDate').value || todayStr();
  const r = await run({ action: 'markPlanning', itemIds: JSON.stringify(ids), planDate }, btn);
  if (!r) return;
  boardSel = {}; toast('✅ ' + r.updated + ' item(s) planned for ' + planDate);
  $('boardDateFilter').value = planDate; cacheDel('tickets'); cacheDel('tracker'); boardLoad(true);
}

async function boardRemovePlan(itemId) {
  if (!confirm(itemId + ' — move back to Pending?')) return;
  const r = await run({ action: 'removePlanning', itemId }); if (!r) return;
  toast('↩️ ' + itemId + ' moved back to Pending'); boardLoad(true);
}

async function boardSetStage(itemId, stage) {
  if (!stage) return;
  const it = boardItems.find(x => x.itemId === itemId);
  const prev = it ? it.status : '';
  if (it) { it.status = stage; it.stageAt = 'just now'; boardRender(); }
  const r = await run({ action: 'updateStage', itemId, stage });
  if (!r) { if (it) { it.status = prev; boardRender(); } return; }
  cacheSet('board_items', boardItems); cacheDel('tickets'); cacheDel('tracker');
  if (stage === STAGES[STAGES.length - 1]) toast('✅ ' + itemId + ' is ready — it will appear in Dispatch');
}

/* ============================================================
   PHASE 3 — DISPATCH
   ============================================================ */
let dispItems = [];
let dispSel = {};

function openDispatch() {
  $('d_date').value = todayStr();
  $('d_by').innerHTML = optList(M().dispatchedBy, $('d_by').value, '-- Select name --');
  ensureMasters().then(() => { $('d_by').innerHTML = optList(M().dispatchedBy, $('d_by').value, '-- Select name --'); });
  dispLoad(true);
}

async function dispLoad() {
  $('dList').innerHTML = '<div class="skeleton sk-card"></div>';
  try {
    const r = await api({ action: 'getItems' });
    if (!r || !r.ok) { toast('❌ ' + ((r && r.msg) || 'Could not load')); return; }
    const last = STAGES[STAGES.length - 1];
    dispItems = (r.items || []).map(mapItem).filter(it => it.status === last);
    dispSel = {}; dispRender();
  } catch (e) { if (e !== 'auth') $('dList').innerHTML = '<div class="empty">Could not load data ❌</div>'; }
}

function dispRender() {
  const q = $('dSearch').value.toLowerCase().trim();
  const rows = dispItems.filter(it => !q || (it.itemId + ' ' + it.ticketId + ' ' + it.customer + ' ' + it.category + ' ' + it.model + ' ' + it.serial).toLowerCase().indexOf(q) !== -1);
  $('dList').innerHTML = rows.length ? rows.map(it =>
    '<label class="ms-opt"><input type="checkbox" data-id="' + esc(it.itemId) + '"' + (dispSel[it.itemId] ? ' checked' : '') + ' onchange="dispToggle(this)">' +
    '<span class="ms-main"><b>' + esc(it.itemId) + '</b> · ' + esc(it.customer) + ' ' + repeatTag(it.repeat) + '<br><small>' + itemDesc(it) + (it.serial ? ' · SN ' + esc(it.serial) : '') + '</small>' +
    '<button type="button" class="bc-fault' + (it.fault ? '' : ' empty') + '" data-id="' + esc(it.itemId) + '" onclick="event.preventDefault();itemInfoOpen(this.dataset.id)">' +
      (it.fault ? '🔎 ' + esc(it.fault) + (it.cost !== '' ? ' · ' + rupee(it.cost) : '') : '⚠️ No fault code — add') + '</button></span></label>'
  ).join('') : '<div class="empty">' + (dispItems.length ? 'No matches 🔍' : 'No items at Final QC & Pack ✅') + '</div>';
  $('dSelCount').textContent = Object.keys(dispSel).filter(k => dispSel[k]).length;
}

function dispToggle(el) {
  const id = el.dataset.id;
  if (el.checked) {
    // one dispatch = one ticket (single address / transport)
    const tid = (dispItems.find(x => x.itemId === id) || {}).ticketId;
    const other = Object.keys(dispSel).filter(k => dispSel[k]).map(k => (dispItems.find(x => x.itemId === k) || {}).ticketId).find(x => x !== tid);
    if (other) { el.checked = false; return toast('⚠️ One dispatch can only include items from one ticket — dispatch ' + other + ' first'); }
  }
  dispSel[id] = el.checked;
  $('dSelCount').textContent = Object.keys(dispSel).filter(k => dispSel[k]).length;
}

async function dispSubmit() {
  const ids = Object.keys(dispSel).filter(k => dispSel[k]);
  if (!ids.length) return toast('⚠️ Select at least one item');
  const d = {
    action: 'dispatch', itemIds: JSON.stringify(ids), dispatchDate: $('d_date').value, dispatchedBy: $('d_by').value.trim(),
    transport: $('d_transport').value.trim(), charges: $('d_cost').value.trim(), actualProblem: $('d_problem').value.trim(),
    address: $('d_address').value.trim(), remarks: $('d_remarks').value.trim()
  };
  if (!d.dispatchDate) return toast('⚠️ Enter dispatch date');
  if (!d.dispatchedBy) return toast('⚠️ Select Dispatched By');
  if (d.charges !== '' && !(Number(d.charges) >= 0)) return toast('⚠️ Dispatch charges must be a number');
  const noFault = dispItems.filter(it => dispSel[it.itemId] && !it.fault).length;
  if (!confirm((noFault ? '⚠️ ' + noFault + ' item(s) have no fault code — the fault report will miss them.\n\n' : '') + ids.length + ' item(s) will be dispatched. Continue?')) return;
  const r = await run(d, $('dSubmit')); if (!r) return;

const sel = dispItems.filter(it => dispSel[it.itemId]);
  let tk = null;
  try { const g = await api({ action: 'getTicket', ticketId: (r.tickets || [])[0] }); if (g && g.ok) tk = g.ticket; } catch (e) {}
  dispSlip(sel, d, r, tk);
  ['d_transport', 'd_cost', 'd_problem', 'd_address', 'd_remarks'].forEach(id => { $(id).value = ''; });
  cacheDel('board_items'); cacheDel('tickets'); cacheDel('tracker');
  dispLoad();
}

function dispSlip(sel, d, r, tk) {
  let wa = '';
  if (tk) {
    const nb = sel.filter(i => i.itemType === 'Battery').length;
    wa = waBtn(tk['Ticket ID'], 'dispatched', waUrl(tk['Phone'], waFill((CONFIG.WA_TEMPLATES || {}).dispatched, {
      name: tk['Contact Person'], id: tk['Ticket ID'], items: itemsText(nb, sel.length - nb),
      date: niceDate(d.dispatchDate), transport: d.transport, link: trackLink(tk)
    })), 'Send "Dispatched" on WhatsApp', '');
  }
  const html =
    '<div class="slip" id="slip">' +
      slipHead('Dispatch Slip', d.dispatchDate) +
      '<div class="slip-sec">Ticket: <b>' + esc((r.tickets || []).join(', ')) + '</b> · ' + esc(sel[0] ? sel[0].customer : '') + '</div>' +
      kv([['Dispatched By', d.dispatchedBy], ['Transport', d.transport], ['Address', d.address], ['Charges', rupee(d.charges)], ['Problem Found', d.actualProblem]]) +
      '<table class="slip-table"><tr><th>#</th><th>Item ID</th><th>Item</th><th>Type</th><th>Model</th><th>Serial No</th><th>Fault</th></tr>' +
      sel.map((it, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(it.itemId) + '</td><td>' + esc(it.itemType) + '</td><td>' + esc(it.category || '—') + '</td><td>' + esc(it.model || '—') +
        '</td><td>' + esc(it.serial || '—') + '</td><td>' + esc(it.fault || '—') + '</td></tr>').join('') +
      '</table>' +
'<div class="slip-sign"><div>Dispatched by (Litpax)</div><div>Received by (Customer / Transporter)</div></div>' +
    '</div><button class="btn btn-primary btn-block" onclick="slipPrint()">🖨️ Print Slip</button>' +
    (wa ? '<div class="wa-after">' + wa + '</div>' : '');
  modalOpen('✅ ' + r.dispatched + ' item(s) dispatched', html);
}

function slipPrint() {
  const w = window.open('', '_blank'); if (!w) return toast('⚠️ Popup blocked — allow popups to print');
  const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join(''); } catch (e) { return ''; } }).join('');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dispatch Slip</title><style>' + css + 'body{background:#fff;padding:24px}</style></head><body>' + $('slip').outerHTML + '</body></html>');
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* ============================================================
   MASTERS (admin) — dropdown lists, also editable in the sheet
   ============================================================ */
const MST_LISTS = [
  ['attendedBy',   'Attended By',   'Names in the call log dropdown',          '🎧'],
  ['dispatchedBy', 'Dispatched By', 'Names in the Dispatch form dropdown',     '🚚'],
  ['batteryType',  'Battery Type',  'Types offered when receiving batteries',  '🔋'],
['chargerType',  'Charger Type',  'Types offered when receiving chargers',   '⚡'],
  ['dealer',       'Dealer',        'Dealers in the New Ticket form',          '🏪'],
  ['complaint',    'Complaint',     'What the customer reports (New Ticket)',  '⚠️'],
  ['faultCode',    'Fault Code',    'Fault found by the repair team',          '🔎'],
  ['customerType', 'Customer Type', 'Who the customer is (New Ticket)',        '👤'],
  ['source',       'Source',        'How the customer reached us (New Ticket)', '📣'],
  ['checks',       'Troubleshooting', 'Checklist in the call log',             '🧰'],
  ['callFix',      'Call Fix',      'What solved it on call',                  '✅'],
  ['condition',    'Condition',     'Item condition when received',            '📦'],
  ['accessory',    'Accessory',     'Things received along with the items',    '🔌']
];

function openMasters() {
  mstRender();
  ensureMasters(true).then(mstRender);
}

function mstRender() {
  const m = M();
  $('mstGrid').innerHTML = MST_LISTS.map(([k, label, sub, ico]) => {
    const list = m[k] || [];
    return '<div class="card mst-card">' +
      '<div class="card-head"><span>' + ico + ' ' + label + ' <b class="count">' + list.length + '</b></span></div>' +
      '<div class="mst-sub">' + sub + '</div>' +
      '<div class="mst-list">' + (list.length
        ? list.map(v => '<span class="mst-chip">' + esc(v) +
            '<button type="button" title="Remove" data-k="' + k + '" data-v="' + esc(v) + '" onclick="mstRemove(this)">✕</button></span>').join('')
        : '<div class="empty sm">No entries yet</div>') + '</div>' +
      '<div class="mst-add"><input id="mst_' + k + '" maxlength="100" placeholder="Add ' + label.toLowerCase() + '" ' +
        'onkeydown="if(event.key===\'Enter\')mstAdd(\'' + k + '\')">' +
        '<button class="btn btn-primary" id="mstBtn_' + k + '" onclick="mstAdd(\'' + k + '\')">Add</button></div>' +
    '</div>';
  }).join('');
}

async function mstAdd(k) {
  const inp = $('mst_' + k), v = inp.value.trim();
  if (!v) return toast('⚠️ Enter a value');
  const r = await run({ action: 'addMaster', list: k, value: v }, $('mstBtn_' + k));
  if (!r) return;
  MASTERS = r.masters; cacheSet('masters', MASTERS);
  toast('✅ "' + v + '" added'); mstRender();
  const n = $('mst_' + k); if (n) n.focus();
}

async function mstRemove(el) {
  const k = el.dataset.k, v = el.dataset.v;
  if (!confirm('Remove "' + v + '"? Old records keep their value.')) return;
  const r = await run({ action: 'removeMaster', list: k, value: v });
  if (!r) return;
  MASTERS = r.masters; cacheSet('masters', MASTERS);
  toast('🗑️ "' + v + '" removed'); mstRender();
}

/* ---------- LOGIN INTRO — technician story; the login card comes out of the battery ---------- */
(function () {
  const root = document.documentElement;
  if (!root.classList.contains('play-intro')) return;

  const card = document.querySelector('.login-card'), mouth = document.querySelector('.ws-mouth');
  try { localStorage.setItem('hub_intro_at', String(Date.now())); } catch (e) {}
  const timers = [];
  let ended = false;

  // start the card inside the open battery, then fly it to its real place
  function fly() {
    if (!card) return;
    const m = mouth ? mouth.getBoundingClientRect() : null, c = card.getBoundingClientRect();
    const ok = m && m.width > 0;
    const ox = ok ? m.left + m.width / 2 : c.left + c.width / 2;
    const oy = ok ? m.top + m.height / 2 : c.top + c.height / 2;
    card.style.setProperty('--dx', Math.round(ox - (c.left + c.width / 2)) + 'px');
    card.style.setProperty('--dy', Math.round(oy - (c.top + c.height / 2)) + 'px');
    card.classList.add('card-start');
    void card.offsetWidth; // apply the start position before animating
    card.classList.add('card-out');
  }
  function end() {
    if (ended) return;
    ended = true;
    timers.forEach(clearTimeout);
    root.classList.remove('play-intro', 'intro-reveal');
    if (card) {
      card.classList.remove('card-start', 'card-out');
      card.style.removeProperty('--dx'); card.style.removeProperty('--dy');
    }
    document.removeEventListener('click', end, true);
    window.removeEventListener('keydown', end);
  }

  timers.push(setTimeout(fly, 5900));
  timers.push(setTimeout(() => root.classList.add('intro-reveal'), 9000));
  timers.push(setTimeout(end, 10400));
  document.addEventListener('click', end, true);
  window.addEventListener('keydown', end);
})();

/* ============================================================
   TICKET TRACKER — every ticket, every step, SLA
   ============================================================ */
let TRK = [], trkFilter = 'open', trkStage = '', trkTimer = 0;
const TRK_STEPS = ['Registered', 'Service call', 'Pickup', 'Received', 'Repair', 'Dispatched'];
const TRK_NOW = ['', 'Awaiting first call', 'Awaiting pickup', 'In transit', 'In repair', 'Ready to dispatch'];
const TRK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SLA_DEF = { firstCall: 4, transit: 72, queue: 24, repair: 72, dispatch: 24 };
const slaMs = k => ((CONFIG.SLA_HOURS || {})[k] || SLA_DEF[k]) * 3600e3;
const TRK_CHIPS = [['open', 'Open'], ['late', '🔴 Delayed'], ['risk', '🟡 At risk'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['all', 'All']];

function tsOf(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0;
}
function fmtDur(ms) {
  if (!(ms > 0)) return '0m';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return d + 'd ' + (h % 24) + 'h';
  if (h) return h + 'h ' + (m % 60) + 'm';
  return m + 'm';
}
function fmtDT(ts) { if (!ts) return ''; const d = new Date(ts); return d.getDate() + ' ' + TRK_MON[d.getMonth()] + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDay(ts) { const d = new Date(ts); return d.getDate() + ' ' + TRK_MON[d.getMonth()]; }

// everything about one ticket, calculated
function trkModel(t) {
  const now = Date.now(), ST = CONFIG.STAGES || [], last = ST[ST.length - 1];
  const created = tsOf(t.createdAt), call = tsOf(t.firstCallAt), pick = tsOf(t.pickupSetAt), recv = tsOf(t.receivedDate);
  const cancelled = t.status === 'Cancelled', closed = t.status === 'Closed' || cancelled, closedAt = closed ? (tsOf(t.closedAt) || now) : 0;
  const solved = t.outcome === 'Solved on Call', sent = t.batterySent === 'Yes';

  const items = (t.items || []).map(it => {
    const ev = it.events || [], times = n => ev.filter(e => e.e === n).map(e => tsOf(e.t)).filter(Boolean);
    const isDisp = String(it.status || '').toLowerCase() === 'dispatched';
    const planned = times('Planned').sort((a, b) => a - b)[0] || 0;
    const qc = times(last).sort((a, b) => b - a)[0] || 0;
    const disp = times('Dispatched').sort((a, b) => b - a)[0] || 0;
    const idx = ST.indexOf(it.status);
    return Object.assign({}, it, { isDisp, planned, disp, qc: qc || (isDisp ? disp : 0), step: isDisp ? ST.length : (idx >= 0 ? idx + 1 : 0) });
  });
  const nItems = items.length, nDisp = items.filter(i => i.isDisp).length, qcCount = items.filter(i => i.qc).length;
  const repStart = items.reduce((a, i) => (i.planned && (!a || i.planned < a)) ? i.planned : a, 0);
  const qcDone = nItems && qcCount === nItems ? Math.max(...items.map(i => i.qc)) : 0;

  const list = solved ? ['Registered', 'Service call', 'Solved on call'] : TRK_STEPS;
  const times = solved ? [created, call || closedAt, closedAt]
    : [created, call, pick || (sent ? created : 0), recv, qcDone, closedAt];
  let curIdx = 1;
  for (let i = times.length - 1; i >= 0; i--) if (times[i]) { curIdx = i + 1; break; }
  const lastTs = Math.max(...times.filter(Boolean), created);

  const segDefs = [
    { k: 'firstCall', label: 'First response', from: created, to: call || recv || (solved ? closedAt : 0) },
    { k: 'transit', label: 'Pickup → received', from: pick || (sent ? created : 0), to: recv },
    { k: 'queue', label: 'Received → repair start', from: recv, to: repStart },
    { k: 'repair', label: 'Repair → Final QC', from: repStart, to: qcDone },
    { k: 'dispatch', label: 'Final QC → dispatch', from: qcDone, to: (closed && !solved) ? closedAt : 0 }
  ];
  const segs = segDefs.map(s => {
    const tgt = slaMs(s.k);
    if (!s.from || (solved && s.k !== 'firstCall')) return Object.assign(s, { tgt, state: 'todo', dur: 0 });
    const running = !s.to && !closed, end = s.to || (closed ? closedAt : now);
    const dur = Math.max(0, end - s.from), r = dur / tgt;
    return Object.assign(s, { tgt, dur, running, state: running ? (r > 1 ? 'late' : r > .75 ? 'risk' : 'ok') : (r > 1 ? 'late-done' : 'done') });
  });
  const run = segs.find(s => s.running);
  const sla = cancelled ? 'cancelled' : closed ? (segs.some(s => s.state === 'late-done') ? 'closed-late' : 'closed') : (run ? run.state : 'ok');

  let eta = 0;
  if (!closed && !solved) {
    eta = now + segs.reduce((a, s) => a + (s.state === 'todo' ? s.tgt : s.running ? Math.max(s.tgt - s.dur, 0) : 0), 0);
  }
  const itemFrac = nItems ? items.reduce((a, i) => a + i.step / (ST.length || 1), 0) / nItems : 0;
  const pct = closed ? 100 : Math.round(((curIdx - 1) + (curIdx === 5 ? itemFrac : 0)) / (list.length - 1) * 100);
  const nowLabel = cancelled ? 'Cancelled' : closed ? 'Completed' : (curIdx === 5 && !repStart ? 'Waiting for repair' : TRK_NOW[Math.min(curIdx, 5)]);

  return {
    t, created, closed, cancelled, closedAt, solved, list, times, curIdx, nowLabel, pct, sla, segs, eta,
    inStageMs: now - lastTs, ageMs: (closed ? closedAt : now) - created,
    items, nItems, nDisp, qcCount,
    respMs: segs[0].state === 'done' || segs[0].state === 'late-done' ? segs[0].dur : 0,
    repairMs: segs[3].state === 'done' || segs[3].state === 'late-done' ? segs[3].dur : 0
  };
}

function openTracker() {
  trkLoad(false);
  clearInterval(trkTimer);
  trkTimer = setInterval(() => {
    if (CURRENT !== 'tracker') return clearInterval(trkTimer);
    if (document.visibilityState === 'visible') trkLoad(true);
  }, 60000);
}

async function trkLoad(silent) {
  const c = cacheGet('tracker');
  if (c && !TRK.length) { TRK = c.val || []; trkRender(); }
  if (!TRK.length && !silent) $('trkList').innerHTML = '<div class="skeleton sk-card"></div>'.repeat(3);
  try {
    const r = await api({ action: 'getTracker' });
    if (!r || !r.ok) { if (!silent) toast('❌ ' + ((r && r.msg) || 'Could not load tracker')); return; }
    TRK = r.tickets || []; cacheSet('tracker', TRK); trkRender();
  } catch (e) { if (e !== 'auth' && !silent && !TRK.length) $('trkList').innerHTML = '<div class="empty">Could not load data ❌</div>'; }
}

function trkSetFilter(f) { trkFilter = f; trkRender(); }
function trkSetStage(s) { trkStage = trkStage === s ? '' : s; if (trkStage) trkFilter = 'open'; trkRender(); }
function trkMatch(m, f) {
  if (f === 'all') return true;
  if (f === 'open') return !m.closed;
  if (f === 'closed') return m.closed && !m.cancelled;
  if (f === 'cancelled') return m.cancelled;
  return !m.closed && m.sla === f;
}

function trkRender() {
  const every = TRK.map(trkModel), all = every.filter(m => !m.cancelled), open = all.filter(m => !m.closed), closedM = all.filter(m => m.closed);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const since = Date.now() - 30 * 864e5, today = todayStr();

  // KPIs
  const tat = avg(closedM.filter(m => !m.solved && m.closedAt >= since).map(m => m.ageMs));
  const resp = avg(all.filter(m => m.respMs > 0).map(m => m.respMs));
  const rep = avg(all.filter(m => m.repairMs > 0).map(m => m.repairMs));
  const solvedPct = closedM.length ? Math.round(closedM.filter(m => m.solved).length / closedM.length * 100) : 0;
  const late = open.filter(m => m.sla === 'late').length, risk = open.filter(m => m.sla === 'risk').length;
  const kpi = (lbl, val, cls, sub) => '<div class="kpi ' + (cls || '') + '"><span>' + lbl + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  $('trkKpis').innerHTML =
    kpi('Open tickets', open.length) +
    kpi('Raised today', all.filter(m => String(m.t.createdAt).slice(0, 10) === today).length) +
    kpi('Delayed', late, late ? 'late' : 'good', 'past SLA') +
    kpi('At risk', risk, risk ? 'risk' : 'good', '75%+ of SLA used') +
    kpi('Avg turnaround', tat ? fmtDur(tat) : '—', '', 'last 30 days') +
    kpi('Avg first response', resp ? fmtDur(resp) : '—', resp && resp <= slaMs('firstCall') ? 'good' : '', 'target ' + fmtDur(slaMs('firstCall'))) +
    kpi('Avg repair time', rep ? fmtDur(rep) : '—', rep && rep <= slaMs('repair') ? 'good' : '', 'target ' + fmtDur(slaMs('repair'))) +
    kpi('Solved on call', solvedPct + '%', '', 'of closed tickets');

  // where open tickets are right now
  $('trkStages').innerHTML = [[1, 'Awaiting first call'], [2, 'Awaiting pickup'], [3, 'In transit'], [4, 'In repair'], [5, 'Ready to dispatch']].map(([idx, lbl]) => {
    const n = open.filter(m => m.curIdx === idx).length, w = open.length ? Math.round(n / open.length * 100) : 0;
    return '<button class="trk-st' + (trkStage === String(idx) ? ' on' : '') + '" onclick="trkSetStage(\'' + idx + '\')"><b>' + n + '</b><span>' + lbl + '</span><div class="bar"><i style="width:' + w + '%"></i></div></button>';
  }).join('');

  // chips
  $('trkChips').innerHTML = TRK_CHIPS.map(([k, l]) => {
    const n = every.filter(m => trkMatch(m, k)).length;
    return '<button class="chip' + (k === trkFilter ? ' active' : '') + ((k === 'late' || k === 'risk') && n ? ' chip-red' : '') +
      '" onclick="trkSetFilter(\'' + k + '\')">' + l + ' <b>' + n + '</b></button>';
  }).join('');

  // list
  const q = ($('trkSearch').value || '').toLowerCase().trim();
  const rank = { late: 0, risk: 1, ok: 2, 'closed-late': 3, closed: 3, cancelled: 4 };
  const rows = every.filter(m => trkMatch(m, trkFilter) && (!trkStage || (!m.closed && String(m.curIdx) === trkStage)))
    .filter(m => !q || [m.t.id, m.t.company, m.t.person, m.t.phone, m.t.brand, m.t.city, m.t.complaint].join(' ').toLowerCase().indexOf(q) !== -1)
    .sort((a, b) => (rank[a.sla] - rank[b.sla]) || (b.created - a.created));
  $('trkList').innerHTML = rows.length ? rows.map(trkCard).join('') : '<div class="empty">' + (TRK.length ? 'No tickets here 🔍' : 'No tickets yet ✅') + '</div>';
}

function trkCard(m) {
  const t = m.t;
  const badge = { late: ['🔴 Delayed', 'late'], risk: ['🟡 At risk', 'risk'], ok: ['🟢 On track', 'ok'],
    closed: ['✅ Completed', 'done'], 'closed-late': ['✅ Completed · late', 'donelate'], cancelled: ['🚫 Cancelled', 'donelate'] }[m.sla];
  const steps = m.list.map((lbl, i) => {
    const cls = (i < m.curIdx || m.closed) ? 'done' : (i === m.curIdx ? 'now ' + m.sla : '');
    const tm = m.times[i] ? fmtDT(m.times[i]) : '';
    return '<div class="tr-step ' + cls + '"><span class="tr-dot"></span><span class="tr-lbl">' + esc(lbl) + '</span><span class="tr-tm">' + esc(tm) + '</span></div>';
  }).join('');
  const foot = [];
  if (!m.closed) foot.push('<span>⏱ ' + esc(m.nowLabel) + ' for <b>' + fmtDur(m.inStageMs) + '</b></span>');
  foot.push('<span>' + (m.closed ? 'Turnaround' : 'Age') + ' <b>' + fmtDur(m.ageMs) + '</b></span>');
  if (m.nItems) foot.push('<span>📦 ' + m.nItems + ' item' + (m.nItems > 1 ? 's' : '') + ' · ' + m.qcCount + '/' + m.nItems + ' QC' + (m.nDisp ? ' · ' + m.nDisp + ' dispatched' : '') + '</span>');
  if (m.eta) foot.push('<span>🎯 Ready by <b>' + fmtDay(m.eta) + '</b></span>');
  return '<div class="tr-card ' + (m.closed ? '' : m.sla) + '" style="--p:' + m.pct + '%" data-id="' + esc(t.id) + '" onclick="trkOpen(this.dataset.id)">' +
    '<div class="tr-top"><span class="tr-id">' + esc(t.id) + '</span><span class="tr-badge ' + badge[1] + '">' + badge[0] + '</span></div>' +
    '<div class="tr-co">' + esc(t.company) + ' <span>· ' + esc(t.person) + (t.brand ? ' · 🏪 ' + esc(t.brand) : '') + (t.city ? ' · 📍 ' + esc(t.city) : '') +
      (t.complaint ? ' · ⚠️ ' + esc(t.complaint) : '') + '</span></div>' +
    '<div class="tr-steps">' + steps + '</div>' +
    '<div class="tr-foot">' + foot.join('') + '</div></div>';
}

function trkEvLabel(e) {
  const ST = CONFIG.STAGES || [], last = ST[ST.length - 1];
  if (e === 'Planned') return 'Planned for repair';
  if (e === 'Dispatched') return 'Dispatched';
  if (e === 'Removed from plan') return 'Removed from plan';
  if (e === last) return 'Final QC & Pack — ready';
  return 'Repair stage: ' + e;
}

function trkOpen(id) {
  const raw = TRK.find(x => x.id === id);
  if (!raw) return;
  const m = trkModel(raw), t = raw, ST = CONFIG.STAGES || [];

  const sum = '<div class="trd-sum">' +
    '<div><span>Now</span><b>' + esc(m.nowLabel) + '</b></div>' +
    '<div><span>' + (m.closed ? 'Turnaround' : 'Age') + '</span><b>' + fmtDur(m.ageMs) + '</b></div>' +
    '<div><span>' + (m.closed ? 'Closed on' : 'Ready by') + '</span><b>' + (m.closed ? fmtDT(m.closedAt) : (m.eta ? fmtDay(m.eta) : '—')) + '</b></div></div>';

  const SLA_TXT = { todo: ['—', 'muted'], ok: ['On track', 'ok'], risk: ['At risk', 'risk'], late: ['Delayed', 'late'], done: ['Within SLA', 'ok'], 'late-done': ['Late', 'late'] };
  const sla = '<div class="trd-h2">⏱ SLA</div><table class="trd-sla"><tr><th>Step</th><th>Target</th><th>Actual</th><th></th></tr>' +
    m.segs.map(s => '<tr><td>' + s.label + '</td><td>' + fmtDur(s.tgt) + '</td><td>' + (s.state === 'todo' ? '—' : fmtDur(s.dur) + (s.running ? ' <small>(running)</small>' : '')) +
      '</td><td><span class="tr-pill ' + SLA_TXT[s.state][1] + '">' + SLA_TXT[s.state][0] + '</span></td></tr>').join('') + '</table>';

  const items = m.nItems ? '<div class="trd-h2">📦 Items</div><div class="trd-items">' + m.items.map(it =>
    '<div class="trd-item"><div class="r1"><b>' + (/charg/i.test(it.type || '') ? '⚡ ' : '🔋 ') + esc(it.id) + '</b><span>' +
    esc([it.category, it.model].filter(Boolean).join(' · ')) + '</span></div>' +
    ((it.serial || it.fault) ? '<div class="r1"><span>' + esc([it.serial && 'SN ' + it.serial, it.fault && 'Fault: ' + it.fault].filter(Boolean).join(' · ')) + '</span>' + repeatTag(it.repeat) + '</div>' : '') +
    '<div class="r1"><span>' + esc(it.isDisp ? 'Dispatched' : (it.status || 'Received')) + '</span><span>' + it.step + '/' + ST.length + '</span></div>' +
    '<div class="bar"><i style="width:' + Math.round(it.step / (ST.length || 1) * 100) + '%"></i></div></div>').join('') + '</div>' : '';

  const evs = [], add = (ts, title, sub, tag) => { if (ts) evs.push({ ts, title, sub, tag }); };
  add(m.created, 'Ticket registered', t.createdBy ? 'by ' + t.createdBy : '');
  add(tsOf(t.firstCallAt), 'First service call', t.calls + ' call' + (t.calls === 1 ? '' : 's') + ' logged');
  add(tsOf(t.pickupSetAt), 'Pickup arranged', [t.pickupBy && 'by ' + t.pickupBy, t.transport, t.lr && 'LR ' + t.lr].filter(Boolean).join(' · '));
  add(tsOf(t.receivedDate), 'Received at service center', m.nItems + ' item' + (m.nItems === 1 ? '' : 's'));
  (t.items || []).forEach(it => {
    const tag = (/charg/i.test(it.type || '') ? '⚡ #' : '🔋 #') + String(it.id).split('-').pop();
    (it.events || []).forEach(e => add(tsOf(e.t), trkEvLabel(e.e), e.by ? 'by ' + e.by : '', tag));
  });
  if (m.closed) add(m.closedAt, m.cancelled ? 'Ticket cancelled' : m.solved ? 'Solved on call — closed' : 'Ticket closed', m.cancelled ? t.cancelReason : (t.outcome || ''));
  evs.sort((a, b) => a.ts - b.ts);
  const tl = '<div class="trd-h2">🧭 Full timeline</div><div class="trd-tl">' + (evs.length ? evs.map((e, i) =>
    '<div class="trd-ev"><span class="trd-dot"></span><div><div class="trd-h"><b>' + esc(e.title) + '</b><span>' + fmtDT(e.ts) + '</span></div>' +
    (e.tag ? '<span class="trd-tag">' + esc(e.tag) + '</span>' : '') + '<span class="trd-sub">' + esc(e.sub || '') + '</span>' +
    (i ? '<div class="trd-gap">+' + fmtDur(e.ts - evs[i - 1].ts) + ' after previous step</div>' : '') + '</div></div>'
  ).join('') : '<div class="empty sm">No events yet</div>') + '</div>';

  modalOpen('🛰️ ' + t.id + ' · ' + t.company, sum + sla + items + tl);
}

/* ============================================================
   SETTINGS — values come from the "Settings" tab of the sheet (config.js is only a fallback)
   ============================================================ */
let SETTINGS = null;
const SCREEN_NEED = { newTicket: 'create', board: 'repair', dispatch: 'repair', masters: 'admin', settings: 'admin' };
const ROLE_OF_NAV = { NAV_ATTENDANT: 'attendant', NAV_SERVICE: 'service', NAV_REPAIR: 'repair', NAV_ADMIN: 'admin' };

async function ensureSettings(force) {
  const c = cacheGet('settings');
  if (!force && SETTINGS) return SETTINGS;
  if (!force && c && c.fresh) { SETTINGS = c.val; return SETTINGS; }
  try {
    const r = await api({ action: 'getSettings' });
    if (r && r.ok) { SETTINGS = r; cacheSet('settings', r); }
  } catch (e) {}
  return SETTINGS || (c && c.val) || null;
}

// copy sheet values into CONFIG — the rest of the app keeps reading CONFIG as before
function applySettings(S) {
  if (!S || !S.cfg) return;
  const c = S.cfg;
  if (c.STAGES && c.STAGES.length >= 2) CONFIG.STAGES.splice(0, CONFIG.STAGES.length, ...c.STAGES);
  ['PURCHASE_AGE', 'WARRANTY', 'STATES'].forEach(k => { if (c[k] && c[k].length) CONFIG[k] = c[k]; });
  ['TRACK_URL', 'WA_COUNTRY', 'COMPANY'].forEach(k => { if (c[k]) CONFIG[k] = c[k]; });
  CONFIG.SUPPORT_PHONE = c.SUPPORT_PHONE || '';
  if (c.FEEDBACK_AFTER_DAYS >= 0) CONFIG.FEEDBACK_AFTER_DAYS = c.FEEDBACK_AFTER_DAYS;
  if (c.SLA_HOURS) CONFIG.SLA_HOURS = c.SLA_HOURS;
  if (c.WA_TEMPLATES) CONFIG.WA_TEMPLATES = Object.assign({}, CONFIG.WA_TEMPLATES, c.WA_TEMPLATES);
  const r = role(), R = CONFIG.ROLES[r];
  if (R && c.NAV && c.NAV[r] && c.NAV[r].length) {
    const nav = c.NAV[r].filter(k => SCREENS[k] && (!SCREEN_NEED[k] || can(SCREEN_NEED[k])));
    if (r === 'admin' && nav.indexOf('settings') === -1) nav.push('settings');
    if (nav.length) R.nav = nav;
  }
  if (R && $('appWrap').style.display !== 'none') {
    $('sbNav').innerHTML = R.nav.map(k =>
      '<button class="sb-item' + (k === CURRENT ? ' active' : '') + '" data-nav="' + k + '" onclick="go(this.dataset.nav)"><span class="sb-ico">' + SCREENS[k].icon + '</span>' + SCREENS[k].label + '</button>'
    ).join('');
    if (CURRENT && R.nav.indexOf(CURRENT) === -1) go(R.nav[0]);
  }
}
// other users pick up changes every 5 minutes (or on refresh)
setInterval(() => { if (localStorage.getItem('hub_token') && CURRENT !== 'settings') ensureSettings(true).then(applySettings); }, 300000);

/* ---- Settings screen (admin) ---- */
function openSettings() {
  $('setForm').innerHTML = '<div class="skeleton sk-block"></div><div class="skeleton sk-block"></div>';
  ensureSettings(true).then(setRender);
}

const setList = v => String(v || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);

function setField(x) {
  const id = 'set_' + x.key;
  let input;
  if (x.type === 'tpl') {
    input = '<textarea id="' + id + '" rows="6">' + esc(x.value) + '</textarea>';
  } else if (x.type === 'list' || x.type === 'stages') {
    const l = setList(x.value);
    input = '<textarea id="' + id + '" rows="' + Math.min(10, Math.max(3, l.length)) + '" placeholder="One per line">' + esc(l.join('\n')) + '</textarea>';
  } else if (x.type === 'nav') {
    const r = ROLE_OF_NAV[x.key], perms = CONFIG.PERMS[r] || [], cur = setList(x.value);
    const allowed = Object.keys(SCREENS).filter(k => !SCREEN_NEED[k] || perms.indexOf(SCREEN_NEED[k]) !== -1);
    input = '<div id="' + id + '" class="set-nav">' +
      '<div class="set-checks">' + allowed.map(k => '<label class="set-chk"><input type="checkbox" value="' + k + '"' + (cur.indexOf(k) !== -1 ? ' checked' : '') +
        (r === 'admin' && k === 'settings' ? ' checked disabled' : '') + '> ' + SCREENS[k].icon + ' ' + esc(SCREENS[k].label) + '</label>').join('') + '</div>' +
      '<label class="set-first">Opens after login <select>' + allowed.map(k => '<option value="' + k + '"' + (cur[0] === k ? ' selected' : '') + '>' + esc(SCREENS[k].label) + '</option>').join('') + '</select></label></div>';
  } else {
    input = '<input id="' + id + '" ' + (x.type === 'num' ? 'type="number" min="0" step="any"' : 'type="text"') + ' value="' + esc(x.value) + '">';
  }
  return '<div class="set-row"><div class="set-lbl"><b>' + esc(x.label) + '</b><small>' + esc(x.desc) + '</small></div><div class="set-in">' + input + '</div></div>';
}

function setRender() {
  const rows = (SETTINGS && SETTINGS.rows) || [];
  if (!rows.length) { $('setForm').innerHTML = '<div class="empty">Settings not found — run <b>🔧 Litpax Hub → Setup Sheets</b> once, then refresh.</div>'; return; }
  const groups = {};
  rows.forEach(x => (groups[x.group] = groups[x.group] || []).push(x));
  $('setForm').innerHTML = Object.keys(groups).map(g =>
    '<div class="card set-card"><div class="card-head"><span>' + esc(g) + '</span></div>' + groups[g].map(setField).join('') + '</div>'
  ).join('') +
    '<div class="set-bar"><span>Saved values apply to everyone within 5 minutes (or on refresh). These are also in the <b>Settings</b> tab of the sheet.</span>' +
    '<button id="setSave" class="btn btn-primary" onclick="setSave(this)">Save settings ✓</button></div>';
}

function setRead(x) {
  const el = $('set_' + x.key);
  if (!el) return null;
  if (x.type === 'nav') {
    const on = Array.from(el.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
    const first = el.querySelector('select').value, cur = setList(x.value);
    // keep the saved order; newly ticked screens go to the end
    const rest = cur.filter(k => k !== first && on.indexOf(k) !== -1).concat(on.filter(k => k !== first && cur.indexOf(k) === -1));
    return [first].concat(rest).join(', ');
  }
  if (x.type === 'list' || x.type === 'stages') return setList(el.value).join(', ');
  return x.type === 'tpl' ? el.value.replace(/\r/g, '') : el.value.trim();
}

async function setSave(btn) {
  const vals = {};
  SETTINGS.rows.forEach(x => {
    const v = setRead(x);
    if (v === null) return;
    const old = (x.type === 'list' || x.type === 'stages' || x.type === 'nav') ? setList(x.value).join(', ') : String(x.value);
    if (v !== old) vals[x.key] = v;
  });
  if (!Object.keys(vals).length) return toast('ℹ️ Nothing changed');
  const r = await run({ action: 'saveSettings', values: JSON.stringify(vals) }, btn, true, '⏳ Saving...');
  if (!r) return;
  cacheDel('settings'); SETTINGS = null;
  const S = await ensureSettings(true);
  applySettings(S); setRender();
  ['tickets', 'board_items', 'tracker'].forEach(cacheDel);

  toast('✅ ' + r.saved + ' setting(s) saved');
}

/* ============================================================
   BATTERY MODELS — from the common Master Sheet (same list as PLT / IMS / ERP)
   ============================================================ */
let MODELS = null;
const OTHER_MODEL = 'Other company battery';
const modelKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
const modelOf = v => { const k = modelKey(v); return k ? (MODELS || []).find(m => modelKey(m.code) === k) || null : null; };

async function ensureModels(force) {
  const c = cacheGet('models');
  if (!force && MODELS) return MODELS;
  if (!force && c && c.fresh) MODELS = c.val;
  else {
    try {
      const r = await api(Object.assign({ action: 'getModels' }, force ? { refresh: 1 } : {}));
      if (r && r.ok) { MODELS = r.models || []; cacheSet('models', MODELS); }
      else if (force) toast('❌ ' + ((r && r.msg) || 'Could not read the Master Sheet'));
    } catch (e) {}
    if (!MODELS && c) MODELS = c.val;
  }
  let dl = $('dl_models');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl_models'; document.body.appendChild(dl); }
  dl.innerHTML = (MODELS || []).map(m => '<option value="' + esc(m.code) + '">' +
    esc([m.v && m.ah ? m.v + 'V ' + m.ah + 'Ah' : '', m.cat, m.chem].filter(Boolean).join(' · ')) + '</option>').join('') +
    '<option value="' + OTHER_MODEL + '">Not a Litpax battery — type brand + model</option>';
  return MODELS || [];
}

// receive form: battery model picked → Litpax (fills the type) or "Other company battery" (asks for the brand)
function unitModel(inp) {
  const row = inp.closest('.u-card'), brand = row.querySelector('.u-brand'), v = inp.value.trim();
  inp.classList.remove('bad');
  if (v === OTHER_MODEL) {
    row.dataset.src = 'Other'; inp.value = ''; inp.placeholder = 'Other company model *';
    brand.hidden = false; brand.focus();
    return;
  }
  const m = modelOf(v);
  if (m) {
    row.dataset.src = 'Litpax'; inp.value = m.code; inp.placeholder = 'Model * — search';
    brand.hidden = true; brand.value = '';
    const sel = row.querySelector('.u-type');
    if (m.cat) {
      if (!Array.from(sel.options).some(o => o.value === m.cat)) sel.add(new Option(m.cat, m.cat));
      sel.value = m.cat;
    }
  } else if (v && row.dataset.src !== 'Other' && (MODELS || []).length) {
    inp.classList.add('bad');
    toast('⚠️ "' + v + '" is not a Litpax model — pick from the list, or choose "' + OTHER_MODEL + '"');
  }
}

// Masters screen (admin): model count + refresh
function modelsCard() {
  const n = (MODELS || []).length;
  return '<div class="card mst-card"><div class="card-head"><span>🔋 Battery Models <b class="count">' + n + '</b></span></div>' +
    '<div class="mst-sub">Read from the common Master Sheet (same list as PLT / IMS / ERP). Add or change models there — not here.</div>' +
    '<div class="mst-list">' + (n ? (MODELS || []).slice(0, 40).map(m => '<span class="mst-chip mdl-chip">' + esc(m.code) + '</span>').join('') +
      (n > 40 ? '<span class="muted-sm">+' + (n - 40) + ' more</span>' : '') : '<div class="empty sm">Not loaded yet</div>') + '</div>' +
    '<div class="mst-add"><button class="btn btn-ghost" id="mdlRefresh" onclick="refreshModels(this)">🔄 Refresh from Master Sheet</button></div></div>';
}
async function refreshModels(btn) {
  btn.disabled = true; btn.textContent = '⏳ Reading Master Sheet...';
  cacheDel('models'); MODELS = null;
  const list = await ensureModels(true);
  toast(list.length ? '✅ ' + list.length + ' models loaded' : '⚠️ No models loaded');
  mstRender();
}

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
const EMPTY_MASTERS = { attendedBy: [], dispatchedBy: [], batteryType: [], chargerType: [] };
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
  'In Planning': 'amber', 'Dispatched': 'green'
};
function pill(s) { return '<span class="pill pill-' + (STATUS_TONE[s] || 'blue') + '">' + esc(s || '—') + '</span>'; }

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
  masters:   { id: 'scrMasters',  icon: '⚙️', label: 'Masters',      title: 'Masters',      sub: 'Dropdown lists — names and battery / charger types', open: openMasters }
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
  ensureMasters();           // preload dropdown lists in the background
  go(R.nav[0]);
}

function logout() {
  if (localStorage.getItem('hub_token')) jsonp({ action: 'logout' }, () => {}, () => {});
  clearSession(); toggleSidebar(false); showLogin();
}

// clear stale cached data after any change
function afterChange() {
  ['tickets', 'board_items'].forEach(cacheDel);
  if (CURRENT === 'tickets') tkLoad(true);
}

/* ============================================================
   PHASE 1 — NEW TICKET
   ============================================================ */
function openNew() { newReset(); }

function newReset() {
  ['n_company', 'n_person', 'n_phone', 'n_brand'].forEach(id => { $(id).value = ''; });
  document.querySelectorAll('#n_sentSeg button').forEach(b => b.classList.remove('on'));
  $('newForm').style.display = 'block'; $('newSuccess').style.display = 'none';
}

async function ticketCreate() {
  const v = id => $(id).value.trim();
  const d = { action: 'createTicket', company: v('n_company'), person: v('n_person'), phone: v('n_phone'), brand: v('n_brand'), batterySent: segVal('n_sentSeg') };
  if (!d.company || !d.person || !d.phone || !d.brand) return toast('⚠️ Please fill all fields');
  if (!/^\d{10}$/.test(d.phone)) return toast('⚠️ Phone must be 10 digits');
  if (!d.batterySent) return toast('⚠️ Select whether the battery has been sent');
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

/* ============================================================
   TICKETS LIST
   ============================================================ */
let TK = [];
let tkFilter = 'open';
const TK_CHIPS = [
  ['open', 'Open'], ['New', 'New'], ['In Follow-up', 'Follow-up'], ['In Transit', 'In Transit'],
  ['repair', 'In Repair'], ['due', '📅 Follow-up Due'], ['fb', '⭐ Feedback Due'], ['lowfb', '🔴 Low Feedback'],
  ['Closed', 'Closed'], ['all', 'All']
];
const REPAIR_SET = ['Received', 'In Repair', 'Partial Dispatch'];

function isDue(t) { const f = t['Next Follow-up']; return !!f && t['Status'] !== 'Closed' && f.substring(0, 10) <= todayStr(); }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isFbDue(t) {
  const c = String(t['Closed At'] || '').substring(0, 10);
  return fbOpen(t) && !t['Feedback Asked At'] && !!c && c <= daysAgoStr(CONFIG.FEEDBACK_AFTER_DAYS || 3);
}
function tkMatch(t, f) {
  const s = t['Status'];
  if (f === 'all') return true;
  if (f === 'open') return s !== 'Closed';
  if (f === 'repair') return REPAIR_SET.indexOf(s) !== -1;
   if (f === 'due') return isDue(t);
  if (f === 'fb') return isFbDue(t);
  if (f === 'lowfb') return t['Feedback Flag'] === 'Low';
  return s === f;
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
    [t['Ticket ID'], t['Company Name'], t['Contact Person'], t['Phone'], t['Scooty Brand']].join(' ').toLowerCase().indexOf(q) !== -1
  ).sort((a, b) => idNum(b['Ticket ID']) - idNum(a['Ticket ID']));

  if (!rows.length) { $('tkList').innerHTML = '<div class="empty">' + (TK.length ? 'No matches 🔍' : 'No tickets yet ✅') + '</div>'; return; }

  $('tkList').innerHTML = rows.map(t => {
    const due = isDue(t), calls = parseInt(t['Total Calls'], 10) || 0, items = parseInt(t['Total Items'], 10) || 0;
    const tags = [];
    if (t['Battery Sent'] === 'Yes' && REPAIR_SET.indexOf(t['Status']) === -1 && t['Status'] !== 'Closed') tags.push('<span class="tag tag-violet">🚚 Battery sent</span>');
    if (calls) tags.push('<span class="tag">📞 ' + calls + ' call' + (calls > 1 ? 's' : '') + '</span>');
    if (t['Next Follow-up'] && t['Status'] !== 'Closed') tags.push('<span class="tag ' + (due ? 'tag-red' : '') + '">📅 ' + esc(t['Next Follow-up']) + '</span>');
    if (items) tags.push('<span class="tag tag-teal">📦 ' + items + ' items</span>');
  if (t['Outcome'] && t['Status'] === 'Closed') tags.push('<span class="tag tag-green">' + esc(t['Outcome']) + '</span>');
    if (isFbDue(t)) tags.push('<span class="tag tag-amber">⭐ Feedback due</span>');
    if (t['Rating']) tags.push('<span class="tag ' + (t['Feedback Flag'] === 'Low' ? 'tag-red' : 'tag-green') + '">⭐ ' + esc(t['Rating']) + '/5</span>');
    if (t['Feedback Flag'] === 'Low') tags.push('<span class="tag tag-red">🔴 Low feedback</span>');
    return '<div class="tk-card' + (due || t['Feedback Flag'] === 'Low' ? ' due' : '') + '" data-id="' + esc(t['Ticket ID']) + '" onclick="drawerOpen(this.dataset.id)">' +
      '<div class="tk-top"><span class="tk-id">' + esc(t['Ticket ID']) + '</span>' + pill(t['Status']) + '</div>' +
      '<div class="tk-company">' + esc(t['Company Name']) + '</div>' +
      '<div class="tk-meta">' + esc(t['Contact Person']) + ' · ' + esc(t['Phone']) + ' · 🛵 ' + esc(t['Scooty Brand']) + '</div>' +
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
  $('drBody').innerHTML = '<div class="skeleton sk-block"></div><div class="skeleton sk-block"></div>';
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
  const t = CUR.ticket, s = t['Status'], sent = t['Battery Sent'] === 'Yes', open = s !== 'Closed';
  const early = s === 'New' || s === 'In Follow-up';
  $('drTitle').innerHTML = esc(t['Ticket ID']) + ' ' + pill(s);

  let h = stepper(t);

  // ---- actions (service team) ----
  const lowFb = t['Feedback Flag'] === 'Low';
  if (can('service') && (open || lowFb)) {
    const b = [];
    b.push('<button class="btn btn-primary" onclick="callFormToggle()">📞 Add Call Log</button>');
    if (!sent && early) b.push('<button class="btn btn-green" onclick="ticketSolve(this)">✅ Solved on Call</button>');
    if (early || s === 'In Transit') b.push('<button class="btn btn-violet" onclick="pickupOpen()">🚚 ' + (s === 'In Transit' ? 'Edit Pickup' : 'Arrange Pickup') + '</button>');
    if (s === 'In Transit' || (sent && early)) b.push('<button class="btn btn-teal" onclick="receiveOpen()">📥 Mark Received</button>');
h += '<div class="dsec actions">' +
      (lowFb ? '<div class="note note-red">🔴 The customer gave low feedback. Call them and save a call log — that clears this flag.</div>' : '') +
      (sent && early ? '<div class="note">🚚 The customer has already sent the battery — no troubleshooting needed. Just note the problem and fill in the pickup details.</div>' : '') +
      '<div class="btn-wrap">' + b.join('') + '</div>' + callFormHtml(t) + '</div>';
  }
  h += waSection();
  h += sec('📝 Phase 1 — Basic', kv([
    ['Company', t['Company Name']], ['Contact Person', t['Contact Person']], ['Phone', t['Phone']],
    ['Scooty Brand', t['Scooty Brand']], ['Battery Sent', t['Battery Sent']],
    ['Created', t['Created At'] + (t['Created By'] ? ' · ' + t['Created By'] : '')]
  ]) + (t['Phone'] ? '<a class="call-link" href="tel:' + esc(t['Phone']) + '">📲 Call ' + esc(t['Phone']) + '</a>' : ''));

  h += sec('🎧 Phase 2 — Service', kv([
    ['Attended By', t['Attended By']], ['Purchase Age', t['Purchase Age']], ['Outcome', t['Outcome']],
    ['Next Follow-up', open ? t['Next Follow-up'] : ''], ['Total Calls', t['Total Calls']]
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
      ['Remarks', t['Receive Remarks']]
    ]) + (items.length ? '<div class="items-mini">' + items.map(it =>
      '<div class="im-row"><span class="im-id">' + esc(it['Item ID']) + '</span><span>' + (it['Item Type'] === 'Charger' ? '⚡' : '🔋') + ' ' +
      esc([it['Category'], it['Model']].filter(Boolean).join(' · ')) + '</span>' + pill(it['Item Status']) + '</div>'
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
    (c['Next Follow-up'] ? '<div class="tl-next">📅 Next follow-up: ' + esc(c['Next Follow-up']) + '</div>' : '') + '</div>'
  ).join('') + '</div>' : '<div class="empty sm">No call logs yet</div>');

  if (t['Closed At']) h += sec('✅ Closed', kv([['Closed At', t['Closed At']], ['Outcome', t['Outcome']]]));

  $('drBody').innerHTML = h;
}

/* ---- Call log ---- */
function callFormHtml(t) {
  const ages = CONFIG.PURCHASE_AGE.map(a => '<option' + (a === t['Purchase Age'] ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
  return '<div id="callForm" class="call-form" style="display:none"><div class="form-grid">' +
    '<div class="fg"><label>Attended By <b>*</b></label><select id="c_by">' + optList(M().attendedBy, t['Attended By'] || '', '-- Select name --') + '</select></div>' +
    '<div class="fg"><label>Battery Purchase Age</label><select id="c_age"><option value="">-- Select --</option>' + ages + '</select></div>' +
    '<div class="fg full"><label>Call notes <b>*</b></label><textarea id="c_notes" maxlength="1000" placeholder="Problem, troubleshooting steps, what the customer said..."></textarea></div>' +
    '<div class="fg"><label>Next Follow-up</label><input type="date" id="c_next"></div>' +
    '</div><button class="btn btn-primary btn-block" onclick="callSave(this)">Save Call ✓</button></div>';
}
function callFormToggle() { const f = $('callForm'); if (f) { f.style.display = f.style.display === 'none' ? 'block' : 'none'; if (f.style.display === 'block') $('c_notes').focus(); } }

async function callSave(btn) {
  const d = {
    action: 'addCall', ticketId: CUR.ticket['Ticket ID'], attendedBy: $('c_by').value.trim(),
    purchaseAge: $('c_age').value, notes: $('c_notes').value.trim(), nextFollowUp: $('c_next').value
  };
  if (!d.attendedBy) return toast('⚠️ Select Attended By');
  if (!d.notes) return toast('⚠️ Please add call notes');
  const r = await run(d, btn); if (!r) return;
  toast('✅ Call log saved'); afterChange(); drawerReload();
}

async function ticketSolve(btn) {
  if (!confirm('Mark this ticket as "Solved on Call" and close it?')) return;
  const r = await run({ action: 'solveTicket', ticketId: CUR.ticket['Ticket ID'] }, btn); if (!r) return;
  toast('✅ Ticket closed — Solved on Call'); afterChange(); drawerReload();
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
  modalOpen('📥 Mark Received',
    '<div class="form-grid">' +
      fg('Received Date <b>*</b>', 'r_date', 'date', todayStr()) + '<div class="fg"></div>' +
      fg('Battery Qty', 'r_bq', 'number', 0, ' min="0" max="50" oninput="recvUnits()"') +
      fg('Charger Qty', 'r_cq', 'number', 0, ' min="0" max="50" oninput="recvUnits()"') +
    '</div>' +
    '<div id="r_units"></div>' +
    '<div class="fg full" style="margin-bottom:12px"><label>Remarks</label><textarea id="r_rem" maxlength="500"></textarea></div>' +
    '<div id="r_prev" class="note">Enter quantities — a detail row opens for every unit</div>' +
    '<button class="btn btn-teal btn-block" onclick="recvSave(this)">Mark Received ✓</button>');
}

const qtyVal = id => Math.max(0, Math.min(50, parseInt($(id).value, 10) || 0));

function recvUnits() {
  // keep what was already typed when quantities change
  const keep = k => Array.from(document.querySelectorAll('.u-row[data-u="' + k + '"]'))
    .map(r => ({ c: r.querySelector('select').value, m: r.querySelector('input').value }));
  const kb = keep('B'), kc = keep('C');
  const bq = qtyVal('r_bq'), cq = qtyVal('r_cq');

  const block = (k, label, n, list, prev, ico) => {
    if (!n) return '';
    let s = '<div class="u-block"><div class="u-head"><span>' + ico + ' ' + (label === 'Battery' ? 'Batteries' : label + 's') + ' (' + n + ')</span>' +
      (n > 1 ? '<button type="button" class="link-btn" onclick="recvCopy(\'' + k + '\')">Copy #1 to all</button>' : '') + '</div>';
    for (let i = 0; i < n; i++) {
      const p = prev[i] || {};
      s += '<div class="u-row" data-u="' + k + '"><span class="u-no">#' + (i + 1) + '</span>' +
        '<select>' + optList(list, p.c || '', '-- ' + label + ' type --') + '</select>' +
        '<input maxlength="100" placeholder="' + label + ' model" value="' + esc(p.m || '') + '"></div>';
    }
    return s + '</div>';
  };
  $('r_units').innerHTML =
    block('B', 'Battery', bq, M().batteryType, kb, '🔋') +
    block('C', 'Charger', cq, M().chargerType, kc, '⚡');

  const n = bq + cq, id = CUR.ticket['Ticket ID'];
  $('r_prev').innerHTML = n
    ? '📦 <b>' + n + '</b> items will be created: ' + esc(id) + '-01 … ' + esc(id) + '-' + pad2(n)
    : 'Enter quantities — a detail row opens for every unit';
}

function recvCopy(k) {
  const rows = document.querySelectorAll('.u-row[data-u="' + k + '"]');
  if (!rows.length) return;
  const c = rows[0].querySelector('select').value, m = rows[0].querySelector('input').value;
  rows.forEach(r => { r.querySelector('select').value = c; r.querySelector('input').value = m; });
}

async function recvSave(btn) {
  const id = CUR.ticket['Ticket ID'];
  const items = [];
  for (const [k, type] of [['B', 'Battery'], ['C', 'Charger']]) {
    const rows = document.querySelectorAll('.u-row[data-u="' + k + '"]');
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i].querySelector('select').value, m = rows[i].querySelector('input').value.trim();
      if (!c || !m) return toast('⚠️ ' + type + ' #' + (i + 1) + ': select type and enter model');
      items.push({ type, category: c, model: m });
    }
  }
  if (!items.length) return toast('⚠️ Enter battery or charger quantity');
  if (!$('r_date').value) return toast('⚠️ Enter received date');
  if (!confirm(items.length + ' items will be received and sent to Repair. Continue?')) return;

  const r = await run({ action: 'markReceived', ticketId: id, receivedDate: $('r_date').value, items, remarks: $('r_rem').value.trim() }, btn, true);
  if (!r) return;
  afterChange();
  toast('✅ ' + r.items + ' items moved to Repair');
  try {
    const t = await api({ action: 'getTicket', ticketId: id });
    if (t && t.ok) { CUR = t; drawerRender(); recvSlip(); return; }
  } catch (e) {}
  modalClose(); drawerReload();
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
        ['Scooty Brand', t['Scooty Brand']], ['Received By', t['Received By']],
        ['Pickup By', t['Pickup By']], ['Transport', t['Transport Name']], ['LR No', t['LR No']],
        ['No. of Boxes', t['No. of Boxes']], ['Remarks', t['Receive Remarks']]
      ]) +
      '<table class="slip-table"><tr><th>#</th><th>Item ID</th><th>Item</th><th>Type</th><th>Model</th></tr>' +
      items.map((it, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(it['Item ID']) + '</td><td>' + esc(it['Item Type']) +
        '</td><td>' + esc(it['Category'] || '—') + '</td><td>' + esc(it['Model'] || '—') + '</td></tr>').join('') +
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
    stageAt: it['Stage Updated At'], customer: it['Customer'] || '', category: it['Category'] || ''
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
        '<span><b>' + esc(it.itemId) + '</b> · ' + esc(it.customer) + '<br><small>' + itemDesc(it) + '</small></span></label>'
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
      '<div class="bc-prog"><div style="width:' + pct + '%"></div></div>' +
      '<div class="bc-lbl">' + (inPlan ? 'In Planning — pick a stage' : 'Stage ' + (idx + 1) + '/' + STAGES.length + (idx === last ? ' · Ready ✅' : '')) + '</div>' +
      '<select data-id="' + esc(it.itemId) + '" onchange="boardSetStage(this.dataset.id, this.value)">' +
        (inPlan ? '<option value="" selected disabled>-- Select stage --</option>' : '') + opts + '</select>' +
      (it.stageAt ? '<div class="bc-at">Updated: ' + esc(it.stageAt) + '</div>' : '') +
    '</div>';
  }).join('') : '<div class="empty">' + (df ? 'No items planned for this date 📅' : 'No planned items') + '</div>';
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
  $('boardDateFilter').value = planDate; cacheDel('tickets'); boardLoad(true);
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
  cacheSet('board_items', boardItems); cacheDel('tickets');
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
  const rows = dispItems.filter(it => !q || (it.itemId + ' ' + it.ticketId + ' ' + it.customer + ' ' + it.category + ' ' + it.model).toLowerCase().indexOf(q) !== -1);
  $('dList').innerHTML = rows.length ? rows.map(it =>
    '<label class="ms-opt"><input type="checkbox" data-id="' + esc(it.itemId) + '"' + (dispSel[it.itemId] ? ' checked' : '') + ' onchange="dispToggle(this)">' +
    '<span><b>' + esc(it.itemId) + '</b> · ' + esc(it.customer) + '<br><small>' + itemDesc(it) + '</small></span></label>'
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
    transport: $('d_transport').value.trim(), anyCost: $('d_cost').value.trim(), actualProblem: $('d_problem').value.trim(),
    address: $('d_address').value.trim(), remarks: $('d_remarks').value.trim()
  };
  if (!d.dispatchDate) return toast('⚠️ Enter dispatch date');
  if (!d.dispatchedBy) return toast('⚠️ Select Dispatched By');
  if (!confirm(ids.length + ' item(s) will be dispatched. Continue?')) return;
  const r = await run(d, $('dSubmit')); if (!r) return;

const sel = dispItems.filter(it => dispSel[it.itemId]);
  let tk = null;
  try { const g = await api({ action: 'getTicket', ticketId: (r.tickets || [])[0] }); if (g && g.ok) tk = g.ticket; } catch (e) {}
  dispSlip(sel, d, r, tk);
  ['d_transport', 'd_cost', 'd_problem', 'd_address', 'd_remarks'].forEach(id => { $(id).value = ''; });
  cacheDel('board_items'); cacheDel('tickets');
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
      kv([['Dispatched By', d.dispatchedBy], ['Transport', d.transport], ['Address', d.address], ['Any Cost', d.anyCost], ['Problem Found', d.actualProblem]]) +
      '<table class="slip-table"><tr><th>#</th><th>Item ID</th><th>Item</th><th>Type</th><th>Model</th></tr>' +
      sel.map((it, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(it.itemId) + '</td><td>' + esc(it.itemType) + '</td><td>' + esc(it.category || '—') + '</td><td>' + esc(it.model || '—') + '</td></tr>').join('') +
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
  ['chargerType',  'Charger Type',  'Types offered when receiving chargers',   '⚡']
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

/* ---------- LOGIN — cinematic hero mouse tilt ---------- */
(function () {
  const hero = document.querySelector('.login-hero'), tilt = document.getElementById('cineTilt');
  if (!hero || !tilt) return;
  if (!window.matchMedia('(hover: hover)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  hero.addEventListener('mousemove', e => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      tilt.style.setProperty('--ry', (x * 14).toFixed(2) + 'deg');
      tilt.style.setProperty('--rx', (-y * 10).toFixed(2) + 'deg');
    });
  });
  hero.addEventListener('mouseleave', () => { tilt.style.setProperty('--ry', '0deg'); tilt.style.setProperty('--rx', '0deg'); });
})();

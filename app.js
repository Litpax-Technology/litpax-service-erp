/* ============================================================
   LITPAX SERVICE HUB v12 — app.js  (record pages: Customer › Ticket › Pickup / Repair Job › Item › Dispatch)
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
  if (params.token) IDLE.ping = Date.now();   // any signed-in call also keeps the session alive
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
// button busy state + error toast; returns the response on success, otherwise null
// Saves carry a request ID: a retry of the SAME save (timeout, slow network, double tap) reuses it,
// so the server returns the first result instead of saving twice.
const READ_ACTIONS = { login: 1, logout: 1, ping: 1, getSite: 1, getTickets: 1, getTicket: 1, getMasters: 1, getTracker: 1, getItems: 1, getReportData: 1,
  getSettings: 1, lookupPhone: 1, getModels: 1, findRecord: 1, getCustomer: 1, listRecords: 1, getTechJobs: 1, getTracking: 1, touch: 1, getSecurity: 1 };
const PENDING_REQ = {};
const newReqId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(params, btn, post, busyText) {
  let old = '';
  if (btn) { old = btn.innerHTML; btn.disabled = true; btn.textContent = busyText || '⏳ ...'; }
  const write = !READ_ACTIONS[params.action];
  let key = '';
  if (write) {
    try { key = params.action + '|' + JSON.stringify(params); } catch (e) { key = ''; }
    params = Object.assign({}, params, { reqId: (key && PENDING_REQ[key]) || newReqId() });
    if (key) PENDING_REQ[key] = params.reqId;
  }
  try {
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await (post ? apiPost(params) : api(params)); }
      catch (e) {
        if (e === 'auth') return null;
        // a save can be retried safely (same request ID) — try twice more before giving up
        if (write && attempt < 2) { if (btn) btn.textContent = '⏳ Retrying...'; await sleep(1500 * (attempt + 1)); continue; }
        toast('❌ Network error — please try again'); return null;
      }
      if (r && r.busy && attempt < 4) { if (btn) btn.textContent = '⏳ Saving...'; await sleep(2000); continue; }
      if (!r || !r.ok) { if (key) delete PENDING_REQ[key]; toast('❌ ' + ((r && r.msg) || 'Something went wrong')); return null; }
      if (key) delete PENDING_REQ[key];
      return r;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
}

/* ---------- v12 — security: idle sign-out, keep-alive, device name, Security card ---------- */
const IDLE = { last: Date.now(), ping: Date.now(), timer: 0, saved: 0 };
function devName() {
  const u = navigator.userAgent || '';
  const b = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Chrome\//.test(u) ? 'Chrome' :
    /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  const o = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '';
  return b + (o ? ' · ' + o : '') + (/Mobi/.test(u) ? ' · mobile' : '');
}
function idleMin() { const n = parseFloat(localStorage.getItem('hub_idle')); return isFinite(n) && n >= 0 ? n : 30; }
function idleMark() {
  IDLE.last = Date.now();
  if (IDLE.last - IDLE.saved > 15000) { IDLE.saved = IDLE.last; try { localStorage.setItem('hub_last_act', String(IDLE.last)); } catch (e) {} }   // shared by all open tabs
}
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(ev => document.addEventListener(ev, idleMark, { passive: true, capture: true }));
function idleStart() { clearInterval(IDLE.timer); IDLE.saved = 0; idleMark(); IDLE.ping = Date.now(); IDLE.timer = setInterval(idleTick, 20000); }
function idleStop() { clearInterval(IDLE.timer); IDLE.timer = 0; }
function idleTick() {
  if (!localStorage.getItem('hub_token')) return idleStop();
  const m = idleMin(), now = Date.now(), last = Math.max(IDLE.last, +localStorage.getItem('hub_last_act') || 0);
  if (now - last > (m ? Math.max(5, m) : 360) * 60e3) {
    logout(); toast('🔒 Signed out after ' + (m ? Math.max(5, m) : 360) + ' minutes without activity'); return;
  }
  // someone is working but nothing was saved / loaded for a while → keep the server session alive
  if (now - IDLE.ping > 4 * 60e3 && now - last < 4 * 60e3) jsonp({ action: 'touch' }, () => {}, () => {});
}
// everything loaded for the last user is dropped from memory on sign-out
function wipeMem() {
  try {
    TK = []; CUR = null; CUST = null; REC = null; REC_HIST = []; SETTINGS = null; SEC = null;
    Object.keys(REC_MEM).forEach(k => delete REC_MEM[k]);
    AS.data = {}; if (AS.open) asToggle(false);
    tkPrevClose();
    ['tkList', 'tkKpis', 'drBody', 'setForm', 'recList', 'trkList', 'boardPending', 'boardActive', 'dList', 'rsList', 'exList'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });
    if ($('secBanner')) $('secBanner').remove();
  } catch (e) {}
}
function weakPinBanner() {
  if ($('secBanner') || sessionStorage.getItem('hub_weak') !== '1') return;
  const b = document.createElement('div');
  b.id = 'secBanner'; b.className = 'sec-banner';
  b.innerHTML = ico('alert') + '<span><b>This login uses a short PIN.</b> ' + (can('admin') ? 'Set a 6+ digit PIN for every role in <a href="#" onclick="go(\'settings\');return false">Settings → Security</a>.' :
    'Ask the admin to set a 6+ digit PIN for this login.') + '</span><button class="x-btn" aria-label="Dismiss" onclick="sessionStorage.removeItem(\'hub_weak\');this.parentNode.remove()">' + ico('x') + '</button>';
  document.querySelector('.topbar').insertAdjacentElement('afterend', b);
}

/* ---------- Security card (admin → Settings) ---------- */
let SEC = null, SEC_ALL = false;
async function secLoad() {
  const box = $('secBox'); if (!box) return;
  if (!SEC) box.innerHTML = '<div class="skeleton sk-block"></div>';
  try {
    const r = await api({ action: 'getSecurity' });
    if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'Could not load security') + ' — update Code.gs to v12 and deploy a new version.</div>'; return; }
    SEC = r; secRender();
  } catch (e) { if (e !== 'auth') box.innerHTML = '<div class="empty">Could not load security</div>'; }
}
function secRender() {
  const r = SEC, box = $('secBox'); if (!r || !box) return;
  const L = { attendant: 'Call Attendant', service: 'Service Team', repair: 'Repair Team', admin: 'Admin' };
  const secured = r.users.filter(u => u.hashed && !u.weak).length;
  const pinPill = u => u.empty ? '<span class="pill pill-red">No PIN</span>' : !u.hashed ? '<span class="pill pill-amber" title="Stored as plain text — secured at the next sign-in">Not secured yet</span>' :
    u.weak ? '<span class="pill pill-amber" title="Hashed, but shorter than ' + r.pinMin + ' characters">Weak</span>' : '<span class="pill pill-green">Secured</span>';
  const resPill = x => '<span class="pill pill-' + (x === 'Success' ? 'green' : x === 'Locked' ? 'red' : 'amber') + '">' + esc(x) + '</span>';
  const log = SEC_ALL ? r.log : r.log.slice(0, 15);
  box.innerHTML = '<div class="card sec-card">' +
    '<div class="card-head"><span>Security</span><div class="btn-wrap">' +
      '<button class="btn btn-ghost btn-sm" onclick="secLoad()" aria-label="Refresh">' + ico('refresh') + 'Refresh</button>' +
      '<button class="btn btn-ghost btn-sm btn-danger" onclick="secLogoutAllOpen()">' + ico('logout') + 'Sign out all devices</button></div></div>' +
    '<div class="sec-stats">' +
      '<div><span>Strong PINs (6+, hashed)</span><b class="' + (secured < r.users.length ? 't-warn' : 't-ok') + '">' + secured + ' / ' + r.users.length + '</b></div>' +
      '<div><span>Failed sign-ins · 24 h</span><b class="' + (r.fails24 >= 10 ? 't-bad' : '') + '">' + r.fails24 + '</b></div>' +
      '<div><span>Auto sign-out</span><b>' + (r.idleMin ? Math.max(5, r.idleMin) + ' min idle' : '6 h idle') + ' · ' + r.maxHours + ' h max</b></div>' +
      '<div><span>Tech page</span><b class="' + (r.techKey ? 't-ok' : 't-warn') + '">' + (r.techKey ? 'Key required' : 'Open — no key') + '</b></div>' +
    '</div>' +
    '<div class="sec-h">Logins</div>' +
    '<div class="dt-scroll"><table class="dt sec-users"><thead><tr><th>Username</th><th>Role</th><th>PIN</th><th>Status</th><th></th></tr></thead><tbody>' +
    r.users.map(u => '<tr><td class="mono">' + esc(u.username) + '</td><td>' + esc(L[String(u.role).toLowerCase()] || u.role) + '</td><td>' + pinPill(u) + '</td>' +
      '<td>' + (u.active ? '<span class="pill pill-green">Active</span>' : '<span class="pill pill-gray">Inactive</span>') + '</td>' +
      '<td class="sec-act"><button class="btn btn-ghost btn-sm" data-u="' + esc(u.username) + '" onclick="secPinOpen(this.dataset.u)">Change PIN</button>' +
      '<button class="btn btn-ghost btn-sm' + (u.active ? ' btn-danger' : '') + '" data-u="' + esc(u.username) + '" data-a="' + (u.active ? 'false' : 'true') + '" onclick="secActiveOpen(this.dataset.u, this.dataset.a)">' +
        (u.active ? 'Deactivate' : 'Activate') + '</button></td></tr>').join('') +
    '</tbody></table></div>' +
    '<div class="sec-h">Recent sign-ins</div>' +
    (log.length ? '<div class="dt-scroll"><table class="dt"><thead><tr><th>Time</th><th>Username</th><th>Result</th><th class="hide-sm">Device</th></tr></thead><tbody>' +
      log.map(x => '<tr><td class="muted-c">' + esc(String(x.time).substring(0, 16)) + '</td><td class="mono">' + esc(x.user) + '</td><td>' + resPill(x.result) + '</td><td class="hide-sm muted-c">' + esc(x.device || '—') + '</td></tr>').join('') +
      '</tbody></table></div>' + (r.log.length > 15 ? '<div class="dt-foot"><span>Showing ' + log.length + ' of ' + r.log.length + '</span><button class="btn btn-ghost btn-sm" onclick="SEC_ALL=!SEC_ALL;secRender()">' + (SEC_ALL ? 'Show less' : 'Show all') + '</button></div>' : '')
      : '<div class="muted-sm">No sign-ins recorded yet.</div>') +
    '<div class="sec-note">' + ico('info') + '<span>PINs are stored as salted hashes, so nobody can read them in the sheet. Changing a PIN or deactivating a login signs that login out on every device. ' +
      'Turn on <b>Litpax Hub → Turn on daily backup</b> in the sheet menu if it is not on yet.</span></div>' +
  '</div>';
}
function secPinOpen(u) {
  modalOpen('Change PIN — ' + u,
    '<div class="note note-gray">At least 6 characters. Avoid easy PINs like 123456 or 111111. Everyone using this login will need the new PIN.</div>' +
    '<div class="form-grid">' +
      '<div class="fg full"><label for="sp_pin">New PIN <b>*</b></label><input id="sp_pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="32"></div>' +
      '<div class="fg full"><label for="sp_pin2">Repeat new PIN <b>*</b></label><input id="sp_pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="32" ' +
        'onkeydown="if(event.key===\'Enter\')secPinSave($(\'sp_btn\'))"></div>' +
    '</div><button id="sp_btn" class="btn btn-primary btn-block" data-u="' + esc(u) + '" onclick="secPinSave(this)">Save new PIN</button>');
  setTimeout(() => $('sp_pin') && $('sp_pin').focus(), 50);
}
async function secPinSave(btn) {
  const a = $('sp_pin').value.trim(), b = $('sp_pin2').value.trim();
  if (a.length < 6) return toast('⚠️ PIN must be at least 6 characters');
  if (a !== b) return toast('⚠️ The two PINs do not match');
  const r = await run({ action: 'setPin', username: btn.dataset.u, pin: a }, btn);
  if (!r) return;
  modalClose();
  if (r.self) { logout(); toast('✅ PIN changed — sign in again with the new PIN'); return; }
  toast('✅ PIN changed for ' + btn.dataset.u + ' — it is signed out on every device'); secLoad();
}
function secActiveOpen(u, on) {
  const yes = on === 'true';
  modalOpen((yes ? 'Activate ' : 'Deactivate ') + u,
    '<p class="modal-p">' + (yes ? 'This login will be able to sign in again.' : 'This login is signed out on every device right away and cannot sign in until you activate it again.') + '</p>' +
    '<button class="btn ' + (yes ? 'btn-primary' : 'btn-danger-solid') + ' btn-block" data-u="' + esc(u) + '" data-a="' + on + '" onclick="secActiveSave(this)">' + (yes ? 'Activate' : 'Deactivate') + '</button>');
}
async function secActiveSave(btn) {
  const r = await run({ action: 'setUserActive', username: btn.dataset.u, active: btn.dataset.a }, btn);
  if (!r) return;
  modalClose(); toast('✅ ' + btn.dataset.u + (btn.dataset.a === 'true' ? ' activated' : ' deactivated')); secLoad();
}
function secLogoutAllOpen() {
  modalOpen('Sign out all devices',
    '<p class="modal-p">Everyone — including you — is signed out on every phone and computer right now. Use it when a phone is lost or a PIN may have leaked, then change that PIN.</p>' +
    '<button class="btn btn-danger-solid btn-block" onclick="secLogoutAll(this)">Sign out everyone</button>');
}
async function secLogoutAll(btn) {
  const r = await run({ action: 'logoutAll' }, btn);
  if (!r) return;
  modalClose(); logout(); toast('✅ Everyone has been signed out — sign in again');
}

/* ---------- UTILS ---------- */
const $ = id => document.getElementById(id);
const pad2 = n => ('0' + n).slice(-2);
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const idNum = id => parseInt(String(id || '').replace(/\D/g, ''), 10) || 0;

/* ---------- v11 — icons (Lucide) + emoji-free UI chrome ---------- */
const ICO = {
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'
};
const ico = (k, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICO[k] || '') + '</svg>';

// emoji used as decoration in labels are removed from the UI (✕ close and arrows stay)
const EMO_RE = /(?:[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{2712}]|[\u{2717}-\u{27BF}]|[\u{2B50}\u{2B55}\u{23E9}-\u{23FA}\u{21A9}\u{21AA}\u{2139}])[\u{FE0F}\u{200D}]*(?:[\u{1F000}-\u{1FAFF}]\u{FE0F}?)*[  ]?/gu;
const stripEmo = v => String(v == null ? '' : v).replace(EMO_RE, '').replace(/️/g, '').replace(/^\s+/, '');
function deEmoji(root) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 11)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), todo = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    EMO_RE.lastIndex = 0;
    if (!EMO_RE.test(n.nodeValue)) continue;
    const p = n.parentElement;
    if (!p || p.closest('textarea, script, style, option, .as-panel, .keep-emo')) continue;
    todo.push(n);
  }
  todo.forEach(n => {
    const v = n.nodeValue.replace(EMO_RE, '').replace(/️/g, '');
    if (!v.trim()) {   // emoji was the whole label of this element → keep it (e.g. an icon-only button)
      const rest = Array.from(n.parentElement.childNodes).some(c => c !== n && (c.nodeType === 1 || c.nodeValue.trim()));
      if (!rest) return;
    }
    n.nodeValue = v;
  });
}
(function () {
  const ob = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.parentElement) deEmoji(n.parentElement); } else deEmoji(n);
  })));
  const start = () => ['appWrap', 'drawer', 'modalOv'].forEach(id => { const el = $(id); if (el) { deEmoji(el); ob.observe(el, { childList: true, subtree: true }); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// "/" jumps to the global search · Esc closes the ticket preview
document.addEventListener('keydown', e => {
  const tag = ((document.activeElement || {}).tagName || '');
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && $('appWrap') && $('appWrap').style.display !== 'none') {
    e.preventDefault(); $('gSearch').focus();
  }
  if (e.key === 'Escape' && $('tkPrev') && !$('tkPrev').hidden && !$('drawer').classList.contains('open') && !$('modalOv').classList.contains('show')) tkPrevClose();
});

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  msg = String(msg == null ? '' : msg);
  const tone = /^\s*(❌|🔒|⛔|🚫)/.test(msg) ? 'err' : /^\s*(⚠️|⚠)/.test(msg) ? 'warn' : /^\s*(✅|✓|✔)/.test(msg) ? 'ok' : 'info';
  const t = $('toast');
  t.className = 'toast t-' + tone;
  t.innerHTML = ico(tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert') + '<span>' + esc(stripEmo(msg)) + '</span>';
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3400);
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
  settings:  { id: 'scrSettings', icon: '🛠️', label: 'Settings',     title: 'Settings',     sub: 'SLA targets, lists, WhatsApp messages and screens per role', open: openSettings },
  records:   { id: 'scrRecords',  icon: '🗂️', label: 'Records',      title: 'Records',      sub: 'Every customer, call, pickup, repair job, item and dispatch — click any row to open it', open: () => openRecords() }
};
const NAV_ICO = { newTicket: 'plus', tickets: 'ticket', board: 'wrench', dispatch: 'truck', masters: 'list', tracker: 'activity', settings: 'sliders', records: 'folder' };
const NAV_ADMIN = { masters: 1, settings: 1 };
function navRender(nav) {
  const item = k => '<button class="sb-item' + (k === CURRENT ? ' active' : '') + '" data-nav="' + k + '" onclick="go(this.dataset.nav)">' + ico(NAV_ICO[k] || 'list') + '<span>' + SCREENS[k].label + '</span></button>';
  const work = nav.filter(k => !NAV_ADMIN[k]), adm = nav.filter(k => NAV_ADMIN[k]);
  $('sbNav').innerHTML = '<div class="sb-grp">Workspace</div>' + work.map(item).join('') + (adm.length ? '<div class="sb-grp">Admin</div>' + adm.map(item).join('') : '');
}
// every role can browse records (read-only lists — actions still follow the role)
function navList(nav) {
  const n = nav.filter(k => k !== 'records'), i = n.indexOf('settings');
  if (i === -1) n.push('records'); else n.splice(i, 0, 'records');
  return n;
}
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
  if ($('hdrGroup')) $('hdrGroup').textContent = NAV_ADMIN[key] ? 'Admin' : 'Service';
  if (key !== 'tickets') tkPrevClose();
  toggleSidebar(false); window.scrollTo(0, 0);
  if ($('asFab')) $('asFab').hidden = key === 'settings';   // keeps the Save bar free
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
  ['hub_role', 'hub_token', 'hub_user', 'hub_last_act'].forEach(k => localStorage.removeItem(k));
  try { sessionStorage.clear(); } catch (e) {}
  idleStop(); wipeMem();
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
  const r = await run({ action: 'login', username: u, pin: p, dev: devName() }, $('loginBtn'));
  if (!r) return;
  if (!CONFIG.ROLES[r.role]) return toast('❌ Role not found in config.js: ' + r.role);
  localStorage.setItem('hub_role', r.role); localStorage.setItem('hub_token', r.token); localStorage.setItem('hub_user', u);
  if (r.idleMin != null) localStorage.setItem('hub_idle', String(r.idleMin));
  try { if (r.weakPin) sessionStorage.setItem('hub_weak', '1'); else sessionStorage.removeItem('hub_weak'); } catch (e) {}
  if ($('rememberUser').checked) localStorage.setItem('hub_remember_user', u); else localStorage.removeItem('hub_remember_user');
  enterApp(r.role);
}

function enterApp(r) {
  const R = CONFIG.ROLES[r];
  $('loginScreen').style.display = 'none'; $('appWrap').style.display = 'flex';
  $('sbRole').innerHTML = '<b>' + esc(R.label) + '</b><span>' + esc(localStorage.getItem('hub_user') || '') + '</span>';
  R.nav = navList(R.nav);
  navRender(R.nav);
  if ($('hdrDate')) $('hdrDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  ensureMasters();           // preload dropdown lists in the background
  ensureSettings().then(applySettings);   // SLA, lists, WhatsApp text, screens — from the Settings tab
  go(R.nav[0]);
  idleStart(); weakPinBanner();
}

function logout() {
  if (localStorage.getItem('hub_token')) jsonp({ action: 'logout' }, () => {}, () => {});
  clearSession(); toggleSidebar(false); showLogin();
}

// clear stale cached data after any change
function afterChange() {
  Object.keys(REC_MEM).forEach(k => delete REC_MEM[k]);
  AS.data = {};
  ['tickets', 'board_items', 'tracker'].concat(Object.keys(REC_LISTS).map(k => 'rec_' + k)).forEach(cacheDel);
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
  $('newCust').innerHTML = r.customerId ? 'Customer ' + idChip(r.customerId) + (r.newCustomer ? ' <span class="tag">new customer</span>' : ' <span class="tag">existing customer</span>') : '';
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
  box.innerHTML = '<div class="note">🔁 <b>Repeat customer</b>' + (r.customerId ? ' ' + idChip(r.customerId) : '') + ' — ' + r.count + ' earlier ticket' + (r.count > 1 ? 's' : '') +
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
  ['repair', 'In Repair'], ['due', '📅 Follow-up Due'], ['cb', '📞 Call-back'], ['fb', '⭐ Feedback Due'], ['lowfb', '🔴 Low Feedback'],
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
  if (f === 'cb') return !!t['Open Callback'];
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

function tkSetFilter(f) { tkFilter = f; TK_LIMIT = 50; tkRender(); }

/* ---------- v11 — table / board + preview pane ---------- */
let TK_LIMIT = 50, TK_SEL = '', _pvSeq = 0;
let TK_VIEW = (() => { try { return localStorage.getItem('hub_tk_view') || 'list'; } catch (e) { return 'list'; } })();
function tkSetView(v) { TK_VIEW = v === 'board' ? 'board' : 'list'; try { localStorage.setItem('hub_tk_view', TK_VIEW); } catch (e) {} tkRender(); }

const shortDate = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + (+m[1] !== new Date().getFullYear() ? ' ' + m[1] : '') : String(s || ''); };
function dueInfo(t) {
  const f = String(t['Next Follow-up'] || ''), d = f.substring(0, 10);
  if (!d || isEnded(t['Status'])) return { txt: '', cls: '' };
  const tm = f.length > 11 ? ' ' + f.substring(11, 16) : '';
  if (d < todayStr()) return { txt: 'Overdue · ' + shortDate(d), cls: 'due-late' };
  if (d === todayStr()) return { txt: 'Today' + tm, cls: 'due-late' };
  return { txt: shortDate(d) + tm, cls: '' };
}
function tkFlags(t) {
  const f = [];
  if (t['Open Callback']) f.push('<span class="tag tag-red" title="Customer asked for a call back on the tracking page">Call back · ' + esc(t['Open Callback']) + '</span>');
  if (t['Feedback Flag'] === 'Low') f.push('<span class="tag tag-red">Low feedback</span>');
  else if (t['Rating']) f.push('<span class="tag tag-green">' + ico('star', 'ic-xs') + esc(t['Rating']) + '/5</span>');
  if (isFbDue(t)) f.push('<span class="tag tag-amber">Feedback due</span>');
  if (+t['Previous Tickets']) f.push('<span class="tag tag-amber" title="Earlier tickets from this phone">Repeat customer</span>');
  if (t['Battery Sent'] === 'Yes' && REPAIR_SET.indexOf(t['Status']) === -1 && !isEnded(t['Status'])) f.push('<span class="tag tag-violet">Items sent</span>');
  return f.join('');
}
function tkKpis() {
  const n = f => TK.filter(t => tkMatch(t, f)).length;
  const K = [['open', 'Open tickets', n('open'), 'not closed or cancelled'], ['due', 'Follow-up due', n('due'), 'today or overdue', 'late'],
    ['cb', 'Call-backs', n('cb'), 'asked on the tracking page', 'late'], ['repair', 'In repair', n('repair'), 'received · in repair · partial'],
    ['fb', 'Feedback due', n('fb'), 'closed ' + (CONFIG.FEEDBACK_AFTER_DAYS || 3) + '+ days ago', 'risk']];
  $('tkKpis').innerHTML = K.map(k => '<button type="button" class="kpi' + (k[4] && k[2] ? ' ' + k[4] : '') + (tkFilter === k[0] ? ' on' : '') + '" data-f="' + k[0] + '" onclick="tkSetFilter(this.dataset.f)">' +
    '<span>' + k[1] + '</span><b>' + k[2] + '</b><small>' + k[3] + '</small></button>').join('');
}

function tkRender() {
  tkKpis();
  $('tkChips').innerHTML = TK_CHIPS.map(([k, l]) => {
    const n = TK.filter(t => tkMatch(t, k)).length;
    return '<button class="chip' + (k === tkFilter ? ' active' : '') + (['due', 'fb', 'lowfb', 'cb'].indexOf(k) !== -1 && n ? ' chip-red' : '') +
      '" data-f="' + k + '" onclick="tkSetFilter(this.dataset.f)">' + l + ' <b>' + n + '</b></button>';
  }).join('');
  document.querySelectorAll('.vt-toggle button').forEach(b => b.classList.toggle('on', b.dataset.v === TK_VIEW));

  const q = $('tkSearch').value.toLowerCase().trim();
  const rows = TK.filter(t => tkMatch(t, tkFilter)).filter(t => !q ||
    [t['Ticket ID'], t['Company Name'], t['Contact Person'], t['Phone'], dealerOf(t), t['City'], t['Complaint'], t['Vehicle Model']].join(' ').toLowerCase().indexOf(q) !== -1
  ).sort((a, b) => idNum(b['Ticket ID']) - idNum(a['Ticket ID']));

  $('tkList').className = 'tk-list ' + (TK_VIEW === 'board' ? 'is-board' : 'is-table');
  if (!rows.length) { $('tkList').innerHTML = '<div class="empty">' + (TK.length ? 'No tickets match this view' : 'No tickets yet') + '</div>'; return; }
  if (TK_VIEW === 'board') return tkBoard(rows);

  const shown = rows.slice(0, TK_LIMIT);
  $('tkList').innerHTML = '<div class="dt-scroll"><table class="dt"><thead><tr>' +
    '<th>Ticket</th><th>Customer</th><th class="hide-md">Complaint</th><th class="hide-md">Dealer · City</th><th>Status</th>' +
    '<th class="hide-sm">Activity</th><th class="hide-sm">Follow-up</th><th class="hide-lg">Flags</th><th class="hide-md">Created</th></tr></thead><tbody>' +
    shown.map(t => {
      const d = dueInfo(t), calls = parseInt(t['Total Calls'], 10) || 0, items = parseInt(t['Total Items'], 10) || 0;
      const late = d.cls || t['Feedback Flag'] === 'Low' || t['Open Callback'];
      return '<tr class="tk-card' + (late ? ' due' : '') + (t['Ticket ID'] === TK_SEL ? ' sel' : '') + '" data-id="' + esc(t['Ticket ID']) + '" tabindex="0" ' +
        'onclick="tkPick(this.dataset.id)" ondblclick="drawerOpen(this.dataset.id)" onkeydown="if(event.key===\'Enter\')drawerOpen(this.dataset.id)">' +
        '<td class="mono tk-id">' + esc(t['Ticket ID']) + '</td>' +
        '<td class="tk-cust"><b>' + esc(t['Company Name']) + '</b><small>' + esc([t['Contact Person'], t['Phone']].filter(Boolean).join(' · ')) + '</small>' +
          '<span class="show-lg-no">' + tkFlags(t) + '</span></td>' +
        '<td class="hide-md">' + tv(t['Complaint']) + '</td>' +
        '<td class="hide-md">' + tv([dealerOf(t), t['City']].filter(Boolean).join(' · ')) + '</td>' +
        '<td>' + pill(t['Status']) + (t['Outcome'] && t['Status'] === 'Closed' ? '<small class="sub">' + esc(t['Outcome']) + '</small>' : '') + '</td>' +
        '<td class="hide-sm muted-c">' + ([items && items + ' item' + (items > 1 ? 's' : ''), calls && calls + ' call' + (calls > 1 ? 's' : '')].filter(Boolean).join(' · ') || '—') + '</td>' +
        '<td class="hide-sm ' + d.cls + '">' + (d.txt ? esc(d.txt) : '<span class="muted-c">—</span>') + '</td>' +
        '<td class="hide-lg"><div class="tags">' + tkFlags(t) + '</div></td>' +
        '<td class="hide-md muted-c">' + esc(shortDate(t['Created At'])) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="dt-foot"><span>Showing ' + shown.length + ' of ' + rows.length + '</span>' +
    (rows.length > shown.length ? '<button class="btn btn-ghost btn-sm" onclick="TK_LIMIT += 50; tkRender()">Show 50 more</button>' : '') + '</div>';
  if (TK_SEL) tkPrevRender();
}

const TK_BOARD = [['New', 'New'], ['In Follow-up', 'Follow-up'], ['In Transit', 'In transit'], ['Received', 'Received'], ['In Repair', 'In repair'],
  ['Partial Dispatch', 'Partial dispatch'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']];
function tkBoard(rows) {
  const cols = TK_BOARD.filter(([s]) => !isEnded(s) || rows.some(t => t['Status'] === s));
  $('tkList').innerHTML = '<div class="kb">' + cols.map(([s, l]) => {
    const L = rows.filter(t => t['Status'] === s);
    return '<section class="kb-col"><div class="kb-head"><span class="kb-dot t-' + (STATUS_TONE[s] || 'blue') + '"></span>' + l + '<span class="kb-n">' + L.length + '</span></div>' +
      (L.length ? L.slice(0, 60).map(t => {
        const d = dueInfo(t), items = parseInt(t['Total Items'], 10) || 0;
        return '<div class="kb-card tk-card' + (d.cls || t['Open Callback'] ? ' due' : '') + (t['Ticket ID'] === TK_SEL ? ' sel' : '') + '" data-id="' + esc(t['Ticket ID']) + '" tabindex="0" ' +
          'onclick="tkPick(this.dataset.id)" ondblclick="drawerOpen(this.dataset.id)" onkeydown="if(event.key===\'Enter\')drawerOpen(this.dataset.id)">' +
          '<div class="kb-top"><span class="mono">' + esc(t['Ticket ID']) + '</span>' + (d.txt ? '<span class="' + d.cls + '">' + esc(d.txt) + '</span>' : '') + '</div>' +
          '<b>' + esc(t['Company Name']) + '</b>' +
          '<small>' + esc([t['Complaint'], t['City']].filter(Boolean).join(' · ') || t['Contact Person'] || '') + '</small>' +
          '<div class="tags">' + (items ? '<span class="tag">' + items + ' item' + (items > 1 ? 's' : '') + '</span>' : '') + tkFlags(t) + '</div></div>';
      }).join('') + (L.length > 60 ? '<div class="muted-sm">+' + (L.length - 60) + ' more — use search</div>' : '') : '<div class="kb-empty">Nothing here</div>') +
      '</section>';
  }).join('') + '</div>';
  if (TK_SEL) tkPrevRender();
}

// click = quick preview on the right (wide screens) · double-click / Enter / small screens = full record
function tkPick(id) {
  if (window.innerWidth < 1180) return drawerOpen(id);
  TK_SEL = id;
  document.querySelectorAll('#tkList .tk-card').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
  tkPrevRender(true);
}
function tkPrevClose() {
  TK_SEL = '';
  const p = $('tkPrev'); if (!p) return;
  p.hidden = true; p.innerHTML = '';
  document.querySelector('.tk-wrap') && document.querySelector('.tk-wrap').classList.remove('has-prev');
  document.querySelectorAll('#tkList .tk-card.sel').forEach(r => r.classList.remove('sel'));
}
function tkPrevRender(fetch) {
  const t = TK.find(x => x['Ticket ID'] === TK_SEL);
  if (!t) return tkPrevClose();
  const d = dueInfo(t), ph = String(t['Phone'] || '').replace(/\D/g, ''), seq = ++_pvSeq;
  const F = (l, v, cls) => '<div><span>' + l + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + (v || '—') + '</b></div>';
  $('tkPrev').innerHTML =
    '<div class="pv-top"><span class="mono">' + esc(t['Ticket ID']) + '</span>' + pill(t['Status']) +
      '<button class="x-btn" onclick="tkPrevClose()" aria-label="Close preview">' + ico('x') + '</button></div>' +
    '<h3 class="pv-co">' + esc(t['Company Name']) + '</h3>' +
    '<div class="pv-sub">' + esc(t['Contact Person'] || '') + (ph ? ' · <a href="tel:' + esc(ph) + '">' + esc(t['Phone']) + '</a>' : '') + '</div>' +
    '<div class="pv-act">' +
      (can('service') ? '<button class="btn btn-primary btn-sm" data-id="' + esc(t['Ticket ID']) + '" onclick="pvLogCall(this.dataset.id)">' + ico('phone') + 'Log call</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-id="' + esc(t['Ticket ID']) + '" onclick="drawerOpen(this.dataset.id)">' + ico('open') + 'Open record</button>' +
      (ph ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(ph) + '">Call</a>' : '') +
    '</div>' +
    (t['Open Callback'] ? '<div class="note note-red">Customer asked for a call back — ' + esc(t['Open Callback']) + '</div>' : '') +
    (t['Feedback Flag'] === 'Low' ? '<div class="note note-red">Low feedback — call the customer and save a call log.</div>' : '') +
    '<div class="pv-grid">' +
      F('Complaint', esc(t['Complaint'])) + F('Dealer', esc(dealerOf(t))) +
      F('City', esc([t['City'], t['State']].filter(Boolean).join(', '))) + F('Vehicle', esc(t['Vehicle Model'])) +
      F('Next follow-up', esc(d.txt), d.cls) + F('Last call', esc(t['Last Call At'] ? shortDate(t['Last Call At']) + String(t['Last Call At']).substring(10, 16) : '')) +
      F('Calls · Items', esc((+t['Total Calls'] || 0) + ' · ' + (+t['Total Items'] || 0))) + F('Created', esc(shortDate(t['Created At']) + (t['Created By'] ? ' · ' + t['Created By'] : ''))) +
    '</div>' +
    '<div class="pv-h">Recent calls</div><div id="pvCalls"><div class="skeleton" style="height:56px"></div></div>';
  $('tkPrev').hidden = false;
  document.querySelector('.tk-wrap').classList.add('has-prev');
  const show = r => {
    if (seq !== _pvSeq || !$('pvCalls')) return;
    const calls = (r.calls || []).slice(-3).reverse();
    $('pvCalls').innerHTML = calls.length ? calls.map(c => '<div class="pv-call"><div><b>' + esc(c['Attended By'] || c['Logged By'] || 'Call') + '</b><span>' + esc(c['Time'] || '') + '</span></div>' +
      '<p>' + esc(c['Notes'] || '') + '</p>' + (c['Next Follow-up'] ? '<small>Next follow-up: ' + esc(c['Next Follow-up']) + '</small>' : '') + '</div>').join('')
      : '<div class="muted-sm">No calls logged yet.</div>';
  };
  const m = memGet('tk_' + t['Ticket ID']);
  if (m) show(m);
  if (!fetch && m) return;
  api({ action: 'getTicket', ticketId: t['Ticket ID'] }).then(r => { if (r && r.ok) { memPut('tk_' + t['Ticket ID'], r); show(r); } else if (!m && seq === _pvSeq && $('pvCalls')) $('pvCalls').innerHTML = '<div class="muted-sm">Could not load calls.</div>'; })
    .catch(() => { if (!m && seq === _pvSeq && $('pvCalls')) $('pvCalls').innerHTML = '<div class="muted-sm">Could not load calls.</div>'; });
}
async function pvLogCall(id) {
  await drawerOpen(id);
  const f = $('callForm');
  if (f && f.style.display === 'none') callFormToggle();
}

/* ============================================================
   TICKET DRAWER (Phase 2 actions live here)
   ============================================================ */
let CUR = null; // {ticket, calls, items}

function drawerClose() { $('drawer').classList.remove('open'); $('drawerOv').classList.remove('show'); }

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
    '</div><div class="muted-sm" style="margin:-4px 0 14px">Company, contact, phone, dealer, city, state and customer type are saved on the customer' +
      (t['Customer ID'] ? ' <b>' + esc(t['Customer ID']) + '</b>' : '') + ' — every ticket of this customer shows the change. ' +
      'Typing the phone of another customer moves this ticket to that customer. Every change is saved in the ticket history.</div>' +
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
  toast('✅ Call log saved' + (r.callId ? ' — ' + r.callId : '') + ((r.callbacksDone || []).length ? ' · call-back ' + r.callbacksDone.join(', ') + ' closed' : '')); DR_TAB = 'calls'; afterChange(); drawerReload();
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
  const t0 = CUR.ticket, op = openPickup(), first = !(CUR.items || []).length && !(CUR.pickups || []).length;
  // edit the open pickup, or a new one (first pickup pre-fills the quantities from the ticket)
  const t = op || (first ? { 'Pickup By': t0['Pickup By'], 'No. of Boxes': t0['No. of Boxes'], 'Pickup Date': t0['Pickup Date'], 'Pickup Place': t0['Pickup Place'],
    'Transport Name': t0['Transport Name'], 'LR No': t0['LR No'], 'Builty URL': t0['Builty URL'], 'Exp Battery Qty': t0['Exp Battery Qty'], 'Exp Charger Qty': t0['Exp Charger Qty'] } : {});
  const cur = safeUrl(t['Builty URL']);
  modalOpen(op ? '🚚 Edit Pickup — ' + op['Pickup ID'] : (first ? '🚚 Arrange Pickup' : '🚚 Another Pickup — next lot of items'),
    '<div class="fg"><label>Pickup arranged by <b>*</b></label><div class="seg" id="p_bySeg">' +
      ['Company', 'Customer'].map(v => '<button type="button" data-v="' + v + '" class="' + (t['Pickup By'] === v ? 'on' : '') + '" onclick="segPick(this)">' +
        (v === 'Company' ? '🏢 Company' : '👤 Customer (self)') + '</button>').join('') + '</div></div>' +
    '<div class="form-grid">' +
      fg('🔋 Batteries coming', 'p_expB', 'number', t['Exp Battery Qty'], ' min="0" max="50" placeholder="0"') +
      fg('⚡ Chargers coming', 'p_expC', 'number', t['Exp Charger Qty'], ' min="0" max="50" placeholder="0"') +
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
    '</div><button class="btn btn-primary btn-block" onclick="pickupSave(this)">' + (op ? 'Save pickup ✓' : 'Save pickup — items on the way ✓') + '</button>');
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
    expB: $('p_expB').value, expC: $('p_expC').value,
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
  modalClose(); toast('✅ Pickup saved' + (r.pickupId ? ' — ' + r.pickupId : '') + (file ? ' with builty' : '')); DR_TAB = 'pickups'; afterChange(); drawerReload();
}

/* ---- Received (one row per unit: type + model) ---- */
// which pickup these items came with + what it said was coming
let RECV = { pid: '', eb: 0, ec: 0, from: '', start: 1 };
async function receiveOpen(pickupId) {
  await Promise.all([ensureMasters(), ensureModels()]);
  const t = CUR.ticket, items = CUR.items || [];
  const pk = pickupId ? (CUR.pickups || []).find(p => p['Pickup ID'] === pickupId) : openPickup();
  let eb = pk ? +pk['Exp Battery Qty'] || 0 : 0, ec = pk ? +pk['Exp Charger Qty'] || 0 : 0, from = pk && (eb || ec) ? 'pickup ' + pk['Pickup ID'] : '';
  if (!eb && !ec && !items.length) { eb = +t['Exp Battery Qty'] || 0; ec = +t['Exp Charger Qty'] || 0; from = (eb || ec) ? 'ticket' : ''; }
  const start = items.reduce((m, i) => Math.max(m, parseInt(String(i['Item ID']).split('-').pop(), 10) || 0), 0) + 1;
  RECV = { pid: pk ? pk['Pickup ID'] : '', eb, ec, from, start };
  modalOpen('📥 Mark Received' + (pk ? ' — ' + pk['Pickup ID'] : ''),
    '<div class="form-grid">' +
      fg('Received Date <b>*</b>', 'r_date', 'date', todayStr()) +
      '<div class="fg"><label>Expected' + (from ? ' (from ' + esc(from) + ')' : '') + '</label><div class="r-exp">' + ((eb || ec) ? esc(itemsText(eb, ec)) : 'Not given') + '</div></div>' +
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
      cond: r.querySelector('.u-cond').value, v: r.querySelector('.u-volt').value, mfg: r.querySelector('.u-mfg').value, b: r.querySelector('.u-batch').value,
      src: r.dataset.src || '', br: (r.querySelector('.u-brand') || {}).value || '' }));
  const kb = keep('B'), kc = keep('C');
  const bq = qtyVal('r_bq'), cq = qtyVal('r_cq');

  const block = (k, label, n, list, prev, ico) => {
    if (!n) return '';
    let s = '<div class="u-block"><div class="u-head"><span>' + ico + ' ' + (label === 'Battery' ? 'Batteries' : label + 's') + ' (' + n + ')</span>' +
      (n > 1 ? '<button type="button" class="link-btn" onclick="recvCopy(\'' + k + '\')">Copy #1 to all (not serial / voltage)</button>' : '') + '</div>' +
      '<div class="u-cols"><span></span><div><span>Type / Condition *</span><span>Model * / Voltage (V)</span><span>Serial No / Mfg month</span><span>Warranty / Batch No</span></div></div>';
    for (let i = 0; i < n; i++) {
      const p = prev[i] || {};
      s += '<div class="u-row u-card" data-u="' + k + '" data-src="' + esc(p.src || '') + '"><span class="u-no">#' + (i + 1) + '</span><div class="u-fields">' +
        '<select class="u-type">' + optList(list, p.c || '', '-- ' + label + ' type --') + '</select>' +
        (k === 'B'
          ? '<input class="u-model" maxlength="100" list="dl_models" placeholder="' + (p.src === 'Other' ? 'Other company model *' : 'Model * — search') + '" value="' + esc(p.m || '') + '" onchange="unitModel(this)">'
          : '<input class="u-model" maxlength="100" placeholder="' + label + ' model *" value="' + esc(p.m || '') + '">') +
        '<input class="u-serial" maxlength="60" placeholder="Serial No" value="' + esc(p.s || '') + '">' +
        '<select class="u-war">' + optList(CONFIG.WARRANTY || [], p.w || '', 'Warranty?') + '</select>' +
        '<select class="u-cond">' + optList(M().condition, p.cond || '', 'Condition *') + '</select>' +
        '<input class="u-volt" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Voltage (V)" value="' + esc(p.v || '') + '">' +
        '<input class="u-mfg" type="month" title="Manufacturing month" value="' + esc(p.mfg || '') + '">' +
        '<input class="u-batch" maxlength="60" placeholder="Batch No" value="' + esc(p.b || '') + '">' +
        (k === 'B' ? '<input class="u-brand" maxlength="60" placeholder="Brand of the other company *" value="' + esc(p.br || '') + '"' + (p.src === 'Other' ? '' : ' hidden') + '>' : '') +
        '</div></div>';
    }
    return s + '</div>';
  };
  $('r_units').innerHTML =
    block('B', 'Battery', bq, M().batteryType, kb, '🔋') +
    block('C', 'Charger', cq, M().chargerType, kc, '⚡');

  const n = bq + cq, id = CUR.ticket['Ticket ID'], eb = RECV.eb, ec = RECV.ec;
  const miss = (eb || ec) && (eb !== bq || ec !== cq);
  $('r_prev').className = 'note' + (miss ? ' note-red' : '');
  $('r_prev').innerHTML = (n
    ? '📦 New Repair Job with <b>' + n + '</b> items: ' + esc(id) + '-' + pad2(RECV.start) + (n > 1 ? ' … ' + esc(id) + '-' + pad2(RECV.start + n - 1) : '')
    : 'Enter quantities — a detail row opens for every unit') +
    (miss ? '<br>⚠️ Expected ' + esc(itemsText(eb, ec)) + ' (' + esc(RECV.from) + ') — the shortfall will be recorded.' : '');
}

function recvCopy(k) {
  const rows = document.querySelectorAll('.u-row[data-u="' + k + '"]');
  if (!rows.length) return;
  ['.u-type', '.u-model', '.u-war', '.u-cond', '.u-mfg', '.u-batch'].forEach(sel => {
    const v = rows[0].querySelector(sel).value;
    rows.forEach(r => { r.querySelector(sel).value = v; });
  });
  const b0 = rows[0].querySelector('.u-brand');
  rows.forEach(r => {
    r.dataset.src = rows[0].dataset.src || '';
    const b = r.querySelector('.u-brand');
    if (b0 && b) { b.value = b0.value; b.hidden = b0.hidden; }
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
      let src = '', brand = '';
      if (k === 'B') {
        src = rows[i].dataset.src === 'Other' ? 'Other' : 'Litpax';
        brand = src === 'Other' ? rows[i].querySelector('.u-brand').value.trim() : '';
        if (src === 'Litpax' && (MODELS || []).length && !modelOf(m)) return toast('⚠️ Battery #' + (i + 1) + ': pick the model from the list, or choose "' + OTHER_MODEL + '"');
        if (src === 'Other' && !brand) return toast('⚠️ Battery #' + (i + 1) + ': enter the brand of the other company');
      }
      if (volt !== '' && !(Number(volt) >= 0)) return toast('⚠️ ' + type + ' #' + (i + 1) + ': voltage must be a number');
      items.push({ type, category: c, model: m, serial: sn, warranty: w, condition: cond, voltage: volt, mfg, batch, source: src, brand });
    }
  }
  if (!items.length) return toast('⚠️ Enter battery or charger quantity');
  if (!$('r_date').value) return toast('⚠️ Enter received date');
  if (!confirm(items.length + ' items will be received and sent to Repair. Continue?')) return;

  const accessories = Array.from(document.querySelectorAll('#r_acc input:checked')).map(i => i.value);
  const r = await run({ action: 'markReceived', ticketId: id, pickupId: RECV.pid, receivedDate: $('r_date').value, items, accessories, remarks: $('r_rem').value.trim() }, btn, true);
  if (!r) return;
  afterChange();
  const rep = r.repeats || [];
  toast(rep.length ? '🔁 ' + rep.length + ' repeat batter' + (rep.length > 1 ? 'ies' : 'y') + ' found: ' + rep.map(x => x.serial + ' (×' + x.count + ')').join(', ')
                   : r.qtyNote ? '⚠️ Received — ' + r.qtyNote : '✅ ' + (r.receiptId ? r.receiptId + ' · ' : '') + r.items + ' items moved to Repair');
  DR_TAB = 'jobs';
  try {
    const t = await api({ action: 'getTicket', ticketId: id });
    if (t && t.ok) { CUR = t; renderRecord(); recvSlip(r.receiptId); return; }
  } catch (e) {}
  modalClose(); drawerReload();
}

/* ---- Correct a received item (service) — type, model, serial, condition ... ---- */
function itemEditOpen(itemId) {
  const it = (CUR.items || []).find(x => x['Item ID'] === itemId);
  if (!it) return;
  const isC = it['Item Type'] === 'Charger';
  ensureModels();
  modalOpen('✏️ ' + itemId + ' — correct details',
    '<div class="form-grid">' +
      '<div class="fg"><label>Item <b>*</b></label><select id="ie_type" onchange="itemEditType()"><option' + (!isC ? ' selected' : '') + '>Battery</option><option' + (isC ? ' selected' : '') + '>Charger</option></select></div>' +
      '<div class="fg"><label>Type <b>*</b></label><select id="ie_cat">' + optList(isC ? M().chargerType : M().batteryType, it['Category'] || '', '-- Select --') + '</select></div>' +
      fg('Model <b>*</b>', 'ie_model', 'text', it['Model'], ' maxlength="100" list="dl_models"') +
      fg('Serial No', 'ie_serial', 'text', it['Serial No'], ' maxlength="60"') +
      '<div class="fg"><label>Warranty</label><select id="ie_war">' + optList(CONFIG.WARRANTY || [], it['Warranty'] || '', '-- Select --') + '</select></div>' +
      '<div class="fg"><label>Condition at receipt</label><select id="ie_cond">' + optList(M().condition, it['Condition'] || '', '-- Select --') + '</select></div>' +
      fg('Voltage (V)', 'ie_volt', 'number', it['Voltage'], ' min="0" step="0.1"') +
      fg('Mfg month', 'ie_mfg', 'month', it['Mfg Month'], '') +
      fg('Batch No', 'ie_batch', 'text', it['Batch No'], ' maxlength="60"') +
      fg('Brand <span class="opt">(other company only)</span>', 'ie_brand', 'text', it['Brand'], ' maxlength="60"') +
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
  if (d.model === OTHER_MODEL) return toast('⚠️ Type the model of the other company battery');
  if (d.type === 'Battery') {
    const lit = modelOf(d.model);
    d.source = lit || !(MODELS || []).length ? 'Litpax' : 'Other';
    if (lit) d.model = lit.code;
    d.brand = d.source === 'Other' ? v('ie_brand') : '';
    if (d.source === 'Other' && !d.brand) return toast('⚠️ "' + d.model + '" is not a Litpax model — enter the brand of the other company');
  } else { d.source = ''; d.brand = ''; }
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

function recvSlip(rid) {
  if (!CUR) return;
  const t0 = CUR.ticket, rcs = receiptsOf();
  const rc = (rid && rcs.find(x => x['Receipt ID'] === rid)) || rcs[rcs.length - 1] || {};
  const pk = (CUR.pickups || []).find(p => p['Pickup ID'] === rc['Pickup ID']) || {};
  const items = rc['Receipt ID'] ? itemsOfReceipt(rc) : (CUR.items || []);
  // the slip reads the repair job + its pickup, falling back to the ticket view
  const t = Object.assign({}, t0, rc['Receipt ID'] ? { 'Received Date': rc['Received Date'], 'Received By': rc['Received By'], 'Accessories': rc['Accessories'],
    'Qty Note': rc['Qty Note'], 'Receive Remarks': rc['Remarks'] } : {}, pk['Pickup ID'] ? { 'Pickup By': pk['Pickup By'], 'Transport Name': pk['Transport Name'],
    'LR No': pk['LR No'], 'No. of Boxes': pk['No. of Boxes'] } : {});
const nb = items.filter(i => i['Item Type'] === 'Battery').length, nc = items.length - nb;
  const link = trackLink(t);
  const track = link ? '<div class="slip-track">' + qrImg(link, 110) +
    '<div><b>Track your service online</b><br>Scan the QR code, or open<br><span class="slip-url">' + esc(CONFIG.TRACK_URL) +
    '</span><br>and enter Ticket ID <b>' + esc(t['Ticket ID']) + '</b> + last 4 digits of your phone.</div></div>' : '';
  const wa = waBtn(t['Ticket ID'], 'received', waUrl(t['Phone'], waFill((CONFIG.WA_TEMPLATES || {}).received,
    { name: t['Contact Person'], id: t['Ticket ID'], items: itemsText(nb, nc), link })), 'Send "Items Received" on WhatsApp', '');
  const html =
    '<div class="slip" id="slip">' + slipHead('Receiving Slip', t['Received Date']) +
      '<div class="slip-sec">Ticket: <b>' + esc(t['Ticket ID']) + '</b>' + (rc['Receipt ID'] ? ' · Repair Job: <b>' + esc(rc['Receipt ID']) + '</b>' : '') +
        (pk['Pickup ID'] ? ' · Pickup: <b>' + esc(pk['Pickup ID']) + '</b>' : '') + '</div>' +
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
    fault: it['Fault Code'] || '', cost: it['Repair Cost'] === '' || it['Repair Cost'] == null ? '' : it['Repair Cost'],
    result: it['Repair Result'] || '', replacementId: it['Replacement ID'] || ''
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
  const live = it => !itemDone(it.status);
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
      '<button type="button" class="bc-fault bc-report' + (it.result ? '' : ' empty') + '" data-id="' + esc(it.itemId) + '" data-t="' + esc(it.ticketId) + '" onclick="reportOpen(this.dataset.id, this.dataset.t)">' +
        (it.result ? '🧾 ' + esc(it.result) + (it.cost !== '' && it.cost != null ? ' · ' + rupee(it.cost) : '') : '🧾 Repair report — needed before ' + esc(STAGES[last])) + '</button>' +
      (it.replacementId ? '<div class="bc-info"><span class="tag tag-violet">🔁 Exchange · ' + esc(it.replacementId) + '</span></div>' : '') +
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
  if (stage === STAGES[STAGES.length - 1] && it && !it.result) {   // report first
    boardRender(); toast('🧾 Fill the Repair Report first'); return reportOpen(itemId, it.ticketId);
  }
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
  replLoadDispatch();
}

async function dispLoad() {
  $('dList').innerHTML = '<div class="skeleton sk-card"></div>';
  try {
    const r = await api({ action: 'getItems' });
    if (!r || !r.ok) { toast('❌ ' + ((r && r.msg) || 'Could not load')); return; }
    const last = STAGES[STAGES.length - 1];
    dispItems = (r.items || []).map(mapItem).filter(it => it.status === last && !it.replacementId);   // exchanged batteries go to stock, not to the customer
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
    transport: $('d_transport').value.trim(), lr: $('d_lr').value.trim(), charges: $('d_cost').value.trim(), actualProblem: $('d_problem').value.trim(),
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
  ['d_transport', 'd_lr', 'd_cost', 'd_problem', 'd_address', 'd_remarks'].forEach(id => { $(id).value = ''; });
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
  ['accessory',    'Accessory',     'Things received along with the items',    '🔌'],
  ['rootCause',    'Root Cause',    'What was faulty — Repair Report',         '🧩'],
  ['sparePart',    'Spare Part',    'Parts in the Repair Report — add the rate like "BMS 13S 30A | 650"', '🔩']
];

function openMasters() {
  mstRender();
  ensureMasters(true).then(mstRender);
  ensureModels().then(mstRender);
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
  }).join('') + modelsCard();
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
    const isDisp = itemDone(it.status);
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
    if (nav.length) R.nav = navList(nav);
  }
  if (R && $('appWrap').style.display !== 'none') {
    navRender(R.nav);
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
  $('setForm').innerHTML = (can('admin') ? '<div id="secBox"></div>' : '') + Object.keys(groups).map(g =>
    '<div class="card set-card"><div class="card-head"><span>' + esc(g) + '</span></div>' + groups[g].map(setField).join('') + '</div>'
  ).join('') +
    '<div class="set-bar"><span>Saved values apply to everyone within 5 minutes (or on refresh). These are also in the <b>Settings</b> tab of the sheet.</span>' +
    '<button id="setSave" class="btn btn-primary" onclick="setSave(this)">Save settings ✓</button></div>';
  if (can('admin')) { if (SEC) secRender(); secLoad(); }
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

/* ============================================================
   v7 — RECORD PAGES (Salesforce-style)
   Every ID is a link → its own page with lookups (parent records), details, related lists and history.
   Customer › Ticket › Pickup / Repair Job › Item › Dispatch
   ============================================================ */
const REC_ICO = { customer: '👤', ticket: '🎫', call: '📞', pickup: '🚚', receipt: '🧰', item: '🔋', dispatch: '📦', feedback: '⭐', whatsapp: '📲', replacement: '🔁' };
const REC_LABEL = { customer: 'Customer', ticket: 'Ticket', call: 'Call', pickup: 'Pickup', receipt: 'Repair Job', item: 'Item', dispatch: 'Dispatch', feedback: 'Feedback', whatsapp: 'WhatsApp', replacement: 'Replacement' };
let REC = null, REC_HIST = [], CUST = null, _recSeq = 0;
// tickets / customers opened in this session — shown instantly next time, then refreshed in the background
const REC_MEM = {};
const memPut = (k, v) => { REC_MEM[k] = { v, at: Date.now() }; };
const memGet = k => { const m = REC_MEM[k]; return m && Date.now() - m.at < 10 * 60000 ? m.v : null; };
let DR_TAB = 'overview';

const serialKey = s => String(s || '').replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
function idChip(id, old) {
  return id ? '<span class="id-chip">' + esc(id) + '</span>' : (old ? '<span class="id-chip id-old" title="Old record — gets its own ID when the migration is run">old</span>' : '');
}
// lookup link → opens that record
function lk(type, id, tid, text) {
  if (!id) return '<span class="muted-txt">—</span>';
  return '<button type="button" class="lk" data-t="' + type + '" data-i="' + esc(id) + '" data-k="' + esc(tid || '') + '" onclick="lkGo(this,event)">' +
    esc(text || id) + '</button>';
}
function lkGo(el, e) { if (e) { e.stopPropagation(); e.preventDefault(); } openRecord(el.dataset.t, el.dataset.i, el.dataset.k); }
// key/value rows where the value is already HTML (lookups)
function kvh(rows) {
  return rows.filter(r => r[1] !== '' && r[1] != null).map(r => '<div class="kv"><span>' + esc(r[0]) + '</span><span>' + r[1] + '</span></div>').join('') || '<div class="empty sm">—</div>';
}
const tv = v => esc(v === '' || v == null ? '—' : v);
function recCard(id, title, right, body, old, link) {
  return '<div class="rec' + (link ? ' rec-click' : '') + '"' + (link ? ' data-t="' + link[0] + '" data-i="' + esc(link[1]) + '" data-k="' + esc(link[2] || '') + '" onclick="lkGo(this,event)"' : '') + '>' +
    '<div class="rec-head">' + idChip(id, old) + '<b>' + title + '</b><span class="rec-right">' + (right || '') + '</span></div>' + body + '</div>';
}
// record header: type, big ID, status, highlight fields (lookups)
function recHead(type, id, pillHtml, high, sub) {
  return '<div class="rp-head"><div class="rp-type">' + (REC_ICO[type] || '') + ' ' + REC_LABEL[type] + '</div>' +
    '<div class="rp-title"><span>' + esc(id || 'Old record') + '</span>' + (pillHtml || '') + '</div>' +
    (sub ? '<div class="rp-sub">' + sub + '</div>' : '') +
    '<div class="rp-high">' + high.filter(h => h[1] !== '' && h[1] != null).map(h => '<div><span>' + esc(h[0]) + '</span><b>' + h[1] + '</b></div>').join('') + '</div></div>';
}
function tabsHtml(tabs) {
  if (!tabs.some(x => x[0] === DR_TAB)) DR_TAB = tabs[0][0];
  return '<div class="dr-tabs">' + tabs.map(([k, l, n]) => '<button type="button" class="' + (DR_TAB === k ? 'on' : '') + '" onclick="drTab(\'' + k + '\')">' + l +
    (n != null ? ' <span class="cnt">' + n + '</span>' : '') + '</button>').join('') + '</div>';
}
function drTab(k) { DR_TAB = k; renderRecord(); }
function bar(done, total) {
  const pc = total ? Math.round(done * 100 / total) : 0;
  return '<div class="pbar"><div class="pbar-fill" style="width:' + pc + '%"></div></div><div class="pbar-txt">' + done + ' / ' + total + ' dispatched</div>';
}
function histList(list) {
  return list.length ? '<div class="timeline">' + list.map(x =>
    '<div class="tl-item"><div class="tl-head"><b>' + idChip(x['Audit ID'], !x['Audit ID']) + ' ' + esc(x['Action']) +
    (x['Record ID'] && REC && x['Record ID'] !== REC.id ? ' · ' + esc(x['Record ID']) : (x['Item ID'] && (!REC || x['Item ID'] !== REC.id) ? ' · ' + esc(x['Item ID']) : '')) +
    '</b><span>' + esc(x['Time']) + ' · ' + esc(x['User']) + '</span></div>' +
    '<div class="tl-body muted-txt">' + esc(x['Details']) + '</div></div>').join('') + '</div>' : '<div class="empty sm">No changes recorded</div>';
}
function itemLine(it, tid) {
  return '<div class="im-row rec-click" data-t="item" data-i="' + esc(it['Item ID']) + '" data-k="' + esc(tid || it['Ticket ID']) + '" onclick="lkGo(this,event)">' +
    '<span class="im-id">' + esc(it['Item ID']) + '</span><span class="im-main">' + (it['Item Type'] === 'Charger' ? '⚡' : '🔋') + ' ' +
    esc([it['Category'], it['Model']].filter(Boolean).join(' · ')) +
    '<small>' + esc([it['Model Source'] === 'Other' && 'Other company: ' + it['Brand'], it['Serial No'] && 'SN ' + it['Serial No'], it['Warranty'],
      it['Condition'] && 'Arrived: ' + it['Condition'], it['Fault Code'] && 'Fault: ' + it['Fault Code']].filter(Boolean).join(' · ')) + '</small>' +
    '<span class="im-links">' + idChip(it['Receipt ID']) + idChip(it['Dispatch ID']) + idChip(it['Replacement ID']) + '</span>' + repeatTag(it['Repeat Count']) +
    (it['Repair Result'] ? '<span class="tag' + (it['Repair Result'] === 'Replace' ? ' tag-violet' : it['Repair Result'] === 'Repaired' ? ' tag-green' : '') + '">' + esc(it['Repair Result']) + (it['Repair Cost'] !== '' && it['Repair Cost'] != null ? ' · ' + esc(rupee(it['Repair Cost'])) : '') + '</span>' : '') +
    '</span>' + pill(it['Item Status']) + '</div>';
}
const isDisp = it => itemDone(it['Item Status']);   // dispatched, or (exchanged) moved to stock / production / scrap
const openPickup = () => (CUR && CUR.pickups || []).filter(p => p['Status'] === 'Arranged').pop() || null;

// old tickets (not migrated) → one pickup / repair job built from the old ticket columns
function pickupsOf() {
  const t = CUR.ticket; let pks = CUR.pickups || [];
  if (!pks.length && t['Pickup By']) pks = [{ 'Pickup ID': '', 'Pickup By': t['Pickup By'], 'No. of Boxes': t['No. of Boxes'], 'Pickup Place': t['Pickup Place'],
    'Pickup Date': t['Pickup Date'], 'Transport Name': t['Transport Name'], 'LR No': t['LR No'], 'Builty URL': t['Builty URL'],
    'Status': t['Received Date'] ? 'Received' : 'Arranged', 'Created At': t['Pickup Set At'], old: 1 }];
  return pks;
}
function receiptsOf() {
  const t = CUR.ticket; let rcs = CUR.receipts || [];
  if (!rcs.length && t['Received Date']) rcs = [{ 'Receipt ID': '', 'Received Date': t['Received Date'], 'Received By': t['Received By'],
    'Battery Qty': t['Battery Qty'], 'Charger Qty': t['Charger Qty'], 'Accessories': t['Accessories'], 'Qty Note': t['Qty Note'], 'Remarks': t['Receive Remarks'], old: 1 }];
  return rcs;
}
const itemsOfReceipt = r => (CUR.items || []).filter(i => (i['Receipt ID'] || '') === (r['Receipt ID'] || ''));

/* ---------- open / navigate ---------- */
async function openRecord(type, id, tid, opts) {
  opts = opts || {};
  if (!id) return;
  if (opts.fresh) { REC_HIST = []; opts.reload = true; }
  else if (REC && !opts.back && !opts.reload && !(REC.type === type && REC.id === id)) REC_HIST.push(REC);
  if (!opts.reload && !opts.back && !(REC && REC.type === type && REC.id === id)) DR_TAB = type === 'ticket' ? 'overview' : 'details';
  REC = { type, id, tid: type === 'ticket' ? id : (tid || ''), retried: !!opts.retried };
  const seq = ++_recSeq;
  $('drawer').classList.add('open'); $('drawerOv').classList.add('show');
  const have = type === 'customer' ? CUST && CUST.customer['Customer ID'] === id : CUR && REC.tid && CUR.ticket['Ticket ID'] === REC.tid;
  if (!have || opts.reload) $('drBody').innerHTML = '<div class="skeleton sk-block"></div><div class="skeleton sk-block"></div>';
  try {
    if (type === 'customer') {
      if (!have || opts.reload) {
        const m = !opts.reload && memGet('cu_' + id);
        if (m) { CUST = m; renderRecord(); }
        const r = await api({ action: 'getCustomer', customerId: id });
        if (seq !== _recSeq) return;
        if (!r || !r.ok) return m ? null : recError((r && r.msg) || 'Could not load');
        memPut('cu_' + id, r);
        if (m && JSON.stringify(m) === JSON.stringify(r)) return;
        CUST = r;
      }
      return renderRecord();
    }
    if (!REC.tid) {
      const f = await api({ action: 'findRecord', q: id });
      if (seq !== _recSeq) return;
      if (!f || !f.ok || !f.ticketId) return recError((f && f.msg) || 'Record not found');
      REC.tid = f.ticketId;
    }
    if (!have || opts.reload) {
      const m = !opts.reload && memGet('tk_' + REC.tid);
      if (m) { CUR = m; renderRecord(); }          // instant from memory …
      const [r] = await Promise.all([api({ action: 'getTicket', ticketId: REC.tid }), ensureMasters()]);
      if (seq !== _recSeq) return;
      if (!r || !r.ok) return m ? null : recError((r && r.msg) || 'Could not load');
      memPut('tk_' + REC.tid, r);
      if (m && JSON.stringify(m) === JSON.stringify(r)) return;   // … and redrawn only if something changed
      CUR = r;
    }
    renderRecord();
  } catch (e) { if (e !== 'auth' && seq === _recSeq) recError('Network error ❌'); }
}
function recError(msg) { $('drBody').innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }
function recBack() { const p = REC_HIST.pop(); if (p) openRecord(p.type, p.id, p.tid, { back: true }); }

// breadcrumb from the record's parents (not the click history)
function crumbs() {
  const c = [];
  const t = CUR && CUR.ticket;
  if (REC.type === 'customer') return [['customer', REC.id, '', REC.id]];
  if (t && t['Customer ID']) c.push(['customer', t['Customer ID'], '', t['Company Name'] || t['Customer ID']]);
  if (t) c.push(['ticket', t['Ticket ID'], t['Ticket ID'], t['Ticket ID']]);
  if (REC.type === 'item') {
    const it = (CUR.items || []).find(i => i['Item ID'] === REC.id);
    if (it && it['Receipt ID']) c.push(['receipt', it['Receipt ID'], REC.tid, it['Receipt ID']]);
  }
  if (REC.type !== 'ticket') c.push([REC.type, REC.id, REC.tid, REC.id]);
  return c;
}

function renderRecord() {
  if (!REC) return;
  const cr = crumbs();
  $('drTitle').innerHTML = (REC_HIST.length ? '<button class="rp-back" onclick="recBack()" title="Back">←</button>' : '') +
    '<div class="crumbs">' + cr.map((x, i) => i === cr.length - 1 ? '<b>' + esc(x[3]) + '</b>' : lk(x[0], x[1], x[2], x[3])).join('<span class="crumb-sep">›</span>') + '</div>';
  const R = { ticket: renderTicket, customer: renderCustomer, call: renderCall, pickup: renderPickup, receipt: renderReceipt,
              item: renderItem, dispatch: renderDispatch, feedback: renderFeedback, whatsapp: renderTicket, replacement: renderReplacement };
  (R[REC.type] || renderTicket)();
}

/* ---------- compat: old callers ---------- */
function drawerOpen(id) { return openRecord('ticket', id, id, { fresh: true, reload: true }); }
function drawerReload() { if (REC) openRecord(REC.type, REC.id, REC.tid, { reload: true }); }
function drawerRender() { renderRecord(); }

/* ---------- TICKET ---------- */
function qtyBox() {
  const t = CUR.ticket, items = CUR.items || [], pks = pickupsOf();
  let eb = 0, ec = 0;
  pks.forEach(p => { eb += +p['Exp Battery Qty'] || 0; ec += +p['Exp Charger Qty'] || 0; });
  if (!eb && !ec) { eb = +t['Exp Battery Qty'] || 0; ec = +t['Exp Charger Qty'] || 0; }
  const row = (lbl, typ, exp) => {
    const L = items.filter(i => i['Item Type'] === typ), got = L.length, out = L.filter(isDisp).length;
    const short = exp && got < exp ? exp - got : 0;
    return '<tr><td>' + lbl + '</td><td>' + (exp || '—') + '</td><td>' + got + '</td><td>' + (got - out) + '</td><td>' + out + '</td><td>' +
      (short ? '<span class="tag tag-red">⚠️ ' + short + ' short</span>' : (got && out === got ? '<span class="tag tag-green">✓ all out</span>' : '')) + '</td></tr>';
  };
  const th = (l, sh) => '<th><span class="lg">' + l + '</span><span class="sm">' + sh + '</span></th>';
  return '<table class="qty-box"><tr><th></th>' + th('Expected', 'Exp.') + th('Received', 'Rcvd') + th('In repair', 'Repair') + th('Done', 'Done') + '<th></th></tr>' +
    row('🔋 Battery', 'Battery', eb) + row('⚡ Charger', 'Charger', ec) + '</table>';
}

function renderTicket() {
  const t = CUR.ticket, s = t['Status'], sent = t['Battery Sent'] === 'Yes', open = !isEnded(s), cancelled = s === 'Cancelled';
  const early = s === 'New' || s === 'In Follow-up', opk = openPickup();
  const inRepair = ['Received', 'In Repair', 'Partial Dispatch'].indexOf(s) !== -1;
  const calls = CUR.calls || [], items = CUR.items || [], hist = CUR.history || [], dsp = CUR.dispatches || [], fbs = CUR.feedback || [];
  const pks = pickupsOf(), rcs = receiptsOf(), bats = items.filter(i => i['Item Type'] !== 'Charger'), chgs = items.filter(i => i['Item Type'] === 'Charger');
  const cu = CUR.customer, rpl = CUR.replacements || [];

  let h = recHead('ticket', t['Ticket ID'], pill(s), [
    ['Customer', t['Customer ID'] ? lk('customer', t['Customer ID'], '', t['Company Name']) : tv(t['Company Name'])],
    ['Contact', tv([t['Contact Person'], t['Phone']].filter(Boolean).join(' · '))],
    ['Complaint', tv(t['Complaint'])],
    ['Items', items.length ? esc(items.filter(isDisp).length + ' / ' + items.length + ' dispatched') : '—']
  ], cu && +cu['Total Tickets'] > 1 ? '🔁 Repeat customer — ' + esc(cu['Total Tickets']) + ' tickets' : '');
  h += cancelled ? '' : stepper(t);
  if (cancelled) h += '<div class="dsec actions"><div class="note note-gray">🚫 <b>Cancelled</b> on ' + esc(t['Closed At']) + '<br>Reason: ' + esc(t['Cancel Reason'] || '—') + '</div>' +
    (can('admin') ? '<button class="btn btn-ghost" onclick="ticketReopen(this)">↩️ Reopen ticket</button>' : '<div class="muted-sm">Only admin can reopen a cancelled ticket.</div>') + '</div>';

  // ---- actions (service team) ----
  const lowFb = t['Feedback Flag'] === 'Low', wantsCall = (CUR.callbacks || []).some(c => c['Status'] === 'Open');
  if (can('service') && (open || lowFb || wantsCall)) {
    const b = [];
    b.push('<button class="btn btn-primary" onclick="callFormToggle()">📞 Add Call Log</button>');
    if (!sent && early) b.push('<button class="btn btn-green" onclick="ticketSolve(this)">✅ Solved on Call</button>');
    if (opk) b.push('<button class="btn btn-violet" onclick="pickupOpen()">🚚 Edit Pickup ' + esc(opk['Pickup ID']) + '</button>');
    else if (early || s === 'In Transit') b.push('<button class="btn btn-violet" onclick="pickupOpen()">🚚 ' + (s === 'In Transit' ? 'Edit Pickup' : 'Arrange Pickup') + '</button>');
    else if (inRepair) b.push('<button class="btn btn-ghost" onclick="pickupOpen()">➕ Another Pickup</button>');
    if (opk || s === 'In Transit' || (sent && early)) b.push('<button class="btn btn-teal" onclick="receiveOpen()">📥 Mark Received' + (opk ? ' — ' + esc(opk['Pickup ID']) : '') + '</button>');
    if (open) b.push('<button class="btn btn-ghost" onclick="replOpen()">🔁 Advance Replacement</button>');
    if (open) b.push('<button class="btn btn-ghost" onclick="editOpen()">✏️ Edit details</button>');
    if (early || (s === 'In Transit' && !items.length)) b.push('<button class="btn btn-ghost btn-danger" onclick="cancelOpen()">🚫 Cancel ticket</button>');
    h += '<div class="dsec actions">' +
      (lowFb ? '<div class="note note-red">🔴 The customer gave low feedback. Call them and save a call log — that clears this flag.</div>' : '') +
      (sent && early ? '<div class="note">🚚 The customer has already sent the items — no troubleshooting needed. Just note the problem and fill in the pickup details.</div>' : '') +
      ((CUR.callbacks || []).filter(c => c['Status'] === 'Open').map(c => '<div class="note note-red">📞 <b>Customer asked for a call back</b> ' + idChip(c['Callback ID']) +
        ' — ' + esc(c['Preferred Time']) + ' · ' + esc(String(c['Requested At']).substring(0, 16)) + (c['Message'] ? '<br>“' + esc(c['Message']) + '”' : '') +
        '<br><span class="muted-sm">Saving a call log closes this request.</span></div>').join('')) +
      (opk && inRepair ? '<div class="note">🚚 Another lot is on the way — ' + esc(opk['Pickup ID']) + (opk['Exp Battery Qty'] || opk['Exp Charger Qty'] ? ' (' + esc(itemsText(+opk['Exp Battery Qty'] || 0, +opk['Exp Charger Qty'] || 0)) + ')' : '') + '</div>' : '') +
      '<div class="btn-wrap">' + b.join('') + '</div>' + callFormHtml(t) + '</div>';
  }

  h += tabsHtml([['overview', 'Overview'], ['calls', 'Calls', calls.length], ['pickups', 'Pickups', pks.length], ['jobs', 'Repair Jobs', rcs.length],
    ['batteries', '🔋 Batteries', bats.length], ['chargers', '⚡ Chargers', chgs.length], ['dispatches', 'Dispatches', dsp.length],
    ['replacements', '🔁 Replacements', rpl.length], ['feedback', 'Feedback', fbs.length || (t['Rating'] ? 1 : 0)], ['history', 'History', hist.length]]);

  let body = '';
  if (DR_TAB === 'overview') {
    if (items.length || pks.length) body += sec('📦 Quantities', qtyBox());
    body += sec('🎫 Ticket details', kv([
      ['Source', t['Source']], ['Vehicle', t['Vehicle Model']],
      ['Invoice / Purchase', [t['Invoice No'], t['Purchase Date'] && niceDate(t['Purchase Date'])].filter(Boolean).join(' · ')],
      ['Purchase Age', t['Purchase Age']],
      ['Items expected', (+t['Exp Battery Qty'] || +t['Exp Charger Qty']) ? itemsText(+t['Exp Battery Qty'] || 0, +t['Exp Charger Qty'] || 0) : ''],
      ['Earlier tickets', +t['Previous Tickets'] ? t['Previous Tickets'] + ' (repeat customer)' : ''],
      ['Items Sent', t['Battery Sent']], ['Created', t['Created At'] + (t['Created By'] ? ' · ' + t['Created By'] : '')]
    ]));
    body += sec('📊 Summary', kv([
      ['Outcome', t['Outcome']], ['Next Follow-up', open ? t['Next Follow-up'] : ''],
      ['Calls', t['Total Calls']], ['Last attended by', t['Attended By']], ['Solved by', t['Call Fix']],
      ['Rating', t['Rating'] ? t['Rating'] + ' / 5' : ''], ['Closed', t['Closed At'] && !cancelled ? t['Closed At'] : '']
    ]));
  }
  if (DR_TAB === 'calls') body += calls.length ? calls.map(c => recCard(c['Call ID'], esc(c['Attended By'] || c['Logged By']), esc(c['Time']),
      '<div class="tl-body">' + esc(c['Notes']) + '</div>' +
      (c['Checks'] ? '<div class="tl-checks">🧰 ' + esc(c['Checks']) + '</div>' : '') +
      (c['Next Follow-up'] ? '<div class="tl-next">📅 Next follow-up: ' + esc(c['Next Follow-up']) + '</div>' : ''),
      c['Old'], c['Call ID'] ? ['call', c['Call ID'], t['Ticket ID']] : null)).join('')
    : '<div class="empty sm">No calls yet</div>';
  if (DR_TAB === 'pickups') body += pks.length ? pks.slice().reverse().map(p => recCard(p['Pickup ID'],
      (p['Pickup By'] === 'Company' ? '🏢 By company' : '👤 By customer') + ' · ' + esc(niceDate(p['Pickup Date'])), pill(p['Status']),
      '<div class="rec-meta">' + esc([(+p['Exp Battery Qty'] || +p['Exp Charger Qty']) && 'Coming: ' + itemsText(+p['Exp Battery Qty'] || 0, +p['Exp Charger Qty'] || 0),
        p['Transport Name'], p['LR No'] && 'LR ' + p['LR No'], p['No. of Boxes'] && p['No. of Boxes'] + ' boxes'].filter(Boolean).join(' · ') || '—') + '</div>' +
      (p['Receipt ID'] ? '<div class="rec-meta">→ ' + lk('receipt', p['Receipt ID'], t['Ticket ID']) + '</div>' : ''),
      p.old, p['Pickup ID'] ? ['pickup', p['Pickup ID'], t['Ticket ID']] : null)).join('')
    : '<div class="empty sm">No pickup yet</div>';
  if (DR_TAB === 'jobs') body += rcs.length ? rcs.slice().reverse().map(r => {
      const L = itemsOfReceipt(r), out = L.filter(isDisp).length;
      return recCard(r['Receipt ID'], '🧰 ' + esc(niceDate(r['Received Date'])), r['Pickup ID'] ? 'from ' + lk('pickup', r['Pickup ID'], t['Ticket ID']) : '',
        '<div class="rec-meta">' + esc(itemsText(+r['Battery Qty'] || 0, +r['Charger Qty'] || 0)) + (r['Received By'] ? ' · by ' + esc(r['Received By']) : '') + '</div>' +
        (r['Qty Note'] ? '<div class="note note-red">⚠️ ' + esc(r['Qty Note']) + '</div>' : '') + bar(out, L.length),
        r.old, r['Receipt ID'] ? ['receipt', r['Receipt ID'], t['Ticket ID']] : null);
    }).join('') : '<div class="empty sm">Not received yet</div>';
  if (DR_TAB === 'batteries') body += bats.length ? '<div class="items-mini">' + bats.map(i => itemLine(i, t['Ticket ID'])).join('') + '</div>' : '<div class="empty sm">No batteries</div>';
  if (DR_TAB === 'chargers') body += chgs.length ? '<div class="items-mini">' + chgs.map(i => itemLine(i, t['Ticket ID'])).join('') + '</div>' : '<div class="empty sm">No chargers</div>';
  if (DR_TAB === 'dispatches') body += dsp.length ? dsp.slice().reverse().map(d => recCard(d['Dispatch ID'], '📦 ' + esc(niceDate(d['Dispatch Date'])),
      esc(itemsText(+d['Batteries'] || 0, +d['Chargers'] || 0)),
      '<div class="rec-meta">' + esc([d['Transport'], d['Dispatched By'] && 'by ' + d['Dispatched By'], rupee(d['Charges'])].filter(Boolean).join(' · ') || '—') + '</div>' +
      '<div class="rec-meta muted-txt">' + esc(d['Item IDs']) + '</div>', d['Old'], d['Dispatch ID'] ? ['dispatch', d['Dispatch ID'], t['Ticket ID']] : null)).join('')
    : '<div class="empty sm">Nothing dispatched yet</div>';
  if (DR_TAB === 'feedback') {
    const was = waLog(t);
    body += fbs.length ? fbs.slice().reverse().map(f => recCard(f['Feedback ID'], '⭐ ' + esc(f['Rating']) + ' / 5', esc(f['Time']),
        kv([['Problem Solved', f['Solved']], ['Comment', f['Comment']],
            ['Flag', t['Feedback Flag'] === 'Low' ? '🔴 Low — call pending' : (t['Feedback Flag'] === 'Resolved' ? '✅ Called back' : '')]]), !f['Feedback ID'])).join('')
      : (t['Feedback Asked At'] ? sec('⭐ Feedback', kv([['Asked On', t['Feedback Asked At']], ['Status', 'Waiting for customer']])) : '<div class="empty sm">No feedback yet</div>');
    if (was.length) body += sec('📲 WhatsApp sent (' + was.length + ')', '<div class="timeline">' + was.slice().reverse().map(w =>
      '<div class="tl-item"><div class="tl-head"><b>' + idChip(w.id, !w.id) + ' ' + esc(w.e) + '</b><span>' + esc(w.t) + (w.b ? ' · ' + esc(w.b) : '') + '</span></div></div>').join('') + '</div>');
  }
  if (DR_TAB === 'replacements') body += rpl.length ? rpl.slice().reverse().map(x => recCard(x['Replacement ID'], '🔁 ' + esc(x['Type']),
      '<span class="pill pill-' + ({ 'Pending Approval': 'amber', 'Requested': 'blue', 'Dispatched': 'violet', 'Closed': 'green' }[x['Status']] || 'gray') + '">' + esc(x['Status']) + '</span>',
      '<div class="rec-meta">' + esc([x['Old Model'], x['Warranty'], x['New Serial'] && 'new SN ' + x['New Serial'], x['Dispatch Date'] && 'sent ' + niceDate(x['Dispatch Date'])].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="rec-meta">Old battery: ' + (x['Against Item ID'] ? esc(x['Against Item ID']) + (x['Old Outcome'] ? ' → ' + esc(x['Old Outcome']) : ' · with us') : '<b>not received yet</b>') + '</div>',
      0, ['replacement', x['Replacement ID'], t['Ticket ID']])).join('')
    : '<div class="empty sm">No replacements. Use <b>🔁 Advance Replacement</b> to send a new battery before the old one arrives, or choose "Replace" in an item\'s Repair Report.</div>';
  if (DR_TAB === 'history') body += histList(hist);
  h += '<div class="dr-tab-body">' + body + '</div>';
  if (!cancelled) h += waSection();
  $('drBody').innerHTML = h;
}

/* ---------- CHILD RECORDS (pages) ---------- */
function recHistory(id) { return (CUR.history || []).filter(x => x['Record ID'] === id || x['Item ID'] === id); }
function custLk() { const t = CUR.ticket; return t['Customer ID'] ? lk('customer', t['Customer ID'], '', t['Company Name']) : tv(t['Company Name']); }
function tkLk() { return lk('ticket', CUR.ticket['Ticket ID'], CUR.ticket['Ticket ID']); }
// the record may be newer than the loaded ticket → reload once before giving up
function notFound() {
  if (!REC.retried) { openRecord(REC.type, REC.id, REC.tid, { reload: true, retried: true }); return; }
  $('drBody').innerHTML = '<div class="empty">' + esc(REC.id) + ' was not found on ' + esc(REC.tid) + '</div>';
}

function renderCall() {
  const c = (CUR.calls || []).find(x => x['Call ID'] === REC.id); if (!c) return notFound();
  const all = (CUR.calls || []).slice().reverse(), k = all.indexOf(c), prev = all[k - 1], next = all[k + 1];
  let h = recHead('call', c['Call ID'], c['Result'] ? '<span class="pill pill-blue">' + esc(c['Result']) + '</span>' : '',
    [['Ticket', tkLk()], ['Customer', custLk()], ['Time', tv(c['Time'])], ['Attended By', tv(c['Attended By'])]]);
  h += tabsHtml([['details', 'Details'], ['history', 'History', recHistory(c['Call ID']).length]]);
  let body = '';
  if (DR_TAB === 'details') {
    body += sec('🗒️ Call', kvh([['Notes', tv(c['Notes'])], ['Checks done', tv(c['Checks'])], ['Next follow-up', tv(c['Next Follow-up'])],
      ['Purchase age', tv(c['Purchase Age'])], ['Logged by', tv(c['Logged By'])]]));
    body += sec('↔️ Call sequence on this ticket', kvh([['Call', esc((k + 1) + ' of ' + all.length)],
      ['Previous call', prev ? lk('call', prev['Call ID'], REC.tid, (prev['Call ID'] || 'old') + ' · ' + prev['Time']) : ''],
      ['Follow-up call', next ? lk('call', next['Call ID'], REC.tid, (next['Call ID'] || 'old') + ' · ' + next['Time']) : '']]));
  }
  if (DR_TAB === 'history') body += histList(recHistory(c['Call ID']));
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

function renderPickup() {
  const p = (CUR.pickups || []).find(x => x['Pickup ID'] === REC.id); if (!p) return notFound();
  const r = (CUR.receipts || []).find(x => x['Receipt ID'] === p['Receipt ID'] || x['Pickup ID'] === p['Pickup ID']);
  const L = r ? itemsOfReceipt(r) : [];
  let h = recHead('pickup', p['Pickup ID'], pill(p['Status']),
    [['Ticket', tkLk()], ['Customer', custLk()], ['Pickup date', tv(niceDate(p['Pickup Date']))], ['Repair Job', r ? lk('receipt', r['Receipt ID'], REC.tid) : tv('')]]);
  if (can('service') && p['Status'] === 'Arranged' && !isEnded(CUR.ticket['Status']))
    h += '<div class="rp-actions"><button class="btn btn-violet btn-sm" onclick="pickupOpen()">✏️ Edit pickup</button>' +
      '<button class="btn btn-teal btn-sm" data-p="' + esc(p['Pickup ID']) + '" onclick="receiveOpen(this.dataset.p)">📥 Mark Received</button></div>';
  h += tabsHtml([['details', 'Details'], ['related', 'Items received', L.length], ['history', 'History', recHistory(p['Pickup ID']).length]]);
  let body = '';
  if (DR_TAB === 'details') {
    body += sec('📦 Coming in this pickup', kvh([['Batteries', tv(p['Exp Battery Qty'] || 0)], ['Chargers', tv(p['Exp Charger Qty'] || 0)], ['Boxes', tv(p['No. of Boxes'])],
      ['Received', r ? esc(itemsText(+r['Battery Qty'] || 0, +r['Charger Qty'] || 0)) + (r['Qty Note'] ? ' <span class="tag tag-red">⚠️ short</span>' : ' <span class="tag tag-green">✓ matches</span>') : '']]));
    body += sec('🚚 Transport', kvh([['Arranged by', tv(p['Pickup By'])], ['Place', tv(p['Pickup Place'])], ['Transport', tv(p['Transport Name'])], ['LR No', tv(p['LR No'])],
      ['Builty', safeUrl(p['Builty URL']) ? '<a class="call-link" href="' + esc(safeUrl(p['Builty URL'])) + '" target="_blank" rel="noopener">📎 View builty</a>' : tv('')],
      ['Saved', tv(p['Created At'] + (p['Created By'] ? ' · ' + p['Created By'] : ''))]]));
  }
  if (DR_TAB === 'related') body += L.length ? '<div class="items-mini">' + L.map(i => itemLine(i, REC.tid)).join('') + '</div>' : '<div class="empty sm">Not received yet</div>';
  if (DR_TAB === 'history') body += histList(recHistory(p['Pickup ID']));
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

function renderReceipt() {
  const r = (CUR.receipts || []).find(x => x['Receipt ID'] === REC.id); if (!r) return notFound();
  const L = itemsOfReceipt(r), out = L.filter(isDisp), bats = L.filter(i => i['Item Type'] !== 'Charger'), chgs = L.filter(i => i['Item Type'] === 'Charger');
  const dIds = Array.from(new Set(L.map(i => i['Dispatch ID']).filter(Boolean)));
  const dsp = (CUR.dispatches || []).filter(d => dIds.indexOf(d['Dispatch ID']) !== -1);
  let h = recHead('receipt', r['Receipt ID'], out.length === L.length && L.length ? '<span class="pill pill-green">All dispatched</span>' : '<span class="pill pill-blue">' + (L.length - out.length) + ' in repair</span>',
    [['Ticket', tkLk()], ['Customer', custLk()], ['Pickup', r['Pickup ID'] ? lk('pickup', r['Pickup ID'], REC.tid) : tv('')], ['Received', tv(niceDate(r['Received Date']))]]);
  h += '<div class="dsec">' + bar(out.length, L.length) + '</div>';
  h += tabsHtml([['details', 'Details'], ['batteries', '🔋 Batteries', bats.length], ['chargers', '⚡ Chargers', chgs.length], ['dispatches', 'Dispatches', dsp.length],
    ['history', 'History', recHistory(r['Receipt ID']).length]]);
  let body = '';
  if (DR_TAB === 'details') {
    body += sec('🧰 Received', kvh([['Batteries', tv(r['Battery Qty'] || 0)], ['Battery models', tv(r['Battery Model'])], ['Chargers', tv(r['Charger Qty'] || 0)],
      ['Charger models', tv(r['Charger Model'])], ['Expected', (+r['Exp Battery Qty'] || +r['Exp Charger Qty']) ? esc(itemsText(+r['Exp Battery Qty'] || 0, +r['Exp Charger Qty'] || 0)) : ''],
      ['Received with items', tv(r['Accessories'])], ['Remarks', tv(r['Remarks'])], ['Received by', tv(r['Received By'])]]) +
      (r['Qty Note'] ? '<div class="note note-red" style="margin-top:10px">⚠️ ' + esc(r['Qty Note']) + '</div>' : '') +
      '<button class="btn btn-ghost btn-sm" style="margin-top:10px" data-r="' + esc(r['Receipt ID']) + '" onclick="recvSlip(this.dataset.r)">🖨️ Receiving Slip</button>');
    const pend = L.filter(i => !isDisp(i)), by = {};
    pend.forEach(i => { by[i['Item Status']] = (by[i['Item Status']] || 0) + 1; });
    if (pend.length) body += sec('⏳ Still in repair (' + pend.length + ')', '<div class="rec-meta">' + Object.keys(by).map(k => esc(k) + ': <b>' + by[k] + '</b>').join(' · ') + '</div>');
  }
  if (DR_TAB === 'batteries') body += bats.length ? '<div class="items-mini">' + bats.map(i => itemLine(i, REC.tid)).join('') + '</div>' : '<div class="empty sm">No batteries</div>';
  if (DR_TAB === 'chargers') body += chgs.length ? '<div class="items-mini">' + chgs.map(i => itemLine(i, REC.tid)).join('') + '</div>' : '<div class="empty sm">No chargers</div>';
  if (DR_TAB === 'dispatches') body += dsp.length ? dsp.map(d => recCard(d['Dispatch ID'], '📦 ' + esc(niceDate(d['Dispatch Date'])), esc(itemsText(+d['Batteries'] || 0, +d['Chargers'] || 0)),
      '<div class="rec-meta">' + esc(d['Item IDs']) + '</div>', 0, ['dispatch', d['Dispatch ID'], REC.tid])).join('') : '<div class="empty sm">Nothing dispatched yet</div>';
  if (DR_TAB === 'history') body += histList(recHistory(r['Receipt ID']));
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

function renderItem() {
  const it = (CUR.items || []).find(x => x['Item ID'] === REC.id); if (!it) return notFound();
  const log = (CUR.stageLog || []).filter(l => l['Item ID'] === it['Item ID']).reverse();
  const earlier = ((CUR.serialHistory || {})[serialKey(it['Serial No'])] || []);
  let h = recHead('item', it['Item ID'], pill(it['Item Status']),
    [['Ticket', tkLk()], ['Customer', custLk()], ['Repair Job', it['Receipt ID'] ? lk('receipt', it['Receipt ID'], REC.tid) : tv('')],
     ['Dispatch', it['Dispatch ID'] ? lk('dispatch', it['Dispatch ID'], REC.tid) : tv('')]],
    (it['Item Type'] === 'Charger' ? '⚡ ' : '🔋 ') + esc([it['Category'], it['Model']].filter(Boolean).join(' · ')) + (+it['Repeat Count'] ? ' · ' + repeatTag(it['Repeat Count']) : ''));
  const ab = [], done = itemDone(it['Item Status']);
  if (can('repair') && !done) ab.push('<button class="btn btn-primary btn-sm" data-id="' + esc(it['Item ID']) + '" onclick="reportOpen(this.dataset.id)">🧾 ' + (it['Repair Result'] ? 'Edit' : 'Fill') + ' Repair Report</button>');
  if (can('repair') && !done && it['Replacement ID']) ab.push('<button class="btn btn-ghost btn-sm" data-id="' + esc(it['Item ID']) + '" onclick="stockOpen(this.dataset.id)">📦 Move to stock</button>');
  if (can('service')) ab.push('<button class="btn btn-ghost btn-sm" data-id="' + esc(it['Item ID']) + '" onclick="itemEditOpen(this.dataset.id)">✏️ Correct details</button>');
  if (it['Replacement ID']) h += '<div class="note">🔁 Exchanged battery — the customer gets a new one through ' + lk('replacement', it['Replacement ID'], REC.tid) + '. This battery is not sent back: after repair it goes to <b>Refurbished stock</b>, <b>Production</b> or <b>Scrap</b>.</div>';
  if (ab.length) h += '<div class="rp-actions">' + ab.join('') + '</div>';
  const myParts = (CUR.parts || []).filter(p => p['Item ID'] === it['Item ID']);
  h += tabsHtml([['details', 'Details'], ['report', 'Repair Report', it['Repair Result'] ? 1 : 0], ['stages', 'Stage history', log.length], ['visits', 'Earlier visits', earlier.length], ['history', 'History', recHistory(it['Item ID']).length]]);
  let body = '';
  if (DR_TAB === 'details') {
    body += sec('🔋 Item', kvh([['Type', tv(it['Item Type'])], ['Category', tv(it['Category'])], ['Model', tv(it['Model'])],
      ['Made by', it['Model Source'] === 'Other' ? esc('Other company: ' + it['Brand']) : tv(it['Model Source'] || '')],
      ['Serial No', tv(it['Serial No'])], ['Warranty', tv(it['Warranty'])], ['Mfg month', tv(it['Mfg Month'])], ['Batch No', tv(it['Batch No'])]]));
    body += sec('📥 On arrival', kvh([['Received', tv(niceDate(it['Received Date']))], ['Condition', tv(it['Condition'])],
      ['Voltage', it['Voltage'] === '' || it['Voltage'] == null ? tv('') : esc(it['Voltage'] + ' V')], ['Used for', it['Usage Months'] !== '' && it['Usage Months'] != null ? esc(it['Usage Months'] + ' months') : tv('')]]));
    body += sec('🔧 Repair', kvh([['Status', pill(it['Item Status'])], ['Plan date', tv(it['Plan Date'])], ['Fault found', tv(it['Fault Code'])],
      ['Repair cost', tv(rupee(it['Repair Cost']))], ['Problem found', tv(it['Actual Problem Found'])]]));
    if (it['Dispatch ID'] || it['Dispatch Date']) body += sec('📦 Dispatch', kvh([['Dispatch', it['Dispatch ID'] ? lk('dispatch', it['Dispatch ID'], REC.tid) : tv('')],
      ['Date', tv(niceDate(it['Dispatch Date']))], ['Transport', tv(it['Transport (Outward)'])], ['By', tv(it['Dispatched By'])]]));
  }
  if (DR_TAB === 'report') body += it['Repair Result'] ? sec('🧾 Repair Report', kvh([['Result', esc(it['Repair Result'])], ['Root cause', tv(it['Root Cause'])], ['Details', tv(it['Repair Notes'])],
      ['Parts cost', tv(rupee(it['Parts Cost']))], ['Labour', tv(rupee(it['Labour']))], ['Repair cost', '<b>' + tv(rupee(it['Repair Cost'])) + '</b>'], ['By', tv((it['Report By'] || '') + ' · ' + (it['Report At'] || ''))]]) +
      (myParts.length ? '<table class="as-table"><tr><th>ID</th><th>Part</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>' + myParts.map(p => '<tr><td>' + idChip(p['Part Use ID']) + '</td><td>' + esc(p['Part']) + '</td><td>' + esc(p['Qty']) +
        '</td><td>' + esc(rupee(p['Rate'])) + '</td><td>' + esc(rupee(p['Amount'])) + '</td></tr>').join('') + '</table>' : '<div class="muted-sm">No parts used</div>'))
    : '<div class="empty sm">No repair report yet' + (can('repair') ? ' — fill it before ' + esc(STAGES[STAGES.length - 1]) : '') + '</div>';
  if (DR_TAB === 'stages') body += log.length ? '<div class="timeline">' + log.map(l =>
      '<div class="tl-item"><div class="tl-head"><b>' + idChip(l['Log ID'], !l['Log ID']) + ' ' + esc(l['Event']) + '</b><span>' + esc(l['Time']) + ' · ' + esc(l['By']) + '</span></div>' +
      (l['Plan Date'] ? '<div class="muted-sm">Plan date ' + esc(l['Plan Date']) + '</div>' : '') + '</div>').join('') + '</div>' : '<div class="empty sm">No stage changes yet</div>';
  if (DR_TAB === 'visits') body += earlier.length ? '<div class="note">🔁 This serial number came to service ' + earlier.length + ' time(s) before</div>' + earlier.map(e =>
      recCard(e.itemId, esc(niceDate(e.received)), pill(e.status), '<div class="rec-meta">Ticket ' + esc(e.ticketId) + (e.fault ? ' · Fault: ' + esc(e.fault) : '') + '</div>', 0, ['item', e.itemId, e.ticketId])).join('')
    : '<div class="empty sm">' + (it['Serial No'] ? 'First visit of this serial number' : 'No serial number entered') + '</div>';
  if (DR_TAB === 'history') body += histList(recHistory(it['Item ID']));
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

function renderDispatch() {
  const d = (CUR.dispatches || []).find(x => x['Dispatch ID'] === REC.id); if (!d) return notFound();
  const L = (CUR.items || []).filter(i => i['Dispatch ID'] === d['Dispatch ID']);
  const rIds = String(d['Receipt IDs'] || '').split(/\s*,\s*/).filter(Boolean);
  let h = recHead('dispatch', d['Dispatch ID'], '<span class="pill pill-green">' + esc(itemsText(+d['Batteries'] || 0, +d['Chargers'] || 0)) + '</span>',
    [['Ticket', tkLk()], ['Customer', custLk()], ['Repair Job', rIds.length ? rIds.map(x => lk('receipt', x, REC.tid)).join(' ') : tv('')], ['Date', tv(niceDate(d['Dispatch Date']))]]);
  h += tabsHtml([['details', 'Details'], ['items', 'Items', L.length], ['history', 'History', recHistory(d['Dispatch ID']).length]]);
  let body = '';
  if (DR_TAB === 'details') body += sec('📦 Dispatch', kvh([['Dispatched by', tv(d['Dispatched By'])], ['Transport', tv(d['Transport'])], ['Charges', tv(rupee(d['Charges']))],
      ['Address', tv(d['Address'])], ['Problem found', tv(d['Problem Found'])], ['Remarks', tv(d['Remarks'])], ['Saved', tv(d['Created At'])]]));
  if (DR_TAB === 'items') body += L.length ? '<div class="items-mini">' + L.map(i => itemLine(i, REC.tid)).join('') + '</div>' : '<div class="rec-meta">' + esc(d['Item IDs']) + '</div>';
  if (DR_TAB === 'history') body += histList(recHistory(d['Dispatch ID']));
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

function renderFeedback() {
  const f = (CUR.feedback || []).find(x => x['Feedback ID'] === REC.id); if (!f) return notFound();
  const h = recHead('feedback', f['Feedback ID'], '<span class="pill pill-' + (+f['Rating'] <= 2 ? 'red' : 'green') + '">' + esc(f['Rating']) + ' / 5</span>',
    [['Ticket', tkLk()], ['Customer', custLk()], ['Given', tv(f['Time'])], ['Solved', tv(f['Solved'])]]);
  $('drBody').innerHTML = h + sec('⭐ Feedback', kvh([['Comment', tv(f['Comment'])]]));
}

/* ---------- CUSTOMER ---------- */
function renderCustomer() {
  const c = CUST.customer, T = CUST.tickets || [], I = CUST.items || [], F = CUST.feedback || [];
  const bats = I.filter(i => i['Item Type'] !== 'Charger').length, open = T.filter(t => !isEnded(t['Status'])).length;
  let h = recHead('customer', c['Customer ID'], open ? '<span class="pill pill-blue">' + open + ' open</span>' : '',
    [['Phone', c['Phone'] ? '<a href="tel:' + esc(c['Phone']) + '">' + esc(c['Phone']) + '</a>' : tv('')], ['City', tv([c['City'], c['State']].filter(Boolean).join(', '))],
     ['Tickets', esc(T.length)], ['Items serviced', esc(I.length + ' (' + bats + ' batteries)')]], esc(c['Company Name'] + (c['Contact Person'] ? ' · ' + c['Contact Person'] : '')));
  h += tabsHtml([['details', 'Details'], ['tickets', 'Tickets', T.length], ['items', 'Items', I.length], ['feedback', 'Feedback', F.length]]);
  let body = '';
  if (DR_TAB === 'details') body += sec('👤 Customer', kvh([['Company', tv(c['Company Name'])], ['Contact person', tv(c['Contact Person'])], ['Phone', tv(c['Phone'])],
      ['City / State', tv([c['City'], c['State']].filter(Boolean).join(', '))], ['Customer type', tv(c['Customer Type'])], ['Dealer', tv(c['Dealer'])],
      ['Customer since', tv(c['Created At'])], ['Last ticket', tv(c['Last Ticket At'])]]));
  if (DR_TAB === 'tickets') body += T.map(t => recCard(t['Ticket ID'], esc(t['Complaint'] || '—'), pill(t['Status']),
      '<div class="rec-meta">' + esc([niceDate(t['Created At']), +t['Total Items'] ? t['Total Items'] + ' items' : '', t['Outcome']].filter(Boolean).join(' · ')) + '</div>',
      0, ['ticket', t['Ticket ID'], t['Ticket ID']])).join('') || '<div class="empty sm">No tickets</div>';
  if (DR_TAB === 'items') body += I.length ? '<div class="items-mini">' + I.slice().reverse().map(i => itemLine(i, i['Ticket ID'])).join('') + '</div>' : '<div class="empty sm">No items</div>';
  if (DR_TAB === 'feedback') body += F.length ? F.map(f => recCard(f['Feedback ID'], '⭐ ' + esc(f['Rating']) + ' / 5', esc(f['Ticket ID']),
      '<div class="rec-meta">' + esc(f['Comment'] || '—') + '</div>', !f['Feedback ID'])).join('') : '<div class="empty sm">No feedback</div>';
  $('drBody').innerHTML = h + '<div class="dr-tab-body">' + body + '</div>';
}

/* ---------- GLOBAL SEARCH (topbar) ---------- */
async function gSearch() {
  const q = $('gSearch').value.trim();
  if (!q) return;
  let r;
  try { r = await api({ action: 'findRecord', q }); } catch (e) { return; }
  if (!r || !r.ok) return toast('🔎 ' + ((r && r.msg) || 'Nothing found'));
  $('gSearch').blur(); $('gSearch').value = '';
  if (r.type === 'serial') return modalOpen('🔎 Serial ' + q + ' — ' + r.matches.length + ' visits',
    r.matches.map(m => recCard(m.itemId, esc(niceDate(m.received)) + ' · ' + esc(m.model || ''), pill(m.status), '<div class="rec-meta">Ticket ' + esc(m.ticketId) + '</div>', 0, ['item', m.itemId, m.ticketId])).join('') +
    '<div class="muted-sm">Click a visit to open it.</div>');
  modalClose();
  openRecord(r.type, r.id, r.ticketId, { fresh: true });
}

/* ---------- RECORDS SCREEN ---------- */
const REC_LISTS = {
  customers: { label: '👤 Customers', type: 'customer', id: 'Customer ID',
    cols: [['Customer', r => esc(r['Company Name'])], ['Contact', r => esc([r['Contact Person'], r['Phone']].filter(Boolean).join(' · '))],
           ['City', r => esc(r['City'])], ['Tickets', r => esc(r['Total Tickets'])], ['Last ticket', r => esc(niceDate(r['Last Ticket At']))]] },
  calls: { label: '📞 Calls', type: 'call', id: 'Call ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc(r['Customer'])], ['By', r => esc(r['Attended By'] || r['Logged By'])],
           ['Notes', r => esc(String(r['Notes'] || '').substring(0, 80))], ['Time', r => esc(r['Time'])]] },
  pickups: { label: '🚚 Pickups', type: 'pickup', id: 'Pickup ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc(r['Customer'])], ['Coming', r => esc((+r['Exp Battery Qty'] || +r['Exp Charger Qty']) ? itemsText(+r['Exp Battery Qty'] || 0, +r['Exp Charger Qty'] || 0) : '—')],
           ['Transport', r => esc([r['Transport Name'], r['LR No']].filter(Boolean).join(' · '))], ['Status', r => pill(r['Status'])]] },
  receipts: { label: '🧰 Repair Jobs', type: 'receipt', id: 'Receipt ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc(r['Customer'])], ['Received', r => esc(niceDate(r['Received Date']))],
           ['Items', r => esc(itemsText(+r['Battery Qty'] || 0, +r['Charger Qty'] || 0))], ['Pickup', r => esc(r['Pickup ID'])]] },
  items: { label: '🔋 Items', type: 'item', id: 'Item ID',
    cols: [['Item', r => esc((r['Item Type'] === 'Charger' ? '⚡ ' : '🔋 ') + [r['Category'], r['Model']].filter(Boolean).join(' · '))], ['Serial', r => esc(r['Serial No'])],
           ['Customer', r => esc(r['Customer'])], ['Repair Job', r => esc(r['Receipt ID'])], ['Status', r => pill(r['Item Status'])]] },
  callbacks: { label: '📞 Call-backs', type: 'ticket', id: 'Callback ID', open: 'Ticket ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc([r['Customer'], r['Phone']].filter(Boolean).join(' · '))], ['When', r => esc(r['Preferred Time'])],
           ['Asked', r => esc(String(r['Requested At']).substring(0, 16))], ['Status', r => pill(r['Status'] === 'Open' ? 'Open' : 'Done')]] },
  replacements: { label: '🔁 Replacements', type: 'replacement', id: 'Replacement ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc(r['Customer'])], ['Battery', r => esc([r['Old Model'], r['New Serial'] && '→ ' + r['New Serial']].filter(Boolean).join(' '))],
           ['Old battery', r => esc(r['Against Item ID'] ? (r['Old Outcome'] || 'with us') : 'not received')], ['Status', r => pill(r['Status'])]] },
  stock: { label: '♻️ Refurb stock', type: 'item', id: 'Stock ID', open: 'Item ID',
    cols: [['Battery', r => esc([r['Category'], r['Model']].filter(Boolean).join(' · '))], ['Serial', r => esc(r['Serial No'])], ['From', r => esc(r['Item ID'])],
           ['Added', r => esc(niceDate(r['Added At']))], ['Status', r => pill(r['Status']) + (r['Issued RPL'] ? ' ' + esc(r['Issued RPL']) : '')]] },
  parts: { label: '🔩 Parts used', type: 'item', id: 'Part Use ID', open: 'Item ID',
    cols: [['Part', r => esc(r['Part'])], ['Qty', r => esc(r['Qty'])], ['Amount', r => esc(rupee(r['Amount']))], ['Item', r => esc(r['Item ID'])], ['Customer', r => esc(r['Customer'])]] },
  dispatches: { label: '📦 Dispatches', type: 'dispatch', id: 'Dispatch ID',
    cols: [['Ticket', r => esc(r['Ticket ID'])], ['Customer', r => esc(r['Customer'])], ['Date', r => esc(niceDate(r['Dispatch Date']))],
           ['Items', r => esc(itemsText(+r['Batteries'] || 0, +r['Chargers'] || 0))], ['Transport', r => esc(r['Transport'])]] }
};
let REC_TYPE = 'customers', REC_ROWS = {}, REC_LIMIT = 100;
function openRecords() {
  $('recTabs').innerHTML = Object.keys(REC_LISTS).map(k => '<button class="chip' + (k === REC_TYPE ? ' active' : '') + '" data-k="' + k + '" onclick="recSetType(this.dataset.k)">' + REC_LISTS[k].label + '</button>').join('');
  recLoad(false);
}
function recSetType(k) { REC_TYPE = k; REC_LIMIT = 100; $('recSearch').value = ''; openRecords(); }
async function recLoad(force) {
  const k = REC_TYPE, ck = 'rec_' + k, c = cacheGet(ck);
  if (!force && c && c.fresh) { REC_ROWS[k] = c.val; return recRender(); }
  if (c) { REC_ROWS[k] = c.val; recRender(); } else $('recList').innerHTML = '<div class="skeleton sk-block"></div><div class="skeleton sk-block"></div>';
  try {
    const r = await api({ action: 'listRecords', type: k });
    if (r && r.ok) { REC_ROWS[k] = r.rows; cacheSet(ck, r.rows); if (k === REC_TYPE) recRender(); }
    else if (!c) $('recList').innerHTML = '<div class="empty">' + esc((r && r.msg) || 'Could not load') + '</div>';
  } catch (e) { if (!c && e !== 'auth') $('recList').innerHTML = '<div class="empty">Network error ❌</div>'; }
}
function recRender() {
  const L = REC_LISTS[REC_TYPE], q = $('recSearch').value.trim().toLowerCase();
  let rows = REC_ROWS[REC_TYPE] || [];
  if (q) rows = rows.filter(r => Object.keys(r).some(k => String(r[k]).toLowerCase().indexOf(q) !== -1));
  $('recCount').textContent = rows.length + ' record' + (rows.length === 1 ? '' : 's');
  if (!rows.length) { $('recList').innerHTML = '<div class="empty">No records</div>'; return; }
  const show = rows.slice(0, REC_LIMIT);
  $('recList').innerHTML = '<div class="rl"><div class="rl-row rl-head"><span>ID</span>' + L.cols.map(c => '<span>' + c[0] + '</span>').join('') + '</div>' +
    show.map(r => '<div class="rl-row rec-click" data-t="' + L.type + '" data-i="' + esc(r[L.open || L.id] || '') + '" data-k="' + esc(r['Ticket ID'] || '') + '" onclick="lkGo(this,event)">' +
      '<span>' + idChip(r[L.id], !r[L.id]) + '</span>' + L.cols.map(c => '<span data-l="' + c[0] + '">' + (c[1](r) || '—') + '</span>').join('') + '</div>').join('') + '</div>' +
    (rows.length > REC_LIMIT ? '<button class="btn btn-ghost btn-block" onclick="REC_LIMIT += 200; recRender()">Show more (' + (rows.length - REC_LIMIT) + ')</button>' : '');
}

/* ============================================================
   ASSISTANT (staff) — rule-based, no AI / API key.
   Type a question or tap a chip → answers from the app's own (cached) data,
   every result opens its record page. English + Hinglish keywords.
   ============================================================ */
const AS = { open: false, started: false, data: {} };
const AS_CMDS = [
  ['help',     /^\s*(help|\?|commands?|kya kar sakte)\s*$/i,                                    '❔ Help'],
  ['callback', /\b(call ?backs?|call me|callback|ring back)\b/i,                               '📞 Call-backs'],
  ['fbdue',    /\b(feedback due|ask feedback|feedback pending)\b/i,                             '⭐ Feedback due'],
  ['due',      /\b(follow ?-?ups?|due|pending calls?|call karna|calls? (today|aaj))\b/i,       '📅 Follow-ups due'],
  ['sla',      /\b(sla|late|overdue|delay(ed)?|breach|der|lagging)\b/i,                        '⏱ SLA late'],
  ['transit',  /\b(transit|pickups?|on the way|raste)\b/i,                                     '🚚 In transit'],
  ['recv',     /\b(received|receive|aaya|aaye|aayi|inward|repair jobs?)\b/i,                  '📥 Received'],
  ['disp',     /\b(dispatch(ed)?|gaya|gaye|gayi|bheja|outward|sent)\b/i,                       '📦 Dispatched'],
  ['lowfb',    /\b(low feedback|bad rating|complain(t)? feedback|lowfb|unhappy|naraz)\b/i,      '🔴 Low feedback'],
  ['repeat',   /\b(repeat|dobara|again|baar baar)\b/i,                                          '🔁 Repeat batteries'],
  ['model',    /\b(model|models)\b/i,                                                           '🔋 Model-wise'],
  ['open',     /\b(open|chalu|active)\s*tickets?\b/i,                                           '🎫 Open tickets'],
  ['returns',  /\b(pending returns?|old battery|purani battery|not returned|return pending)\b/i,  '♻️ Pending returns'],
  ['tosend',   /\b(replacements?( to send)?|replace|exchange)\b/i,                         '🔁 Replacements to send'],
  ['stuck',    /\b(stuck|old|aging|ageing|purane|pending repair|repair pending|days?|din)\b/i, '🔧 Stuck in repair'],
  ['summary',  /\b(summary|today|aaj|snapshot|dashboard|overview|report)\b/i,              '📊 Today']
];
const AS_CHIPS = ['summary', 'callback', 'due', 'sla', 'stuck', 'tosend', 'returns', 'recv', 'disp', 'lowfb'];

function asBoot() {
  if ($('asFab')) return;
  const w = document.createElement('div');
  w.innerHTML =
    '<button id="asFab" class="as-fab" onclick="asToggle()" title="Assistant (Ctrl+K)"><span>✨</span><b>Ask</b></button>' +
    '<section id="asPanel" class="as-panel" hidden>' +
      '<header class="as-head"><div class="as-av">✨</div><div><b>Service Assistant</b><span>Ask about tickets, call-backs, SLA, repair, dispatch</span></div>' +
        '<button class="as-x" onclick="asToggle(false)">✕</button></header>' +
      '<div id="asLog" class="as-log"></div>' +
      '<div id="asChips" class="as-chips"></div>' +
      '<form class="as-in" onsubmit="asSend(event)"><input id="asInput" autocomplete="off" placeholder="e.g. stuck 5 days · model 48V · DSP-0004 · Rohtak">' +
      '<button type="submit">➤</button></form>' +
    '</section>';
  ($('appWrap') || document.body).appendChild(w);   // only visible once signed in
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && $('appWrap').style.display !== 'none') { e.preventDefault(); asToggle(true); } });
}
function asToggle(force) {
  AS.open = typeof force === 'boolean' ? force : !AS.open;
  $('asPanel').hidden = !AS.open; $('asFab').classList.toggle('on', AS.open);
  if (AS.open && !AS.started) { AS.started = true; asAdd('<b>Namaste 👋</b> Ask me anything about today\'s work, or tap a chip. Type any ID, phone or serial to open it.', 'bot'); }
  if (AS.open) { asChipsShow(AS_CHIPS); setTimeout(() => $('asInput').focus(), 50); }
}
function asAdd(html, who) {
  const d = document.createElement('div'); d.className = 'as-msg ' + who; d.innerHTML = html;
  $('asLog').appendChild(d); $('asLog').scrollTop = $('asLog').scrollHeight; return d;
}
function asChipsShow(keys) {
  $('asChips').innerHTML = keys.map(k => { const c = AS_CMDS.find(x => x[0] === k); return c ? '<button type="button" data-k="' + k + '" onclick="asChip(this)">' + c[2] + '</button>' : ''; }).join('');
}
function asChip(el) { asAdd(esc(el.textContent), 'me'); asRun(el.dataset.k, ''); }
function asSend(e) {
  e.preventDefault();
  const q = $('asInput').value.trim(); if (!q) return;
  $('asInput').value = ''; asAdd(esc(q), 'me'); asAsk(q);
}

// ---- data (all cached server-side; refreshed after any save) ----
async function asGet(k) {
  const fresh = AS.data[k] && Date.now() - AS.data[k].at < 60000;
  if (fresh) return AS.data[k].v;
  let v = null;
  if (k === 'tickets') { const r = await api({ action: 'getTickets' }); v = r && r.ok ? r.tickets : null; }
  else if (k === 'tracker') { const r = await api({ action: 'getTracker' }); v = r && r.ok ? r.tickets : null; }
  else { const r = await api({ action: 'listRecords', type: k }); v = r && r.ok ? r.rows : null; }
  if (!v) throw 'load';
  AS.data[k] = { v, at: Date.now() };
  return v;
}
const dayStr = n => daysAgoStr(n);
const ageDays = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Math.floor((Date.now() - new Date(+m[1], m[2] - 1, +m[3]).getTime()) / 864e5) : 0; };

// result list → clickable rows
function asRows(title, rows, more) {
  if (!rows.length) return '<b>' + title + '</b><div class="as-empty">Nothing here 🎉</div>';
  const show = rows.slice(0, 15);
  return '<b>' + title + '</b> <span class="as-n">' + rows.length + '</span><div class="as-rows">' + show.map(r =>
    '<div class="as-row rec-click" data-t="' + r.t + '" data-i="' + esc(r.id) + '" data-k="' + esc(r.tid || '') + '" onclick="lkGo(this,event)">' +
      idChip(r.id) + '<span class="as-main">' + esc(r.main || '') + '<small>' + esc(r.sub || '') + '</small></span>' + (r.right || '') + '</div>').join('') + '</div>' +
    (rows.length > show.length ? '<div class="as-more">+ ' + (rows.length - show.length) + ' more' + (more ? ' — ' + more : '') + '</div>' : '');
}
const tkRow = (t, sub) => ({ t: 'ticket', id: t['Ticket ID'], tid: t['Ticket ID'], main: t['Company Name'], sub: sub || [t['Contact Person'], t['Phone'], t['City']].filter(Boolean).join(' · '), right: pill(t['Status']) });

async function asAsk(q) {
  const Q = q.trim();
  // an ID, phone or serial → open it
  if (/^(CUS|LTX-R|CAL|PCK|RCV|DSP|FBK|CBR|WA)-\d/i.test(Q) || /^\d{10}$/.test(Q)) return asFind(Q);
  const cmd = AS_CMDS.find(c => c[1].test(Q));
  if (cmd) return asRun(cmd[0], Q);
  // otherwise: search tickets by name / city / dealer / complaint, then serial numbers
  const wait = asAdd('<span class="as-typing"><i></i><i></i><i></i></span>', 'bot');
  try {
    const T = await asGet('tickets'), s = Q.toLowerCase();
    const hits = T.filter(t => ['Company Name', 'Contact Person', 'City', 'State', 'Dealer', 'Complaint', 'Customer Type', 'Source'].some(k => String(t[k] || '').toLowerCase().indexOf(s) !== -1));
    wait.remove();
    if (hits.length) return asAdd(asRows('Tickets matching “' + esc(Q) + '”', hits.slice().reverse().map(t => tkRow(t))), 'bot');
  } catch (e) { wait.remove(); }
  return asFind(Q, true);
}
async function asFind(q, soft) {
  let r;
  try { r = await api({ action: 'findRecord', q }); } catch (e) { r = null; }
  if (r && r.ok && r.type === 'serial') return asAdd(asRows('Serial ' + esc(q) + ' — ' + r.matches.length + ' visits', r.matches.map(m => ({ t: 'item', id: m.itemId, tid: m.ticketId, main: m.model, sub: niceDate(m.received) + ' · ' + m.ticketId, right: pill(m.status) }))), 'bot');
  if (r && r.ok) { asAdd('Opening <b>' + esc(r.id) + '</b> →', 'bot'); return openRecord(r.type, r.id, r.ticketId, { fresh: true }); }
  asAdd(soft ? 'I didn\'t understand “' + esc(q) + '”. Try one of these, or type <b>help</b>.' : esc((r && r.msg) || 'Nothing found'), 'bot');
  asChipsShow(AS_CHIPS);
}

async function asRun(k, q) {
  const wait = asAdd('<span class="as-typing"><i></i><i></i><i></i></span>', 'bot');
  let html = '';
  try { html = await asAnswer(k, q || ''); } catch (e) { html = '❌ Could not load data — check the connection and try again.'; }
  wait.remove();
  asAdd(html, 'bot');
}

async function asAnswer(k, q) {
  const today = todayStr(), num = (q.match(/\d+/) || [])[0];
  if (k === 'help') return '<b>You can ask:</b><ul class="as-help">' +
    '<li><b>today / summary</b> — today at a glance</li><li><b>call-backs</b> — customers who asked us to call</li>' +
    '<li><b>follow-ups due</b>, <b>sla late</b>, <b>in transit</b></li><li><b>stuck 5 days</b> — items in repair longer than N days</li>' +
    '<li><b>received today / yesterday</b>, <b>dispatched this week</b></li><li><b>low feedback</b>, <b>feedback due</b>, <b>repeat batteries</b></li>' +
    '<li><b>replacements</b> to send, <b>pending returns</b> (old battery not back)</li><li><b>model 48V</b> — items of a model and where they are</li><li>any <b>name, city, dealer, complaint</b> — matching tickets</li>' +
    '<li>any <b>ID, phone or serial no.</b> — opens it</li></ul><div class="muted-sm">Shortcut: Ctrl + K</div>';

  if (k === 'summary') {
    const [T, R, D, C] = await Promise.all([asGet('tickets'), asGet('receipts'), asGet('dispatches'), asGet('callbacks')]);
    const n = f => T.filter(f).length, rcv = R.filter(r => String(r['Received Date']).substring(0, 10) === today), dsp = D.filter(d => String(d['Dispatch Date']).substring(0, 10) === today);
    const sum = (L, a) => L.reduce((x, r) => x + (+r[a] || 0), 0);
    const tile = (ico, v, l, cmd) => '<button class="as-tile" ' + (cmd ? 'data-k="' + cmd + '" onclick="asChip(this)"' : '') + '><span>' + ico + '</span><b>' + v + '</b><small>' + l + '</small></button>';
    return '<b>Today · ' + esc(niceDate(today)) + '</b><div class="as-tiles">' +
      tile('🎫', n(t => String(t['Created At']).substring(0, 10) === today), 'new tickets') +
      tile('📞', C.filter(c => c['Status'] === 'Open').length, 'call-backs open', 'callback') +
      tile('📅', n(isDue), 'follow-ups due', 'due') +
      tile('📥', sum(rcv, 'Battery Qty') + ' / ' + sum(rcv, 'Charger Qty'), 'received (bat / chg)', 'recv') +
      tile('📦', sum(dsp, 'Batteries') + ' / ' + sum(dsp, 'Chargers'), 'dispatched (bat / chg)', 'disp') +
      tile('🔧', n(t => REPAIR_SET.indexOf(t['Status']) !== -1), 'tickets in repair', 'stuck') +
      tile('🚚', n(t => t['Status'] === 'In Transit'), 'in transit', 'transit') +
      tile('🔴', n(t => t['Feedback Flag'] === 'Low'), 'low feedback', 'lowfb') + '</div>';
  }
  if (k === 'callback') {
    const C = (await asGet('callbacks')).filter(c => c['Status'] === 'Open');
    return asRows('Open call-back requests', C.map(c => ({ t: 'ticket', id: c['Ticket ID'], tid: c['Ticket ID'], main: c['Customer'] + ' · ' + c['Phone'],
      sub: c['Preferred Time'] + ' · asked ' + String(c['Requested At']).substring(0, 16) + (c['Message'] ? ' · “' + c['Message'] + '”' : ''), right: idChip(c['Callback ID']) })));
  }
  if (k === 'tosend' || k === 'returns') {
    const P = await asGet('replacements');
    if (k === 'tosend') return asRows('Replacements to send', P.filter(x => x['Status'] === 'Requested' || x['Status'] === 'Pending Approval').map(x => ({ t: 'replacement', id: x['Replacement ID'], tid: x['Ticket ID'],
      main: x['Customer'], sub: [x['Old Model'], x['Type'], x['Warranty']].filter(Boolean).join(' · '), right: pill(x['Status']) })));
    const L = P.filter(x => x['Status'] === 'Dispatched' && !x['Against Item ID']).sort((a, b) => String(a['Dispatch Date']).localeCompare(String(b['Dispatch Date'])));
    return asRows('New battery sent — old one not back yet', L.map(x => ({ t: 'replacement', id: x['Replacement ID'], tid: x['Ticket ID'], main: x['Customer'] + (x['Phone'] ? ' · ' + x['Phone'] : ''),
      sub: 'sent ' + niceDate(x['Dispatch Date']) + ' · ' + ageDays(x['Dispatch Date']) + ' days ago', right: '<span class="pill pill-' + (ageDays(x['Dispatch Date']) > 7 ? 'red' : 'amber') + '">' + ageDays(x['Dispatch Date']) + 'd</span>' })));
  }
  if (k === 'due') return asRows('Follow-ups due', (await asGet('tickets')).filter(isDue).map(t => tkRow(t, '📅 ' + t['Next Follow-up'] + ' · ' + (t['Complaint'] || ''))));
  if (k === 'transit') return asRows('In transit', (await asGet('tickets')).filter(t => t['Status'] === 'In Transit').map(t => tkRow(t, 'since ' + niceDate(t['Updated At'] || t['Created At']))));
  if (k === 'open') return asRows('Open tickets', (await asGet('tickets')).filter(t => !isEnded(t['Status'])).reverse().map(t => tkRow(t)));
  if (k === 'lowfb') return asRows('Low feedback — call them', (await asGet('tickets')).filter(t => t['Feedback Flag'] === 'Low').map(t => tkRow(t, '⭐ ' + t['Rating'] + '/5')));
  if (k === 'fbdue') return asRows('Ask for feedback', (await asGet('tickets')).filter(isFbDue).map(t => tkRow(t, 'closed ' + niceDate(t['Closed At']))));
  if (k === 'sla') {
    const L = (await asGet('tracker')).map(trkModel).filter(m => m.sla === 'late' || m.sla === 'risk').sort((a, b) => (a.sla === 'late' ? 0 : 1) - (b.sla === 'late' ? 0 : 1));
    return asRows('SLA late / at risk', L.map(m => ({ t: 'ticket', id: m.t.id, tid: m.t.id, main: m.t.company, sub: m.nowLabel + ' · ' + (m.segs.find(s => s.running) || {}).label,
      right: '<span class="pill pill-' + (m.sla === 'late' ? 'red' : 'amber') + '">' + (m.sla === 'late' ? 'Late' : 'At risk') + '</span>' })));
  }
  if (k === 'stuck') {
    const days = num != null ? +num : 3, I = await asGet('items');
    const L = I.filter(i => String(i['Item Status']).toLowerCase() !== 'dispatched' && ageDays(i['Received Date']) >= days).sort((a, b) => ageDays(b['Received Date']) - ageDays(a['Received Date']));
    return asRows('In repair for ' + days + '+ days', L.map(i => ({ t: 'item', id: i['Item ID'], tid: i['Ticket ID'], main: [i['Category'], i['Model']].filter(Boolean).join(' · '),
      sub: i['Customer'] + ' · ' + ageDays(i['Received Date']) + ' days', right: pill(i['Item Status']) })), 'try “stuck 7 days”');
  }
  if (k === 'recv' || k === 'disp') {
    const since = /yesterday|kal/i.test(q) ? dayStr(1) : /week|hafte|7/i.test(q) ? dayStr(7) : /month|mahine|30/i.test(q) ? dayStr(30) : today;
    const until = /yesterday|kal/i.test(q) ? dayStr(1) : today;
    const lbl = since === today ? 'today' : until === since ? 'yesterday' : 'since ' + niceDate(since);
    if (k === 'recv') {
      const R = (await asGet('receipts')).filter(r => { const d = String(r['Received Date']).substring(0, 10); return d >= since && d <= until; });
      return asRows('Received ' + lbl, R.map(r => ({ t: 'receipt', id: r['Receipt ID'], tid: r['Ticket ID'], main: r['Customer'], sub: itemsText(+r['Battery Qty'] || 0, +r['Charger Qty'] || 0) + ' · ' + niceDate(r['Received Date']) })));
    }
    const D = (await asGet('dispatches')).filter(d => { const x = String(d['Dispatch Date']).substring(0, 10); return x >= since && x <= until; });
    return asRows('Dispatched ' + lbl, D.map(d => ({ t: 'dispatch', id: d['Dispatch ID'], tid: d['Ticket ID'], main: d['Customer'], sub: itemsText(+d['Batteries'] || 0, +d['Chargers'] || 0) + (d['Transport'] ? ' · ' + d['Transport'] : '') })));
  }
  if (k === 'repeat') {
    const I = (await asGet('items')).filter(i => +i['Repeat Count'] > 0);
    return asRows('Repeat batteries (serial came before)', I.map(i => ({ t: 'item', id: i['Item ID'], tid: i['Ticket ID'], main: [i['Model'], i['Serial No'] && 'SN ' + i['Serial No']].filter(Boolean).join(' · '),
      sub: i['Customer'] + ' · ' + (+i['Repeat Count'] + 1) + 'th visit', right: pill(i['Item Status']) })));
  }
  if (k === 'model') {
    const I = await asGet('items'), m = q.replace(/\bmodels?\b/i, '').trim().toUpperCase().replace(/\s+/g, '');
    if (!m) {   // model-wise table
      const by = {};
      I.forEach(i => { const x = i['Model'] || '—'; by[x] = by[x] || { n: 0, open: 0 }; by[x].n++; if (String(i['Item Status']).toLowerCase() !== 'dispatched') by[x].open++; });
      const rows = Object.keys(by).sort((a, b) => by[b].n - by[a].n).slice(0, 15);
      return '<b>Model-wise</b><table class="as-table"><tr><th>Model</th><th>Total</th><th>With us</th></tr>' +
        rows.map(x => '<tr><td>' + esc(x) + '</td><td>' + by[x].n + '</td><td>' + by[x].open + '</td></tr>').join('') + '</table><div class="muted-sm">Type “model 48V” for one model</div>';
    }
    const L = I.filter(i => String(i['Model']).toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(m.replace(/[^A-Z0-9]/g, '')) !== -1);
    return asRows('Model ' + esc(m), L.map(i => ({ t: 'item', id: i['Item ID'], tid: i['Ticket ID'], main: i['Model'], sub: i['Customer'] + ' · ' + niceDate(i['Received Date']), right: pill(i['Item Status']) })));
  }
  return 'Type <b>help</b> to see what I can do.';
}
window.addEventListener('load', asBoot);

/* ============================================================
   v10 — REPAIR REPORT · REPLACEMENTS · REFURBISHED STOCK
   ============================================================ */
const RESULTS = [['Repaired', '✅'], ['Replace', '🔁'], ['No fault found', '⚪'], ['Not repairable', '⛔']];
const ITEM_DONE = { 'dispatched': 1, 'in refurb stock': 1, 'returned to production': 1, 'scrapped': 1 };
const itemDone = st => !!ITEM_DONE[String(st || '').toLowerCase()];
const partOf = v => { const s = String(v || ''), i = s.lastIndexOf('|'); return i < 0 ? { name: s.trim(), rate: '' } : { name: s.slice(0, i).trim(), rate: s.slice(i + 1).replace(/[₹,\s]/g, '') }; };
let RPT = null;   // repair report being edited: {itemId, ticketId, item, parts}

// ---------- REPAIR REPORT (repair team) ----------
async function reportOpen(itemId, ticketId) {
  ticketId = ticketId || String(itemId).replace(/-\d+$/, '');
  await ensureMasters();
  let data = CUR && CUR.ticket && CUR.ticket['Ticket ID'] === ticketId ? CUR : null;
  if (!data) {
    modalOpen('🧾 Repair Report — ' + itemId, '<div class="skeleton sk-block"></div>');
    try { const r = await api({ action: 'getTicket', ticketId }); if (r && r.ok) data = r; } catch (e) {}
    if (!data) return modalClose(), toast('❌ Could not load the item');
  }
  const it = (data.items || []).find(x => x['Item ID'] === itemId);
  if (!it) return toast('❌ Item not found');
  const parts = (data.parts || []).filter(p => p['Item ID'] === itemId);
  RPT = { itemId, ticketId, item: it };
  const res = it['Repair Result'] || '', causes = String(it['Root Cause'] || '').split(/\s*,\s*/).filter(Boolean);
  const rc = (M().rootCause || []).concat(causes.filter(c => (M().rootCause || []).indexOf(c) === -1));
  modalOpen('🧾 Repair Report — ' + itemId,
    '<div class="rpt-item">' + (it['Item Type'] === 'Charger' ? '⚡ ' : '🔋 ') + esc([it['Category'], it['Model']].filter(Boolean).join(' · ')) +
      (it['Serial No'] ? ' · SN ' + esc(it['Serial No']) : '') + (it['Warranty'] ? ' · <b>' + esc(it['Warranty']) + '</b>' : '') + '</div>' +
    '<div class="fg full"><label>Result <b>*</b></label><div class="rpt-res" id="rp_res">' + RESULTS.map(([v, ico]) =>
      '<button type="button" data-v="' + esc(v) + '" class="' + (res === v ? 'on' : '') + '" onclick="rptResult(this)">' + ico + ' ' + esc(v) + '</button>').join('') + '</div></div>' +
    '<div id="rp_replNote" class="note" hidden></div>' +
    '<div class="fg full"><label>Root cause — what was faulty <b id="rp_rcReq">*</b></label><div class="chk-list" id="rp_rc">' +
      rc.map(c => '<label class="set-chk"><input type="checkbox" value="' + esc(c) + '"' + (causes.indexOf(c) !== -1 ? ' checked' : '') + '> ' + esc(c) + '</label>').join('') + '</div></div>' +
    '<div class="fg full"><label>Details <span class="opt" id="rp_notesHint">(what you found / did)</span></label><textarea id="rp_notes" maxlength="500" placeholder="e.g. 2 cells dead in group 4, BMS MOSFET burnt">' + esc(it['Repair Notes'] || '') + '</textarea></div>' +
    '<div class="fg full" id="rp_partsBox"><label>Parts used</label>' +
      '<div class="rpt-parts"><div class="rpt-ph"><span>Part</span><span>Qty</span><span>Rate ₹</span><span>Amount</span><span></span></div><div id="rp_parts"></div></div>' +
      '<button type="button" class="link-btn" onclick="rptAddPart()">＋ Add part</button>' +
      '<datalist id="dl_parts">' + (M().sparePart || []).map(v => '<option value="' + esc(partOf(v).name) + '">').join('') + '</datalist></div>' +
    '<div class="form-grid"><div class="fg"><label>Labour (₹)</label><input id="rp_labour" type="number" min="0" step="1" value="' + esc(it['Labour'] || '') + '" oninput="rptTotal()"></div>' +
      '<div class="fg"><label>Repair cost</label><div class="rpt-total" id="rp_total">₹0</div></div></div>' +
    '<button class="btn btn-primary btn-block" onclick="rptSave(this)">Save report ✓</button>');
  (parts.length ? parts : []).forEach(p => rptAddPart(p['Part'], p['Qty'], p['Rate']));
  rptResult(null); rptTotal();
}
function rptResult(btn) {
  if (btn) document.querySelectorAll('#rp_res button').forEach(b => b.classList.toggle('on', b === btn));
  const v = (document.querySelector('#rp_res button.on') || {}).dataset ? document.querySelector('#rp_res button.on').dataset.v : '';
  const n = $('rp_replNote'), w = RPT && RPT.item['Warranty'];
  $('rp_partsBox').hidden = v === 'No fault found';
  $('rp_rcReq').hidden = v === 'No fault found';
  $('rp_notesHint').textContent = v === 'Replace' || v === 'Not repairable' ? '* — reason' : '(what you found / did)';
  if (v === 'Replace') {
    n.hidden = false;
    n.className = 'note' + (w === 'Out of Warranty' ? ' note-red' : '');
    n.innerHTML = RPT.item['Replacement ID'] ? '🔁 Replacement <b>' + esc(RPT.item['Replacement ID']) + '</b> already exists for this battery.'
      : '🔁 A <b>replacement request</b> will be created. The new battery is sent from the Dispatch screen; this battery then goes to stock / production / scrap.' +
        (w === 'Out of Warranty' ? '<br><b>Out of warranty</b> — admin must approve first.' : '');
  } else n.hidden = true;
}
function rptAddPart(name, qty, rate) {
  const d = document.createElement('div');
  d.className = 'rpt-row';
  d.innerHTML = '<input class="rp-part" list="dl_parts" maxlength="100" placeholder="Part" value="' + esc(name || '') + '" onchange="rptPart(this)">' +
    '<input class="rp-qty" type="number" min="0" step="1" value="' + esc(qty || 1) + '" oninput="rptTotal()">' +
    '<input class="rp-rate" type="number" min="0" step="1" value="' + esc(rate === undefined ? '' : rate) + '" oninput="rptTotal()">' +
    '<span class="rp-amt">₹0</span><button type="button" class="rp-del" onclick="this.parentNode.remove();rptTotal()">✕</button>';
  $('rp_parts').appendChild(d);
  if (!name) d.querySelector('.rp-part').focus();
  rptTotal();
}
function rptPart(inp) {   // rate from the Masters list ("Part | rate")
  const m = (M().sparePart || []).map(partOf).find(p => p.name.toLowerCase() === inp.value.trim().toLowerCase());
  const r = inp.parentNode.querySelector('.rp-rate');
  if (m && m.rate !== '' && !r.value) r.value = m.rate;
  rptTotal();
}
function rptRows() {
  return Array.from(document.querySelectorAll('#rp_parts .rpt-row')).map(r => ({
    part: r.querySelector('.rp-part').value.trim(), qty: r.querySelector('.rp-qty').value, rate: r.querySelector('.rp-rate').value, el: r }));
}
function rptTotal() {
  let t = 0;
  rptRows().forEach(p => { const a = (Number(p.qty) || 0) * (Number(p.rate) || 0); t += a; p.el.querySelector('.rp-amt').textContent = rupee(Math.round(a)) || '₹0'; });
  t += Number($('rp_labour').value) || 0;
  $('rp_total').textContent = rupee(Math.round(t)) || '₹0';
}
async function rptSave(btn) {
  const res = document.querySelector('#rp_res button.on');
  if (!res) return toast('⚠️ Select the result');
  const result = res.dataset.v;
  const rootCause = Array.from(document.querySelectorAll('#rp_rc input:checked')).map(i => i.value);
  const notes = $('rp_notes').value.trim();
  if (result !== 'No fault found' && !rootCause.length) return toast('⚠️ Select the root cause');
  if ((result === 'Replace' || result === 'Not repairable') && !notes) return toast('⚠️ Write the reason in Details');
  const parts = result === 'No fault found' ? [] : rptRows().filter(p => p.part).map(p => ({ part: p.part, qty: p.qty, rate: p.rate }));
  if (parts.some(p => !(Number(p.qty) > 0))) return toast('⚠️ Enter the quantity of every part');
  const r = await run({ action: 'saveRepairReport', itemId: RPT.itemId, result, rootCause: rootCause.join(','), notes, labour: $('rp_labour').value, parts: JSON.stringify(parts) }, btn);
  if (!r) return;
  modalClose();
  toast('✅ Report saved' + (r.repairCost !== '' && r.repairCost != null ? ' · repair cost ' + rupee(r.repairCost) : '') + (r.replacementId ? ' · replacement ' + r.replacementId + ' created' : ''));
  afterChange(); cacheDel('board_items');
  const bi = (typeof boardItems !== 'undefined' ? boardItems : []).find(x => x.itemId === RPT.itemId);
  if (bi) { bi.result = result; bi.cost = r.repairCost; bi.replacementId = bi.replacementId || r.replacementId || ''; if (CURRENT === 'board') boardRender(); }
  if ($('drawer').classList.contains('open')) drawerReload();
}

// ---------- MOVE TO STOCK (exchanged battery) ----------
function stockOpen(itemId) {
  modalOpen('📦 ' + itemId + ' — where does it go?',
    '<div class="muted-sm" style="margin-bottom:12px">The customer already got a new battery for this one, so it is not sent back.</div>' +
    '<div class="rpt-res" id="mv_out">' + [['Refurbished Stock', '♻️', 'Repaired & passed QC — keep for future replacements'], ['Returned to Production', '🏭', 'Send back to production'], ['Scrap', '🗑️', 'Cannot be used']]
      .map(([v, i, s]) => '<button type="button" data-v="' + v + '" onclick="document.querySelectorAll(\'#mv_out button\').forEach(b=>b.classList.toggle(\'on\',b===this))">' + i + ' ' + v + '<small>' + s + '</small></button>').join('') + '</div>' +
    '<div class="fg full" style="margin-top:12px"><label>Remarks</label><input id="mv_rem" maxlength="300"></div>' +
    '<button class="btn btn-primary btn-block" data-id="' + esc(itemId) + '" onclick="stockSave(this)">Save ✓</button>');
}
async function stockSave(btn) {
  const o = document.querySelector('#mv_out button.on');
  if (!o) return toast('⚠️ Select where the battery goes');
  const r = await run({ action: 'moveToStock', itemId: btn.dataset.id, outcome: o.dataset.v, remarks: $('mv_rem').value.trim() }, btn);
  if (!r) return;
  modalClose(); toast('✅ ' + btn.dataset.id + ' → ' + o.dataset.v + (r.stockId ? ' (' + r.stockId + ')' : ''));
  afterChange(); cacheDel('board_items');
  if (CURRENT === 'dispatch') openDispatch();
  if ($('drawer').classList.contains('open')) drawerReload();
}

// ---------- REPLACEMENTS ----------
function replOpen() {   // advance replacement from the ticket (before the old battery arrives)
  const t = CUR.ticket;
  ensureModels();
  modalOpen('🔁 Advance Replacement — ' + t['Ticket ID'],
    '<div class="note">The new battery is sent <b>now</b>; the old one comes later and goes to stock after repair.</div>' +
    '<div class="form-grid">' +
      '<div class="fg"><label>Warranty <b>*</b></label><select id="rq_war">' + optList(CONFIG.WARRANTY || [], 'In Warranty', '-- Select --') + '</select></div>' +
      fg('How many batteries', 'rq_qty', 'number', 1, ' min="1" max="20"') +
      '<div class="fg"><label>Battery type <b>*</b></label><select id="rq_cat">' + optList(M().batteryType, '', '-- Select --') + '</select></div>' +
      fg('Model <b>*</b>', 'rq_model', 'text', '', ' maxlength="100" list="dl_models"') +
      fg('Old serial no <span class="opt">(if known)</span>', 'rq_serial', 'text', '', ' maxlength="60"') +
      '<div class="fg full"><label>Reason <b>*</b></label><textarea id="rq_reason" maxlength="500" placeholder="e.g. No backup, battery 8 months old, in warranty"></textarea></div>' +
    '</div><div class="muted-sm" style="margin:-4px 0 12px">Out of warranty → admin approves first (charge can be set).</div>' +
    '<button class="btn btn-primary btn-block" onclick="replSave(this)">Request replacement ✓</button>');
}
async function replSave(btn) {
  const d = { action: 'requestReplacement', ticketId: CUR.ticket['Ticket ID'], warranty: $('rq_war').value, qty: $('rq_qty').value,
    category: $('rq_cat').value, model: $('rq_model').value.trim(), serial: $('rq_serial').value.trim(), reason: $('rq_reason').value.trim() };
  if (!d.warranty || !d.category || !d.model || !d.reason) return toast('⚠️ Fill warranty, type, model and reason');
  const m = modelOf(d.model); if (m) d.model = m.code;
  const r = await run(d, btn); if (!r) return;
  modalClose(); toast('✅ ' + r.ids.join(', ') + (r.approval ? ' — waiting for admin approval' : ' — shows in Dispatch → Replacements to send'));
  DR_TAB = 'replacements'; afterChange(); drawerReload();
}
async function replDecide(btn, decision) {
  const id = btn.dataset.id;
  let charge = '', remarks = '';
  if (decision === 'approve') { charge = prompt('Charge to the customer (₹) — leave empty if free', ''); if (charge === null) return; }
  else { remarks = prompt('Reason for rejecting', ''); if (remarks === null) return; }
  const r = await run({ action: 'approveReplacement', replacementId: id, decision, charge, remarks }, btn); if (!r) return;
  toast(decision === 'approve' ? '✅ ' + id + ' approved' : '🚫 ' + id + ' rejected'); afterChange(); drawerReload();
}
async function replCancel(btn) {
  const reason = prompt('Why cancel ' + btn.dataset.id + '?', ''); if (!reason) return;
  const r = await run({ action: 'cancelReplacement', replacementId: btn.dataset.id, reason }, btn); if (!r) return;
  toast('🚫 ' + btn.dataset.id + ' cancelled'); afterChange(); drawerReload();
}
// send the new battery (repair / dispatch team)
let REPL_STOCK = [];
async function replSendOpen(id) {
  await Promise.all([ensureMasters(), ensureModels()]);
  modalOpen('🚚 Send replacement — ' + id, '<div class="skeleton sk-block"></div>');
  let rp = null;
  try {
    const [a, b] = await Promise.all([api({ action: 'listRecords', type: 'replacements' }), api({ action: 'listRecords', type: 'stock' })]);
    rp = a && a.ok ? a.rows.find(x => x['Replacement ID'] === id) : null;
    REPL_STOCK = b && b.ok ? b.rows.filter(x => x['Status'] === 'Available') : [];
  } catch (e) {}
  if (!rp) return modalClose(), toast('❌ Could not load ' + id);
  const same = REPL_STOCK.filter(s => modelKey(s['Model']) === modelKey(rp['Old Model']));
  const stockOpts = REPL_STOCK.map(s => '<option value="' + esc(s['Stock ID']) + '">' + esc(s['Stock ID'] + ' · ' + s['Model'] + ' · SN ' + (s['Serial No'] || '—')) +
    (modelKey(s['Model']) === modelKey(rp['Old Model']) ? ' ✓ same model' : '') + '</option>').join('');
  $('mdBody').innerHTML =
    '<div class="rpt-item">For <b>' + esc(rp['Customer'] || '') + '</b> · ' + esc(rp['Ticket ID']) + ' · old: ' + esc([rp['Old Model'], rp['Old Serial'] && 'SN ' + rp['Old Serial']].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="fg full"><label>New battery from <b>*</b></label><div class="seg" id="rs_src">' +
      '<button type="button" data-v="New from Production" class="on" onclick="segPick(this);replSrc()">🏭 New from Production</button>' +
      '<button type="button" data-v="Refurbished Stock" onclick="segPick(this);replSrc()">♻️ Refurbished stock (' + REPL_STOCK.length + ')</button></div></div>' +
    '<div id="rs_new" class="form-grid">' +
      '<div class="fg"><label>Type</label><select id="rs_cat">' + optList(M().batteryType, rp['Old Category'] || '', '-- Select --') + '</select></div>' +
      fg('Model <b>*</b>', 'rs_model', 'text', rp['Old Model'] || '', ' maxlength="100" list="dl_models"') +
      fg('New serial no <b>*</b>', 'rs_serial', 'text', '', ' maxlength="60"') + '</div>' +
    '<div id="rs_stk" class="fg full" hidden><label>Pick from refurbished stock <b>*</b></label><select id="rs_stock"><option value="">-- Select --</option>' + stockOpts + '</select>' +
      (REPL_STOCK.length && !same.length ? '<div class="muted-sm">No stock of the same model — pick carefully</div>' : '') + '</div>' +
    '<div class="form-grid">' + fg('Dispatch date <b>*</b>', 'rs_date', 'date', todayStr()) +
      '<div class="fg"><label>Dispatched by <b>*</b></label><select id="rs_by">' + optList(M().dispatchedBy, '', '-- Select --') + '</select></div>' +
      fg('Transport', 'rs_tr', 'text', '', ' maxlength="150"') + fg('LR / docket no', 'rs_lr', 'text', '', ' maxlength="60"') +
      fg('Charges (₹)', 'rs_ch', 'number', '', ' min="0"') + fg('Remarks', 'rs_rem', 'text', '', ' maxlength="500"') + '</div>' +
    '<button class="btn btn-primary btn-block" data-id="' + esc(id) + '" onclick="replSend(this)">Dispatch new battery 🚚</button>';
}
function replSrc() { const s = segVal('rs_src'); $('rs_new').hidden = s !== 'New from Production'; $('rs_stk').hidden = s !== 'Refurbished Stock'; }
async function replSend(btn) {
  const d = { action: 'dispatchReplacement', replacementId: btn.dataset.id, source: segVal('rs_src'), stockId: $('rs_stock').value,
    category: $('rs_cat').value, model: $('rs_model').value.trim(), serial: $('rs_serial').value.trim(), dispatchDate: $('rs_date').value,
    dispatchedBy: $('rs_by').value, transport: $('rs_tr').value.trim(), lr: $('rs_lr').value.trim(), charges: $('rs_ch').value, remarks: $('rs_rem').value.trim() };
  if (d.source === 'New from Production' && (!d.model || !d.serial)) return toast('⚠️ Enter model and new serial no');
  if (d.source === 'Refurbished Stock' && !d.stockId) return toast('⚠️ Pick the stock battery');
  if (!d.dispatchedBy) return toast('⚠️ Select Dispatched By');
  const m = modelOf(d.model); if (m) d.model = m.code;
  const r = await run(d, btn); if (!r) return;
  modalClose(); toast('✅ Replacement dispatched — ' + r.dispatchId); afterChange();
  if (CURRENT === 'dispatch') openDispatch();
  if ($('drawer').classList.contains('open')) drawerReload();
}

// ---------- Dispatch screen: replacements to send + exchanged batteries ----------
async function replLoadDispatch() {
  const box = $('rsList'), ex = $('exList');
  if (!box) return;
  try {
    const [a, it] = await Promise.all([api({ action: 'listRecords', type: 'replacements' }), api({ action: 'getItems' })]);
    const L = a && a.ok ? a.rows.filter(x => x['Status'] === 'Requested' || x['Status'] === 'Pending Approval') : [];
    $('rsCount').textContent = L.filter(x => x['Status'] === 'Requested').length;
    box.innerHTML = L.length ? L.map(x => '<div class="rs-row">' + idChip(x['Replacement ID']) +
      '<span class="as-main"><b>' + esc(x['Customer'] || x['Ticket ID']) + '</b><small>' + esc([x['Ticket ID'], x['Old Model'], x['Type'], x['Warranty']].filter(Boolean).join(' · ')) + '</small></span>' +
      (x['Status'] === 'Pending Approval' ? '<span class="pill pill-amber">Needs approval</span>'
        : '<button class="btn btn-primary btn-sm" data-id="' + esc(x['Replacement ID']) + '" onclick="replSendOpen(this.dataset.id)">Send 🚚</button>') + '</div>').join('')
      : '<div class="empty sm">No replacements to send ✅</div>';
    const E = it && it.ok ? (it.items || []).filter(i => i['Replacement ID'] && !itemDone(i['Item Status'])) : [];
    $('exCount').textContent = E.length;
    ex.innerHTML = E.length ? E.map(i => '<div class="rs-row">' + '<span class="im-id">' + esc(i['Item ID']) + '</span>' +
      '<span class="as-main"><b>' + esc(i['Customer'] || '') + '</b><small>' + esc([i['Model'], i['Serial No'] && 'SN ' + i['Serial No'], i['Item Status'], i['Repair Result'] || 'no report yet'].filter(Boolean).join(' · ')) + '</small></span>' +
      '<button class="btn btn-ghost btn-sm" data-id="' + esc(i['Item ID']) + '" onclick="stockOpen(this.dataset.id)">📦 Move to stock</button></div>').join('')
      : '<div class="empty sm">No exchanged batteries waiting</div>';
  } catch (e) { box.innerHTML = '<div class="empty sm">Could not load ❌</div>'; }
}

// ---------- record page: Replacement ----------
function renderReplacement() {
  const x = (CUR.replacements || []).find(r => r['Replacement ID'] === REC.id); if (!x) return notFound();
  const st = x['Status'], tone = { 'Pending Approval': 'amber', 'Requested': 'blue', 'Dispatched': 'violet', 'Closed': 'green', 'Cancelled': 'gray' }[st] || 'blue';
  let h = recHead('replacement', x['Replacement ID'], '<span class="pill pill-' + tone + '">' + esc(st) + '</span>',
    [['Ticket', tkLk()], ['Customer', custLk()], ['Old battery', x['Against Item ID'] ? lk('item', x['Against Item ID'], REC.tid) : tv('not received yet')],
     ['Dispatch', x['Dispatch ID'] ? lk('dispatch', x['Dispatch ID'], REC.tid) : tv('')]], esc(x['Type'] + ' · ' + (x['Warranty'] || '')));
  const b = [];
  if (st === 'Pending Approval' && can('admin')) b.push('<button class="btn btn-green btn-sm" data-id="' + esc(x['Replacement ID']) + '" onclick="replDecide(this,\'approve\')">✅ Approve</button>',
    '<button class="btn btn-ghost btn-sm btn-danger" data-id="' + esc(x['Replacement ID']) + '" onclick="replDecide(this,\'reject\')">Reject</button>');
  if (st === 'Requested' && can('repair')) b.push('<button class="btn btn-primary btn-sm" data-id="' + esc(x['Replacement ID']) + '" onclick="replSendOpen(this.dataset.id)">🚚 Send new battery</button>');
  if ((st === 'Requested' || st === 'Pending Approval') && can('service')) b.push('<button class="btn btn-ghost btn-sm btn-danger" data-id="' + esc(x['Replacement ID']) + '" onclick="replCancel(this)">Cancel</button>');
  if (b.length) h += '<div class="rp-actions">' + b.join('') + '</div>';
  h += sec('🔁 Request', kvh([['Reason', tv(x['Reason'])], ['Old battery', tv([x['Old Category'], x['Old Model'], x['Old Serial'] && 'SN ' + x['Old Serial']].filter(Boolean).join(' · '))],
    ['Chargeable', tv(x['Chargeable'] === 'Yes' ? 'Yes' + (x['Charge Amount'] !== '' ? ' · ' + rupee(x['Charge Amount']) : '') : 'No')],
    ['Requested', tv(x['Requested At'] + ' · ' + x['Requested By'])], ['Approved', tv(x['Approved At'] ? x['Approved At'] + ' · ' + x['Approved By'] : '')]]));
  h += sec('📦 New battery', kvh([['From', tv(x['Source'])], ['Stock', x['Stock ID'] ? esc(x['Stock ID']) : tv('')], ['Model', tv([x['New Category'], x['New Model']].filter(Boolean).join(' · '))],
    ['Serial no', tv(x['New Serial'])], ['Dispatched', tv(x['Dispatch Date'] ? niceDate(x['Dispatch Date']) + ' · ' + x['Dispatched By'] : '')], ['Transport', tv([x['Transport'], x['LR No'] && 'LR ' + x['LR No']].filter(Boolean).join(' · '))]]));
  h += sec('♻️ Old battery', kvh([['Received', tv(x['Old Received At'])], ['Went to', tv(x['Old Outcome'])], ['Closed', tv(x['Closed At'])], ['Remarks', tv(x['Remarks'])]]));
  h += sec('🕘 History', histList(recHistory(x['Replacement ID'])));
  $('drBody').innerHTML = h;
}

/* ============================================================
   LITPAX SERVICE HUB — app.js
   Merged logic: Repair + Enquiry + Admin. Namespaced, cached,
   config-driven dropdowns, client-side validation.
   ============================================================ */

/* ---------- SHARED: JSONP + POST + TOAST + CACHE ---------- */
let _jsonpSeq = 0;
function jsonp(baseUrl, params, onData, onErr) {
  const cbName = '__cb' + (++_jsonpSeq) + '_' + Date.now();
  const qs = Object.keys(params || {}).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const src = baseUrl + '?' + qs + (qs ? '&' : '') + 'callback=' + cbName + '&t=' + Date.now();

  let done = false;
  const script = document.createElement('script');
  const timer = setTimeout(() => { if (!done) { cleanup(); onErr && onErr('timeout'); } }, CONFIG.JSONP_TIMEOUT_MS);

  function cleanup() { done = true; clearTimeout(timer); delete window[cbName]; if (script.parentNode) script.parentNode.removeChild(script); }
  window[cbName] = function (data) { cleanup(); onData && onData(data); };
  script.onerror = function () { if (!done) { cleanup(); onErr && onErr('network'); } };
  script.src = src;
  document.body.appendChild(script);
}

function postNoCors(baseUrl, data) {
  return fetch(baseUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

function selectTag(el, fieldId, val) {
  el.parentElement.querySelectorAll('.tag-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(fieldId).value = val;
}

// sessionStorage cache with TTL
function cacheSet(key, val) { try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), val })); } catch (e) {} }
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key); if (!raw) return null;
    const obj = JSON.parse(raw);
    return { fresh: (Date.now() - obj.ts) < CONFIG.CACHE_TTL_MS, val: obj.val };
  } catch (e) { return null; }
}

const todayStr = () => new Date().toISOString().split('T')[0];

/* ---------- HEADER DATE ---------- */
window.onload = function () {
  const now = new Date();
  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  document.getElementById('headerDate').innerHTML =
    now.toLocaleDateString('en-IN', opts) + '<br>' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
  authInit();
};

/* ---------- NAV (sidebar) ---------- */
const HEADERS = {
  dashboard: ['Dashboard', 'Aaj ka overview'],
  repair:   ['Service Management', 'Battery / Charger — Receive & Dispatch'],
  enquiry:  ['Enquiry Management', 'Customer Enquiry — Log & Track'],
  records:  ['Records', 'Saari entries — dekho aur action lo'],
  board:    ['Repair Board', 'Item-wise repair stage tracking']
};
const NAV_ITEMS = [
  { key: 'records',   icon: '📁', label: 'Records',   mod: 'records' },
  { key: 'board',     icon: '🔧', label: 'Repair Board', mod: 'board' },
  { key: 'repair',    icon: '🛠️', label: 'Repair',    mod: 'repair' },
  { key: 'enquiry',   icon: '📞', label: 'Enquiry',   mod: 'enquiry' }
];

function setHeader(mod) {
  document.getElementById('hdrTitle').textContent = HEADERS[mod][0];
  document.getElementById('hdrSub').textContent = HEADERS[mod][1];
}
function showApp(id) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}
function currentRole() { return localStorage.getItem('hub_role') || ''; }
function roleCan(mod) { const r = CONFIG.ROLES[currentRole()]; return r && r.modules.indexOf(mod) !== -1; }

function buildSidebar() {
  const nav = document.getElementById('sbNav');
  nav.innerHTML = NAV_ITEMS.filter(it => it.mod === null || (it.mod === 'records' ? recCanAny() : (it.mod === 'board' ? roleCan('repair') : roleCan(it.mod)))).map(it =>
    '<button class="sb-item" data-nav="' + it.key + '" onclick="navGo(\'' + it.key + '\')"><span class="sb-ico">' + it.icon + '</span>' + it.label + '</button>'
  ).join('');
}
function setActiveNav(key) {
  document.querySelectorAll('.sb-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-nav') === key));
}
function navGo(key) { if (key === 'records') openRecords(); else if (key === 'board') openBoard(); else openModule(key); toggleSidebar(false); }
function toggleSidebar(force) {
  const sb = document.getElementById('sidebar'), ov = document.getElementById('sbOverlay');
  const open = (typeof force === 'boolean') ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('show', open);
}

function openModule(mod) {
  if (!roleCan(mod)) { showToast('⚠️ Is role ko iski permission nahi'); return; }
  setActiveNav(mod);
  if (mod === 'repair') { setHeader('repair'); showApp('repairModule'); repInit(); }
  else if (mod === 'enquiry') { setHeader('enquiry'); showApp('enquiryModule'); enqInit(); }
}
function openDashboard() { setActiveNav('dashboard'); setHeader('dashboard'); showApp('dashboardScreen'); dashLoad(false); }

/* ============================================================
   AUTH (sessionStorage-based, ERP-style — no GAS)
   ============================================================ */
function authInit() {
  const role = currentRole();
  if (role && CONFIG.ROLES[role]) enterApp(role);
  else showLogin();
}

function showLogin() {
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('appWrap').style.display = 'none';
  document.body.classList.remove('has-sidebar');
  toggleSidebar(false);
  const u = document.getElementById('loginUser'), p = document.getElementById('loginPass');
  if (u) u.value = ''; if (p) p.value = '';
}

function loginTogglePass(el) {
  const p = document.getElementById('loginPass');
  p.type = p.type === 'password' ? 'text' : 'password';
  el.style.opacity = p.type === 'text' ? '1' : '.5';
}

function authLogin() {
  const user = (document.getElementById('loginUser').value || '').trim().toLowerCase();
  const pass = (document.getElementById('loginPass').value || '').trim();
  if (!user || !pass) { showToast('⚠️ Username aur PIN bharein'); return; }

  const btn = document.querySelector('#loginScreen .btn-login, #loginScreen button');
  const oldTxt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking...'; }

  jsonp(CONFIG.REPAIR_URL, { action: 'login', username: user, pin: pass }, function (res) {
    if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
    if (!res || !res.ok || !res.role || !CONFIG.ROLES[res.role]) {
      showToast('❌ ' + ((res && res.msg) || 'Galat username ya PIN'));
      return;
    }
    localStorage.setItem('hub_role', res.role);
    enterApp(res.role);
  }, function () {
    if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
    showToast('❌ Network error — login nahi ho paya, dobara try karo');
  });
}

function enterApp(role) {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appWrap').style.display = 'block';
  document.body.classList.add('has-sidebar');
  document.getElementById('sbRole').innerHTML = CONFIG.ROLES[role].icon + ' ' + CONFIG.ROLES[role].label;
  buildSidebar();
  openRecords();
}

function logout() { localStorage.removeItem('hub_role'); toggleSidebar(false); showLogin(); }

/* ============================================================
   DASHBOARD (KPIs + recent lists) — uses existing backends
   ============================================================ */
let _dashLoading = false;
function dashLoad(force) {
  const role = currentRole();
  const canRep = roleCan('repair'), canEnq = roleCan('enquiry');
  const cached = cacheGet('dash_' + role);
  if (cached && !force) { dashRender(cached.val); if (cached.fresh) return; }
  else if (!cached) { document.getElementById('kpiGrid').innerHTML = '<div class="skeleton kpi-sk"></div>'.repeat(canRep && canEnq ? 6 : 3); document.getElementById('dashLists').innerHTML = ''; }

  if (_dashLoading) return; _dashLoading = true;
  const acc = { rep: null, repPend: null, enq: null, enqOpen: null };
  let pending = 0;
  const done = () => { if (pending === 0) { _dashLoading = false; const data = dashCompute(acc); cacheSet('dash_' + role, data); dashRender(data); } };

  if (canRep) {
    pending += 2;
    jsonp(CONFIG.REPAIR_URL, { action: 'getDashboard' }, r => { acc.rep = (r && r.data) || []; pending--; done(); }, () => { acc.rep = []; pending--; done(); });
    jsonp(CONFIG.REPAIR_URL, { action: 'getPending' }, r => { acc.repPend = (r && r.data) || []; pending--; done(); }, () => { acc.repPend = []; pending--; done(); });
  }
  if (canEnq) {
    pending += 2;
    jsonp(CONFIG.ENQUIRY_URL, { action: 'getAllEnquiries' }, r => { acc.enq = (r && r.rows) || []; pending--; done(); }, () => { acc.enq = []; pending--; done(); });
    jsonp(CONFIG.ENQUIRY_URL, { action: 'getOpenEnquiries' }, r => { acc.enqOpen = (r && r.rows) || []; pending--; done(); }, () => { acc.enqOpen = []; pending--; done(); });
  }
  if (pending === 0) { _dashLoading = false; }
}

function dashCompute(acc) {
  const out = { kpis: [], repPend: acc.repPend || [], enqOpen: acc.enqOpen || [], hasRep: !!acc.rep, hasEnq: !!acc.enq };
  if (acc.rep) {
    const rows = acc.rep;
    const total = rows.length;
    const pending = (acc.repPend || []).length;
    const dispatched = rows.filter(r => String(r['Repair Status'] || '').toLowerCase().indexOf('dispatch') !== -1).length;
    out.kpis.push({ label: 'Total Repairs', value: total, tone: 'blue', icon: '🛠️' });
    out.kpis.push({ label: 'Pending', value: pending, tone: 'amber', icon: '⏳' });
    out.kpis.push({ label: 'Dispatched', value: dispatched, tone: 'green', icon: '🚚' });
  }
  if (acc.enq) {
    const rows = acc.enq;
    const total = rows.length;
    const open = (acc.enqOpen || []).length;
    const closed = rows.filter(r => String(r.enquiryClosed || '').toLowerCase() === 'yes').length;
    out.kpis.push({ label: 'Total Enquiries', value: total, tone: 'blue', icon: '📞' });
    out.kpis.push({ label: 'Open', value: open, tone: 'amber', icon: '📂' });
    out.kpis.push({ label: 'Closed', value: closed, tone: 'green', icon: '✅' });
  }
  return out;
}

function dashRender(d) {
  const role = currentRole();
  document.getElementById('dashHello').textContent = CONFIG.ROLES[role].icon + ' ' + CONFIG.ROLES[role].label + ' Dashboard';
  document.getElementById('kpiGrid').innerHTML = d.kpis.map(k =>
    '<div class="kpi kpi-' + k.tone + '"><div class="kpi-ico">' + k.icon + '</div>' +
    '<div class="kpi-val">' + k.value + '</div><div class="kpi-lbl">' + k.label + '</div></div>'
  ).join('');

  let lists = '';
  if (d.hasRep) {
    const items = (d.repPend || []).slice(0, 5);
    lists += '<div class="dash-list card"><div class="card-label">🔧 Pending Repairs</div>' +
      (items.length ? items.map(r =>
        '<div class="mini-row"><div><div class="mini-title">' + (r.repairId || '') + ' · ' + (r.customerName || '') + '</div>' +
        '<div class="mini-sub">' + (r.category || '') + (r.batteryModel ? ' — ' + r.batteryModel : '') + '</div></div>' +
        '<span class="badge badge-amber">' + r.pendingQty + ' pending</span></div>'
      ).join('') : '<div class="no-results">Koi pending nahi ✅</div>') +
      (roleCan('repair') ? '<button class="mini-cta" onclick="openModule(\'repair\')">Open Repair →</button>' : '') + '</div>';
  }
  if (d.hasEnq) {
    const items = (d.enqOpen || []).slice(0, 5);
    lists += '<div class="dash-list card"><div class="card-label">📂 Open Enquiries</div>' +
      (items.length ? items.map(r =>
        '<div class="mini-row"><div><div class="mini-title">Sr.' + r.srNo + ' · ' + (r.customerName || '') + '</div>' +
        '<div class="mini-sub">' + (r.enquiryAbout || '') + (r.oems ? ' — ' + r.oems : '') + '</div></div>' +
        '<span class="badge badge-amber">Open</span></div>'
      ).join('') : '<div class="no-results">Koi open enquiry nahi ✅</div>') +
      (roleCan('enquiry') ? '<button class="mini-cta" onclick="openModule(\'enquiry\')">Open Enquiry →</button>' : '') + '</div>';
  }
  document.getElementById('dashLists').innerHTML = lists;
}

/* ---------- Dropdowns (hardcoded from config.js — no GAS) ---------- */
function fillDropdowns(moduleId, app) {
  const map = (CONFIG.DROPDOWNS && CONFIG.DROPDOWNS[app]) || {};
  document.querySelectorAll('#' + moduleId + ' select[data-cfg]').forEach(sel => {
    if (sel.dataset.filled) return; // fill once
    const cat = sel.getAttribute('data-cfg');
    const opts = map[cat] || [];
    const first = sel.querySelector('option'); // keep placeholder
    sel.innerHTML = '';
    if (first) sel.appendChild(first);
    opts.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    sel.dataset.filled = '1';
  });
}

/* ============================================================
   REPAIR MODULE
   ============================================================ */
let repInited = false;
let repStep = 1;
let repRepairId = '';
let repNextSrNo = 1;
let repPending = [];
let repSelected = null;

function repInit() {
  document.getElementById('r_receivingDate').value = todayStr();
  document.getElementById('d_dispatchDate').value = todayStr();
  if (!repInited) {
    fillDropdowns('repairModule', 'repair');
    repInited = true;
  }
  // warm the pending/srNo data in background so both screens are instant
  repLoadData(false);
  repGoHome();
}

function repGoHome() {
  document.querySelectorAll('#repairModule .screen').forEach(s => s.classList.remove('active'));
  document.getElementById('repHomeScreen').classList.add('active');
  document.getElementById('repReceiveSuccess').style.display = 'none';
  document.getElementById('repDispatchSuccess').style.display = 'none';
  window.scrollTo(0, 0);
}
function repShowScreen(id) {
  document.querySelectorAll('#repairModule .screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ----- shared data fetch (getPending gives {data, lastSrNo}) ----- */
function repLoadData(force, cb) {
  const ckey = 'rep_pending';
  const cached = cacheGet(ckey);
  if (cached && !force) {
    repPending = cached.val.data || [];
    repNextSrNo = (cached.val.lastSrNo || 0) + 1;
    cb && cb();
    if (cached.fresh) return; // still refresh in bg if stale
  }
  jsonp(CONFIG.REPAIR_URL, { action: 'getPending' }, function (res) {
    repPending = (res && res.data) || [];
    repNextSrNo = ((res && res.lastSrNo) || 0) + 1;
    cacheSet(ckey, { data: repPending, lastSrNo: (res && res.lastSrNo) || 0 });
    cb && cb();
    // if user currently on dispatch list, re-render
    if (document.getElementById('repDispatchScreen').classList.contains('active')) repRenderPending();
  }, function () { cb && cb('err'); });
}

/* ----- RECEIVE ----- */
function repShowReceive() {
  repShowScreen('repReceiveScreen');
  document.getElementById('repairIdDisplay').textContent = '...';
  repLoadData(false, function () {
    repRepairId = 'LTX-R-' + String(repNextSrNo).padStart(3, '0');
    document.getElementById('r_srNo').value = repNextSrNo;
    document.getElementById('repairIdDisplay').textContent = repRepairId;
  });
}

function repUpdateSteps() {
  for (let i = 1; i <= 3; i++) {
    const b = document.getElementById('rStepBtn' + i);
    b.className = 'step-btn';
    if (i < repStep) b.classList.add('done'); else if (i === repStep) b.classList.add('active');
  }
}
function repGoToStep(s) { if (s > repStep) return; document.getElementById('rSection' + repStep).classList.remove('active'); repStep = s; document.getElementById('rSection' + repStep).classList.add('active'); repUpdateSteps(); window.scrollTo(0, 0); }
function repNextStep(from) { if (!repValidate('rSection' + from)) return; document.getElementById('rSection' + from).classList.remove('active'); repStep = from + 1; document.getElementById('rSection' + repStep).classList.add('active'); repUpdateSteps(); window.scrollTo(0, 0); }
function repPrevStep(from) { document.getElementById('rSection' + from).classList.remove('active'); repStep = from - 1; document.getElementById('rSection' + repStep).classList.add('active'); repUpdateSteps(); window.scrollTo(0, 0); }

function repSelectRadio(el, fieldId, val) {
  const name = el.querySelector('input').name;
  document.querySelectorAll('[name="' + name + '"]').forEach(i => { const o = i.closest('.radio-opt'); o.classList.remove('selected', 'selected-both'); });
  el.classList.add(val === 'Battery+Charger' ? 'selected-both' : 'selected');
  document.getElementById(fieldId).value = val;
  if (fieldId === 'r_category') repApplyCategory(val);
}

// dropdown options config se — item cards ke andar bhare jaate hain
function repOpts(cat) {
  const m = (CONFIG.DROPDOWNS && CONFIG.DROPDOWNS.repair) || {};
  return (m[cat] || []).map(v => '<option value="' + v + '">' + v + '</option>').join('');
}

// Qty ke hisaab se item cards banao (Battery pehle, phir Charger). Purani values preserve.
function repBuildItems() {
  let bQty = parseInt(document.getElementById('r_batteryReceivedQty').value) || 0;
  let cQty = parseInt(document.getElementById('r_chargerReceivedQty').value) || 0;
  if (bQty < 0) bQty = 0; if (cQty < 0) cQty = 0;
  if (bQty > 50) { bQty = 50; document.getElementById('r_batteryReceivedQty').value = 50; showToast('⚠️ Max 50'); }
  if (cQty > 50) { cQty = 50; document.getElementById('r_chargerReceivedQty').value = 50; showToast('⚠️ Max 50'); }

  // category auto-set (dispatch/records ke liye kaam aata hai)
  const cat = bQty && cQty ? 'Battery+Charger' : (bQty ? 'Battery' : (cQty ? 'Charger' : ''));
  document.getElementById('r_category').value = cat;

  const prev = repCollectItems(); // jo bhara hai bacha lo
  const wrap = document.getElementById('itemsWrap');
  let html = '';
  let idx = 0;
  const card = (kind, n, typeCfg) => {
    const p = prev[idx] || {};
    const h =
      '<div class="card item-card" data-kind="' + kind + '">' +
      '<div class="item-card-head"><span class="item-badge ' + (kind === 'Battery' ? 'bat' : 'chg') + '">' +
        (kind === 'Battery' ? '🔋 Battery' : '⚡ Charger') + ' #' + n + '</span>' +
        (idx === 0 ? '<button type="button" class="copy-all-btn" onclick="repCopyToAll(this)">⬇ Copy to all</button>' : '') +
      '</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>Type</label><select class="it-type"><option value="">-- Select --</option>' + repOpts(typeCfg) + '</select></div>' +
        '<div class="form-group"><label>Model</label><input type="text" class="it-model" placeholder="e.g. ' + (kind === 'Battery' ? 'LFP-48V-100AH' : 'CHR-48V-20A') + '" value="' + (p.model || '') + '"></div>' +
        '<div class="form-group"><label>Serial No</label><input type="text" class="it-serial" placeholder="Serial" value="' + (p.serialNo || '') + '"></div>' +
        '<div class="form-group"><label>Problem Type <span class="req">*</span></label><select class="it-ptype it-req"><option value="">-- Select --</option>' + repOpts('ProblemType') + '</select></div>' +
        '<div class="form-group full"><label>Problem Description</label><textarea class="it-pdesc" placeholder="Kya dikkat hai...">' + (p.problemDescription || '') + '</textarea></div>' +
        '<div class="form-group"><label>Warranty</label><select class="it-warr"><option value="">-- Select --</option><option>Yes</option><option>No</option><option>Partial</option></select></div>' +
        '<div class="form-group"><label>Warranty Claim</label><select class="it-claim"><option value="">-- Select --</option>' + repOpts('WarrantyClaim') + '</select></div>' +
        '<div class="form-group full"><label>Transport (Inward)</label><input type="text" class="it-transin" placeholder="e.g. BlueDart AWB 123" value="' + (p.transportInward || '') + '"></div>' +
      '</div></div>';
    idx++;
    return h;
  };
  for (let i = 0; i < bQty; i++) html += card('Battery', i + 1, 'BatteryType');
  for (let i = 0; i < cQty; i++) html += card('Charger', i + 1, 'ChargerType');
  wrap.innerHTML = html || '<div class="no-results" style="margin:8px 0">Battery ya Charger qty daalo — item cards yahan aayenge</div>';

  // dropdown values wapas set (select ke liye value attr kaam nahi karta)
  const cards = wrap.querySelectorAll('.item-card');
  cards.forEach((cd, i) => {
    const p = prev[i] || {};
    if (p.itemType) cd.querySelector('.it-type').value = p.itemType;
    if (p.problemType) cd.querySelector('.it-ptype').value = p.problemType;
    if (p.warranty) cd.querySelector('.it-warr').value = p.warranty;
    if (p.warrantyClaimStatus) cd.querySelector('.it-claim').value = p.warrantyClaimStatus;
  });
}

// saare item cards se data nikaalo
function repCollectItems() {
  return Array.from(document.querySelectorAll('#itemsWrap .item-card')).map(cd => ({
    itemType:            cd.querySelector('.it-type').value,
    model:               cd.querySelector('.it-model').value.trim(),
    serialNo:            cd.querySelector('.it-serial').value.trim(),
    problemType:         cd.querySelector('.it-ptype').value,
    problemDescription:  cd.querySelector('.it-pdesc').value.trim(),
    warranty:            cd.querySelector('.it-warr').value,
    warrantyClaimStatus: cd.querySelector('.it-claim').value,
    transportInward:     cd.querySelector('.it-transin').value.trim(),
    _kind:               cd.getAttribute('data-kind')
  }));
}

// pehle card ki values baaki SAME-kind cards me copy
function repCopyToAll(btn) {
  const src = btn.closest('.item-card');
  const kind = src.getAttribute('data-kind');
  const g = c => src.querySelector(c).value;
  const vals = { type:g('.it-type'), model:g('.it-model'), ptype:g('.it-ptype'), pdesc:g('.it-pdesc'), warr:g('.it-warr'), claim:g('.it-claim'), transin:g('.it-transin') };
  document.querySelectorAll('#itemsWrap .item-card').forEach(cd => {
    if (cd === src || cd.getAttribute('data-kind') !== kind) return;
    cd.querySelector('.it-type').value = vals.type;
    cd.querySelector('.it-model').value = vals.model;
    cd.querySelector('.it-ptype').value = vals.ptype;
    cd.querySelector('.it-pdesc').value = vals.pdesc;
    cd.querySelector('.it-warr').value = vals.warr;
    cd.querySelector('.it-claim').value = vals.claim;
    cd.querySelector('.it-transin').value = vals.transin;
  });
  showToast('✅ Baaki ' + kind + ' cards me copy ho gaya');
}

function repValidate(sectionId) {
  const req = document.querySelectorAll('#' + sectionId + ' [required]:not(:disabled)');
  let ok = true, first = null;
  req.forEach(el => {
    const v = el.tagName === 'SELECT' ? el.value : el.value.trim();
    if (!v) { el.style.borderColor = '#e94560'; if (!first) first = el; ok = false; } else el.style.borderColor = '';
  });
  // contact 10-digit check on step 1
  const c = document.getElementById('r_contactNo');
  if (sectionId === 'rSection1' && c.value && !/^\d{10}$/.test(c.value.trim())) { c.style.borderColor = '#e94560'; showToast('⚠️ Contact 10-digit hona chahiye'); return false; }
  if (!ok) { if (first) first.focus(); showToast('⚠️ Sabhi required fields bharein'); }
  return ok;
}

function repSubmitReceive() {
  if (!repValidate('rSection3')) return;

  const items = repCollectItems();
  if (!items.length) { showToast('⚠️ Battery/Charger qty daalo (Step 2)'); return; }

  // har item ka Problem Type zaroori
  const cards = document.querySelectorAll('#itemsWrap .item-card');
  for (let i = 0; i < items.length; i++) {
    if (!items[i].problemType) {
      cards[i].querySelector('.it-ptype').style.borderColor = '#e94560';
      cards[i].scrollIntoView({ behavior:'smooth', block:'center' });
      showToast('⚠️ Item #' + (i + 1) + ' ka Problem Type select karo');
      return;
    }
  }
  // payload me _kind nahi chahiye
  const payload = items.map(it => ({ itemType:it.itemType || it._kind, model:it.model, serialNo:it.serialNo,
    problemType:it.problemType, problemDescription:it.problemDescription, warranty:it.warranty,
    warrantyClaimStatus:it.warrantyClaimStatus, transportInward:it.transportInward }));

  const btn = document.querySelector('#rSection3 .btn-submit-receive');
  btn.disabled = true; btn.textContent = '⏳ Submitting...';

  const data = {
    action: 'receive',
    items: JSON.stringify(payload),
    'Receiving Date': document.getElementById('r_receivingDate').value,
    'Customer Name': document.getElementById('r_customerName').value,
    'Contact No': document.getElementById('r_contactNo').value,
    'Email': document.getElementById('r_email').value,
    'Category': document.getElementById('r_category').value,
    'Received Mode': document.getElementById('r_receivedMode').value,
    'Received By': document.getElementById('r_receivedBy').value,
    'Accepted By': document.getElementById('r_acceptedBy').value,
    'Estimated Dispatch Date': document.getElementById('r_estimatedDispatchDate').value,
    'Receiving Remarks': document.getElementById('r_remarks').value
  };

  jsonp(CONFIG.REPAIR_URL, data, function (res) {
    if (!res || !res.ok) {
      btn.disabled = false; btn.textContent = 'Submit Entry ✓';
      showToast('❌ Save nahi hua' + (res && res.msg ? ' — ' + res.msg : '') + '. Dobara try karo');
      return;
    }
    repRepairId = res.id;
    sessionStorage.removeItem('rep_pending');
    sessionStorage.removeItem('rec_rep_all');

    document.getElementById('rSection3').classList.remove('active');
    document.getElementById('repReceiveSuccess').style.display = 'block';
    document.getElementById('successReceiveId').textContent = res.id;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('receiptDate').textContent = dateStr + ' ' + timeStr;
    document.getElementById('receiptFooterDate').textContent = dateStr + ' ' + timeStr;

    const itemRows = (res.itemIds || []).map((iid, i) => {
      const it = payload[i] || {};
      return '<tr><td>' + iid + '</td><td>' + (it.itemType || '') + '</td><td>' + (it.model || '—') + '</td><td>' + (it.serialNo || '—') + '</td><td>' + (it.problemType || '—') + '</td></tr>';
    }).join('');

    document.getElementById('receiveSummary').innerHTML =
      '<div class="receipt-section">Customer Details</div><table class="receipt-table">' +
      '<tr><td>Customer Name</td><td>' + data['Customer Name'] + '</td></tr>' +
      '<tr><td>Contact No.</td><td>' + data['Contact No'] + '</td></tr>' +
      '<tr><td>Email</td><td>' + (data['Email'] || '—') + '</td></tr>' +
      '<tr><td>Category</td><td>' + (data['Category'] || '—') + '</td></tr>' +
      '<tr><td>Total Items</td><td>' + payload.length + '</td></tr>' +
      '<tr><td>Received By</td><td>' + data['Received By'] + '</td></tr></table>' +
      '<div class="receipt-section" style="margin-top:8px;">Items (' + payload.length + ')</div>' +
      '<table class="receipt-table"><tr><th>Item ID</th><th>Type</th><th>Model</th><th>Serial</th><th>Problem</th></tr>' + itemRows + '</table>';

    btn.disabled = false; btn.textContent = 'Submit Entry ✓';
    window.scrollTo(0, 0);
  }, function () {
    btn.disabled = false; btn.textContent = 'Submit Entry ✓';
    showToast('❌ Network error — save confirm nahi hua, dobara try karo');
  });
}

function repResetReceive() {
  document.getElementById('repReceiveSuccess').style.display = 'none';
  document.querySelectorAll('#repReceiveScreen input:not([type=radio]),#repReceiveScreen select,#repReceiveScreen textarea').forEach(el => {
    if (el.type === 'date') el.value = todayStr(); else el.value = '';
  });
  document.getElementById('r_batteryReceivedQty').value = '0';
  document.getElementById('r_chargerReceivedQty').value = '0';
  document.getElementById('r_category').value = '';
  document.getElementById('itemsWrap').innerHTML = '';
  repStep = 1;
  document.querySelectorAll('#repReceiveScreen .form-section').forEach((s, i) => s.classList.toggle('active', i === 0));
  repUpdateSteps();
  repShowReceive();
  window.scrollTo(0, 0);
}

/* ----- DISPATCH (item-level, Final QC & Pack ready) ----- */
let dispReady = [];       // sirf Final QC & Pack items (+ parent info)
let dispSel = {};         // itemId -> true

function repShowDispatch() {
  repShowScreen('repDispatchScreen');
  document.getElementById('dSection1').classList.add('active');
  document.getElementById('dSection2').classList.remove('active');
  document.getElementById('repDispatchSuccess').style.display = 'none';
  document.getElementById('dErrorBox').style.display = 'none';
  dispSel = {};
  document.getElementById('d_dispatchDate').value = todayStr();
  dispLoadReady(false);
}

function dispLoadReady(force) {
  const cached = cacheGet('rec_rep_all');
  if (cached && !force) { dispBuildReady(cached.val); dispRenderReady(); }
  else { document.getElementById('dReadySkeleton').style.display = 'block'; document.getElementById('dReadyList').innerHTML = ''; }

  jsonp(CONFIG.REPAIR_URL, { action: 'getAll' }, function (r) {
    document.getElementById('dReadySkeleton').style.display = 'none';
    const repairs = (r && r.repairs) || [];
    const items   = (r && r.items) || [];
    const pmap = {};
    repairs.forEach(rp => { pmap[String(rp['Repair ID']).trim()] = rp; });
    const merged = items.map(it => {
      const p = pmap[String(it['Repair ID']).trim()] || {};
      return {
        itemId:    it['Item ID'],
        repairId:  it['Repair ID'],
        itemType:  it['Item Type'],
        model:     it['Model'],
        serialNo:  it['Serial No'],
        status:    it['Item Status'],
        customer:  p['Customer Name'] || '',
        contactNo: p['Contact No'] || ''
      };
    });
    cacheSet('rec_rep_all', merged); // records ke saath share
    dispBuildReady(merged);
    dispRenderReady();
  }, function () {
    document.getElementById('dReadySkeleton').style.display = 'none';
    document.getElementById('dErrorBox').style.display = 'block';
  });
}

function dispBuildReady(merged) {
  // sirf "Final QC & Pack" wale (dispatched nahi)
  dispReady = (merged || []).filter(it => String(it.status).trim() === 'Final QC & Pack');
}

function dispRenderReady() {
  document.getElementById('dReadySkeleton').style.display = 'none';
  const list = document.getElementById('dReadyList');
  if (!dispReady.length) { list.innerHTML = '<div class="no-results">Koi item "Final QC & Pack" pe nahi ✅ (pehle Repair Board me Final QC tak le jao)</div>'; dispUpdCount(); return; }

  const q = (document.getElementById('dReadySearch').value || '').toLowerCase().trim();
  const filtered = dispReady.filter(r =>
    !q || (r.itemId + ' ' + r.repairId + ' ' + (r.customer || '') + ' ' + (r.itemType || '') + ' ' + (r.model || '')).toLowerCase().indexOf(q) !== -1);

  if (!filtered.length) { list.innerHTML = '<div class="no-results">Kuch nahi mila 🔍</div>'; dispUpdCount(); return; }

  const opts = filtered.map((r, i) =>
    '<option value="' + r.itemId + '"' + (dispSel[r.itemId] ? ' selected' : '') + '>' +
    r.itemId + ' · ' + (r.customer || '') + ' · ' + (r.itemType || '') + (r.model ? ' (' + r.model + ')' : '') +
    '</option>'
  ).join('');

  list.innerHTML =
    '<select class="board-pick-sel" id="dReadySelect" onchange="dispPickOne(this.value)" style="width:100%">' +
    '<option value="">-- Item chuno --</option>' + opts + '</select>';
  dispUpdCount();
}

// single select — ek hi item select rahega
function dispPickOne(itemId) {
  dispSel = {};
  if (itemId) dispSel[itemId] = true;
  dispUpdCount();
}

function dispToggle(itemId) {
  dispSel[itemId] = !dispSel[itemId];
  dispRenderReady();
}

function dispUpdCount() {
  const n = Object.keys(dispSel).filter(k => dispSel[k]).length;
  const c = document.getElementById('dSelCount'); if (c) c.textContent = n;
  const btn = document.getElementById('dNextBtn');
  if (btn) { btn.disabled = !n; btn.style.opacity = n ? '1' : '.5'; }
}

function dispGoStep2() {
  const ids = Object.keys(dispSel).filter(k => dispSel[k]);
  if (!ids.length) { showToast('⚠️ Kam se kam ek item chuno'); return; }
  // selected summary
  const sel = dispReady.filter(r => dispSel[r.itemId]);
  document.getElementById('dSelectedSummary').innerHTML =
    '<table class="receipt-table"><tr><th>Item ID</th><th>Repair ID</th><th>Type</th><th>Model</th></tr>' +
    sel.map(r => '<tr><td>' + r.itemId + '</td><td>' + r.repairId + '</td><td>' + (r.itemType || '') + '</td><td>' + (r.model || '—') + '</td></tr>').join('') +
    '</table>';
  document.getElementById('dSection1').classList.remove('active');
  document.getElementById('dSection2').classList.add('active');
  window.scrollTo(0, 0);
}
function dispBackStep1() { document.getElementById('dSection2').classList.remove('active'); document.getElementById('dSection1').classList.add('active'); window.scrollTo(0, 0); }

function dispSubmit() {
  const ids = Object.keys(dispSel).filter(k => dispSel[k]);
  if (!ids.length) { showToast('⚠️ Koi item selected nahi'); return; }
  const dispDate = document.getElementById('d_dispatchDate').value;
  const by = document.getElementById('d_dispatchedBy').value.trim();
  if (!dispDate) { showToast('⚠️ Dispatch Date bharein'); return; }
  if (!by) { showToast('⚠️ Dispatched By bharein'); return; }

  // items ko repair-id ke hisaab se group karo (backend ek repairId leta hai)
  const sel = dispReady.filter(r => dispSel[r.itemId]);
  const byRepair = {};
  sel.forEach(r => { (byRepair[r.repairId] = byRepair[r.repairId] || []).push(r.itemId); });
  const repairIds = Object.keys(byRepair);

  const btn = document.querySelector('#dSection2 .btn-submit-dispatch');
  btn.disabled = true; btn.textContent = '⏳ ...';

  const common = {
    'Dispatch Date': dispDate,
    'Dispatched By': by,
    'Transport (Outward)': document.getElementById('d_transportOutward').value,
    'Actual Problem Found': document.getElementById('d_actualProblem').value,
    'Any Cost': document.getElementById('d_anyCost').value,
    'Dispatch Remarks': document.getElementById('d_remarks').value
  };

  let pendingCalls = repairIds.length, anyFail = false, completedRepairs = [];

  repairIds.forEach(rid => {
    const params = Object.assign({}, common, {
      action: 'dispatch',
      'Repair ID': rid,
      itemIds: JSON.stringify(byRepair[rid])
    });
    jsonp(CONFIG.REPAIR_URL, params, function (res) {
      if (!res || !res.ok) anyFail = true;
      else if (res.pending === 0) completedRepairs.push(rid);
      if (--pendingCalls === 0) dispDone(anyFail, sel, common, completedRepairs);
    }, function () {
      anyFail = true;
      if (--pendingCalls === 0) dispDone(anyFail, sel, common, completedRepairs);
    });
  });
}

function dispDone(anyFail, sel, common, completedRepairs) {
  const btn = document.querySelector('#dSection2 .btn-submit-dispatch');
  btn.disabled = false; btn.textContent = 'Dispatch Karo 🚚';

  sessionStorage.removeItem('rec_rep_all');
  sessionStorage.removeItem('board_items');

  if (anyFail) { showToast('❌ Kuch items dispatch nahi hue — refresh karke dekho'); }

  document.getElementById('dSection2').classList.remove('active');
  document.getElementById('repDispatchSuccess').style.display = 'block';

  const repairSet = [...new Set(sel.map(r => r.repairId))];
  document.getElementById('successDispatchId').textContent = repairSet.join(', ');
  document.getElementById('dispatchCompleteNote').textContent =
    completedRepairs.length ? ('✅ Poore complete: ' + completedRepairs.join(', ')) : (sel.length + ' item dispatched');

  const now = new Date();
  const dStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const tStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

  document.getElementById('dispatchSummary').innerHTML =
    '<div style="background:white;border-radius:12px;border:1px solid #dde1f0;padding:24px;">' +
    '<div class="receipt-header"><div><div class="receipt-logo">LITPAX</div><div class="receipt-title">Battery / Charger Service Center</div></div>' +
    '<div style="text-align:right;"><div style="font-size:11px;color:#5a6080;">Dispatch Slip</div><div style="font-size:11px;color:#8890b0;">' + dStr + ' ' + tStr + '</div></div></div>' +
    '<div class="receipt-section">Dispatch Details</div><table class="receipt-table">' +
    '<tr><td>Dispatch Date</td><td>' + common['Dispatch Date'] + '</td></tr>' +
    '<tr><td>Dispatched By</td><td>' + common['Dispatched By'] + '</td></tr>' +
    '<tr><td>Transport (Outward)</td><td>' + (common['Transport (Outward)'] || '—') + '</td></tr>' +
    '<tr><td>Address</td><td>' + (document.getElementById('d_dispatchAddress').value || '—') + '</td></tr>' +
    '<tr><td>Any Cost</td><td>' + (common['Any Cost'] || '—') + '</td></tr></table>' +
    '<div class="receipt-section" style="margin-top:8px;">Items (' + sel.length + ')</div>' +
    '<table class="receipt-table"><tr><th>Item ID</th><th>Repair ID</th><th>Type</th><th>Model</th></tr>' +
    sel.map(r => '<tr><td>' + r.itemId + '</td><td>' + r.repairId + '</td><td>' + (r.itemType || '') + '</td><td>' + (r.model || '—') + '</td></tr>').join('') +
    '</table>' +
    '<div class="receipt-footer"><span>Litpax Technology — Service Management System</span><span>' + dStr + ' ' + tStr + '</span></div></div>';

  window.scrollTo(0, 0);
}

function dispReset() {
  document.getElementById('repDispatchSuccess').style.display = 'none';
  document.querySelectorAll('#repDispatchScreen input:not([type=hidden]),#repDispatchScreen textarea,#repDispatchScreen select').forEach(el => { if (el.type === 'date') el.value = todayStr(); else el.value = ''; });
  dispSel = {};
  repShowDispatch();
}
function repPrint() { window.print(); }

/* ============================================================
   ENQUIRY MODULE
   ============================================================ */
let enqInited = false;
let enqNextSrNo = 1;
let enqOpen = [];
let enqSelected = null;

function enqInit() {
  document.getElementById('entryDate').value = todayStr();
  if (!enqInited) { fillDropdowns('enquiryModule', 'enquiry'); enqInited = true; }
  enqSwitchTab('new');
  enqFetchSrNo();
}

function enqFetchSrNo() {
  document.getElementById('srNoDisplay').textContent = 'Loading...';
  jsonp(CONFIG.ENQUIRY_URL, { action: 'getSrNo' }, function (res) {
    enqNextSrNo = (res && res.lastSrNo) || 1;
    document.getElementById('srNoDisplay').textContent = enqNextSrNo;
  }, function () { enqNextSrNo = 1; document.getElementById('srNoDisplay').textContent = '1'; });
}

function enqSwitchTab(tab, onOpenLoaded) {
  document.getElementById('tab-new').classList.toggle('active', tab === 'new');
  document.getElementById('tab-update').classList.toggle('active', tab === 'update');
  ['enqFormScreen','enqUpdateSearchScreen','enqUpdateFormScreen','enqUpdateSuccessScreen','enqSuccessScreen'].forEach(id => document.getElementById(id).style.display = 'none');
  if (tab === 'new') document.getElementById('enqFormScreen').style.display = 'block';
  else { document.getElementById('enqUpdateSearchScreen').style.display = 'block'; enqLoadOpen(onOpenLoaded); }
  window.scrollTo(0, 0);
}

function enqValidate() {
  const req = document.querySelectorAll('#enqFormScreen [required]');
  let ok = true, first = null;
  req.forEach(el => { const v = el.tagName === 'SELECT' ? el.value : el.value.trim(); if (!v) { el.style.borderColor = '#e94560'; if (!first) first = el; ok = false; } else el.style.borderColor = ''; });
  if (!document.getElementById('enquiryClosed').value) { showToast('⚠️ Enquiry Closed select karo'); return false; }
  if (!ok) { if (first) first.focus(); showToast('⚠️ Sabhi required fields bharein'); }
  return ok;
}

function enqSubmit() {
  if (!enqValidate()) return;
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '⏳ Submitting...';

  const data = {
    action: 'addEnquiry',
    'Sr No': enqNextSrNo,
    'Date': document.getElementById('entryDate').value,
    'Customer Name': document.getElementById('customerName').value,
    'OEMs': document.getElementById('oems').value,
    'Company Name': document.getElementById('companyName').value,
    'Contact': document.getElementById('contact').value,
    'Enquiry About': document.getElementById('enquiryAbout').value,
    'Response': document.getElementById('response').value,
    'Solution': document.getElementById('solution').value,
    'Attended By': document.getElementById('attendedBy').value,
    'Enquiry Closed': document.getElementById('enquiryClosed').value,
    'Remarks': document.getElementById('remarks').value
  };

  jsonp(CONFIG.ENQUIRY_URL, data, function (res) {
    if (!res || !res.ok) {
      btn.disabled = false; btn.textContent = 'Submit Entry ✓';
      showToast('❌ Save nahi hua' + (res && res.msg ? ' — ' + res.msg : '') + '. Dobara try karo');
      return;
    }
    sessionStorage.removeItem('enq_open'); // list changed
    sessionStorage.removeItem('rec_enq_all');

    const savedSrNo = res.srNo || enqNextSrNo;
    document.getElementById('enqFormScreen').style.display = 'none';
    document.getElementById('enqSuccessScreen').style.display = 'block';
    document.getElementById('enqSuccessSrNo').textContent = 'Sr. No. — ' + savedSrNo;
    document.getElementById('enqSummaryCard').innerHTML =
      '<div class="summary-row"><span>Customer</span><span>' + data['Customer Name'] + '</span></div>' +
      '<div class="summary-row"><span>OEM</span><span>' + data['OEMs'] + '</span></div>' +
      '<div class="summary-row"><span>Contact</span><span>' + data['Contact'] + '</span></div>' +
      '<div class="summary-row"><span>Enquiry About</span><span>' + data['Enquiry About'] + '</span></div>' +
      '<div class="summary-row"><span>Enquiry Closed</span><span>' + data['Enquiry Closed'] + '</span></div>' +
      '<div class="summary-row"><span>Attended By</span><span>' + data['Attended By'] + '</span></div>';
    window.scrollTo(0, 0);
  }, function () {
    btn.disabled = false; btn.textContent = 'Submit Entry ✓';
    showToast('❌ Network error — save confirm nahi hua, dobara try karo');
  });
}

function enqReset() {
  document.getElementById('enqFormScreen').style.display = 'block';
  document.getElementById('enqSuccessScreen').style.display = 'none';
  document.querySelectorAll('#enqFormScreen input:not([type=hidden]), #enqFormScreen select, #enqFormScreen textarea').forEach(el => { if (el.type === 'date') el.value = todayStr(); else el.value = ''; });
  document.querySelectorAll('#enqFormScreen .tag-opt').forEach(o => o.classList.remove('selected'));
  document.getElementById('enquiryClosed').value = '';
  const btn = document.getElementById('submitBtn'); btn.disabled = false; btn.textContent = 'Submit Entry ✓';
  enqFetchSrNo();
  window.scrollTo(0, 0);
}

let enqLoadingOpen = false;
function enqLoadOpen(cb) {
  const cached = cacheGet('enq_open');
  if (cached) { enqOpen = cached.val || []; enqFillOpen(); if (cached.fresh) { cb && cb(); return; } }
  else { document.getElementById('openSkeleton').style.display = 'block'; document.getElementById('openList').innerHTML = ''; }

  if (enqLoadingOpen) return; enqLoadingOpen = true;
  jsonp(CONFIG.ENQUIRY_URL, { action: 'getOpenEnquiries' }, function (res) {
    enqLoadingOpen = false;
    document.getElementById('openSkeleton').style.display = 'none';
    enqOpen = (res && res.rows) || [];
    cacheSet('enq_open', enqOpen);
    enqFillOpen();
    cb && cb();
  }, function () { enqLoadingOpen = false; document.getElementById('openSkeleton').style.display = 'none'; showToast('❌ Network error'); });
}

function enqFillOpen() {
  const list = document.getElementById('openList');
  if (!enqOpen.length) { list.innerHTML = '<div class="no-results">Koi open enquiry nahi ✅</div>'; return; }
  const q = (document.getElementById('openSearch').value || '').toLowerCase().trim();
  const rows = enqOpen.map((r, i) => ({ r, i })).filter(({ r }) =>
    !q || (('sr.' + r.srNo) + ' ' + (r.customerName || '') + ' ' + (r.contact || '') + ' ' + (r.oems || '')).toLowerCase().indexOf(q) !== -1);
  if (!rows.length) { list.innerHTML = '<div class="no-results">Kuch nahi mila 🔍</div>'; return; }
  list.innerHTML = rows.map(({ r, i }) =>
    '<div class="pick-card" onclick="enqSelectFromDropdown(' + i + ')">' +
    '<div class="pick-main"><div class="pick-title">Sr.' + r.srNo + ' · ' + (r.customerName || '') + '</div>' +
    '<div class="pick-sub">' + (r.enquiryAbout || '') + (r.oems ? ' — ' + r.oems : '') + '</div></div>' +
    '<span class="badge badge-amber">Open</span></div>'
  ).join('');
}

function enqSelectFromDropdown(idx) {
  if (idx === '') return;
  const row = enqOpen[parseInt(idx)];
  if (!row) return;
  enqSelected = row;
  document.getElementById('uf-title').textContent = row.customerName + ' — Sr No. ' + row.srNo;
  document.getElementById('uf-sub').textContent = row.date + ' · ' + row.enquiryAbout;
  document.getElementById('ro-grid').innerHTML =
    '<div class="ro-item"><div class="ro-label">Sr No</div><div class="ro-value">' + row.srNo + '</div></div>' +
    '<div class="ro-item"><div class="ro-label">Date</div><div class="ro-value">' + row.date + '</div></div>' +
    '<div class="ro-item"><div class="ro-label">Customer</div><div class="ro-value">' + row.customerName + '</div></div>' +
    '<div class="ro-item"><div class="ro-label">Contact</div><div class="ro-value">' + row.contact + '</div></div>' +
    '<div class="ro-item"><div class="ro-label">OEM</div><div class="ro-value">' + row.oems + '</div></div>' +
    '<div class="ro-item"><div class="ro-label">Enquiry About</div><div class="ro-value">' + row.enquiryAbout + '</div></div>';
  document.getElementById('uEnquiryClosed').value = row.enquiryClosed || '';
  document.getElementById('uResponse').value = row.response || '';
  document.getElementById('uRemarks').value = row.remarks || '';
  document.querySelectorAll('#enqUpdateFormScreen .tag-opt').forEach(o => o.classList.remove('selected'));
  if (row.enquiryClosed === 'Yes') document.querySelector('#enqUpdateFormScreen .tag-opt.yes').classList.add('selected');
  else if (row.enquiryClosed === 'No') document.querySelector('#enqUpdateFormScreen .tag-opt.no').classList.add('selected');
  document.getElementById('enqUpdateSearchScreen').style.display = 'none';
  document.getElementById('enqUpdateFormScreen').style.display = 'block';
  window.scrollTo(0, 0);
}

function enqBackToSearch() { document.getElementById('enqUpdateFormScreen').style.display = 'none'; document.getElementById('enqUpdateSearchScreen').style.display = 'block'; }

function enqSubmitUpdate() {
  if (!enqSelected) return;
  const closed = document.getElementById('uEnquiryClosed').value;
  if (!closed) { showToast('⚠️ Enquiry Closed select karo'); return; }
  const btn = document.getElementById('updateBtn'); btn.disabled = true; btn.textContent = '⏳ Updating...';
  const data = { action: 'updateEnquiry', srNo: enqSelected.srNo, enquiryClosed: closed, response: document.getElementById('uResponse').value, remarks: document.getElementById('uRemarks').value };
  jsonp(CONFIG.ENQUIRY_URL, data, function (res) {
    if (!res || !res.ok) {
      btn.disabled = false; btn.textContent = '✅ Update Karo';
      showToast('❌ Update nahi hua' + (res && res.msg ? ' — ' + res.msg : '') + '. Dobara try karo');
      return;
    }
    sessionStorage.removeItem('enq_open');
    sessionStorage.removeItem('rec_enq_all');
    document.getElementById('enqUpdateFormScreen').style.display = 'none';
    document.getElementById('enqUpdateSuccessScreen').style.display = 'block';
    document.getElementById('updateSrNoDisplay').textContent = 'Sr. No. — ' + enqSelected.srNo + ' Updated ✅';
    btn.disabled = false; btn.textContent = '✅ Update Karo';
    window.scrollTo(0, 0);
  }, function () {
    btn.disabled = false; btn.textContent = '✅ Update Karo';
    showToast('❌ Network error — update confirm nahi hua');
  });
}

/* ============================================================
   RECORDS MODULE (view-all + list se action)
   Read-only browser over getDashboard (repair) + getAllEnquiries.
   ============================================================ */
let recTab = 'repair';
let recRepAll = [];
let recEnqAll = [];
let recRepFilterVal = 'all';
let recEnqFilterVal = 'all';

function recCanAny() { return roleCan('repair') || roleCan('enquiry'); }

// resilient field reader — raw column key OR camelCase, jo bhi mile
function recF(row, keys) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return '';
}

function openRecords() { setActiveNav('records'); setHeader('records'); showApp('recordsModule'); recInit(); }

function recInit() {
  const canRep = roleCan('repair'), canEnq = roleCan('enquiry');
  const tabs = [];
  if (canRep) tabs.push({ k: 'repair', label: '🛠️ Repairs' });
  if (canEnq) tabs.push({ k: 'enquiry', label: '📞 Enquiries' });
  document.getElementById('recTabs').innerHTML = tabs.map(t =>
    '<button class="tab-btn" id="recTab-' + t.k + '" onclick="recSwitchTab(\'' + t.k + '\')">' + t.label + '</button>'
  ).join('');
  recTab = tabs.length ? tabs[0].k : 'repair';
  recSwitchTab(recTab);
}

function recSwitchTab(tab) {
  recTab = tab;
  document.querySelectorAll('#recTabs .tab-btn').forEach(b => b.classList.remove('active'));
  const tb = document.getElementById('recTab-' + tab); if (tb) tb.classList.add('active');
  document.getElementById('recRepairPane').style.display = tab === 'repair' ? 'block' : 'none';
  document.getElementById('recEnqPane').style.display = tab === 'enquiry' ? 'block' : 'none';
  if (tab === 'repair') recRepLoad(true); else recEnqLoad(true);
}

/* ---------- REPAIRS records ---------- */
function recRepLoad(force) {
  const cached = cacheGet('rec_rep_all');
  if (cached && !force) { recRepAll = cached.val || []; recRepRender(); if (cached.fresh) return; }
  else { document.getElementById('recRepSkeleton').style.display = 'block'; document.getElementById('recRepList').innerHTML = ''; }
  jsonp(CONFIG.REPAIR_URL, { action: 'getAll' }, function (r) {
    document.getElementById('recRepSkeleton').style.display = 'none';
    const repairs = (r && r.repairs) || [];
    const items   = (r && r.items) || [];
    // repair id -> parent (customer etc.)
    const pmap = {};
    repairs.forEach(rp => { pmap[String(rp['Repair ID']).trim()] = rp; });
    // har item ek row, parent info merge
    recRepAll = items.map(it => {
      const p = pmap[String(it['Repair ID']).trim()] || {};
      return {
        itemId:        it['Item ID'],
        repairId:      it['Repair ID'],
        itemType:      it['Item Type'],
        model:         it['Model'],
        serialNo:      it['Serial No'],
        problemType:   it['Problem Type'],
        problemDesc:   it['Problem Description'],
        warranty:      it['Warranty'],
        warrantyClaim: it['Warranty Claim Status'],
        transportIn:   it['Transport (Inward)'],
        transportOut:  it['Transport (Outward)'],
        itemStatus:    it['Item Status'],
        dispatchDate:  it['Dispatch Date'],
        actualProblem: it['Actual Problem Found'],
        anyCost:       it['Any Cost'],
        itemRemarks:   it['Item Remarks'],
        // parent
        customerName:  p['Customer Name'] || '',
        contactNo:     p['Contact No'] || '',
        email:         p['Email'] || '',
        receivingDate: p['Receiving Date'] || '',
        receivedBy:    p['Received By'] || '',
        receivedMode:  p['Received Mode'] || ''
      };
    });
    cacheSet('rec_rep_all', recRepAll);
    recRepRender();
  }, function () { document.getElementById('recRepSkeleton').style.display = 'none'; document.getElementById('recRepList').innerHTML = '<div class="no-results">Data load nahi hua ❌</div>'; });
}

function recRepStatus(row) {
  const s = String(row.itemStatus || '').trim();
  if (s.toLowerCase() === 'dispatched') return 'dispatched';
  return 'pending'; // filter ke liye (All/Pending/Dispatched)
}
// actual live status (jo sheet me hai)
function recRepStatusLabel(row) {
  return String(row.itemStatus || '').trim() || '—';
}

function recRepFilter(el, f) {
  recRepFilterVal = f;
  document.querySelectorAll('#recRepFilters .rec-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  recRepRender();
}

function recRepRender() {
  const list = document.getElementById('recRepList');
  if (!recRepAll.length) { list.innerHTML = '<div class="no-results">Koi record nahi ✅</div>'; return; }
  const q = (document.getElementById('recRepSearch').value || '').toLowerCase().trim();
  const rows = recRepAll.map((r, i) => ({ r, i })).filter(({ r }) => {
    const st = recRepStatus(r);
    if (recRepFilterVal !== 'all' && st !== recRepFilterVal) return false;
    if (!q) return true;
    const hay = (r.itemId + ' ' + r.repairId + ' ' + r.customerName + ' ' + (r.contactNo || '') + ' ' + (r.model || '') + ' ' + (r.serialNo || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  if (!rows.length) { list.innerHTML = '<div class="no-results">Kuch nahi mila 🔍</div>'; return; }

  // Repair ID ke hisaab se group karo
  const groups = {}, seq = [];
  rows.forEach(({ r, i }) => {
    const rid = r.repairId || '—';
    if (!groups[rid]) { groups[rid] = []; seq.push(rid); }
    groups[rid].push({ r, i });
  });

  let body = '';
  seq.forEach(rid => {
    const items = groups[rid];
    const count = items.length;
    const first = items[0].r;
    items.forEach(({ r, i }, idx) => {
      const isFirst = idx === 0;
      const bt = (isFirst && body) ? 'border-top:2px solid var(--border);' : '';
      const st = recRepStatus(r);
      const lbl = recRepStatusLabel(r);
      const ls = lbl.toLowerCase();
      let pillCls = 'amber';
      if (ls === 'dispatched') pillCls = 'green';
      else if (ls === 'received') pillCls = 'blue';
      else if (ls === 'in planning') pillCls = 'amber';
      else if (REPAIR_STAGES.indexOf(lbl) !== -1) pillCls = 'blue'; // koi stage
      const badge = '<span class="rec-pill ' + pillCls + '">● ' + lbl + '</span>';
      const typeIco = String(r.itemType).toLowerCase().indexOf('charg') !== -1 ? '⚡' : '🔋';

      // Repair-level cells (Repair ID, Date, Customer) sirf pehli row me — rowspan
      const groupCells = isFirst ? (
        '<td class="rec-id" rowspan="' + count + '" style="vertical-align:middle;' + bt + '">' + rid + '</td>' +
        '<td rowspan="' + count + '" style="vertical-align:middle;' + bt + '">' + (first.receivingDate || '—') + '</td>' +
        '<td class="rec-strong" rowspan="' + count + '" style="vertical-align:middle;' + bt + '">' + (first.customerName || '—') + '</td>'
      ) : '';

      body +=
        '<tr onclick="recRepOpen(' + i + ')">' +
        groupCells +
        '<td class="rec-id" style="color:var(--text2);' + bt + '">' + (r.itemId || '—') + '</td>' +
        '<td style="' + bt + '">' + typeIco + ' ' + (r.itemType || '—') + '</td>' +
        '<td style="' + bt + '">' + (r.model || '—') + '</td>' +
        '<td style="' + bt + '">' + (r.serialNo || '—') + '</td>' +
        '<td style="' + bt + '">' + (r.problemType || '—') + '</td>' +
        '<td style="' + bt + '">' + badge + '</td></tr>';
    });
  });

  list.innerHTML =
    '<table class="rec-table"><thead><tr>' +
    '<th>Repair ID</th><th>Date</th><th>Customer</th><th>Item ID</th><th>Type</th><th>Model</th><th>Serial</th><th>Problem</th><th>Status</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>';
}

function recRepOpen(idx) {
  const r = recRepAll[idx]; if (!r) return;
  document.getElementById('recDrawerTitle').textContent = (r.itemId || '') + ' — ' + (r.customerName || '');
  const kv = [
    ['Item ID', r.itemId],
    ['Repair ID', r.repairId],
    ['Item Status', r.itemStatus],
    ['Item Type', r.itemType],
    ['Model', r.model],
    ['Serial No', r.serialNo],
    ['Problem Type', r.problemType],
    ['Problem Description', r.problemDesc],
    ['Warranty', r.warranty],
    ['Warranty Claim', r.warrantyClaim],
    ['Transport (Inward)', r.transportIn],
    ['— Customer —', ''],
    ['Customer Name', r.customerName],
    ['Contact No', r.contactNo],
    ['Email', r.email],
    ['Receiving Date', r.receivingDate],
    ['Received By', r.receivedBy],
    ['Received Mode', r.receivedMode],
    ['— Dispatch —', ''],
    ['Dispatch Date', r.dispatchDate],
    ['Actual Problem Found', r.actualProblem],
    ['Any Cost', r.anyCost],
    ['Transport (Outward)', r.transportOut],
    ['Item Remarks', r.itemRemarks]
  ];
  document.getElementById('recDrawerBody').innerHTML = kv.map(x =>
    '<div class="info-row"><span>' + x[0] + '</span><span>' + (x[1] || '—') + '</span></div>').join('');
  document.getElementById('recDrawerFoot').innerHTML = ''; // dispatch abhi disabled (agle step me item-wise)
  recOpenDrawer();
}

function recDispatch(repairId) {
  recCloseDrawer();
  setActiveNav('repair'); setHeader('repair'); showApp('repairModule');
  if (!repInited) { fillDropdowns('repairModule', 'repair'); repInited = true; }
  repShowDispatch();
}

function recRepNew() {
  setActiveNav('repair'); setHeader('repair'); showApp('repairModule');
  if (!repInited) { fillDropdowns('repairModule', 'repair'); repInited = true; }
  document.getElementById('r_receivingDate').value = todayStr();
  repShowReceive();
}

/* ---------- ENQUIRIES records ---------- */
function recEnqLoad(force) {
  const cached = cacheGet('rec_enq_all');
  if (cached && !force) { recEnqAll = cached.val || []; recEnqRender(); if (cached.fresh) return; }
  else { document.getElementById('recEnqSkeleton').style.display = 'block'; document.getElementById('recEnqList').innerHTML = ''; }
  jsonp(CONFIG.ENQUIRY_URL, { action: 'getAllEnquiries' }, function (r) {
    document.getElementById('recEnqSkeleton').style.display = 'none';
    recEnqAll = (r && r.rows) || [];
    cacheSet('rec_enq_all', recEnqAll);
    recEnqRender();
  }, function () { document.getElementById('recEnqSkeleton').style.display = 'none'; document.getElementById('recEnqList').innerHTML = '<div class="no-results">Data load nahi hua ❌</div>'; });
}

function recEnqStatus(r) {
  return String(recF(r, ['Enquiry Closed', 'enquiryClosed'])).toLowerCase() === 'yes' ? 'closed' : 'open';
}

function recEnqFilter(el, f) {
  recEnqFilterVal = f;
  document.querySelectorAll('#recEnqFilters .rec-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  recEnqRender();
}

function recEnqRender() {
  const list = document.getElementById('recEnqList');
  if (!recEnqAll.length) { list.innerHTML = '<div class="no-results">Koi record nahi ✅</div>'; return; }
  const q = (document.getElementById('recEnqSearch').value || '').toLowerCase().trim();
  const rows = recEnqAll.map((r, i) => ({ r, i })).filter(({ r }) => {
    const st = recEnqStatus(r);
    if (recEnqFilterVal !== 'all' && st !== recEnqFilterVal) return false;
    if (!q) return true;
    const hay = ('sr.' + recF(r, ['Sr No', 'srNo']) + ' ' + recF(r, ['Customer Name', 'customerName']) + ' ' +
      recF(r, ['Contact', 'contact']) + ' ' + recF(r, ['OEMs', 'oems'])).toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  if (!rows.length) { list.innerHTML = '<div class="no-results">Kuch nahi mila 🔍</div>'; return; }
  const body = rows.map(({ r, i }) => {
    const st = recEnqStatus(r);
    const badge = st === 'closed' ? '<span class="rec-pill green">● Closed</span>' : '<span class="rec-pill amber">● Open</span>';
    return '<tr onclick="recEnqOpen(' + i + ')">' +
      '<td class="rec-id">Sr.' + (recF(r, ['Sr No', 'srNo']) || '—') + '</td>' +
      '<td>' + (recF(r, ['Date', 'date']) || '—') + '</td>' +
      '<td class="rec-strong">' + (recF(r, ['Customer Name', 'customerName']) || '—') + '</td>' +
      '<td>' + (recF(r, ['Contact', 'contact']) || '—') + '</td>' +
      '<td>' + (recF(r, ['OEMs', 'oems']) || '—') + '</td>' +
      '<td>' + (recF(r, ['Enquiry About', 'enquiryAbout']) || '—') + '</td>' +
      '<td>' + badge + '</td></tr>';
  }).join('');
  list.innerHTML =
    '<table class="rec-table"><thead><tr>' +
    '<th>Sr No</th><th>Date</th><th>Customer</th><th>Contact</th><th>OEM</th><th>Enquiry About</th><th>Status</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>';
}

function recEnqOpen(idx) {
  const r = recEnqAll[idx]; if (!r) return;
  const st = recEnqStatus(r);
  const sr = recF(r, ['Sr No', 'srNo']);
  document.getElementById('recDrawerTitle').textContent = 'Sr.' + sr + ' — ' + recF(r, ['Customer Name', 'customerName']);
  const kv = [
    ['Sr No', sr],
    ['Date', recF(r, ['Date', 'date'])],
    ['Status', st === 'closed' ? 'Closed' : 'Open'],
    ['Customer Name', recF(r, ['Customer Name', 'customerName'])],
    ['Contact', recF(r, ['Contact', 'contact'])],
    ['OEMs', recF(r, ['OEMs', 'oems'])],
    ['Company Name', recF(r, ['Company Name', 'companyName'])],
    ['Enquiry About', recF(r, ['Enquiry About', 'enquiryAbout'])],
    ['Response', recF(r, ['Response', 'response'])],
    ['Solution', recF(r, ['Solution', 'solution'])],
    ['Attended By', recF(r, ['Attended By', 'attendedBy'])],
    ['Enquiry Closed', recF(r, ['Enquiry Closed', 'enquiryClosed'])],
    ['Remarks', recF(r, ['Remarks', 'remarks'])]
  ];
  document.getElementById('recDrawerBody').innerHTML = kv.map(x =>
    '<div class="info-row"><span>' + x[0] + '</span><span>' + (x[1] || '—') + '</span></div>').join('');
  document.getElementById('recDrawerFoot').innerHTML =
    (st === 'open' && roleCan('enquiry'))
      ? '<button class="btn-update" style="width:100%" onclick="recUpdateEnq(\'' + sr + '\')">✏️ Update Karo</button>'
      : '';
  recOpenDrawer();
}

function recUpdateEnq(srNo) {
  recCloseDrawer();
  setActiveNav('enquiry'); setHeader('enquiry'); showApp('enquiryModule');
  if (!enqInited) { fillDropdowns('enquiryModule', 'enquiry'); enqInited = true; }
  document.getElementById('entryDate').value = todayStr();
  enqSwitchTab('update', function () {
    const idx = enqOpen.findIndex(r => String(r.srNo) === String(srNo));
    if (idx !== -1) enqSelectFromDropdown(idx);
    else showToast('⚠️ Ye enquiry ab open nahi hai');
  });
}

function recEnqNew() {
  setActiveNav('enquiry'); setHeader('enquiry'); showApp('enquiryModule');
  if (!enqInited) { fillDropdowns('enquiryModule', 'enquiry'); enqInited = true; }
  document.getElementById('entryDate').value = todayStr();
  enqSwitchTab('new');
}

/* ---------- shared drawer ---------- */
function recOpenDrawer() { document.getElementById('recDrawer').classList.add('open'); document.getElementById('recDrawerOv').classList.add('show'); }
function recCloseDrawer() { document.getElementById('recDrawer').classList.remove('open'); document.getElementById('recDrawerOv').classList.remove('show'); }

/* ============================================================
   REPAIR BOARD — item-wise stage tracking
   ============================================================ */
let boardItems = [];
const REPAIR_STAGES = (CONFIG.DROPDOWNS && CONFIG.DROPDOWNS.repair && CONFIG.DROPDOWNS.repair.Stages) || [];

function openBoard() { setActiveNav('board'); setHeader('board'); showApp('boardModule'); boardLoad(false); }

function boardLoad(force) {
  const cached = cacheGet('board_items');
  if (cached && !force) { boardItems = cached.val || []; boardRender(); if (cached.fresh) return; }
  else if (!cached) {
    document.getElementById('boardPending').innerHTML = '<div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>';
    document.getElementById('boardActive').innerHTML = '';
  }
  jsonp(CONFIG.REPAIR_URL, { action: 'getAll' }, function (r) {
    const repairs = (r && r.repairs) || [];
    const items   = (r && r.items) || [];
    const pmap = {};
    repairs.forEach(rp => { pmap[String(rp['Repair ID']).trim()] = rp; });
    boardItems = items.map(it => {
      const p = pmap[String(it['Repair ID']).trim()] || {};
      return {
        itemId:   it['Item ID'],
        repairId: it['Repair ID'],
        itemType: it['Item Type'],
        model:    it['Model'],
        serialNo: it['Serial No'],
        problem:  it['Problem Type'],
        status:   it['Item Status'],
        planDate: it['Plan Date'],
        stageAt:  it['Stage Updated At'],
        customer: p['Customer Name'] || ''
      };
    });
    cacheSet('board_items', boardItems);
    boardRender();
  }, function () {
    document.getElementById('boardPending').innerHTML = '<div class="no-results">Data load nahi hua ❌</div>';
  });
}

let boardSel = {}; // itemId -> true (pending me select kiye hue)

// kisi bhi format ki date ko yyyy-mm-dd me badlo
function boardNormDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  // already yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // dd-mm-yyyy ya dd/mm/yyyy
  let m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

function boardRender() {
  const pending = boardItems.filter(it => {
    const s = String(it.status).toLowerCase();
    return s !== 'in planning' && s !== 'dispatched' && REPAIR_STAGES.indexOf(it.status) === -1;
  });
  let active = boardItems.filter(it =>
    String(it.status).toLowerCase() === 'in planning' || REPAIR_STAGES.indexOf(it.status) !== -1);

  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // date filter (active pe) — filter tabhi lagao jab date select ho;
  // jinki planDate empty hai wo kisi bhi date filter me match nahi karenge
  const df = (document.getElementById('boardDateFilter') || {}).value || ''; // yyyy-mm-dd
  if (df) active = active.filter(it => boardNormDate(it.planDate).substring(0, 10) === df.substring(0, 10));

  _set('pendCount', pending.length);
  _set('repairCount', active.length);

  // --- Pending = checkbox multi-select + date picker + Add ---
  const pWrap = document.getElementById('boardPending');
  if (!pending.length) {
    pWrap.innerHTML = '<div class="no-results">Koi pending item nahi ✅</div>';
  } else {
    const rows = pending.map(it =>
      '<label class="ms-opt">' +
        '<input type="checkbox" class="ms-chk" value="' + it.itemId + '"' + (boardMsSel[it.itemId] ? ' checked' : '') + ' onchange="boardMsToggle(\'' + it.itemId + '\')">' +
        '<span class="ms-txt"><b>' + it.itemId + '</b> · ' + (it.customer || '') + ' · ' +
          (String(it.itemType).toLowerCase().indexOf('charg') !== -1 ? '⚡' : '🔋') + ' ' +
          (it.itemType || '') + (it.model ? ' (' + it.model + ')' : '') + '</span>' +
      '</label>'
    ).join('');
    const selN = Object.keys(boardMsSel).filter(k => boardMsSel[k]).length;
    pWrap.innerHTML =
      '<div class="ms-wrap">' +
        '<div class="ms-head" onclick="boardMsOpen()">' +
          '<span>' + (selN ? selN + ' item selected' : '-- Items chuno (multiple) --') + '</span><span>▾</span>' +
        '</div>' +
        '<div class="ms-list" id="boardMsList" style="display:none">' + rows + '</div>' +
      '</div>' +
      '<div class="board-pick" style="margin-top:10px">' +
        '<input type="date" id="boardPlanDate" class="board-pick-date" title="Kis din repair karni hai">' +
        '<button class="board-pick-btn" onclick="boardAddSelected()">➕ In Planning me daalo (<span id="msCount">' + selN + '</span>)</button>' +
      '</div>';
    const pd = document.getElementById('boardPlanDate');
    if (pd && !pd.value) pd.value = todayStr();
  }

  // --- Active cards ---
  const aWrap = document.getElementById('boardActive');
  aWrap.innerHTML = active.length ? active.map(it => {
    const inPlan = String(it.status).toLowerCase() === 'in planning';
    const opts = REPAIR_STAGES.map(s => '<option value="' + s + '"' + (s === it.status ? ' selected' : '') + '>' + s + '</option>').join('');
    const idx = REPAIR_STAGES.indexOf(it.status);
    const pct = inPlan ? 0 : Math.round(((idx + 1) / REPAIR_STAGES.length) * 100);
    const last = REPAIR_STAGES.length - 1;
    const stageLbl = inPlan ? 'In Planning — start karo' :
      ('Stage ' + (idx + 1) + '/' + REPAIR_STAGES.length + (idx === last ? ' · Ready ✅' : ''));
    const sel = '<select class="bc-stage-sel" onchange="boardSetStage(\'' + it.itemId + '\', this.value)">' +
      (inPlan ? '<option value="" selected disabled>-- Stage select karo --</option>' : '') + opts + '</select>';
    return '<div class="board-card active">' +
      '<div class="bc-top"><span class="bc-id">' + it.itemId + '</span>' +
        '<button class="bc-remove" title="Wapas Pending me bhejo" onclick="boardRemovePlan(\'' + it.itemId + '\')">✕</button></div>' +
      '<div class="bc-cust">' + (it.customer || '—') + ' <span class="bc-rid">· ' + it.repairId + '</span></div>' +
      '<div class="bc-meta">' + (String(it.itemType).toLowerCase().indexOf('charg') !== -1 ? '⚡' : '🔋') + ' ' +
        (it.itemType || '') + (it.model ? ' · ' + it.model : '') + '</div>' +
      (it.planDate ? '<div class="bc-plandate">📅 ' + boardNormDate(it.planDate) + '</div>' : '') +
      '<div class="bc-prog"><div class="bc-prog-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="bc-stage-lbl">' + stageLbl + '</div>' + sel +
      (it.stageAt ? '<div class="bc-at">Updated: ' + it.stageAt + '</div>' : '') +
    '</div>';
  }).join('') : '<div class="no-results">' + (df ? 'Is date ka koi item nahi 📅' : 'Koi item planning me nahi') + '</div>';
}

// cache ko local boardItems se refresh karo (dobara fetch ke bina)
function boardSaveLocal() {
  cacheSet('board_items', boardItems);
  sessionStorage.removeItem('rec_rep_all'); // Records stale
}

let boardMsSel = {}; // itemId -> true (pending me checkbox se select)

function boardMsOpen() {
  const l = document.getElementById('boardMsList');
  if (l) l.style.display = l.style.display === 'none' ? 'block' : 'none';
}
function boardMsToggle(itemId) {
  boardMsSel[itemId] = !boardMsSel[itemId];
  const n = Object.keys(boardMsSel).filter(k => boardMsSel[k]).length;
  const c = document.getElementById('msCount'); if (c) c.textContent = n;
  // head text update
  const head = document.querySelector('#boardPending .ms-head span');
  if (head) head.textContent = n ? (n + ' item selected') : '-- Items chuno (multiple) --';
}

function boardAddSelected() {
  const ids = Object.keys(boardMsSel).filter(k => boardMsSel[k]);
  if (!ids.length) { showToast('⚠️ Kam se kam ek item chuno'); return; }
  const planDate = (document.getElementById('boardPlanDate') || {}).value || todayStr();

  // local update
  ids.forEach(id => {
    const it = boardItems.find(x => x.itemId === id);
    if (it) { it.status = 'In Planning'; it.planDate = planDate; it.stageAt = ''; }
  });
  boardMsSel = {};
  boardSaveLocal();
  boardRender();
  showToast('✅ ' + ids.length + ' item → ' + planDate);

  jsonp(CONFIG.REPAIR_URL, { action: 'markPlanning', itemIds: JSON.stringify(ids), planDate: planDate }, function (res) {
    if (!res || !res.ok) { showToast('❌ Save fail — refresh karke check karo'); boardLoad(true); }
  }, function () { showToast('❌ Network error — save nahi hua'); boardLoad(true); });
}

function boardRemovePlan(itemId) {
  if (!confirm(itemId + ' ko wapas Pending me bhejein?')) return;
  const it = boardItems.find(x => x.itemId === itemId);
  if (it) { it.status = 'Received'; it.planDate = ''; it.stageAt = ''; }
  boardSaveLocal();
  boardRender();
  showToast('↩️ ' + itemId + ' wapas Pending me');
  jsonp(CONFIG.REPAIR_URL, { action: 'removePlanning', itemId: itemId }, function (res) {
    if (!res || !res.ok) { showToast('❌ Remove fail — refresh karo'); boardLoad(true); }
  }, function () { showToast('❌ Network error'); boardLoad(true); });
}

function boardSetStage(itemId, stage) {
  if (!stage) return;
  const it = boardItems.find(x => x.itemId === itemId);
  const nowStr = new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  if (it) { it.status = stage; it.stageAt = nowStr; }
  boardSaveLocal();
  boardRender();
  jsonp(CONFIG.REPAIR_URL, { action: 'updateStage', itemId: itemId, stage: stage }, function (res) {
    console.log('updateStage response:', res);
    if (!res || !res.ok) { showToast('❌ Stage save fail — ' + ((res && res.msg) || 'no response')); boardLoad(true); }
  }, function () { showToast('❌ Network error'); boardLoad(true); });
}

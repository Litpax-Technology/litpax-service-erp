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
  records:  ['Records', 'Saari entries — dekho aur action lo']
};
const NAV_ITEMS = [
  { key: 'records',   icon: '📁', label: 'Records',   mod: 'records' },
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
function currentRole() { return sessionStorage.getItem('hub_role') || ''; }
function roleCan(mod) { const r = CONFIG.ROLES[currentRole()]; return r && r.modules.indexOf(mod) !== -1; }

function buildSidebar() {
  const nav = document.getElementById('sbNav');
  nav.innerHTML = NAV_ITEMS.filter(it => it.mod === null || (it.mod === 'records' ? recCanAny() : roleCan(it.mod))).map(it =>
    '<button class="sb-item" data-nav="' + it.key + '" onclick="navGo(\'' + it.key + '\')"><span class="sb-ico">' + it.icon + '</span>' + it.label + '</button>'
  ).join('');
}
function setActiveNav(key) {
  document.querySelectorAll('.sb-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-nav') === key));
}
function navGo(key) { if (key === 'records') openRecords(); else openModule(key); toggleSidebar(false); }
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
    sessionStorage.setItem('hub_role', res.role);
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

function logout() { sessionStorage.removeItem('hub_role'); toggleSidebar(false); showLogin(); }

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

/* ----- DISPATCH ----- */
function repShowDispatch(preselectId) {
  repShowScreen('repDispatchScreen');
  document.getElementById('errorBox').style.display = 'none';
  document.getElementById('selectedInfoBox').style.display = 'none';
  document.getElementById('d_selectedRepairId').value = '';
  document.getElementById('dNextBtn').disabled = true; document.getElementById('dNextBtn').style.opacity = '.5';

  const cached = cacheGet('rep_pending');
  if (cached) { repPending = cached.val.data || []; repRenderPending(); if (cached.fresh) { repPreselect(preselectId); return; } }
  else { document.getElementById('pendingSkeleton').style.display = 'block'; document.getElementById('pendingList').innerHTML = ''; }

  repLoadData(true, function (err) {
    document.getElementById('pendingSkeleton').style.display = 'none';
    if (err) { document.getElementById('errorBox').style.display = 'block'; return; }
    repRenderPending();
    repPreselect(preselectId);
  });
}

function repPreselect(repairId) {
  if (!repairId) return;
  const idx = repPending.findIndex(function (r) { return String(r.repairId) === String(repairId); });
  if (idx !== -1) repPickPending(idx);
  else showToast('⚠️ Ye entry ab pending nahi hai');
}

function repRenderPending() {
  document.getElementById('pendingSkeleton').style.display = 'none';
  const list = document.getElementById('pendingList');
  if (!repPending.length) { list.innerHTML = '<div class="no-results">Koi pending repair nahi hai ✅</div>'; return; }
  const q = (document.getElementById('pendingSearch').value || '').toLowerCase().trim();
  const rows = repPending.map((r, i) => ({ r, i })).filter(({ r }) =>
    !q || (r.repairId + ' ' + r.customerName + ' ' + (r.contactNo || '') + ' ' + (r.batteryModel || '')).toLowerCase().indexOf(q) !== -1);
  if (!rows.length) { list.innerHTML = '<div class="no-results">Kuch nahi mila 🔍</div>'; return; }
  const selId = document.getElementById('d_selectedRepairId').value;
  list.innerHTML = rows.map(({ r, i }) =>
    '<div class="pick-card' + (r.repairId === selId ? ' selected' : '') + '" onclick="repPickPending(' + i + ')">' +
    '<div class="pick-main"><div class="pick-title">' + r.repairId + '</div>' +
    '<div class="pick-sub">' + r.customerName + ' · ' + (r.category || '') + (r.batteryModel ? ' — ' + r.batteryModel : '') + '</div></div>' +
    '<span class="badge badge-amber">' + r.pendingQty + ' pending</span></div>'
  ).join('');
}

function repPickPending(idx) {
  const row = repPending[idx];
  if (!row) return;
  repSelected = row;
  document.getElementById('d_selectedRepairId').value = row.repairId;
  document.getElementById('d_selectedRow').value = row.rowIndex;
  document.getElementById('si_repairId').textContent = row.repairId;
  document.getElementById('si_customer').textContent = row.customerName;
  document.getElementById('si_contact').textContent = row.contactNo;
  document.getElementById('si_product').textContent = (row.category || '') + (row.batteryModel ? ' — ' + row.batteryModel : '');
  document.getElementById('si_batteryRcv').textContent = row.batteryQtyReceived || 0;
  document.getElementById('si_chargerRcv').textContent = row.chargerQtyReceived || 0;
  document.getElementById('si_batteryPending').textContent = row.batteryPending || 0;
  document.getElementById('si_chargerPending').textContent = row.chargerPending || 0;
  document.getElementById('si_pendingQty').textContent = row.pendingQty;
  document.getElementById('si_receivedDate').textContent = row.receivingDate;
  document.getElementById('selectedInfoBox').style.display = 'block';
  document.getElementById('dNextBtn').disabled = false; document.getElementById('dNextBtn').style.opacity = '1';
  repApplyDispatchCategory(row.category || 'Battery+Charger');
  repCalcPending();
  repRenderPending(); // re-highlight selected card
  document.getElementById('selectedInfoBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function repApplyDispatchCategory(cat) {
  const bG = document.getElementById('grp_dBatteryQty'), cG = document.getElementById('grp_dChargerQty');
  const bF = document.getElementById('d_batteryDispatchQty'), cF = document.getElementById('d_chargerDispatchQty');
  if (cat === 'Battery') { bG.style.display = ''; cG.style.display = 'none'; bF.disabled = false; cF.disabled = true; cF.value = '0'; }
  else if (cat === 'Charger') { bG.style.display = 'none'; cG.style.display = ''; bF.disabled = true; bF.value = '0'; cF.disabled = false; }
  else { bG.style.display = ''; cG.style.display = ''; bF.disabled = false; cF.disabled = false; }
}

function repGoToDStep2() {
  if (!document.getElementById('d_selectedRepairId').value) { showToast('⚠️ Pehle ek Repair ID select karo'); return; }
  document.getElementById('dSection1').classList.remove('active');
  document.getElementById('dSection2').classList.add('active');
  window.scrollTo(0, 0);
}
function repBackToDStep1() { document.getElementById('dSection2').classList.remove('active'); document.getElementById('dSection1').classList.add('active'); window.scrollTo(0, 0); }

function repCalcPending() {
  const bP = parseInt(repSelected && repSelected.batteryPending) || 0;
  const cP = parseInt(repSelected && repSelected.chargerPending) || 0;
  const tP = parseInt(repSelected && repSelected.pendingQty) || 0;
  const bF = document.getElementById('d_batteryDispatchQty'), cF = document.getElementById('d_chargerDispatchQty');
  let b = parseInt(bF.value) || 0, c = parseInt(cF.value) || 0;
  if (b > bP) { b = bP; bF.value = bP; showToast('⚠️ Battery qty ' + bP + ' se zyada nahi'); }
  if (c > cP) { c = cP; cF.value = cP; showToast('⚠️ Charger qty ' + cP + ' se zyada nahi'); }
  document.getElementById('d_pendingQty').value = Math.max(0, tP - (b + c));
}

function repSubmitDispatch() {
  if (!repValidate('dSection2')) return;
  const bP = parseInt(repSelected && repSelected.batteryPending) || 0;
  const cP = parseInt(repSelected && repSelected.chargerPending) || 0;
  const b = parseInt(document.getElementById('d_batteryDispatchQty').value) || 0;
  const c = parseInt(document.getElementById('d_chargerDispatchQty').value) || 0;
  if (b === 0 && c === 0) { showToast('⚠️ Battery ya Charger dispatch qty bharein'); return; }
  if (b > bP) { showToast('⚠️ Battery dispatch qty pending (' + bP + ') se zyada'); return; }
  if (c > cP) { showToast('⚠️ Charger dispatch qty pending (' + cP + ') se zyada'); return; }

  const btn = document.querySelector('#dSection2 .btn-submit-dispatch');
  btn.disabled = true; btn.textContent = '⏳ ...';

  const data = {
    action: 'dispatch',
    rowIndex: document.getElementById('d_selectedRow').value,
    'Repair ID': document.getElementById('d_selectedRepairId').value,
    'Dispatch Date': document.getElementById('d_dispatchDate').value,
    'Battery Dispatch Qty': b,
    'Charger Dispatch Qty': c,
    'Pending Qty': document.getElementById('d_pendingQty').value,
    'Repair Status': document.getElementById('d_repairStatus').value,
    'Actual Problem Found': document.getElementById('d_actualProblem').value,
    'Transport Details (Outward)': document.getElementById('d_transportOutward').value,
    'Dispatch Address': document.getElementById('d_dispatchAddress').value,
    'Dispatched By': document.getElementById('d_dispatchedBy').value,
    'Any Cost': document.getElementById('d_anyCost').value,
    'Dispatch Remarks': document.getElementById('d_remarks').value
  };

  postNoCors(CONFIG.REPAIR_URL, data);
  sessionStorage.removeItem('rep_pending'); // force refresh next time
  sessionStorage.removeItem('rec_rep_all');

  document.getElementById('dSection2').classList.remove('active');
  document.getElementById('repDispatchSuccess').style.display = 'block';
  document.getElementById('successDispatchId').textContent = data['Repair ID'];

  const now = new Date();
  const dStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const tStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('dispatchSummary').innerHTML =
    '<div style="background:white;border-radius:12px;border:1px solid #dde1f0;padding:24px;">' +
    '<div class="receipt-header"><div><div class="receipt-logo">LITPAX</div><div class="receipt-title">Battery / Charger Service Center</div></div>' +
    '<div style="text-align:right;"><div style="font-size:11px;color:#5a6080;">Dispatch Slip</div><div style="font-size:11px;color:#8890b0;">' + dStr + ' ' + tStr + '</div></div></div>' +
    '<div style="background:#e8f8f4;border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">' +
    '<span style="font-size:11px;color:#00856e;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Repair ID</span>' +
    '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;color:#00856e;">' + data['Repair ID'] + '</span></div>' +
    '<div class="receipt-section">Customer Details</div><table class="receipt-table">' +
    '<tr><td>Customer Name</td><td>' + ((repSelected && repSelected.customerName) || '—') + '</td></tr>' +
    '<tr><td>Contact No.</td><td>' + ((repSelected && repSelected.contactNo) || '—') + '</td></tr>' +
    '<tr><td>Dispatch Address</td><td>' + (data['Dispatch Address'] || '—') + '</td></tr></table>' +
    '<div class="receipt-section" style="margin-top:8px;">Dispatch Details</div><table class="receipt-table">' +
    '<tr><td>Dispatch Date</td><td>' + data['Dispatch Date'] + '</td></tr>' +
    '<tr><td>Battery Dispatched</td><td>' + b + '</td></tr>' +
    '<tr><td>Charger Dispatched</td><td>' + c + '</td></tr>' +
    '<tr><td>Pending Qty</td><td>' + data['Pending Qty'] + '</td></tr>' +
    '<tr><td>Repair Status</td><td>' + data['Repair Status'] + '</td></tr>' +
    '<tr><td>Actual Problem Found</td><td>' + (data['Actual Problem Found'] || '—') + '</td></tr>' +
    '<tr><td>Any Cost</td><td>' + (data['Any Cost'] || '—') + '</td></tr>' +
    '<tr><td>Transport (Outward)</td><td>' + (data['Transport Details (Outward)'] || '—') + '</td></tr>' +
    '<tr><td>Dispatched By</td><td>' + data['Dispatched By'] + '</td></tr>' +
    '<tr><td>Remarks</td><td>' + (data['Dispatch Remarks'] || '—') + '</td></tr></table>' +
    '<div class="receipt-footer"><span>Litpax Technology — Service Management System</span><span>' + dStr + ' ' + tStr + '</span></div></div>';

  btn.disabled = false; btn.textContent = 'Dispatch Karo 🚚';
  window.scrollTo(0, 0);
}

function repResetDispatch() {
  document.getElementById('repDispatchSuccess').style.display = 'none';
  document.getElementById('dSection2').classList.remove('active');
  document.getElementById('dSection1').classList.add('active');
  document.querySelectorAll('#repDispatchScreen input:not([type=hidden]),#repDispatchScreen select,#repDispatchScreen textarea').forEach(el => { if (el.type === 'date') el.value = todayStr(); else el.value = ''; });
  repSelected = null;
  repShowDispatch();
  window.scrollTo(0, 0);
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

  postNoCors(CONFIG.ENQUIRY_URL, data);
  sessionStorage.removeItem('enq_open'); // list changed
  sessionStorage.removeItem('rec_enq_all');

  document.getElementById('enqFormScreen').style.display = 'none';
  document.getElementById('enqSuccessScreen').style.display = 'block';
  document.getElementById('enqSuccessSrNo').textContent = 'Sr. No. — ' + enqNextSrNo;
  document.getElementById('enqSummaryCard').innerHTML =
    '<div class="summary-row"><span>Customer</span><span>' + data['Customer Name'] + '</span></div>' +
    '<div class="summary-row"><span>OEM</span><span>' + data['OEMs'] + '</span></div>' +
    '<div class="summary-row"><span>Contact</span><span>' + data['Contact'] + '</span></div>' +
    '<div class="summary-row"><span>Enquiry About</span><span>' + data['Enquiry About'] + '</span></div>' +
    '<div class="summary-row"><span>Enquiry Closed</span><span>' + data['Enquiry Closed'] + '</span></div>' +
    '<div class="summary-row"><span>Attended By</span><span>' + data['Attended By'] + '</span></div>';
  window.scrollTo(0, 0);
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
  postNoCors(CONFIG.ENQUIRY_URL, data);
  sessionStorage.removeItem('enq_open');
  setTimeout(() => {
    document.getElementById('enqUpdateFormScreen').style.display = 'none';
    document.getElementById('enqUpdateSuccessScreen').style.display = 'block';
    document.getElementById('updateSrNoDisplay').textContent = 'Sr. No. — ' + enqSelected.srNo + ' Updated ✅';
    btn.disabled = false; btn.textContent = '✅ Update Karo';
    window.scrollTo(0, 0);
  }, 300);
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
  if (tab === 'repair') recRepLoad(false); else recEnqLoad(false);
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
  return String(row.itemStatus || '').toLowerCase() === 'dispatched' ? 'dispatched' : 'pending';
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
      const badge = st === 'dispatched' ? '<span class="rec-pill green">● Dispatched</span>' : '<span class="rec-pill amber">● Pending</span>';
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
  if (!repInited) { fillDropdowns('repairModule', 'repair'); repApplyCategory('Battery'); repInited = true; }
  document.getElementById('d_dispatchDate').value = todayStr();
  repShowDispatch(repairId);
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
    '<th>Item ID</th><th>Repair ID</th><th>Date</th><th>Customer</th><th>Type</th><th>Model</th><th>Serial</th><th>Problem</th><th>Status</th>' +
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

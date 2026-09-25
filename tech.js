/* ============================================================
   LITPAX — REPAIR FLOOR (tech.js)
   No-login page for repair staff. Shows today's planned items
   (Repair ID wise) and lets staff tick stages in sequence.
   Uses shared config.js → CONFIG.REPAIR_URL, CONFIG.JSONP_TIMEOUT_MS
   ============================================================ */
'use strict';

const T = {
  stages: [],     // server se (Code.gs REPAIR_STAGES)
  items: [],      // aaj ke planned items
  open: {},       // repairId -> expanded?
  busy: {},       // itemId -> tick in progress
  just: '',       // "itemId|stageIdx" — naya tick animation ke liye
  loading: false,
  loaded: false,
  firstPaint: true
};

/* ---------- JSONP ---------- */
let _seq = 0;
function jsonp(action, params, onData, onErr) {
  const cb = 'tcb' + (++_seq) + '_' + Date.now();
  const p = Object.assign({ action: action }, params || {});
  const qs = Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
  const s = document.createElement('script');
  let done = false;
  const timer = setTimeout(() => { if (!done) { clean(); onErr && onErr('timeout'); } }, CONFIG.JSONP_TIMEOUT_MS || 20000);
  function clean() { done = true; clearTimeout(timer); delete window[cb]; s.remove(); }
  window[cb] = data => { clean(); onData && onData(data); };
  s.onerror = () => { if (!done) { clean(); onErr && onErr('network'); } };
  s.src = CONFIG.REPAIR_URL + '?' + qs + '&callback=' + cb + '&t=' + Date.now();
  document.body.appendChild(s);
}

/* ---------- helpers ---------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (ok === false ? 'bad' : 'ok');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2800);
}
function stageIdx(status) { return status === 'In Planning' ? -1 : T.stages.indexOf(status); }
function isComplete(it) { return T.stages.length > 0 && stageIdx(it.status) === T.stages.length - 1; }
function anyBusy() { return Object.keys(T.busy).length > 0; }

/* ---------- load ---------- */
function tLoad(silent) {
  if (T.loading) return;
  T.loading = true;
  const btn = document.getElementById('tRefresh');
  btn.classList.add('spin');
  if (!silent && !T.loaded) renderSkeleton();

  jsonp('getTechJobs', {}, res => {
    T.loading = false; btn.classList.remove('spin');
    if (!res || !res.ok) {
      if (!T.loaded) renderError((res && res.msg) || 'Could not load today\'s jobs.');
      else toast((res && res.msg) || 'Could not refresh', false);
      return;
    }
    T.stages = res.stages || [];
    T.items = res.items || [];
    T.loaded = true;
    render();
  }, () => {
    T.loading = false; btn.classList.remove('spin');
    if (!T.loaded) renderError('Network error. Check the connection and try again.');
    else toast('Offline — showing the last loaded list', false);
  });
}

/* ---------- render ---------- */
function renderSkeleton() {
  document.getElementById('tList').innerHTML = '<div class="sk"></div><div class="sk"></div><div class="sk"></div>';
}
function renderError(msg) {
  document.getElementById('tList').innerHTML =
    '<div class="empty"><div class="empty-title">Something went wrong</div>' + esc(msg) +
    '<div><button class="retry" data-act="retry">Try again</button></div></div>';
}

function render() {
  const list = document.getElementById('tList');
  const total = T.items.length;
  const done = T.items.filter(isComplete).length;
  document.getElementById('tDone').textContent = done;
  document.getElementById('tTotal').textContent = total;
  document.getElementById('tBar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';

  if (!total) {
    list.innerHTML = '<div class="empty"><div class="empty-title">No repairs planned for today</div>' +
      'Items will appear here once they are planned for today.</div>';
    return;
  }

  // Repair ID wise group; poore complete wale neeche
  const groups = {}, order = [];
  T.items.forEach(it => {
    if (!groups[it.repairId]) { groups[it.repairId] = []; order.push(it.repairId); }
    groups[it.repairId].push(it);
  });
  const allDone = rid => groups[rid].every(isComplete);
  const sorted = order.filter(r => !allDone(r)).concat(order.filter(allDone));

  list.innerHTML = sorted.map(rid => jobHtml(rid, groups[rid])).join('');
  T.firstPaint = false;
  T.just = '';
}

function jobHtml(rid, items) {
  const doneN = items.filter(isComplete).length;
  const all = doneN === items.length;
  const totalSteps = items.length * T.stages.length;
  const stepsDone = items.reduce((a, it) => a + Math.max(0, stageIdx(it.status) + 1), 0);
  const pct = totalSteps ? Math.round(stepsDone / totalSteps * 100) : 0;
  const open = !!T.open[rid];

  return '<section class="job' + (all ? ' complete' : '') + (open ? ' open' : '') + (T.firstPaint ? ' enter' : '') + '">' +
    '<button class="job-head" data-act="toggle" data-rid="' + esc(rid) + '">' +
      '<div><div class="job-id">' + esc(rid) + '</div><div class="job-cust">' + esc(items[0].customer || '—') + '</div></div>' +
      '<div class="job-side">' +
        (all ? '<span class="pill ok">Ready</span>' : '<span class="pill">' + doneN + '/' + items.length + ' done</span>') +
        '<span class="chev" aria-hidden="true"></span>' +
      '</div>' +
    '</button>' +
    '<div class="job-bar"><i style="width:' + pct + '%"></i></div>' +
    (open ? '<div class="job-body">' + items.map(itemHtml).join('') + '</div>' : '') +
  '</section>';
}

function itemHtml(it) {
  const idx = stageIdx(it.status);
  const last = T.stages.length - 1;
  const isChg = /charg/i.test(it.itemType || '');
  const busy = !!T.busy[it.itemId];
  const info = [it.model, it.serialNo ? 'S/N ' + it.serialNo : '', it.problemType]
    .filter(Boolean).map(esc).join(' · ');

  const steps = T.stages.map((s, i) => {
    let cls = 'locked', dot = String(i + 1), btn = '';
    if (i <= idx) { cls = 'done'; dot = '✓'; }
    else if (i === idx + 1) {
      cls = 'next';
      btn = '<button class="tick" data-act="tick" data-id="' + esc(it.itemId) + '"' + (busy ? ' disabled' : '') + '>' +
        (busy ? '<span class="spinner"></span>Saving…' : 'Mark done') + '</button>';
    }
    if (T.just === it.itemId + '|' + i) cls += ' just';
    return '<li class="st ' + cls + '"><span class="dot">' + dot + '</span><span class="st-name">' + esc(s) + '</span>' + btn + '</li>';
  }).join('');

  return '<article class="item">' +
    '<div class="item-head"><span class="tag">' + (isChg ? 'Charger' : 'Battery') + '</span>' +
      '<span class="item-id">' + esc(it.itemId) + '</span></div>' +
    (info ? '<div class="item-info">' + info + '</div>' : '') +
    (it.stageAt ? '<div class="item-at">Last update: ' + esc(it.stageAt) + '</div>' : '') +
    '<ol class="stages">' + steps + '</ol>' +
    (idx === last ? '<div class="item-ready">All stages done — ready for dispatch</div>' : '') +
  '</article>';
}

/* ---------- tick (sequence-wise) ---------- */
function tick(itemId) {
  if (T.busy[itemId]) return;                       // double-tap guard
  const it = T.items.find(x => x.itemId === itemId);
  if (!it) return;
  const idx = stageIdx(it.status);
  if (idx >= T.stages.length - 1) return;
  const next = T.stages[idx + 1];

  T.busy[itemId] = true;
  render();

  jsonp('techTick', { itemId: itemId, from: it.status }, res => {
    delete T.busy[itemId];
    const cur = T.items.find(x => x.itemId === itemId);   // refresh ke baad bhi sahi object
    if (res && res.ok) {
      if (cur) { cur.status = res.status; cur.stageAt = res.at || ''; T.just = itemId + '|' + (idx + 1); }
      toast(cur && isComplete(cur) ? itemId + ' is ready for dispatch' : next + ' — done');
      render();
    } else {
      if (cur && res && res.status) cur.status = res.status;
      render();
      toast((res && res.msg) || 'Could not save. Tap again.', false);
      tLoad(true);                                         // server ki latest state lao
    }
  }, () => {
    delete T.busy[itemId];
    render();
    toast('Network error — not saved. Tap again.', false);
  });
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'toggle') { const r = b.dataset.rid; T.open[r] = !T.open[r]; render(); }
  else if (act === 'tick') tick(b.dataset.id);
  else if (act === 'refresh' || act === 'retry') tLoad(false);
});

// auto refresh — har 60 sec, aur jab phone wapas khule (tick chal raha ho to nahi)
setInterval(() => {
  if (document.visibilityState === 'visible' && !anyBusy()) tLoad(true);
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && T.loaded && !anyBusy()) tLoad(true);
});

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tDate').textContent =
    new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  tLoad(false);
});

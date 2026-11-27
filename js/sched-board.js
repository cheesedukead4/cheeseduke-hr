/*
 * 人事工作看板｜「班表」頁（#sched）：各部門班表總覽、部門填寫連結、員工名單（從 Apollo 匯出貼上）、鎖定、匯出
 * ---------------------------------------------------------------
 * 資料（HRStore）：
 *   staff   { id, no: Apollo 員工編號, name, dept: 部門名稱, title, kind: 正職/兼職…, on: 在職, order, updatedAt, updatedBy }
 *   depts   { id, name: 部門名稱, t: 填寫連結代碼（32 碼）, on, at, by }；{ id: '_cfg', anchor: 四週變形起算日, shifts: 班別 [{ c, n, s, e, b, d }] }
 *   sched   （sched_YYYYMM）員工 { id: 'YYYY-MM|員工id', date, sid, dept, days }、月設定 { id: 'YYYY-MM|_m', target, hol }、
 *           部門狀態 { id: 'YYYY-MM|_d|部門id', dept, st: draft|sent, sentAt, sentBy, lock, lockAt, lockBy }
 * 部門主管用連結 sched.html#t=代碼 填（雲端後端 schInfo／schSave）；人資在這裡看、改（直接存 HRStore）、鎖定（鎖定後部門連結不能改）、匯出。
 * 權限：sched（班表管理）才能匯入名單、產生連結、修改、鎖定、匯出；其他人只能看。
 * 匯出：Apollo 班表匯入檔（.xlsx，格式照 Apollo「班表匯入範本」的「匯入檔」工作表；對照規則在 sched-core.js 的 apolloRows），另有明細／總表 CSV。
 *   國定假日、整天請假要匯成哪個 Apollo 狀態代碼存在 depts 的 _cfg.apollo = { H, L }（「班表設定」）。
 */
(function () {
'use strict';
const SC = window.SchedCore, ST = window.HRStore, AU = window.HRAuth;
const {esc, pad, fmtH, md} = SC;
const NO_DEPT = '（未分部門）';
const now = new Date();
const B = {
  month: SC.shiftMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`, now.getDate() >= 15 ? 1 : 0),
  dept:'', grid:null, gridKey:'', imp:null, shImp:null, q:'', confirm:'', confirmT:0, ctx:{}, expMsg:'',
  shDept:'', shQ:'', shOnly:false, shAll:false   // 班別設定：「選部門、勾班別」選的部門、搜尋、只看已勾；全部班別明細有沒有打開
};
const toast = m => { if (B.ctx.toast) B.ctx.toast(m); };
const can = () => !!AU && AU.can('sched');
const me = () => (AU && (AU.name() || AU.email())) || '人資';
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const newToken = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const when = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const linkOf = t => new URL('sched.html#t=' + t, location.href.replace(/#.*$/, '')).href;

/* ---------- 資料 ---------- */
const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hant');
const staffAll = () => ST.list('staff').filter(s => s && s.id && s.name).sort(byOrder);
const deptRecs = () => ST.list('depts').filter(d => d && d.id && d.id !== '_cfg' && d.name);
const cfg = () => ST.get('depts', '_cfg') || {};
const anchor = () => SC.isDate(cfg().anchor) ? cfg().anchor : SC.DEFAULT_ANCHOR;
const shiftsAll = () => SC.cleanShifts(cfg().shifts);
const saveCfg = patch => ST.save('depts', Object.assign({}, cfg(), patch, {id:'_cfg', at:Date.now(), by:me()}));
const monthRecs = m => ST.list('sched').filter(r => r && r.date === m);
const monthCfg = m => ST.get('sched', `${m}|_m`) || {};
const deptRec = name => deptRecs().find(d => d.name === name) || null;
const statusRec = (m, d) => d ? ST.get('sched', `${m}|_d|${d.id}`) : null;
function deptNames(){
  const out = [];
  for (const s of staffAll()) if (s.on !== false && s.dept && !out.includes(s.dept)) out.push(s.dept);
  for (const d of deptRecs()) if (!out.includes(d.name) && (d.t || monthRecs(B.month).some(r => r.dept === d.name))) out.push(d.name);
  return out;
}
/** 部門這個月要排的人：在職的部門員工，加上這個月已經排在這個部門的人 */
function staffOfDept(name, m){
  const have = new Set(monthRecs(m).filter(r => r.sid && r.dept === name).map(r => r.sid));
  return staffAll().filter(s => (s.on !== false && (s.dept || NO_DEPT) === name) || have.has(s.id));
}
function daysOf(m, sid){ const r = ST.get('sched', `${m}|${sid}`); return r ? SC.cleanDays(r.days, m) : {}; }
function ctxOf(m, sid){
  const out = {};
  for (const mm of [SC.shiftMonth(m, -1), SC.shiftMonth(m, 1)]) for (const [dd, v] of Object.entries(daysOf(mm, sid))) out[`${mm}-${dd}`] = v;
  return out;
}
function deptSummary(name, m){
  const staff = staffOfDept(name, m), mc = monthCfg(m);
  let full = 0, errs = 0, warns = 0, started = 0;
  for (const s of staff) {
    const days = daysOf(m, s.id), all = Object.assign(ctxOf(m, s.id), Object.fromEntries(Object.entries(days).map(([dd, v]) => [`${m}-${dd}`, v])));
    if (Object.keys(days).length) started++;
    const r = SC.checkStaff({month:m, days:all, anchor:anchor(), target: SC.usesTarget(s) ? Number(mc.target) || 0 : 0, needCode: SC.shiftsFor(cfg().shifts, name).length > 0});
    if (!r.sum.blank) full++;
    errs += r.issues.filter(i => i.sev === 'err').length; warns += r.issues.filter(i => i.sev === 'warn').length;
  }
  return {staff, full, started, errs, warns};
}

/* ---------- 畫面 ---------- */
function keep(el, fn){   // 重畫一個區塊，保留正在輸入的欄位（游標所在的欄位、貼上框）
  const a = document.activeElement, inside = a && el.contains(a) && a.id;
  const vals = {}; el.querySelectorAll('[data-keep="1"]').forEach(i => { if (i.id) vals[i.id] = i.value; });
  if (inside && a.matches('input:not([type="checkbox"]), textarea')) vals[inside] = a.value;
  let sel = null; try { if (inside && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch {}
  fn();
  for (const [id, v] of Object.entries(vals)) { const i = document.getElementById(id); if (i && el.contains(i)) i.value = v; }
  if (inside) { const i = document.getElementById(inside); if (i && el.contains(i)) { i.focus(); if (sel) try { i.setSelectionRange(sel[0], sel[1]); } catch {} } }
}
function render(){
  const root = document.getElementById('sched-view');
  if (!root) return;
  if (!root.dataset.ready) {
    root.dataset.ready = '1';
    root.innerHTML = `<div class="sc-top" id="sc-top"></div>
      <section class="ov-card sc-card" id="sc-month" aria-label="每月設定"></section>
      <section class="ov-card sc-card" id="sc-depts" aria-label="各部門班表"></section>
      <section class="ov-card sc-card" id="sc-gridsec" aria-label="部門班表" hidden></section>
      <details class="ov-card sc-card" id="sc-shift"><summary class="sc-sum"></summary><div id="sc-shift-body"></div></details>
      <details class="ov-card sc-card" id="sc-staff"><summary class="sc-sum"></summary><div id="sc-staff-body"></div></details>
      <details class="ov-card sc-card" id="sc-set"><summary class="sc-sum">班表設定</summary><div id="sc-set-body"></div></details>`;
    bind(root);
  }
  keep(document.getElementById('sc-top'), renderTop);
  keep(document.getElementById('sc-month'), renderMonth);
  keep(document.getElementById('sc-depts'), renderDepts);
  renderGrid();
  keep(document.getElementById('sc-shift'), renderShifts);
  keep(document.getElementById('sc-staff'), renderStaff);
  keep(document.getElementById('sc-set'), renderSet);
}
function renderTop(){
  const [y, m] = B.month.split('-'), mc = monthCfg(B.month), c = can();
  document.getElementById('sc-top').innerHTML = `
    <div class="month" role="group" aria-label="班表月份">
      <button class="btn icon" type="button" data-sc="prev" aria-label="上個月">‹</button>
      <span class="m-label">${+y} 年 ${+m} 月</span>
      <button class="btn icon" type="button" data-sc="next" aria-label="下個月">›</button>
    </div>
    <span class="sp"></span>
    ${c ? `<button class="btn primary" type="button" data-sc="exp-apollo">匯出 Apollo 匯入檔</button><button class="btn" type="button" data-sc="exp-detail">明細 CSV</button><button class="btn" type="button" data-sc="exp-matrix">總表 CSV</button>` : ''}
    ${B.expMsg ? `<div class="sc-exp" role="status">${B.expMsg}<button type="button" class="btn icon" data-sc="exp-close" aria-label="關閉匯出結果">✕</button></div>` : ''}`;
}
/** 每月設定（人資填寫）：正職應排時數、國定假日；部門填寫頁會顯示，工時檢查用來比對 */
function renderMonth(){
  const el = document.getElementById('sc-month'), mc = monthCfg(B.month), c = can(), m = +B.month.slice(5), hol = (mc.hol || []).map(d => +d);
  el.innerHTML = `<div class="ov-h"><h2>${m} 月設定</h2><span class="sc-sub">人資填寫・部門填寫頁會顯示</span></div>
    ${!mc.target ? `<p class="sc-warn">${m} 月的正職應排時數還沒填${c ? '，請填在下面' : ''}。</p>` : ''}
    ${c ? `<div class="sc-row sc-mrow">
      <label class="sc-f sc-big" for="sc-target">${m} 月正職應排時數</label><span class="sc-f"><input class="inp" id="sc-target" type="number" min="0" max="400" step="0.5" inputmode="decimal" value="${mc.target || ''}" placeholder="例：152">小時</span>
      <label class="sc-f sc-big" for="sc-hol">國定假日</label><span class="sc-f"><input class="inp" id="sc-hol" inputmode="numeric" value="${esc(hol.join(', '))}" placeholder="例：25（多天用逗號分開）">日</span>
    </div>` : `<p class="sc-mro">正職應排 <b>${mc.target ? fmtH(mc.target) + ' 小時' : '未填'}</b>　國定假日 <b>${hol.length ? hol.join('、') + ' 日' : '無'}</b></p>`}
    <p class="sc-sub">應排時數用來比對正職員工（身分寫「正職」或空白）這個月「工時＋補／特休」的合計，兼職、工讀不比對。國定假日在部門「快速填入」時會自動排成「國定假日」。每個月各填一次，換月份用上面的 ‹ ›。</p>`;
}
function statusChip(name, m){
  const st = statusRec(m, deptRec(name));
  if (st && st.lock) return `<span class="chip">已鎖定 ${when(st.lockAt)}</span>`;
  if (st && st.st === 'sent') return `<span class="chip ok" title="${esc(st.sentBy || '')}">已送出 ${when(st.sentAt)}</span>`;
  if (st && st.st === 'draft') return `<span class="chip warn" title="${esc(st.editBy || '')}">填寫中${st.sentAt ? '（送出後又改過）' : ''}</span>`;
  return '<span class="chip">還沒送出</span>';
}
function confirmBtn(key, label, again, cls){
  const on = B.confirm === key;
  return `<button type="button" class="btn${on ? ' danger' : ''}${cls ? ' ' + cls : ''}" data-sc="${esc(key)}">${on ? again : label}</button>`;
}
function renderDepts(){
  const el = document.getElementById('sc-depts'), c = can(), names = deptNames(), all = staffAll();
  const noDept = all.filter(s => s.on !== false && !s.dept).length;
  if (!all.length) {
    el.innerHTML = `<div class="ov-h"><h2>各部門班表</h2></div><p class="sc-empty">還沒有員工名單。${c ? '先在下面「員工名單」貼上從 Apollo 匯出的員工資料，就會依部門列出來，再產生各部門的填寫連結。' : '請有「班表管理」權限的人匯入員工名單。'}</p>`;
    return;
  }
  const rows = names.map(name => {
    const d = deptRec(name), s = deptSummary(name, B.month), st = statusRec(B.month, d), live = d && d.t && d.on !== false, id = d ? d.id : '';
    const chk = !s.started ? '<span class="chip">—</span>' : s.errs ? `<span class="chip danger">${s.errs} 個問題</span>` : s.warns ? `<span class="chip warn">${s.warns} 項確認</span>` : '<span class="chip ok">符合</span>';
    const link = !c ? (live ? '已開放' : '未開放')
      : live ? `<button type="button" class="btn" data-sc="copy" data-d="${esc(name)}">複製連結</button>${confirmBtn('regen|' + id, '換新連結', '舊連結會失效，確定？')}${confirmBtn('off|' + id, '停用', '確定停用？')}`
      : `<button type="button" class="btn" data-sc="make" data-d="${esc(name)}">產生填寫連結</button>`;
    const lockBtn = !c || !s.staff.length ? '' : st && st.lock ? `<button type="button" class="btn" data-sc="unlock" data-d="${esc(name)}">解除鎖定</button>` : `<button type="button" class="btn" data-sc="lock" data-d="${esc(name)}" title="鎖定後部門連結只能看、不能改">鎖定</button>`;
    return `<tr${B.dept === name ? ' class="on"' : ''}>
      <th scope="row"><button type="button" class="link" data-sc="open" data-d="${esc(name)}">${esc(name)}</button></th>
      <td>${s.staff.length} 人</td><td>${s.staff.length ? `${s.full}/${s.staff.length} 人排滿` : '—'}</td>
      <td>${statusChip(name, B.month)}</td><td>${chk}</td>
      <td class="sc-acts">${link}</td>
      <td class="sc-acts"><button type="button" class="btn${B.dept === name ? ' primary' : ''}" data-sc="open" data-d="${esc(name)}">${B.dept === name ? '班表在下面' : '開啟班表'}</button>${lockBtn}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="ov-h"><h2>各部門班表</h2><span class="sc-sub">${+B.month.slice(5)} 月・部門主管用填寫連結填好後按「送出給人資」，確認沒問題再鎖定、匯出</span></div>
    ${noDept ? `<p class="sc-warn">有 ${noDept} 位在職員工沒有部門，班表連結看不到他們；請在下面「員工名單」填上部門。</p>` : ''}
    <div class="sc-tw"><table class="sc-t"><thead><tr><th scope="col">部門</th><th scope="col">人數</th><th scope="col">排班進度</th><th scope="col">狀態</th><th scope="col">工時檢查</th><th scope="col">填寫連結</th><th scope="col"><span class="sr-only">動作</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${c ? '<p class="foot-note">「複製連結」後用 LINE 或 Email 傳給部門主管；連結不用登入、只看得到自己部門。連結外流時按「換新連結」，舊的就不能用了。</p>' : ''}`;
}
function renderGrid(){
  const sec = document.getElementById('sc-gridsec');
  if (!B.dept || !deptNames().concat([NO_DEPT]).includes(B.dept)) { sec.hidden = true; B.grid = null; B.gridKey = ''; sec.innerHTML = ''; return; }
  sec.hidden = false;
  const m = B.month, staff = staffOfDept(B.dept, m), st = statusRec(m, deptRec(B.dept)), mc = monthCfg(m), c = can();
  const key = [B.dept, m, c, staff.map(s => s.id).join(',')].join('|');
  const data = Object.fromEntries(staff.map(s => [s.id, daysOf(m, s.id)])), ctx = Object.fromEntries(staff.map(s => [s.id, ctxOf(m, s.id)]));
  const opt = {month:m, staff:staff.map(s => ({id:s.id, name:s.name, title:s.title, kind:s.kind})), data, ctx, anchor:anchor(), target:Number(mc.target) || 0, hol:mc.hol || [], readOnly:!c, shifts:SC.shiftsFor(cfg().shifts, B.dept)};
  const head = `<div class="ov-h"><h2>${esc(B.dept)}　${+m.slice(0, 4)} 年 ${+m.slice(5)} 月班表</h2>${statusChip(B.dept, m)}<button type="button" class="btn icon" data-sc="close" aria-label="關閉班表" style="margin-left:auto">✕</button></div>
    <p class="sc-sub">${st && st.lock ? '已鎖定：部門連結只能看；人資在這裡改的會直接存。' : c ? '人資在這裡改的會直接存，部門連結重新整理後就看得到。' : '你沒有「班表管理」權限，只能查看。'}${st && st.sentBy ? `　送出：${esc(st.sentBy)}` : ''}</p>`;
  if (B.grid && B.gridKey === key && sec.querySelector('#sc-grid')) {
    sec.querySelector('.sc-head').innerHTML = head;
    if (!B.grid.editing()) B.grid.set(opt);
    return;
  }
  sec.innerHTML = `<div class="sc-head">${head}</div><div id="sc-grid"></div>`;
  B.gridKey = key;
  B.grid = SC.Grid(sec.querySelector('#sc-grid'), Object.assign(opt, {onChange:saveCells, onToast:toast}));
}
function saveCells(changes){
  const m = B.month, by = new Map();
  for (const c of changes) { if (!by.has(c.sid)) by.set(c.sid, []); by.get(c.sid).push(c); }
  const recs = [];
  for (const [sid, cs] of by) {
    const id = `${m}|${sid}`, cur = ST.get('sched', id), days = Object.assign({}, cur && cur.days);
    for (const c of cs) { if (c.v) days[c.dd] = c.v; else delete days[c.dd]; }
    recs.push(Object.assign({}, cur || {id, date:m, sid}, {dept:B.dept, days, updatedAt:Date.now(), updatedBy:me()}));
  }
  ST.saveMany('sched', recs);
}

/* ---------- 班別設定 ---------- */
const SH_COLS = [   // Apollo 班別清單的標題 → 欄位（依序找，先找到的優先）
  ['c', [/^班[別次](代碼|代號|編號)$/, /^(代碼|代號|編號)$/, /班[別次](代碼|代號|編號)/, /^班別$/, /^班次$/]],
  ['n', [/^班別名稱$/, /^名稱$/, /(班別|班次)名稱/, /說明|備註/]],
  ['s', [/^上班(時間)?$/, /上班|開始|起始|^起$/]],
  ['e', [/^下班(時間)?$/, /下班|結束|^迄$/]],
  ['b', [/^休息(時數|時間|小時|分鐘)?$/, /休息/]],
  ['d', [/適用部門|^部門/]]
];
const hm = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
function parseBreak(v, mins){
  v = String(v || '').trim();
  if (!v) return 0;
  const g = /(\d{1,2}[:：]?\d{0,2})\s*[-~～－–至到]\s*(\d{1,2}[:：]?\d{0,2})/.exec(v);   // 12:00-13:00 這種時段
  if (g) { const a = SC.parseTime(g[1]), b = SC.parseTime(g[2]); if (a && b) { let x = hm(b) - hm(a); if (x < 0) x += 1440; return Math.round(x / 60 * 100) / 100; } }
  const n = parseFloat(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round((mins || n > 12 ? n / 60 : n) * 100) / 100;
}
function parseShifts(text){
  text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const rows = lines.some(l => l.includes('\t')) ? lines.map(l => l.split('\t')) : parseCSV(text);
  const norm = v => String(v || '').replace(/[\s　]+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  const hi = rows.slice(0, 15).findIndex(r => r.some(c => /上班|開始|班[別次](代碼|代號|編號)/.test(norm(c))));
  if (hi < 0) return {err:'找不到標題列：要有「班次代碼」或「班別代碼」那一欄（請連標題列一起複製）'};
  const head = rows[hi].map(norm), map = {}, used = new Set();
  for (const [f, pats] of SH_COLS) for (const p of pats) { const i = head.findIndex((h, j) => !used.has(j) && p.test(h)); if (i >= 0) { map[f] = i; used.add(i); break; } }
  if (map.c == null && map.n == null) return {err:'找不到「班次代碼」或「班別代碼」欄'};
  const out = [], bad = [];
  for (const r of rows.slice(hi + 1)) {
    const g = f => map[f] == null ? '' : String(r[map[f]] == null ? '' : r[map[f]]).replace(/[\s　]+/g, ' ').trim();
    const code = SC.cleanCode(g('c') || g('n'));
    if (!code) continue;
    const rs = g('s').replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1'), re = g('e').replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
    const st = SC.parseTime(rs) || '', en = SC.parseTime(re) || '';
    if ((rs || re) && !(st && en)) bad.push(code);   // 時間看不懂：代碼照樣匯入，時間留空
    out.push({c:code, n:g('c') ? g('n').slice(0, 20) : '', s:st, e:en, b:parseBreak(g('b'), map.b != null && /分/.test(head[map.b])), d:g('d').slice(0, 200)});
  }
  if (!out.length) return {err:'標題列下面沒有資料'};
  return {rows:out, bad, head:Object.fromEntries(Object.entries(map).map(([f, i]) => [f, rows[hi][i]]))};
}
function shPreview(){
  const x = B.shImp;
  if (!x) return '';
  if (x.err) return `<p class="sc-warn" role="alert">${esc(x.err)}</p>`;
  const have = new Set(shiftsAll().map(s => s.c)), add = x.rows.filter(r => !have.has(r.c)).length;
  const L = {c:'代碼', n:'名稱', s:'上班', e:'下班', b:'休息', d:'適用部門'};
  return `<div class="sc-prev" role="status">
    <p>讀到 <b>${x.rows.length}</b> 種班別：新增 <b>${add}</b>、更新 <b>${x.rows.length - add}</b>。對到的欄位：${Object.entries(x.head).map(([f, h]) => `${L[f]}←「${esc(h)}」`).join('、')}</p>
    <p class="sc-sub">${x.rows.slice(0, 10).map(r => `${esc(r.c)} ${esc(r.s && r.e ? SC.shiftText(r) : r.n)}`).join('、')}${x.rows.length > 10 ? '…' : ''}</p>
    ${x.rows.some(r => !(r.s && r.e)) ? `<p class="sc-sub">${x.rows.filter(r => !(r.s && r.e)).length} 種沒有上下班時間：部門選這些班別時要自己填時間（之後會記住最常用的時間）；已經設定過時間的班別不會被清掉。</p>` : ''}
    ${x.bad.length ? `<p class="sc-sub">上下班時間看不懂（時間先留空）：${x.bad.slice(0, 8).map(esc).join('、')}</p>` : ''}
    <div class="sc-row"><button type="button" class="btn primary" data-sc="sh-import">匯入</button><button type="button" class="btn" data-sc="sh-cancel">取消</button></div></div>`;
}
const deptList = x => String(x.d || '').split(/[,，、;；\s]+/).filter(Boolean);
const shMatch = (x, q) => !q || (x.c + ' ' + x.n).toLowerCase().includes(q);
/** 選部門、勾班別：勾了＝把部門加進那個班別的「適用部門」 */
function shPickHTML(list, depts){
  if (!depts.length) return '';
  if (!depts.includes(B.shDept)) B.shDept = depts[0];
  const name = B.shDept, q = B.shQ.trim().toLowerCase(), has = x => deptList(x).includes(name);
  const picked = list.filter(has).length, open = list.filter(x => !x.d).length;
  const shown = list.filter(x => shMatch(x, q) && (!B.shOnly || has(x)));
  return `<div class="sc-shpick">
    <h3 class="sc-h3">選部門、勾班別</h3>
    <div class="sc-row">
      <label class="sc-f" for="sc-shd">部門</label><select class="inp" id="sc-shd">${depts.map(d => `<option${d === name ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select>
      <input class="inp" id="sc-shq2" type="search" placeholder="找代碼或名稱，例如：京、物流、A0" aria-label="找班別" value="${esc(B.shQ)}">
      <label class="sc-on"><input type="checkbox" id="sc-shonly"${B.shOnly ? ' checked' : ''}>只看已勾的</label>
    </div>
    <p class="sc-sub" role="status"><b>${esc(name)}</b> 已勾 <b>${picked}</b> 種${picked ? '：這個部門的主管只看得到勾的這些。' : `：還沒勾，主管看得到所有沒指定部門的班別（${open} 種）。`}勾了會馬上存。</p>
    <div class="sc-row"><button type="button" class="btn sm" data-sc="shk-all"${shown.length ? '' : ' disabled'}>列出的 ${shown.length} 種全部勾選</button><button type="button" class="btn sm" data-sc="shk-none"${shown.some(has) ? '' : ' disabled'}>列出的全部取消</button></div>
    <div class="sc-shk-list">${shown.map(x => {
      const on = has(x), others = deptList(x).filter(d => d !== name);
      return `<label class="sc-shk${on ? ' on' : ''}"><input type="checkbox" id="sc-shk-${esc(x.c)}" data-shk="${esc(x.c)}"${on ? ' checked' : ''}><b>${esc(x.c)}</b><span>${esc(x.n) || '（沒有名稱）'}</span>${others.length ? `<small>也給：${esc(others.join('、'))}</small>` : ''}</label>`;
    }).join('') || '<p class="sc-empty">找不到符合的班別</p>'}</div>
  </div>`;
}
/** 把部門加進／移出這些班別的「適用部門」 */
function setShiftDept(codes, on){
  const name = B.shDept, set = new Set(codes), list = shiftsAll();
  let n = 0;
  for (const x of list) {
    if (!set.has(x.c)) continue;
    const ds = deptList(x), i = ds.indexOf(name);
    if (on && i < 0) { ds.push(name); n++; }
    if (!on && i >= 0) { ds.splice(i, 1); n++; }
    x.d = ds.join(', ');
  }
  if (n) saveCfg({shifts:list});
  return n;
}
function renderShifts(){
  const el = document.getElementById('sc-shift'), list = shiftsAll(), c = can(), depts = deptNames();
  const box = el.querySelector('.sc-shk-list'), keepTop = box ? box.scrollTop : 0;   // 勾完重畫時清單不要跳回最上面
  el.querySelector('.sc-sum').textContent = `班別設定（${list.length ? list.length + ' 種' : '還沒設定'}）`;
  const rows = list.map((x, i) => {
    const h = x.s && x.e ? fmtH(SC.hoursOf({k:'w', s:x.s, e:x.e, b:x.b})) + ' 小時' : '—';
    if (!c) return `<tr><td><b>${esc(x.c)}</b></td><td>${esc(x.n)}</td><td>${SC.tShow(x.s) || '—'}</td><td>${SC.tShow(x.e) || '—'}</td><td>${x.s && x.e ? fmtH(x.b) : '—'}</td><td>${h}</td><td>${esc(x.d || '全部')}</td><td></td></tr>`;
    const inp = (f, v, w, extra) => `<input class="inp${w ? ' ' + w : ''}" data-sh="${i}" data-f="${f}" value="${esc(v)}" aria-label="${esc(x.c)} ${{c:'代碼', n:'名稱', s:'上班', e:'下班', b:'休息小時', d:'適用部門'}[f]}"${extra || ''}>`;
    return `<tr><td>${inp('c', x.c, 'sh-c', ' maxlength="12"')}</td><td>${inp('n', x.n, '', ' maxlength="20"')}</td><td>${inp('s', SC.tShow(x.s), 'sh-t', ' inputmode="decimal" placeholder="未設定"')}</td><td>${inp('e', SC.tShow(x.e), 'sh-t', ' inputmode="decimal" placeholder="未設定"')}</td>
      <td>${inp('b', fmtH(x.b), 'sh-t', ' inputmode="decimal"')}</td><td class="sh-h">${h}</td><td>${inp('d', x.d, '', ' list="sc-dl2" placeholder="全部"')}</td><td>${confirmBtn('sh-del|' + i, '刪除', '確定刪除？', 'sm')}</td></tr>`;
  }).join('');
  document.getElementById('sc-shift-body').innerHTML = `
    <p class="sc-sub">班別代碼要和 Apollo 的「班次代碼」一樣（匯入 Apollo 的上班日一定要有班次代碼）。部門有班別可以選時，排上班一定要選班別；有預設時間的會自動帶入，時間可以再調整。「適用部門」：有指定給某個部門的班別，那個部門就只看到指定給它的；一個都沒指定的部門，看到所有沒填適用部門的班別（多個部門用逗號分開）。建議每個部門都指定常用的幾種，選單會短很多。改班別設定不會改到已經排好的日子。</p>
    ${c ? `<div class="sc-imp">
      <p class="sc-sub">可以把 Apollo「班表匯入範本」的「班次代碼」工作表（班次代碼、班次名稱）<b>整張連標題列一起複製</b>貼到這裡；也可以多加「上班、下班、休息、適用部門」欄。休息可以是小時、分鐘或 12:00-13:00。代碼一樣的會更新。</p>
      <textarea class="inp" id="sc-sh-paste" data-keep="1" rows="3" placeholder="班次代碼	班次名稱&#10;A099	研發7點(休半小)"></textarea>
      <div class="sc-row"><button type="button" class="btn" data-sc="sh-parse">讀取貼上的內容</button><span class="sp"></span><button type="button" class="btn" data-sc="sh-add">新增一種班別</button></div>
      ${shPreview()}</div>` : ''}
    ${c && list.length ? shPickHTML(list, depts) : ''}
    ${list.length ? `<details class="sc-shall"${B.shAll || !c ? ' open' : ''}><summary>全部班別明細（改代碼、名稱、上下班時間、適用部門）</summary><div class="sc-tw"><table class="sc-t sc-staff sc-shifts"><thead><tr><th scope="col">代碼</th><th scope="col">名稱</th><th scope="col">上班</th><th scope="col">下班</th><th scope="col">休息（小時）</th><th scope="col">工時</th><th scope="col">適用部門</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody>${rows}</tbody></table></div></details>
      <datalist id="sc-dl2">${depts.map(d => `<option value="${esc(d)}">`).join('')}</datalist>` : `<p class="sc-empty">${c ? '還沒有班別：貼上 Apollo 的班別清單，或按「新增一種班別」。沒有設定班別時，部門要自己填上下班時間。' : '還沒有設定班別。'}</p>`}`;
  const nb = el.querySelector('.sc-shk-list'); if (nb && keepTop) nb.scrollTop = keepTop;
}
function editShift(t){
  const i = +t.dataset.sh, f = t.dataset.f, list = shiftsAll(), x = list[i];
  if (!x) return;
  let v = String(t.value).trim();
  if (f === 's' || f === 'e') { const pt = v ? SC.parseTime(v) : ''; if (pt === null) { toast('時間看不懂：請打 7、7.5、7:30 或 0730'); t.value = SC.tShow(x[f]); return; } v = pt; }
  else if (f === 'b') { const n = Number(v || 0); if (!isFinite(n) || n < 0 || n > 12) { toast('休息請填 0 到 12 之間的小時數'); t.value = fmtH(x.b); return; } v = Math.round(n * 100) / 100; }
  else if (f === 'c') { v = SC.cleanCode(v); if (!v || list.some((y, j) => j !== i && y.c === v)) { toast(v ? `代碼「${v}」已經有了` : '代碼不能空白'); t.value = x.c; return; } }
  x[f] = v;
  saveCfg({shifts:list});
}

/* ---------- 員工名單 ---------- */
function renderStaff(){
  const el = document.getElementById('sc-staff'), all = staffAll(), on = all.filter(s => s.on !== false).length, c = can();
  el.querySelector('.sc-sum').textContent = `員工名單（在職 ${on} 人${all.length > on ? `，離職 ${all.length - on} 人` : ''}）`;
  const q = B.q.toLowerCase(), list = all.filter(s => !q || [s.no, s.name, s.dept, s.title, s.kind].some(x => String(x || '').toLowerCase().includes(q)));
  const depts = [...new Set(all.map(s => s.dept).filter(Boolean))];
  const imp = c ? `<div class="sc-imp">
      <p class="sc-sub">從 Apollo 匯出員工清單（Excel），<b>整張表連標題列一起複製</b>貼到下面（或選 CSV 檔）。會找「員工編號、姓名、部門、職稱、員工類別、離職日」這幾欄，其他欄位（身分證、生日等）不會存。用員工編號對應：已經有的人會更新，新的人會加入。</p>
      <textarea class="inp" id="sc-paste" data-keep="1" rows="4" placeholder="員工編號	姓名	部門	職稱	員工類別&#10;A0101	王小明	研發部	研發	正職"></textarea>
      <div class="sc-row"><button type="button" class="btn" data-sc="parse">讀取貼上的內容</button><label class="btn"><input type="file" id="sc-file" accept=".csv,.txt,text/csv,text/plain" hidden>選 CSV 檔</label><span class="sp"></span><button type="button" class="btn" data-sc="add-staff">手動新增一位</button></div>
      ${impPreview()}
    </div>` : '';
  const rows = list.map(s => `<tr${s.on === false ? ' class="off"' : ''}>
      <td>${c ? `<input class="inp" data-sid="${esc(s.id)}" data-f="no" value="${esc(s.no || '')}" maxlength="20" aria-label="${esc(s.name)} 員工編號">` : esc(s.no || '')}</td>
      <td>${c ? `<input class="inp" data-sid="${esc(s.id)}" data-f="name" value="${esc(s.name)}" maxlength="40" aria-label="${esc(s.name)} 姓名">` : esc(s.name)}</td>
      <td>${c ? `<input class="inp" data-sid="${esc(s.id)}" data-f="dept" value="${esc(s.dept || '')}" maxlength="40" list="sc-dl" aria-label="${esc(s.name)} 部門">` : esc(s.dept || '')}</td>
      <td>${c ? `<input class="inp" data-sid="${esc(s.id)}" data-f="title" value="${esc(s.title || '')}" maxlength="40" aria-label="${esc(s.name)} 職稱">` : esc(s.title || '')}</td>
      <td>${c ? `<input class="inp" data-sid="${esc(s.id)}" data-f="kind" value="${esc(s.kind || '')}" maxlength="20" list="sc-kl" aria-label="${esc(s.name)} 身分">` : esc(s.kind || '')}</td>
      <td>${c ? `<label class="sc-on"><input type="checkbox" data-sid="${esc(s.id)}" data-f="on" aria-label="${esc(s.name)} 在職"${s.on !== false ? ' checked' : ''}>在職</label>` : s.on !== false ? '在職' : '離職'}</td>
      <td>${c ? confirmBtn('del|' + s.id, '刪除', '確定刪除？', 'sm') : ''}</td></tr>`).join('');
  document.getElementById('sc-staff-body').innerHTML = `${imp}
    ${all.length ? `<div class="sc-row"><input class="inp" id="sc-q" type="search" placeholder="搜尋編號、姓名、部門" aria-label="搜尋員工" value="${esc(B.q)}"></div>
    <div class="sc-tw"><table class="sc-t sc-staff"><thead><tr><th scope="col">員工編號</th><th scope="col">姓名</th><th scope="col">部門</th><th scope="col">職稱</th><th scope="col">身分</th><th scope="col">在職</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody>${rows || '<tr><td colspan="7">找不到符合的員工</td></tr>'}</tbody></table></div>
    <datalist id="sc-dl">${depts.map(d => `<option value="${esc(d)}">`).join('')}</datalist><datalist id="sc-kl"><option value="正職"><option value="兼職"><option value="工讀"></datalist>
    <p class="foot-note">身分寫「正職」（或空白）的人會和「正職應排」時數比對；兼職、工讀不比對。離職的人班表連結看不到，已經排的班表會留著。</p>` : ''}`;
}

const COLS = [   // Apollo 匯出的標題 → 欄位（依序找，先找到的優先）
  ['no',    [/^(員工)?(編號|代號|工號|代碼)$/, /^員編$/, /^員工(編號|代號|代碼)/, /^工號/]],
  ['name',  [/^(員工)?姓名$/, /^中文姓名$/, /^(?!.*(英文|聯絡|緊急)).*姓名/]],
  ['dept',  [/^部門名稱$/, /^部門$/, /^(所屬|任職)?部門(?!.*(代號|代碼|編號))/, /^單位名稱$/, /^單位$/]],
  ['title', [/^職稱(名稱)?$/, /職稱(?!.*(代號|代碼))/, /^職務$|^職位$/]],
  ['kind',  [/員工類別|員工身[分份]別?$|[雇僱聘]用類別|聘僱類別|員工型態|任用類別|身[分份]類別/]],
  ['end',   [/離職日/]]
];
function parseCSV(text){
  const rows = [[]]; let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { rows[rows.length - 1].push(cur); cur = ''; }
    else if (ch === '\n') { rows[rows.length - 1].push(cur); cur = ''; rows.push([]); }
    else if (ch !== '\r') cur += ch;
  }
  rows[rows.length - 1].push(cur);
  return rows;
}
function parseStaff(text){
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const rows = lines.some(l => l.includes('\t')) ? lines.map(l => l.split('\t')) : parseCSV(text);
  const norm = s => String(s || '').replace(/[\s　]+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  const hi = rows.slice(0, 15).findIndex(r => r.some(c => /姓名/.test(norm(c))));
  if (hi < 0) return {err:'找不到標題列：要有「姓名」那一欄（請連標題列一起複製）'};
  const head = rows[hi].map(norm), map = {}, used = new Set();
  for (const [f, pats] of COLS) for (const p of pats) { const i = head.findIndex((h, j) => !used.has(j) && p.test(h)); if (i >= 0) { map[f] = i; used.add(i); break; } }
  if (map.name == null) return {err:'找不到「姓名」欄'};
  const today = todayStr(), out = [];
  for (const r of rows.slice(hi + 1)) {
    const g = f => map[f] == null ? '' : String(r[map[f]] == null ? '' : r[map[f]]).replace(/[\s　]+/g, ' ').trim();
    const name = g('name');
    if (!name) continue;
    const endRaw = g('end').replace(/\//g, '-'), em = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(endRaw);
    const end = em ? `${em[1]}-${pad(em[2])}-${pad(em[3])}` : '';
    out.push({no:g('no').slice(0, 20), name:name.slice(0, 40), dept:g('dept').slice(0, 40), title:g('title').slice(0, 40), kind:g('kind').slice(0, 20), on: !(end && end <= today)});
  }
  if (!out.length) return {err:'標題列下面沒有資料'};
  return {rows:out, cols:Object.keys(map).filter(f => f !== 'end' || map.end != null), head:Object.fromEntries(Object.entries(map).map(([f, i]) => [f, rows[hi][i]]))};
}
function matchStaff(r, all){
  return (r.no && all.find(s => s.no && s.no === r.no)) || all.find(s => !(r.no && s.no) && s.name === r.name && (s.dept || '') === (r.dept || '')) || null;
}
function impPlan(){
  const all = staffAll(), plan = {add:[], upd:[], same:0, off:[]};
  for (const r of B.imp.rows) {
    const s = matchStaff(r, all);
    if (!s) { plan.add.push(r); continue; }
    const next = Object.assign({}, s, {no:r.no || s.no || '', name:r.name, dept:r.dept || s.dept || '', title:r.title || s.title || '', kind:r.kind || s.kind || '', on:r.on});
    if (['no', 'name', 'dept', 'title', 'kind', 'on'].some(f => (s[f] === false ? false : s[f] || (f === 'on' ? true : '')) !== next[f])) plan.upd.push(next); else plan.same++;
  }
  const nos = new Set(B.imp.rows.map(r => r.no).filter(Boolean));
  if (nos.size) plan.off = all.filter(s => s.on !== false && s.no && !nos.has(s.no));
  return plan;
}
function impPreview(){
  if (!B.imp) return '';
  if (B.imp.err) return `<p class="sc-warn" role="alert">${esc(B.imp.err)}</p>`;
  const p = impPlan(), L = {no:'員工編號', name:'姓名', dept:'部門', title:'職稱', kind:'身分', end:'離職日'};
  return `<div class="sc-prev" role="status">
    <p>讀到 <b>${B.imp.rows.length}</b> 位：新增 <b>${p.add.length}</b>、更新 <b>${p.upd.length}</b>、沒變 ${p.same}。對到的欄位：${Object.entries(B.imp.head).map(([f, h]) => `${L[f]}←「${esc(h)}」`).join('、')}${B.imp.head.no ? '' : '<br><b>沒有員工編號欄</b>：之後匯出給 Apollo 需要員工編號，建議從 Apollo 匯出含員工編號的清單。'}</p>
    ${p.add.length ? `<p class="sc-sub">新增：${p.add.slice(0, 12).map(r => esc(r.name)).join('、')}${p.add.length > 12 ? '…' : ''}</p>` : ''}
    ${p.off.length ? `<label class="sc-on"><input type="checkbox" id="sc-imp-off">名單裡沒有的 ${p.off.length} 位在職員工標成離職（${p.off.slice(0, 6).map(s => esc(s.name)).join('、')}${p.off.length > 6 ? '…' : ''}）</label>` : ''}
    <div class="sc-row"><button type="button" class="btn primary" data-sc="import"${p.add.length + p.upd.length || p.off.length ? '' : ' disabled'}>匯入</button><button type="button" class="btn" data-sc="imp-cancel">取消</button></div></div>`;
}
function runImport(){
  const p = impPlan(), all = staffAll(), t = Date.now(), by = me();
  let order = all.reduce((n, s) => Math.max(n, Number(s.order) || 0), 0);
  const recs = p.upd.map(s => Object.assign(s, {updatedAt:t, updatedBy:by}))
    .concat(p.add.map(r => Object.assign({id:rid('s-'), order:++order, updatedAt:t, updatedBy:by}, r)));
  const off = document.getElementById('sc-imp-off');
  if (off && off.checked) p.off.forEach(s => recs.push(Object.assign({}, s, {on:false, updatedAt:t, updatedBy:by})));
  ST.saveMany('staff', recs);
  B.imp = null;
  const ta = document.getElementById('sc-paste'); if (ta) ta.value = '';
  toast(`員工名單：新增 ${p.add.length} 位、更新 ${p.upd.length} 位${off && off.checked ? `、${p.off.length} 位標成離職` : ''}`);
  render();
}
function renderSet(){
  const c = can();
  document.getElementById('sc-set-body').innerHTML = `
    <div class="sc-row"><label class="sc-f">四週變形起算日<input class="inp" type="date" id="sc-anchor" value="${esc(anchor())}"${c ? '' : ' disabled'}></label></div>
    <p class="sc-sub">每 4 週（28 天）一個週期從這天開始算：週期內正常工時不超過 160 小時、例假＋休息日至少 8 天，前後兩週各至少 2 天例假。請設成公司實際採用的變形工時起算日（預設 ${SC.DEFAULT_ANCHOR}）。</p>
    <h3 class="sc-h3">匯出 Apollo 的狀態代碼</h3>
    <p class="sc-sub">上班 W0001（要有班次代碼）、休息日 H0002、例假 H0003 固定；下面兩種看公司在 Apollo 怎麼用：</p>
    <div class="sc-row sc-mrow">
      <label class="sc-f sc-big" for="sc-ap-H">國定假日</label><select class="inp" id="sc-ap-H"${c ? '' : ' disabled'}>${apOpts(apMap().H, ['H0001', 'M0002'])}</select>
      <label class="sc-f sc-big" for="sc-ap-L">請假（整天）</label><select class="inp" id="sc-ap-L"${c ? '' : ' disabled'}>${apOpts(apMap().L, ['H0001'])}</select>
    </div>
    <p class="sc-sub">選「不匯出」的日子不會出現在匯入檔裡（請假請在 Apollo 另外請假）。</p>`;
}
const apMap = () => Object.assign({}, SC.APOLLO_DEF, cfg().apollo || {});
function apOpts(cur, codes){
  return [['', '不匯出']].concat(SC.APOLLO_STATUS.filter(([k]) => codes.includes(k))).map(([k, t]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${k ? `${k} ${t}` : t}</option>`).join('');
}

/* ---------- 動作 ---------- */
function setConfirm(key){ B.confirm = key; clearTimeout(B.confirmT); B.confirmT = setTimeout(() => { B.confirm = ''; render(); }, 5000); render(); }
function ensureDept(name){
  let d = deptRec(name);
  if (!d) { d = {id:rid('d-'), name, t:'', on:true, at:Date.now(), by:me()}; ST.save('depts', d); }
  return d;
}
async function copyLink(name){
  const d = deptRec(name);
  if (!d || !d.t) return;
  const url = linkOf(d.t);
  try { await navigator.clipboard.writeText(url); toast(`已複製「${name}」的填寫連結，傳給部門主管就可以了`); }
  catch { window.prompt(`「${name}」的填寫連結（請複製）`, url); }
}
function setStatus(name, patch){
  const d = ensureDept(name), id = `${B.month}|_d|${d.id}`, cur = ST.get('sched', id) || {id, date:B.month, dept:name};
  ST.save('sched', Object.assign({}, cur, patch, {dept:name, updatedAt:Date.now(), updatedBy:me()}));
}
function saveMonthCfg(patch){
  const id = `${B.month}|_m`, cur = ST.get('sched', id) || {id, date:B.month};
  ST.save('sched', Object.assign({}, cur, patch, {updatedAt:Date.now(), updatedBy:me()}));
}
function onAct(act, el){
  const name = el.dataset.d || '';
  const [kind, arg] = act.split('|');
  switch (kind) {
    case 'prev': case 'next': B.month = SC.shiftMonth(B.month, kind === 'prev' ? -1 : 1); B.grid = null; B.gridKey = ''; render(); break;
    case 'open': B.dept = B.dept === name ? '' : name; render(); if (B.dept) setTimeout(() => { const s = document.getElementById('sc-gridsec'); if (s) s.scrollIntoView({behavior:'smooth', block:'start'}); }, 30); break;
    case 'close': B.dept = ''; render(); break;
    case 'make': { const d = ensureDept(name); ST.save('depts', Object.assign({}, deptRec(name) || d, {t:newToken(), on:true, at:Date.now(), by:me()})); copyLink(name); render(); break; }
    case 'copy': copyLink(name); break;
    case 'regen': case 'off': {
      if (B.confirm !== act) { setConfirm(act); return; }
      B.confirm = '';
      const d = deptRecs().find(x => x.id === arg); if (!d) return;
      if (kind === 'regen') { ST.save('depts', Object.assign({}, d, {t:newToken(), on:true, at:Date.now(), by:me()})); copyLink(d.name); }
      else { ST.save('depts', Object.assign({}, d, {t:'', on:false, at:Date.now(), by:me()})); toast(`已停用「${d.name}」的填寫連結`); }
      render(); break;
    }
    case 'lock': setStatus(name, {lock:true, lockAt:Date.now(), lockBy:me()}); toast(`已鎖定「${name}」${+B.month.slice(5)} 月班表，部門連結只能看`); render(); break;
    case 'unlock': setStatus(name, {lock:false}); toast(`已解除鎖定，「${name}」可以再修改`); render(); break;
    case 'parse': { const ta = document.getElementById('sc-paste'); B.imp = parseStaff(ta ? ta.value : ''); render(); break; }
    case 'imp-cancel': B.imp = null; render(); break;
    case 'import': runImport(); break;
    case 'add-staff': {
      const all = staffAll(), s = {id:rid('s-'), no:'', name:'新員工', dept:B.dept && B.dept !== NO_DEPT ? B.dept : '', title:'', kind:'正職', on:true, order:all.reduce((n, x) => Math.max(n, Number(x.order) || 0), 0) + 1, updatedAt:Date.now(), updatedBy:me()};
      ST.save('staff', s); B.q = ''; render();
      setTimeout(() => { const i = document.querySelector(`#sc-staff [data-sid="${CSS.escape(s.id)}"][data-f="name"]`); if (i) { i.focus(); i.select(); } }, 30);
      break;
    }
    case 'del': {
      if (B.confirm !== act) { setConfirm(act); return; }
      B.confirm = ''; ST.remove('staff', arg); toast('已刪除（已經排的班表會留著）'); render(); break;
    }
    case 'shk-all': case 'shk-none': {
      const q = B.shQ.trim().toLowerCase(), on = kind === 'shk-all';
      const codes = shiftsAll().filter(x => shMatch(x, q) && (!B.shOnly || deptList(x).includes(B.shDept))).map(x => x.c);
      const n = setShiftDept(codes, on);
      toast(n ? `${B.shDept}：${on ? '勾選' : '取消'} ${n} 種班別` : '沒有要改的');
      render(); break;
    }
    case 'sh-parse': { const ta = document.getElementById('sc-sh-paste'); B.shImp = parseShifts(ta ? ta.value : ''); render(); break; }
    case 'sh-cancel': B.shImp = null; render(); break;
    case 'sh-import': {
      const list = shiftsAll(), n0 = list.length;
      for (const x of B.shImp.rows) {
        const i = list.findIndex(y => y.c === x.c), o = list[i], t = x.s && x.e;
        if (i >= 0) list[i] = Object.assign({}, o, {n: x.n || o.n, s: t ? x.s : o.s, e: t ? x.e : o.e, b: t ? x.b : o.b, d: x.d || o.d});   // 貼上的沒有時間就保留原本的
        else list.push(x);
      }
      saveCfg({shifts:list}); toast(`班別：新增 ${list.length - n0} 種、更新 ${B.shImp.rows.length - (list.length - n0)} 種`);
      B.shImp = null; const ta = document.getElementById('sc-sh-paste'); if (ta) ta.value = ''; render(); break;
    }
    case 'sh-add': {
      const list = shiftsAll(); let n = list.length + 1; while (list.some(y => y.c === 'S' + n)) n++;
      list.push({c:'S' + n, n:'', s:'08:00', e:'17:00', b:1, d:''}); saveCfg({shifts:list}); render();
      setTimeout(() => { const i = document.querySelector(`#sc-shift [data-sh="${list.length - 1}"][data-f="c"]`); if (i) { i.focus(); i.select(); } }, 30);
      break;
    }
    case 'sh-del': {
      if (B.confirm !== act) { setConfirm(act); return; }
      B.confirm = ''; const list = shiftsAll(); list.splice(+arg, 1); saveCfg({shifts:list}); toast('已刪除班別（已經排好的日子不受影響）'); render(); break;
    }
    case 'exp-apollo': exportApollo(); break;
    case 'exp-close': B.expMsg = ''; render(); break;
    case 'exp-detail': exportDetail(); break;
    case 'exp-matrix': exportMatrix(); break;
  }
}
function bind(root){
  root.addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (b && root.contains(b) && !b.closest('.sg')) onAct(b.dataset.sc, b); });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'sc-target') { const v = Number(t.value); saveMonthCfg({target: isFinite(v) && v > 0 && v <= 400 ? Math.round(v * 100) / 100 : 0}); }
    else if (t.id === 'sc-hol') {
      const max = SC.daysIn(B.month), list = [...new Set(String(t.value).split(/[,，、\s]+/).map(x => parseInt(x, 10)).filter(n => n >= 1 && n <= max))].sort((a, b) => a - b).map(pad);
      t.value = list.map(Number).join(', ');
      saveMonthCfg({hol:list});
    }
    else if (t.id === 'sc-anchor') { if (SC.isDate(t.value)) saveCfg({anchor:t.value}); }
    else if (t.id === 'sc-ap-H' || t.id === 'sc-ap-L') saveCfg({apollo:Object.assign(apMap(), {[t.id.slice(-1)]:t.value})});
    else if (t.dataset.sh != null && t.dataset.f) editShift(t);
    else if (t.dataset.shk) { setShiftDept([t.dataset.shk], t.checked); }
    else if (t.id === 'sc-shd') { B.shDept = t.value; render(); }
    else if (t.id === 'sc-shonly') { B.shOnly = t.checked; render(); }
    else if (t.id === 'sc-file' && t.files && t.files[0]) {
      const f = t.files[0];
      if (/\.xlsx?$/i.test(f.name)) { B.imp = {err:'請在 Excel 裡全選複製貼上，或另存成 CSV 再選'}; render(); return; }
      f.arrayBuffer().then(buf => { let s; try { s = new TextDecoder('utf-8', {fatal:true}).decode(buf); } catch { s = new TextDecoder('big5').decode(buf); } B.imp = parseStaff(s); t.value = ''; render(); });
    }
    else if (t.dataset.sid && t.dataset.f) {
      const s = ST.get('staff', t.dataset.sid); if (!s) return;
      const f = t.dataset.f, v = f === 'on' ? t.checked : String(t.value).replace(/\s+/g, ' ').trim();
      if (f === 'name' && !v) { t.value = s.name; return; }
      ST.save('staff', Object.assign({}, s, {[f]:v, updatedAt:Date.now(), updatedBy:me()}));
    }
  });
  root.addEventListener('input', e => {
    if (e.target.id === 'sc-q') { B.q = e.target.value.trim(); keep(document.getElementById('sc-staff'), renderStaff); }
    else if (e.target.id === 'sc-shq2') { B.shQ = e.target.value; keep(document.getElementById('sc-shift'), renderShifts); }
  });
  root.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('sc-shall')) B.shAll = e.target.open; }, true);
}

/* ---------- 匯出 ---------- */
let zipLib = null;
function loadJSZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipLib) zipLib = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    sc.onload = () => res(window.JSZip); sc.onerror = () => { zipLib = null; rej(new Error('載入失敗')); };
    document.head.appendChild(sc);
  });
  return zipLib;
}
const xesc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
/** 簡單的 .xlsx：一個工作表；文字一律存成文字（工號、班次代碼前面的 0 不會不見），日期存成 Excel 日期（yyyy/mm/dd） */
async function xlsxBlob(sheet, rows, widths){
  const JSZip = await loadJSZip(), z = new JSZip();
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const serial = d => (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
  const cell = (v, r, c) => {
    if (v == null || v === '') return '';
    const ref = colName(c) + (r + 1);
    if (v && typeof v === 'object' && v.date) return `<c r="${ref}" s="1"><v>${serial(v.date)}</v></c>`;
    return `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  };
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('');
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${xesc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  const cols = (widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData></worksheet>`);
  return z.generateAsync({type:'blob', compression:'DEFLATE', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function saveBlob(name, blob){
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function exportApollo(){
  const m = B.month, list = exportList().map(({s}) => ({no:s.no, name:s.name, days:daysOf(m, s.id)}));
  const {rows, skip} = SC.apolloRows(m, list, apMap());
  const notLocked = (B.dept ? [B.dept] : deptNames()).filter(n => staffOfDept(n, m).length && !(statusRec(m, deptRec(n)) || {}).lock);
  const warn = [];
  if (skip.noNo.length) warn.push(`沒有工號、沒匯出：${skip.noNo.slice(0, 8).map(esc).join('、')}${skip.noNo.length > 8 ? '…' : ''}（請在「員工名單」補工號）`);
  if (skip.noCode.length) warn.push(`上班沒有班次代碼、沒匯出 ${skip.noCode.length} 天：${skip.noCode.slice(0, 6).map(esc).join('、')}${skip.noCode.length > 6 ? '…' : ''}`);
  if (skip.noTime.length) warn.push(`上班沒有上下班時間、沒匯出 ${skip.noTime.length} 天`);
  if (skip.off) warn.push(`國定假日／請假照設定不匯出 ${skip.off} 天`);
  if (notLocked.length) warn.push(`還沒鎖定的部門：${notLocked.map(esc).join('、')}（部門之後再改，要重新匯出）`);
  if (!rows.length) { B.expMsg = `<b>${+m.slice(5)} 月沒有可以匯出的班表。</b>${warn.length ? '<ul>' + warn.map(w => `<li>${w}</li>`).join('') + '</ul>' : ''}`; render(); return; }
  try {
    const data = [SC.APOLLO_HEAD].concat(rows.map(r => [r[0], r[1], {date:r[2]}, r[3], r[4] || '', r[5] || '', r[6] || '']));
    const blob = await xlsxBlob('匯入檔', data, [10, 12, 14, 10, 10, 12, 12, 20, 12]);
    saveBlob(`Apollo班表匯入_${m}${B.dept ? '_' + B.dept : ''}.xlsx`, blob);
    B.expMsg = `<b>已匯出 Apollo 匯入檔：${rows.length} 筆（${new Set(rows.map(r => r[0])).size} 人）。</b>${warn.length ? '<ul>' + warn.map(w => `<li>${w}</li>`).join('') + '</ul>' : '全部的班都有匯出。'}`;
  } catch (err) {
    B.expMsg = `<b>匯出失敗：${esc(err && err.message || err)}</b>（要連網路載入 Excel 產生程式，請稍後再試）`;
  }
  render();
}
function csv(rows){ return '﻿' + rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n'); }
function download(name, text){
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], {type:'text/csv;charset=utf-8'}));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportList(){
  const names = B.dept ? [B.dept] : deptNames().concat(staffAll().some(s => s.on !== false && !s.dept) ? [NO_DEPT] : []);
  return names.flatMap(n => staffOfDept(n, B.month).map(s => ({s, dept:n})));
}
const hDec = t => t ? fmtH(Math.round((+t.slice(0, 2) + +t.slice(3, 5) / 60) * 100) / 100) : '';
function exportDetail(){
  const m = B.month, rows = [['員工編號', '姓名', '部門', '日期', '星期', '類別', '班別代碼', '上班時間', '下班時間', '休息時數', '工時', '加班時數', '假別', '請假時數', '備註']];
  let n = 0;
  for (const {s, dept} of exportList()) {
    const days = daysOf(m, s.id);
    for (const dd of SC.ddList(m)) {
      const d = days[dd], date = SC.dateOf(m, dd);
      if (!d) continue;
      n++;
      rows.push([s.no || '', s.name, dept, date.replace(/-/g, '/'), SC.WD[SC.wday(date)], SC.KIND_LABEL[d.k], d.c || '', d.s || '', d.e || '', d.k === 'w' ? fmtH(d.b || 0) : '', d.k === 'w' ? fmtH(SC.hoursOf(d)) : '', d.ot ? fmtH(d.ot) : '', d.lt || '', d.lv ? fmtH(d.lv) : '', d.n || '']);
    }
  }
  if (!n) { toast('這個月還沒有任何班表可以匯出'); return; }
  download(`班表明細_${m}${B.dept ? '_' + B.dept : ''}.csv`, csv(rows));
  const missing = exportList().filter(x => !x.s.no).length;
  toast(`已匯出 ${n} 筆${missing ? `；有 ${missing} 位沒有員工編號，匯入 Apollo 前請補上` : ''}`);
}
function exportMatrix(){   // 跟原本的 Excel 班表一樣：一個人 8 列（班別、上班、下班、休息、時數、補/特休、加班、實際工時），時間用小數（7.5＝7:30）
  const m = B.month, dds = SC.ddList(m), mc = monthCfg(m);
  const rows = [[`${+m.slice(0, 4)} 年 ${+m.slice(5)} 月班表${mc.target ? `（正職應排 ${fmtH(mc.target)} 小時）` : ''}`], ['員工編號', '姓名', '部門', '項目'].concat(dds.map(dd => `${+dd}(${SC.WD[SC.wday(SC.dateOf(m, dd))]})`), ['合計'])];
  const list = exportList();
  if (!list.length) { toast('這個月沒有員工可以匯出'); return; }
  for (const {s, dept} of list) {
    const days = daysOf(m, s.id), row = (label, f, total) => {
      let sum = 0;
      const cells = dds.map(dd => { const d = days[dd]; const v = d ? f(d) : ''; if (typeof v === 'number') sum += v; return typeof v === 'number' ? (v ? fmtH(v) : '') : v; });
      return [s.no || '', s.name, dept, label].concat(cells, [total ? fmtH(Math.round(sum * 100) / 100) : '']);
    };
    rows.push(row('班別', d => d.k === 'w' ? d.c || '' : d.k === 'L' ? (d.lt || '請假') : SC.KIND_LABEL[d.k]));
    rows.push(row('上班', d => d.k === 'w' ? hDec(d.s) : ''));
    rows.push(row('下班', d => d.k === 'w' ? hDec(d.e) : ''));
    rows.push(row('休息', d => d.k === 'w' ? (d.b || 0) : 0, true));
    rows.push(row('時數', d => SC.hoursOf(d), true));
    rows.push(row('補/特休', d => d.lv || 0, true));
    rows.push(row('加班', d => d.ot || 0, true));
    rows.push(row('實際工時', d => SC.hoursOf(d) + (d.ot || 0), true));
  }
  download(`班表總表_${m}${B.dept ? '_' + B.dept : ''}.csv`, csv(rows));
  toast(`已匯出 ${list.length} 位的班表總表`);
}

window.HRSched = {
  init: ctx => { B.ctx = ctx || {}; },
  render,
  badge: () => { try { return deptNames().filter(n => { const st = statusRec(B.month, deptRec(n)); return st && st.st === 'sent' && !st.lock; }).length; } catch { return 0; } },
  _test: {parseStaff, parseCSV}
};
})();

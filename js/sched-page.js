/*
 * 起士公爵｜部門班表填寫（sched.html，不用登入）
 * 網址：sched.html#t=部門連結代碼（人資在看板「班表」頁產生；代碼放在 # 後面，不會出現在伺服器紀錄）。
 * 讀班表 POST action=schInfo，存檔 POST action=schSave（只送有改的格子；send: true＝送出給人資）。
 * 格子、編輯視窗、工時檢查都在 sched-core.js（和看板共用）。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const T = (new URLSearchParams(location.hash.slice(1)).get('t') || '').toLowerCase();
const SC = window.SchedCore;
const $ = s => document.querySelector(s);
const esc = SC.esc;
const st = {info:null, err:'', busy:'', msg:'', msgCls:'', dirty:new Map(), grid:null, errs:0};
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const when = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const clone = o => JSON.parse(JSON.stringify(o || {}));

async function api(action, body){
  const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, t:T}, body || {}))});
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.message || '系統忙碌中，請稍後再試'), {code:j.error, info:j.info});
  return j;
}
let toastT = 0;
function toast(msg){ const t = $('#sp-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
const dirtyN = () => [...st.dirty.values()].reduce((n, s) => n + Object.keys(s).length, 0);

async function load(m){
  st.busy = 'load'; renderSave();
  try {
    const j = await api('schInfo', m ? {m} : {});
    st.info = j.info; st.err = ''; st.dirty.clear(); st.msg = ''; st.grid = null;
  } catch (e) { if (!st.info || e.code === 'expired') { st.info = null; st.err = e.message; } else { st.msg = e.message; st.msgCls = 'bad'; } }
  st.busy = '';
  render();
}

function statusOf(o){
  if (o.lock) return ['lock', '人資已鎖定'];
  if (o.st === 'sent') return ['sent', `已送出給人資${o.sentAt ? '（' + when(o.sentAt) + '）' : ''}`];
  if (o.st === 'draft') return ['', '填寫中（還沒送出）'];
  return ['', '還沒開始填'];
}
function render(){
  const main = $('#sp');
  if (!T || !/^[a-f0-9]{32}$/.test(T)) { main.innerHTML = '<div class="ap-done"><h1>連結不完整</h1><p>請直接點人資傳給您的整個連結打開。</p></div>'; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開班表</h1><p>${esc(st.err)}</p></div>`; return; }
  const o = st.info;
  if (!o) { main.innerHTML = '<p class="ap-loading">讀取班表…</p>'; return; }
  const [y, m] = o.month.split('-'), [cls, label] = statusOf(o);
  const info = [
    o.target ? `本月正職應排 <b>${SC.fmtH(o.target)}</b> 小時` : '',
    o.hol.length ? `國定假日：${o.hol.map(d => +d).join('、')} 日` : '',
    o.last && o.last.at ? `最後修改：${esc(o.last.by)} ${when(o.last.at)}` : ''
  ].filter(Boolean).join('　・　');
  main.innerHTML = `
    <div class="sp-head"><h1>${esc(o.dept)}　${+y} 年 ${+m} 月班表</h1><span class="sp-st ${cls}" id="sp-st">${esc(label)}</span></div>
    <div class="sp-months" role="group" aria-label="選月份">${o.months.map(mm => `<button type="button" data-m="${mm}" aria-pressed="${mm === o.month}">${+mm.slice(5)} 月</button>`).join('')}</div>
    ${o.lock ? '<p class="sp-locked">人資已經鎖定這個月的班表，只能查看；需要調整請聯絡人資。</p>' : ''}
    ${info ? `<p class="sp-info">${info}</p>` : ''}
    <div id="sp-grid"></div>
    ${o.lock ? '' : `<div class="sp-save" id="sp-save"></div>`}`;
  st.grid = SC.Grid($('#sp-grid'), {
    month:o.month, staff:o.staff, data:clone(o.data), ctx:o.ctx, anchor:o.anchor, target:o.target, hol:o.hol, readOnly:o.lock, shifts:o.shifts || [],
    onChange: changes => { for (const c of changes) { const s = st.dirty.get(c.sid) || {}; s[c.dd] = c.v; st.dirty.set(c.sid, s); } st.msg = ''; renderSave(); },
    onIssues: n => { st.errs = n; },
    onToast: toast
  });
  renderSave();
}
function renderSave(){
  const b = $('#sp-save');
  if (!b || !st.info) return;
  const n = dirtyN(), busy = !!st.busy, sent = st.info.st === 'sent';
  const msg = st.msg || (busy ? (st.busy === 'load' ? '讀取中…' : '儲存中…') : n ? `有 ${n} 格還沒儲存` : sent ? '已送出給人資，之後修改要再按一次「送出給人資」' : '填好後按「送出給人資」');
  const cls = st.msg ? st.msgCls : n ? 'bad' : '';
  b.innerHTML = `<label class="sp-who">填寫人<input id="sp-who" maxlength="20" autocomplete="name" value="${esc(lsGet('sch_who'))}" placeholder="您的名字"></label>
    <span class="sp-msg ${cls}" role="status">${esc(msg)}</span>
    <button type="button" class="sg-btn" data-a="save"${busy || !n ? ' disabled' : ''}>儲存</button>
    <button type="button" class="sg-btn primary" data-a="send"${busy ? ' disabled' : ''}>送出給人資</button>`;
}
async function save(send){
  if (st.busy) return;
  const o = st.info;
  if (send && st.errs && !confirm(`工時檢查還有 ${st.errs} 個問題（列在班表下方）。確定要先送出給人資嗎？`)) return;
  const who = ($('#sp-who') || {}).value || '';
  lsSet('sch_who', who.trim());
  const rows = [...st.dirty.entries()].map(([sid, set]) => ({sid, set}));
  st.busy = 'save'; st.msg = ''; renderSave();
  try {
    const j = await api('schSave', {m:o.month, rows, who, send});
    st.info = j.info; st.dirty.clear();
    st.msg = send ? `已送出給人資（${when(Date.now())}）` : `已儲存（${when(Date.now())}）`; st.msgCls = 'ok';
    st.busy = '';
    const [cls, label] = statusOf(st.info), s = $('#sp-st');
    if (s) { s.className = 'sp-st ' + cls; s.textContent = label; }
    st.grid.set({data:clone(st.info.data), ctx:st.info.ctx, target:st.info.target, hol:st.info.hol, shifts:st.info.shifts || []});
  } catch (e) {
    st.busy = '';
    if (e.code === 'locked' && e.info) { st.info = e.info; st.dirty.clear(); render(); toast(e.message); return; }
    st.msg = (e.message || '儲存失敗') + '（修改還在，可以再按一次）'; st.msgCls = 'bad';
  }
  renderSave();
}

$('#sp').addEventListener('click', e => {
  const mb = e.target.closest('[data-m]');
  if (mb) {
    if (mb.dataset.m === st.info.month) return;
    if (dirtyN() && !confirm('有修改還沒儲存，換月份會放棄這些修改。確定要換嗎？')) return;
    load(mb.dataset.m);
    return;
  }
  const a = e.target.closest('[data-a]');
  if (a) save(a.dataset.a === 'send');
});
$('#sp').addEventListener('change', e => { if (e.target.id === 'sp-who') lsSet('sch_who', e.target.value.trim()); });
window.addEventListener('beforeunload', e => { if (dirtyN()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', () => location.reload());

if (!URL_) { st.err = '網站還沒設定雲端網址，請聯絡人資。'; render(); }
else if (!T || !/^[a-f0-9]{32}$/.test(T)) render();
else load('');
})();

/*
 * 起士公爵｜面試前一天提醒、Offer 確認（ok.html#t=代碼，不用登入）
 * 面試提醒（kind ivr）：「會準時到」「要改時間」（直接重選時段）「不來了」
 * Offer 確認（kind ofc）：「已收到、會準時報到」「報到日要調整」（點選想改的日期，可加備註）
 * 讀資料 POST action=tokInfo，回覆 POST action=tokReply；看板自動更新。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const T = (new URLSearchParams(location.hash.slice(1)).get('t') || '').toLowerCase();
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const st = { tok:null, err:'', busy:false, mode:'', slot:'', note:'', want:'', msg:'' };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function api(action, body){
  const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, t:T}, body || {}))});
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.message || '系統忙碌中，請稍後再試'), {code:j.error, tok:j.tok});
  return j;
}
const info = rows => `<div class="ob-info">${rows.filter(r => r[1]).map(([k, v]) => `<div class="ob-k">${k}</div><div class="ob-v">${esc(v)}</div>`).join('')}</div>`;
const dis = () => st.busy ? ' disabled' : '';

function ivrHTML(v){
  if (v.ans === 'no') return '<div class="ap-done"><h1>已收到您的回覆</h1><p>謝謝您告知，這次的面試已經幫您取消。</p><p>祝福您一切順利，期待未來有機會再見面。</p></div>';
  const when = `${dayLabel(v.date)} ${v.time}`;
  const done = v.ans === 'yes' ? `<p class="ob-msg">已收到：您會準時到。期待與您見面！</p>` : v.ans === 'change' ? `<p class="ob-msg">已幫您改到 ${esc(when)}。</p>` : '';
  let act;
  if (st.mode === 'change') {
    const slots = (v.slots || []).map(s => `<label class="rp-slot"><input type="radio" name="slot" value="${esc(s.id)}"${st.slot === s.id ? ' checked' : ''}> ${esc(dayLabel(s.date))} ${esc(s.time)}</label>`).join('');
    act = slots ? `<p class="rp-q">請選擇新的面試時段：</p><div class="rp-slots">${slots}</div><div class="ob-btns"><button class="ap-btn" type="button" data-go="change"${dis()}>${st.busy ? '送出中…' : '改到這個時段'}</button><button class="ob-b2" type="button" data-back${dis()}>返回</button></div>`
      : '<p class="rp-q">目前沒有其他可以選的時段，請直接在 104 聊聊告訴我們方便的時間。</p><div class="ob-btns"><button class="ob-b2" type="button" data-back>返回</button></div>';
  } else if (st.mode === 'no') {
    act = `<p class="rp-q">確定<b>不來面試</b>了嗎？</p><div class="ob-btns"><button class="ap-btn" type="button" data-go="no"${dis()}>${st.busy ? '送出中…' : '確定不來了'}</button><button class="ob-b2" type="button" data-back${dis()}>返回</button></div>`;
  } else {
    act = `<div class="ob-btns"><button class="ap-btn" type="button" data-go="yes"${dis()}>會準時到</button><button class="ob-b2" type="button" data-mode="change"${dis()}>要改時間</button><button class="ob-b2" type="button" data-mode="no"${dis()}>不來了</button></div>`;
  }
  return `<p class="ap-intro">${esc(v.name)} 您好，提醒您面試的時間快到了。</p>
    <section class="ap-sec"><h2>面試資訊</h2>${info([['面試時間', when], ['面試地點', v.place], ['應徵職務', v.job]])}</section>
    ${done}
    <section class="ap-sec"><h2>會準時到嗎？</h2>${act}</section>`;
}
function ofcHTML(v){
  const when = [v.date ? dayLabel(v.date) : '', v.time].filter(Boolean).join(' ');
  const done = v.ans === 'yes' ? '<p class="ob-msg">已收到：您會準時報到。歡迎加入！</p>' : v.ans === 'change' ? `<p class="ob-msg">已收到您想把報到日改到 ${esc(v.want ? dayLabel(v.want) : '其他日期')}${v.note ? `（${esc(v.note)}）` : ''}，人資會再和您聯絡。</p>` : '';
  const act = st.mode === 'change'
    ? `<label class="rp-q" for="rp-date">想改到哪一天？</label><input class="rp-note" type="date" id="rp-date" min="${ymd(new Date())}" value="${esc(st.want)}"${dis()}>
      <label class="rp-q" for="rp-note">其他想說的（可以不填）</label><textarea class="rp-note" id="rp-note" rows="2" maxlength="200" placeholder="例如：那週要考試，12/15 之後都可以">${esc(st.note)}</textarea><div class="ob-btns"><button class="ap-btn" type="button" data-go="change"${dis()}>${st.busy ? '送出中…' : '送出'}</button><button class="ob-b2" type="button" data-back${dis()}>返回</button></div>`
    : `<div class="ob-btns"><button class="ap-btn" type="button" data-go="yes"${dis()}>已收到，會準時報到</button><button class="ob-b2" type="button" data-mode="change"${dis()}>報到日要調整</button></div>`;
  return `<p class="ap-intro">${esc(v.name)} 您好，歡迎加入${esc(v.company)}！錄取通知書（Offer）已經寄到您的 Email，請確認報到資訊。</p>
    <section class="ap-sec"><h2>報到資訊</h2>${info([['報到時間', when || '另行通知'], ['報到地點', v.place], ['職務', v.job]])}</section>
    ${done}
    <section class="ap-sec"><h2>請確認</h2>${act}</section>`;
}
function render(){
  const main = $('#okp');
  if (!T || !/^[a-f0-9]{32}$/.test(T)) { main.innerHTML = '<div class="ap-done"><h1>連結不完整</h1><p>請從起士公爵傳給您的訊息，直接點整個連結打開。</p></div>'; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開這個連結</h1><p>${esc(st.err)}</p></div>`; return; }
  const v = st.tok;
  if (!v) { main.innerHTML = '<p class="ap-loading">讀取中…</p>'; return; }
  main.innerHTML = (v.kind === 'ofc' ? ofcHTML(v) : ivrHTML(v)) + (st.msg ? `<p class="ob-msg" role="status">${esc(st.msg)}</p>` : '');
}
document.addEventListener('change', e => { if (e.target.name === 'slot') st.slot = e.target.value; });
document.addEventListener('input', e => { if (e.target.id === 'rp-note') st.note = e.target.value; if (e.target.id === 'rp-date') st.want = e.target.value; });
document.addEventListener('change', e => { if (e.target.id === 'rp-date') st.want = e.target.value; });
document.addEventListener('click', async e => {
  if (st.busy) return;
  const m = e.target.closest('[data-mode]'); if (m) { st.mode = m.dataset.mode; st.msg = ''; render(); return; }
  if (e.target.closest('[data-back]')) { st.mode = ''; st.msg = ''; render(); return; }
  const g = e.target.closest('[data-go]'); if (!g) return;
  const ans = g.dataset.go, body = {ans};
  if (st.tok.kind === 'ivr' && ans === 'change') { if (!st.slot) { st.msg = '請先選一個新的時段。'; render(); return; } body.slotId = st.slot; }
  if (st.tok.kind === 'ofc' && ans === 'change') { if (!st.want) { st.msg = '請先點選想改的報到日期。'; render(); return; } body.date = st.want; body.note = st.note.trim(); }
  st.busy = true; st.msg = ''; render();
  try { st.tok = (await api('tokReply', body)).tok; st.mode = ''; st.slot = ''; st.want = ''; st.note = ''; }
  catch (err) {
    if (err.code === 'expired') st.err = err.message;
    else { if (err.tok) st.tok = err.tok; st.msg = navigator.onLine === false ? '目前沒有網路，連上網路後再按一次。' : (err.message || '送出失敗，請再按一次'); }
  }
  st.busy = false; render(); window.scrollTo(0, 0);
});

(async () => {
  if (!T || !/^[a-f0-9]{32}$/.test(T)) return render();
  try { st.tok = (await api('tokInfo')).tok; }
  catch (e) { st.err = e.code === 'expired' ? e.message : navigator.onLine === false ? '目前沒有網路，連上網路後再重新整理。' : '讀不到資料，請稍後再試。'; }
  render();
})();
})();

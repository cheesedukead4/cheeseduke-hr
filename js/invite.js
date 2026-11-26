/*
 * 起士公爵｜面試邀約回覆（invite.html?i=邀約 id，不用登入）
 * 看板送出的邀約訊息附這個連結。應徵者按「我有興趣，選擇面試時段」→ 記下有意願，帶到 apply.html?i=… 選時段、填資料；
 * 按「婉拒」→ 記下無意願（看板移到「婉拒或取消」，自動送感謝函）。讀資料 POST action=invInfo，回覆 POST action=invReply。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const I = (new URLSearchParams(location.search).get('i') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const st = { inv:null, err:'', busy:false, ask:false, msg:'' };

async function api(action, body){
  const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, i:I}, body || {}))});
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.message || '系統忙碌中，請稍後再試'), {code:j.error});
  return j;
}
const safeApply = u => /^https:\/\/[^\s"'<>]+\/apply\.html\?i=[A-Za-z0-9_-]+$/.test(u || '') ? u : '';

function render(){
  const main = $('#iv');
  if (!I || I.length < 4) { main.innerHTML = '<div class="ap-done"><h1>連結不完整</h1><p>請從起士公爵傳給您的訊息，直接點整個連結打開。</p></div>'; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開這個連結</h1><p>${esc(st.err)}</p></div>`; return; }
  const v = st.inv;
  if (!v) { main.innerHTML = '<p class="ap-loading">讀取中…</p>'; return; }
  if (v.booked) {
    main.innerHTML = `<div class="ap-done"><h1>您已經預約好面試了</h1><p class="when">${esc(dayLabel(v.booked.date))} ${esc(v.booked.time)}</p>${v.place ? `<p>面試地點：${esc(v.place)}</p>` : ''}<p>期待與您見面！如果需要改時間，請直接在 104 聊聊告訴我們。</p></div>`;
    return;
  }
  if (v.ans === 'no') {
    main.innerHTML = '<div class="ap-done"><h1>已收到您的回覆</h1><p>謝謝您撥冗告知，也謝謝您對我們的關注。</p><p>祝福您一切順利，期待未來有機會再合作。</p></div>';
    return;
  }
  const info = [['應徵職務', v.job || '—']].concat(v.place ? [['面試地點', v.place]] : [])
    .map(([k, val]) => `<div class="ob-k">${k}</div><div class="ob-v">${esc(val)}</div>`).join('');
  const btns = st.ask
    ? `<p class="rp-q">確定要<b>婉拒</b>這次的面試邀約嗎？</p><div class="ob-btns"><button class="ap-btn" type="button" data-no${st.busy ? ' disabled' : ''}>${st.busy ? '送出中…' : '確定婉拒'}</button><button class="ob-b2" type="button" data-back${st.busy ? ' disabled' : ''}>返回</button></div>`
    : `<div class="ob-btns"><button class="ap-btn" type="button" data-yes${st.busy ? ' disabled' : ''}>${st.busy ? '前往中…' : '我有興趣，選擇面試時段'}</button><button class="ob-b2" type="button" data-ask${st.busy ? ' disabled' : ''}>婉拒</button></div>`;
  main.innerHTML = `
    <p class="ap-intro">${esc(v.name)} 您好，謝謝您投遞${esc(v.company)}的職缺！我們看過您的履歷，誠摯邀請您來面試。</p>
    <section class="ap-sec"><h2>面試邀約</h2><div class="ob-info">${info}</div>
      <p class="sub">按「我有興趣」後，會帶您選擇方便的面試時段並填寫基本資料，大約 5 分鐘。</p></section>
    <section class="ap-sec"><h2>請告訴我們您的意願</h2>${btns}</section>
    ${st.msg ? `<p class="ob-msg" role="status">${esc(st.msg)}</p>` : ''}`;
}
document.addEventListener('click', async e => {
  if (st.busy) return;
  if (e.target.closest('[data-ask]')) { st.ask = true; st.msg = ''; render(); return; }
  if (e.target.closest('[data-back]')) { st.ask = false; render(); return; }
  const yes = e.target.closest('[data-yes]'), no = e.target.closest('[data-no]');
  if (!yes && !no) return;
  st.busy = true; render();
  try {
    const j = await api('invReply', {ans: yes ? 'yes' : 'no'});
    st.inv = j.inv; st.ask = false;
    if (yes && !j.inv.booked) { const u = safeApply(j.inv.apply); if (u) { location.href = u; return; } }
  } catch (err) {
    if (err.code === 'expired') st.err = err.message;
    else st.msg = navigator.onLine === false ? '目前沒有網路，連上網路後再按一次。' : (err.message || '送出失敗，請再按一次');
  }
  st.busy = false; render(); window.scrollTo(0, 0);
});

(async () => {
  if (!I || I.length < 4) return render();
  try { st.inv = (await api('invInfo')).inv; }
  catch (e) { st.err = e.code === 'expired' ? e.message : navigator.onLine === false ? '目前沒有網路，連上網路後再重新整理。' : '讀不到資料，請稍後再試。'; }
  render();
})();
})();

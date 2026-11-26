/*
 * 起士公爵｜錄取回覆（reply.html，不用登入）
 * 網址：reply.html#t=錄取回覆代碼（看板傳「錄取通知」時產生，附在 104 聊聊等訊息裡；代碼放在 # 後面，不會出現在伺服器紀錄）。
 * 讀錄取資訊（POST action=ofrInfo），新人按「接受錄取」或「婉拒」（POST action=ofrReply），看板自動把這位移到 Offer 或婉拒入職。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const T = (new URLSearchParams(location.hash.slice(1)).get('t') || '').toLowerCase();
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const st = { ofr:null, err:'', busy:false, ask:'', msg:'' };

async function api(action, body){
  const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, t:T}, body || {}))});
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.message || '系統忙碌中，請稍後再試'), {code:j.error, ofr:j.ofr});
  return j;
}

function render(){
  const main = $('#rp');
  if (!T || !/^[a-f0-9]{32}$/.test(T)) { main.innerHTML = '<div class="ap-done"><h1>連結不完整</h1><p>請從起士公爵傳給您的訊息，直接點整個連結打開。</p></div>'; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開這個連結</h1><p>${esc(st.err)}</p></div>`; return; }
  const o = st.ofr;
  if (!o) { main.innerHTML = '<p class="ap-loading">讀取中…</p>'; return; }
  if (o.ans === 'yes') {
    main.innerHTML = `<div class="ap-done"><h1>歡迎加入${esc(o.company)}！</h1><p>我們已經收到您<b>接受錄取</b>的回覆，謝謝您。</p><p>接下來人資會寄給您正式的錄取通知書（Offer）和報到資訊，請留意 Email 和 104 聊聊。</p></div>`;
    return;
  }
  if (o.ans === 'no') {
    main.innerHTML = '<div class="ap-done"><h1>已收到您的回覆</h1><p>謝謝您撥冗告知，也謝謝您對我們的關注。</p><p>祝福您一切順利，期待未來有機會再合作。</p></div>';
    return;
  }
  const info = [['錄取職務', o.job || '—']].concat(o.date ? [['預計報到日', dayLabel(o.date)]] : [])
    .map(([k, v]) => `<div class="ob-k">${k}</div><div class="ob-v">${esc(v)}</div>`).join('');
  const btns = st.ask === 'yes'
    ? `<p class="rp-q">確定<b>接受錄取</b>嗎？</p><div class="ob-btns"><button class="ap-btn" type="button" data-go="yes"${st.busy ? ' disabled' : ''}>${st.busy ? '送出中…' : '確定接受'}</button><button class="ob-b2" type="button" data-back${st.busy ? ' disabled' : ''}>返回</button></div>`
    : st.ask === 'no'
    ? `<p class="rp-q">確定要<b>婉拒</b>這次的錄取嗎？</p><div class="ob-btns"><button class="ap-btn" type="button" data-go="no"${st.busy ? ' disabled' : ''}>${st.busy ? '送出中…' : '確定婉拒'}</button><button class="ob-b2" type="button" data-back${st.busy ? ' disabled' : ''}>返回</button></div>`
    : '<div class="ob-btns"><button class="ap-btn" type="button" data-ask="yes">接受錄取</button><button class="ob-b2" type="button" data-ask="no">婉拒</button></div>';
  main.innerHTML = `
    <p class="ap-intro">${esc(o.name)} 您好，恭喜您通過甄選！我們誠摯邀請您加入${esc(o.company)}。</p>
    <section class="ap-sec"><h2>錄取資訊</h2><div class="ob-info">${info}</div>
      <p class="sub">正式聘僱條件和薪資福利，會在接受錄取後由人資寄送正式的錄取通知書（Offer）說明。</p></section>
    <section class="ap-sec"><h2>請告訴我們您的決定</h2>${btns}</section>
    ${st.msg ? `<p class="ob-msg" role="status">${esc(st.msg)}</p>` : ''}`;
}
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-ask]'), g = e.target.closest('[data-go]'), back = e.target.closest('[data-back]');
  if (a && !st.busy) { st.ask = a.dataset.ask; st.msg = ''; render(); return; }
  if (back && !st.busy) { st.ask = ''; render(); return; }
  if (!g || st.busy) return;
  st.busy = true; render();
  try { st.ofr = (await api('ofrReply', {ans:g.dataset.go})).ofr; st.ask = ''; }
  catch (err) {
    if (err.code === 'expired') st.err = err.message;
    else if (err.code === 'answered' && err.ofr) { st.ofr = err.ofr; st.msg = err.message; }
    else st.msg = navigator.onLine === false ? '目前沒有網路，連上網路後再按一次。' : (err.message || '送出失敗，請再按一次');
  }
  st.busy = false; render(); window.scrollTo(0, 0);
});

(async () => {
  if (!T || !/^[a-f0-9]{32}$/.test(T)) return render();
  try { st.ofr = (await api('ofrInfo')).ofr; }
  catch (e) { st.err = e.code === 'expired' ? e.message : navigator.onLine === false ? '目前沒有網路，連上網路後再重新整理。' : '讀不到資料，請稍後再試。'; }
  render();
})();
})();

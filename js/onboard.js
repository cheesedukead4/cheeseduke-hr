/*
 * 起士公爵｜新進同仁報到資料（onboard.html，不用登入）
 * 網址：onboard.html#t=報到連結代碼（看板「傳報到連結」產生，104 小幫手用聊聊送給新人；代碼放在 # 後面，不會出現在伺服器紀錄）。
 * 讀報到資訊（POST action=onbInfo），新人拍照或選檔上傳（POST action=onbUp），照片先在手機上縮小再傳。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const T = (new URLSearchParams(location.hash.slice(1)).get('t') || '').toLowerCase();
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const HELP = {
  id_front: '有照片的那一面，四個角都要拍進去、字要清楚。',
  id_back: '有地址的那一面。',
  bank: '要轉帳薪資的帳戶，拍封面（有戶名、帳號那一頁）。',
  photo: '近半年、正面、清楚的照片，背景單純即可。',
  health: '新進人員體檢報告或健康證明，可以拍照或上傳 PDF。',
  cert: '最高學歷畢業證書，或跟工作有關的證照；有好幾張可以合成一個 PDF。'
};
const st = { onb:null, err:'', busy:'', msg:'', slot:'' };

async function api(action, body){
  const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({action, t:T}, body || {}))});
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.message || '系統忙碌中，請稍後再試'), {code:j.error});
  return j;
}
/** 照片縮到長邊 1800、轉 JPEG，大約 1MB 以內 */
async function prepare(file){
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file;
  let url = '';
  try {
    url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, 1800 / Math.max(w, h));
    if (sc === 1 && file.size < 1.2e6 && ALLOWED.includes(file.type)) return file;
    const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return b || file;
  } catch { return file; }
  finally { if (url) URL.revokeObjectURL(url); }
}
const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });

function render(){
  const main = $('#ob');
  if (!T || !/^[a-f0-9]{32}$/.test(T)) { main.innerHTML = `<div class="ap-done"><h1>連結不完整</h1><p>請從起士公爵傳給您的訊息，直接點整個連結打開。</p></div>`; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開報到資料</h1><p>${esc(st.err)}</p><p>如果需要協助，請在 104 聊聊回覆起士公爵人資。</p></div>`; return; }
  const o = st.onb;
  if (!o) { main.innerHTML = '<p class="ap-loading">讀取報到資料…</p>'; return; }
  const req = o.slots.filter(s => s.required), done = req.filter(s => s.done).length, all = done === req.length;
  const info = [
    ['報到日期', o.date ? dayLabel(o.date) : '另行通知'], ['報到時間', o.time || '另行通知'], ['報到地點', o.place || '另行通知']
  ].map(([k, v]) => `<div class="ob-k">${k}</div><div class="ob-v">${esc(v)}</div>`).join('');
  main.innerHTML = `
    <p class="ap-intro">${esc(o.name)} 您好，歡迎加入起士公爵！請在報到前用手機把下面的文件拍照上傳，報到當天就不用再準備影本。</p>
    <section class="ap-sec"><h2>報到資訊</h2><div class="ob-info">${info}</div>${o.note ? `<p class="ob-note">${esc(o.note)}</p>` : ''}</section>
    <section class="ap-sec"><h2>上傳文件 <span class="n">必要 ${done}／${req.length}</span></h2>
      <p class="sub">每一項按「拍照」用手機相機拍，或按「選檔案」選手機裡的照片、PDF。拍錯可以重新上傳。</p>
      <ul class="ob-slots">${o.slots.map(slotHTML).join('')}</ul>
    </section>
    ${st.msg ? `<p class="ob-msg" role="status">${esc(st.msg)}</p>` : ''}
    ${all ? `<div class="ap-done"><h1>必要文件都收到了</h1><p>謝謝您！人資確認後如果還需要補件，會在 104 聊聊通知您。</p><p class="ob-exp">這個連結到 ${esc(new Date(o.exp).toLocaleDateString('zh-TW'))} 前都可以再補傳或換檔。</p></div>` : ''}`;
}
function slotHTML(s){
  const busy = st.busy === s.key;
  return `<li class="ob-slot${s.done ? ' done' : ''}">
    <div class="ob-slot-h"><b>${esc(s.label)}</b>${s.required ? '<span class="req">*</span>' : '<span class="ob-opt">有的話再傳</span>'}<span class="ob-st">${busy ? '上傳中…' : s.done ? '✓ 已收到' : '尚未上傳'}</span></div>
    <p class="ap-hint">${esc(HELP[s.key] || '')}</p>
    <div class="ob-btns">
      <button class="ap-btn ob-b" type="button" data-cam="${esc(s.key)}"${st.busy ? ' disabled' : ''}>${s.done ? '重新拍照' : '拍照'}</button>
      <button class="ob-b2" type="button" data-pick="${esc(s.key)}"${st.busy ? ' disabled' : ''}>${s.done ? '換檔案' : '選檔案'}</button>
    </div>
  </li>`;
}
async function upload(file){
  const key = st.slot; st.slot = '';
  if (!file || !key) return;
  st.busy = key; st.msg = ''; render();
  try {
    const blob = await prepare(file);
    const type = blob.type || file.type;
    if (!ALLOWED.includes(type)) throw new Error('只能上傳照片（JPG、PNG、WebP）或 PDF');
    if (blob.size > 2000000) throw new Error('檔案太大（約 2MB 以內），請重新拍攝或改用較小的檔案');
    const j = await api('onbUp', {slot:key, image:{mime:type, data: await toB64(blob)}});
    st.onb = j.onb;
    st.msg = `已收到：${(j.onb.slots.find(s => s.key === key) || {}).label || ''}`;
  } catch (e) {
    if (e.code === 'expired') st.err = e.message;
    else st.msg = navigator.onLine === false ? '目前沒有網路，連上網路後再上傳一次。' : (e.message || '上傳失敗，請再試一次');
  } finally { st.busy = ''; render(); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cam], [data-pick]'); if (!b || st.busy) return;
  st.slot = b.dataset.cam || b.dataset.pick;
  const inp = b.dataset.cam ? $('#ob-cam') : $('#ob-file');
  inp.value = ''; inp.click();
});
['#ob-cam', '#ob-file'].forEach(s => $(s).addEventListener('change', e => upload(e.target.files && e.target.files[0])));

(async () => {
  if (!T || !/^[a-f0-9]{32}$/.test(T)) return render();
  try { st.onb = (await api('onbInfo')).onb; }
  catch (e) { st.err = e.code === 'expired' ? e.message : navigator.onLine === false ? '目前沒有網路，連上網路後再重新整理。' : '讀不到報到資料，請稍後再試。'; }
  render();
})();
})();

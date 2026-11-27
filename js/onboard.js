/*
 * 起士公爵｜新進同仁報到資料（onboard.html，不用登入）
 * 網址：onboard.html#t=報到連結代碼（看板「傳報到連結」產生，104 小幫手用聊聊送給新人；代碼放在 # 後面，不會出現在伺服器紀錄）。
 * 讀報到資訊（POST action=onbInfo）。新人在同一頁：
 *   1. 填 Apollo 入職資料（Hire 批次匯入範本要的欄位；面試前填過的先帶進來），按「儲存入職資料」（POST action=onbSave）
 *   2. 拍照或選檔上傳證件（POST action=onbUp），照片先在手機上縮小再傳
 * 下拉選項在 js/hire-lists.js（window.HIRE_LISTS，和範本相同）。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const T = (new URLSearchParams(location.hash.slice(1)).get('t') || '').toLowerCase();
const L = window.HIRE_LISTS || {};
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
const st = { onb:null, err:'', busy:'', msg:'', slot:'', ap:null, apMsg:'', apBusy:false };

/* ---------- Apollo 入職資料的欄位（順序照範本；req＝範本必填）---------- */
const PERSON = [
  {k:'idType', label:'身分證件類型', req:1, list:'idType'},
  {k:'idNo', label:'身分證件號碼', req:1, ph:'例如：A123456789'},
  {k:'idExp', label:'身分證件到期日', type:'date', hint:'居留證、護照才要填'},
  {k:'last', label:'姓', req:1},
  {k:'first', label:'名', req:1},
  {k:'en', label:'英文姓名', ph:'和護照相同，例如：LIN, XIAO-YUN'},
  {k:'gender', label:'性別', req:1, list:'gender'},
  {k:'birth', label:'生日', req:1, type:'date'},
  {k:'nat', label:'國籍', req:1, list:'nat'},
  {k:'marital', label:'婚姻狀態', list:'marital'},
  {k:'mil', label:'兵役狀態', list:'mil', hint:'女生和外籍不用填'},
  {k:'milType', label:'役別', list:'milType'}
  // 範本還有兵役期間（起迄）、免役原因、入境時間：使用者說不用填（2026-11-27），匯出時留空
];
const CONTACT = [
  {k:'mobile', label:'手機', req:1, type:'tel'},
  {k:'tel', label:'市話', type:'tel'},
  {k:'email', label:'私人信箱', type:'email', full:1},
  {k:'addrReg', label:'戶籍地址', req:1, full:1},
  {k:'addrMail', label:'聯絡地址', req:1, full:1, same:1},
  {k:'ecName', label:'緊急聯絡人姓名'},
  {k:'ecRel', label:'緊急聯絡人關係', ph:'例如：父母、配偶'},
  {k:'ecMobile', label:'緊急聯絡人手機', type:'tel'},
  {k:'ecTel', label:'緊急聯絡人市話', type:'tel'}
];
const GROUPS = {
  edu: {title:'學歷', add:'＋ 再加一筆學歷', max:3, fields:[
    {k:'cat', label:'學歷類別', req:1, list:'eduCat'}, {k:'top', label:'是不是最高學歷', req:1, list:'top'},
    {k:'school', label:'學校名稱', req:1}, {k:'majorCat', label:'科系類別', req:1, list:'majorCat'},
    {k:'major', label:'科系名稱', req:1}, {k:'kind', label:'就學類別', list:'eduKind'}, {k:'status', label:'就學狀態', req:1, list:'eduSt'},
    {k:'from', label:'就學期間（起）', req:1, type:'date'}, {k:'to', label:'就學期間（迄）', req:1, type:'date'}, {k:'loc', label:'學校所在地', ph:'例如：台南市'}]},
  jobs: {title:'工作經歷', add:'＋ 加一筆工作經歷', max:5, fields:[
    {k:'co', label:'公司名稱', req:1}, {k:'ind', label:'產業別', req:1, list:'ind'}, {k:'type', label:'職務類別', req:1, list:'jobType'},
    {k:'dept', label:'任職部門'}, {k:'title', label:'職稱', req:1}, {k:'boss', label:'直屬主管姓名'},
    {k:'from', label:'任職期間（起）', req:1, type:'date'}, {k:'to', label:'任職期間（迄）', req:1, type:'date'},
    {k:'desc', label:'工作內容', full:1, area:1}, {k:'why', label:'離職原因', full:1}]},
  certs: {title:'證照', add:'＋ 加一張證照', max:5, fields:[
    {k:'name', label:'證照名稱', req:1}, {k:'org', label:'發照單位'}, {k:'got', label:'取得日期', type:'date'},
    {k:'exp', label:'到期日期', type:'date'}, {k:'perm', label:'永久有效', list:'perm'}, {k:'note', label:'備註'}]}
};
if (!L.perm) L.perm = ['是'];

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

/* ---------- 入職資料表單 ---------- */
/** 一個欄位；path＝'idNo' 或 'edu.0.school'（存在 st.ap） */
function fieldHTML(f, path, val){
  const id = 'ap-' + path.replace(/\./g, '-'), req = f.req ? '<span class="req" aria-hidden="true">*</span>' : '';
  let input;
  if (f.list) {
    const opts = L[f.list] || [];
    input = `<select id="${id}" data-ap="${esc(path)}"${f.req ? ' aria-required="true"' : ''}><option value="">請選擇</option>${opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.area) input = `<textarea id="${id}" data-ap="${esc(path)}" rows="2" maxlength="300">${esc(val)}</textarea>`;
  else input = `<input type="${f.type || 'text'}" id="${id}" data-ap="${esc(path)}" value="${esc(val)}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${f.req ? ' aria-required="true"' : ''}>`;
  const same = f.same ? '<button class="ob-b2 ob-same" type="button" data-same>同戶籍地址</button>' : '';
  return `<div class="ap-f${f.full ? ' full' : ''}"><label for="${id}">${esc(f.label)}${req}</label>${input}${f.hint ? `<span class="ap-hint">${esc(f.hint)}</span>` : ''}${same}</div>`;
}
function groupHTML(key){
  const g = GROUPS[key], list = st.ap[key] || [];
  const items = list.map((it, i) => `<div class="ob-grp"><div class="ob-grp-h"><b>${g.title} ${i + 1}</b><button class="ob-b2 ob-del" type="button" data-del="${key}.${i}">刪除這筆</button></div>
    <div class="ap-fields">${g.fields.map(f => fieldHTML(f, `${key}.${i}.${f.k}`, it[f.k] || '')).join('')}</div></div>`).join('');
  return `${items || `<p class="sub">${key === 'edu' ? '請填最高學歷（有需要可以多填幾筆）。' : '沒有可以不填。'}</p>`}
    ${list.length < g.max ? `<button class="ob-b2 ob-add" type="button" data-add="${key}">${g.add}</button>` : ''}`;
}
function apHTML(){
  const a = st.onb.apollo || {}, miss = a.miss || [];
  const saved = a.saved ? `已在 ${new Date(a.saved).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})} 儲存` : '還沒儲存';
  const status = !a.saved ? '下面已經先帶入您面試前填過的資料，請確認、補齊後按「儲存入職資料」。'
    : miss.length ? `還有 ${miss.length} 項必填沒有填：${miss.slice(0, 8).join('、')}${miss.length > 8 ? '…' : ''}` : '入職資料都填好了，謝謝您！之後有變更可以再修改、再儲存。';
  return `<section class="ap-sec" id="ap-sec"><h2>入職資料 <span class="n">${esc(saved)}</span></h2>
    <p class="sub">人資會用這些資料幫您建立人事系統（Apollo）的資料。<span class="req">*</span> 是必填。${a.start ? `報到日期：${esc(dayLabel(a.start))}（人資填寫）。` : ''}</p>
    <p class="ob-apst${a.saved && !miss.length ? ' ok' : ''}" role="status">${esc(status)}</p>
    <h3 class="ob-h3">個人資料</h3><div class="ap-fields">${PERSON.map(f => fieldHTML(f, f.k, st.ap[f.k] || '')).join('')}</div>
    <h3 class="ob-h3">通訊資料</h3><div class="ap-fields">${CONTACT.map(f => fieldHTML(f, f.k, st.ap[f.k] || '')).join('')}</div>
    <h3 class="ob-h3">學歷</h3>${groupHTML('edu')}
    <details class="ob-more"${(st.ap.jobs || []).length ? ' open' : ''}><summary>工作經歷（選填）</summary>${groupHTML('jobs')}</details>
    <details class="ob-more"${(st.ap.certs || []).length ? ' open' : ''}><summary>證照（選填）</summary>${groupHTML('certs')}</details>
    <div class="ob-save"><button class="ap-btn" type="button" id="ap-save"${st.apBusy ? ' disabled' : ''}>${st.apBusy ? '儲存中…' : '儲存入職資料'}</button></div>
    ${st.apMsg ? `<p class="ob-msg" role="status">${esc(st.apMsg)}</p>` : ''}
  </section>`;
}
function setPath(path, v){
  const p = path.split('.');
  if (p.length === 1) { st.ap[p[0]] = v; return; }
  const list = st.ap[p[0]] || (st.ap[p[0]] = []), it = list[+p[1]] || (list[+p[1]] = {});
  it[p[2]] = v;
}

/* ---------- 畫面 ---------- */
function render(){
  const main = $('#ob');
  if (!T || !/^[a-f0-9]{32}$/.test(T)) { main.innerHTML = `<div class="ap-done"><h1>連結不完整</h1><p>請從起士公爵傳給您的訊息，直接點整個連結打開。</p></div>`; return; }
  if (st.err) { main.innerHTML = `<div class="ap-done"><h1>打不開報到資料</h1><p>${esc(st.err)}</p><p>如果需要協助，請在 104 聊聊回覆起士公爵人資。</p></div>`; return; }
  const o = st.onb;
  if (!o) { main.innerHTML = '<p class="ap-loading">讀取報到資料…</p>'; return; }
  const req = o.slots.filter(s => s.required), done = req.filter(s => s.done).length, all = done === req.length;
  const apOk = o.apollo && o.apollo.saved && !(o.apollo.miss || []).length;
  const info = [
    ['報到日期', o.date ? dayLabel(o.date) : '另行通知'], ['報到時間', o.time || '另行通知'], ['報到地點', o.place || '另行通知']
  ].map(([k, v]) => `<div class="ob-k">${k}</div><div class="ob-v">${esc(v)}</div>`).join('');
  main.innerHTML = `
    <p class="ap-intro">${esc(o.name)} 您好，歡迎加入起士公爵！請在報到前用手機填好入職資料、把下面的文件拍照上傳，報到當天就不用再準備影本。</p>
    <section class="ap-sec"><h2>報到資訊</h2><div class="ob-info">${info}</div>${o.note ? `<p class="ob-note">${esc(o.note)}</p>` : ''}</section>
    ${o.apollo ? apHTML() : ''}
    <section class="ap-sec" id="up-sec"><h2>上傳文件 <span class="n">必要 ${done}／${req.length}</span></h2>
      <p class="sub">每一項按「拍照」用手機相機拍，或按「選檔案」選手機裡的照片、PDF。拍錯可以重新上傳。</p>
      <ul class="ob-slots">${o.slots.map(slotHTML).join('')}</ul>
    </section>
    ${st.msg ? `<p class="ob-msg" role="status">${esc(st.msg)}</p>` : ''}
    ${all && (apOk || !o.apollo) ? `<div class="ap-done"><h1>入職資料和必要文件都收到了</h1><p>謝謝您！人資確認後如果還需要補件，會在 104 聊聊通知您。</p><p class="ob-exp">這個連結到 ${esc(new Date(o.exp).toLocaleDateString('zh-TW'))} 前都可以再修改或補傳。</p></div>` : ''}`;
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
    st.onb = Object.assign({}, j.onb, {apollo: st.onb.apollo});   // 入職資料以頁面上正在填的為準
    st.msg = `已收到：${(j.onb.slots.find(s => s.key === key) || {}).label || ''}`;
  } catch (e) {
    if (e.code === 'expired') st.err = e.message;
    else st.msg = navigator.onLine === false ? '目前沒有網路，連上網路後再上傳一次。' : (e.message || '上傳失敗，請再試一次');
  } finally { st.busy = ''; render(); }
}
async function saveAp(){
  if (st.apBusy) return;
  st.apBusy = true; st.apMsg = ''; render();
  try {
    const j = await api('onbSave', {ap: st.ap});
    st.onb = j.onb; st.ap = JSON.parse(JSON.stringify(j.onb.apollo.ap || {}));
    const miss = j.onb.apollo.miss || [];
    st.apMsg = miss.length ? `已儲存。還有 ${miss.length} 項必填沒有填，填好後再按一次儲存。` : '已儲存，入職資料都填好了。';
  } catch (e) {
    if (e.code === 'expired') st.err = e.message;
    else st.apMsg = navigator.onLine === false ? '目前沒有網路，連上網路後再按一次儲存（剛剛填的內容還在畫面上）。' : (e.message || '儲存失敗，請再按一次');
  } finally {
    st.apBusy = false; render();
    const sec = $('#ap-sec .ob-apst'); if (sec && sec.scrollIntoView) sec.scrollIntoView({block:'center'});
  }
}
document.addEventListener('input', e => { const el = e.target.closest('[data-ap]'); if (el && st.ap) setPath(el.dataset.ap, el.value); });
document.addEventListener('change', e => { const el = e.target.closest('[data-ap]'); if (el && st.ap) setPath(el.dataset.ap, el.value); });
document.addEventListener('click', e => {
  if (e.target.closest('#ap-save')) { saveAp(); return; }
  if (e.target.closest('[data-same]')) { st.ap.addrMail = st.ap.addrReg || ''; render(); const i = $('#ap-addrMail'); if (i) i.focus(); return; }
  const add = e.target.closest('[data-add]');
  if (add) { const k = add.dataset.add; (st.ap[k] || (st.ap[k] = [])).push(k === 'edu' && !st.ap[k].length ? {top:'是'} : {}); render(); return; }
  const del = e.target.closest('[data-del]');
  if (del) { const [k, i] = del.dataset.del.split('.'); (st.ap[k] || []).splice(+i, 1); render(); return; }
  const b = e.target.closest('[data-cam], [data-pick]'); if (!b || st.busy) return;
  st.slot = b.dataset.cam || b.dataset.pick;
  const inp = b.dataset.cam ? $('#ob-cam') : $('#ob-file');
  inp.value = ''; inp.click();
});
['#ob-cam', '#ob-file'].forEach(s => $(s).addEventListener('change', e => upload(e.target.files && e.target.files[0])));

(async () => {
  if (!T || !/^[a-f0-9]{32}$/.test(T)) return render();
  try { st.onb = (await api('onbInfo')).onb; st.ap = JSON.parse(JSON.stringify((st.onb.apollo && st.onb.apollo.ap) || {})); }
  catch (e) { st.err = e.code === 'expired' ? e.message : navigator.onLine === false ? '目前沒有網路，連上網路後再重新整理。' : '讀不到報到資料，請稍後再試。'; }
  render();
})();
})();

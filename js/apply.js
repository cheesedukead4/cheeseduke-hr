/*
 * 起士公爵｜應徵資料與面試預約（apply.html，不用登入）
 * 先讀雲端後端的可預約時段（GET action=slots），應徵者選一個時段、填人事資料表，送出（POST action=apply）。
 * 欄位和「起士公爵人事資料表」相同，送出的欄位名稱和人事工作看板的 form 欄位一致。
 */
(function () {
'use strict';
const URL_ = ((window.HR_CLOUD || {}).url || '').trim();
const INV = (new URLSearchParams(location.search).get('i') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);   // 看板邀約連結帶的代碼：對到 104 上的哪一位
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const CONSENTS = [
  '本人已知悉並同意貴公司基於人事管理目的蒐集、處理及利用本人資料',
  '本人了解體檢報告將影響錄用與否之最後決定',
  '本人保證上述資料屬實，若有虛偽，貴公司得取消錄用或終止契約'
];
const SCALE = {type:'radio', opts:['1', '2', '3'], hint:'1＝略懂，3＝流利'};
const SECTIONS = [
  {title:'基本資料', fields:[
    {k:'position', label:'應徵職務', req:1, ph:'例如：門市人員、烘焙助理'},
    {k:'name', label:'姓名', req:1},
    {k:'gender', label:'性別', req:1, type:'radio', opts:['男', '女']},
    {k:'military', label:'兵役狀況', type:'radio', opts:['役畢', '未役', '免役']},
    {k:'birth', label:'出生年月日', req:1, type:'date'},
    {k:'idNo', label:'身分證字號', ph:'外籍請填居留證號碼'},
    {k:'identity', label:'身分狀態', req:1, type:'radio', opts:['一般', '原住民', '身心障礙', '外籍'], full:1}
  ]},
  {title:'通訊資料', fields:[
    {k:'mobile', label:'手機號碼', req:1, type:'tel'},
    {k:'homePhone', label:'家電', req:1, type:'tel', ph:'沒有請填「無」'},
    {k:'email', label:'電子郵件', req:1, type:'email', full:1},
    {k:'addrReg', label:'戶籍地址', req:1, full:1},
    {k:'addrMail', label:'通訊地址', req:1, full:1, same:1}
  ]},
  {title:'緊急聯絡人', fields:[
    {k:'ecName', label:'姓名', req:1},
    {k:'ecRel', label:'關係', req:1, ph:'例如：父母、配偶'},
    {k:'ecPhone', label:'聯絡電話', req:1, type:'tel'}
  ]},
  {title:'學歷與專長', fields:[
    {k:'edu', label:'最高學歷', req:1, type:'radio', opts:['博士', '碩士', '大學/五專', '高中', '國中'], full:1},
    {k:'school', label:'學校名稱與科系', req:1},
    {k:'gradStatus', label:'畢業狀態', req:1, type:'radio', opts:['畢業', '肄業']},
    {k:'gradYear', label:'畢業日期', type:'date'},
    Object.assign({k:'langEn', label:'語言能力：英文', req:1}, SCALE),
    Object.assign({k:'langTw', label:'語言能力：台語', req:1}, SCALE),
    Object.assign({k:'langJp', label:'語言能力：日文', req:1}, SCALE),
    {k:'cert', label:'專業證照', type:'checks', opts:['中/西餐烹調 (丙級/乙級)', '烘焙食品 (丙級/乙級)', '門市服務 (丙級/乙級)', '語文證照 (多益/英檢/日檢)'], other:1, full:1},
    {k:'computer', label:'電腦技能', type:'checks', opts:['Word', 'Excel', 'PowerPoint', 'ERP'], other:1, full:1}
  ]},
  {title:'工作經歷', sub:'從最近一份開始填；沒有工作經驗請在第一份填「無」。', jobs:3},
  {title:'到職與待遇', fields:[
    {k:'available', label:'最快可到職時間', req:1, type:'date'},
    {k:'salary', label:'希望待遇（不低於多少）', req:1, ph:'例如：32000'}
  ]},
  {title:'聲明與同意', consent:1}
];
const JOB_FIELDS = [['Co', '服務公司與職稱'], ['Time', '工作時間（年/月/日～年/月/日）'], ['Desc', '服務內容與薪資'], ['Leave', '離職原因']];

const st = {slots:[], slotId:'', jobs:1, busy:false, done:null, loadErr:''};

function fieldHTML(f){
  const id = 'f-' + f.k, req = f.req ? '<span class="req" aria-hidden="true">*</span>' : '';
  const cls = 'ap-f' + (f.full ? ' full' : '');
  if (f.type === 'radio' || f.type === 'checks') {
    const t = f.type === 'radio' ? 'radio' : 'checkbox';
    const opts = f.opts.map((o, i) => `<label><input type="${t}" name="${f.k}" id="${id}-${i}" value="${esc(o)}">${esc(o)}</label>`).join('');
    const other = f.other ? `<input type="text" id="${id}-other" placeholder="其他（自行填寫）" aria-label="${esc(f.label)}：其他">` : '';
    return `<div class="${cls}" data-k="${f.k}"><span class="lbl" id="${id}-l">${esc(f.label)}${req}</span><div class="ap-opts" role="${t === 'radio' ? 'radiogroup' : 'group'}" aria-labelledby="${id}-l">${opts}</div>${other}${f.hint ? `<span class="ap-hint">${esc(f.hint)}</span>` : ''}</div>`;
  }
  const type = f.type || 'text';
  const same = f.same ? `<label class="ap-check"><input type="checkbox" id="same-addr">同戶籍地址</label>` : '';
  return `<div class="${cls}" data-k="${f.k}"><label for="${id}">${esc(f.label)}${req}</label><input type="${type}" id="${id}" name="${f.k}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${type === 'tel' ? ' inputmode="tel" autocomplete="off"' : ''}${f.k === 'email' ? ' autocomplete="email"' : ''}>${same}</div>`;
}
function jobHTML(n){
  return `<div class="ap-job" id="job-${n}"><h3>${n === 1 ? '最近一份工作' : '第 ' + n + ' 份工作（選填）'}</h3><div class="ap-fields">${JOB_FIELDS.map(([s, label]) => {
    const k = 'job' + n + s, big = s === 'Desc' || s === 'Leave';
    const req = n === 1 ? '<span class="req" aria-hidden="true">*</span>' : '';
    return `<div class="ap-f${big ? ' full' : ''}" data-k="${k}"><label for="f-${k}">${label}${req}</label>${big ? `<textarea id="f-${k}" name="${k}" rows="2"></textarea>` : `<input type="text" id="f-${k}" name="${k}">`}</div>`;
  }).join('')}</div></div>`;
}
function slotsHTML(){
  if (st.loadErr) return `<p class="ap-none">${esc(st.loadErr)} <button class="ap-more" type="button" id="reload">重新讀取</button></p>`;
  if (!st.slots.length) return '<p class="ap-none">目前沒有可以預約的面試時段，請稍後再來看看，或直接與通知您面試的人員聯絡。</p>';
  const byDay = new Map();
  st.slots.forEach(s => { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });
  const chosen = st.slots.find(s => s.id === st.slotId);
  return `<div class="ap-days" role="group" aria-label="面試時段">${[...byDay.entries()].map(([d, list]) =>
    `<div class="ap-day"><h3>${dayLabel(d)}</h3><div class="ap-times">${list.map(s => `<button class="ap-slot" type="button" data-slot="${esc(s.id)}" aria-pressed="${s.id === st.slotId}">${esc(s.time)}</button>`).join('')}</div></div>`).join('')}</div>
    ${chosen ? `<p class="ap-chosen" role="status">已選：${dayLabel(chosen.date)} ${esc(chosen.time)}</p>` : ''}`;
}
function render(){
  const root = $('#ap');
  if (st.done) {
    root.innerHTML = `<section class="ap-done" role="status"><h1>預約完成，謝謝您</h1><div class="when">${dayLabel(st.done.date)} ${esc(st.done.time)}</div>
      <p>${esc(st.done.name)} 您好，已收到您的應徵資料，期待和您見面。</p><p>請準時到場；如需更改面試時間，請直接與通知您面試的人員聯絡。</p></section>`;
    return;
  }
  let n = 0;
  root.innerHTML = `<p class="ap-intro">本表單為面試前基本資料確認使用，目的為節省面試當天填寫時間，並協助本公司進行面試安排、招募評估及後續聯繫。本表單填寫不代表錄取結果。<span class="req">*</span> 表示必填。</p>
    <form id="ap-form" novalidate>
      <section class="ap-sec" id="sec-slot"><h2><span class="n">${++n}</span>選擇面試時段<span class="req" aria-hidden="true">*</span></h2><p class="sub">請先選一個方便的時間，再往下填資料。</p><div id="slot-box">${slotsHTML()}</div></section>
      ${SECTIONS.map(sec => {
        let body;
        if (sec.jobs) body = `<div id="jobs">${[1, 2, 3].filter(i => i <= st.jobs).map(jobHTML).join('')}</div>${st.jobs < 3 ? '<button class="ap-more" type="button" id="more-job">＋ 再填一份工作經歷</button>' : ''}`;
        else if (sec.consent) body = `<div class="ap-fields"><div class="ap-f full" data-k="consent">${CONSENTS.map((c, i) => `<label class="ap-check"><input type="checkbox" name="consent" id="f-consent-${i}" value="${esc(c)}">${esc(c)}</label>`).join('')}</div></div>`;
        else body = `<div class="ap-fields">${sec.fields.map(fieldHTML).join('')}</div>`;
        return `<section class="ap-sec"><h2><span class="n">${++n}</span>${sec.title}</h2>${sec.sub ? `<p class="sub">${sec.sub}</p>` : ''}${body}</section>`;
      }).join('')}
      <div class="hp" aria-hidden="true"><label>網站<input type="text" name="website" id="f-website" tabindex="-1" autocomplete="off"></label></div>
      <div class="ap-submit"><span class="sum" id="sum"></span><button class="ap-btn" type="submit" id="go">送出並預約</button><p class="ap-msg" id="msg" role="alert"></p></div>
    </form>`;
  updateSum();
}
function updateSum(){
  const s = st.slots.find(x => x.id === st.slotId), el = $('#sum');
  if (el) el.textContent = s ? `面試時間：${dayLabel(s.date)} ${s.time}` : '還沒選面試時段';
}
function val(k){
  const form = $('#ap-form');
  const boxes = form.querySelectorAll(`input[name="${k}"]`);
  if (boxes.length && (boxes[0].type === 'radio' || boxes[0].type === 'checkbox')) {
    const picked = [...boxes].filter(b => b.checked).map(b => b.value);
    const other = $('#f-' + k + '-other');
    if (other && other.value.trim()) picked.push(other.value.trim());
    return boxes[0].type === 'radio' ? (picked[0] || '') : picked.join(', ');
  }
  const el = $('#f-' + k);
  return el ? el.value.trim() : '';
}
function collect(){
  const out = {};
  SECTIONS.forEach(sec => (sec.fields || []).forEach(f => { out[f.k] = val(f.k); }));
  for (let n = 1; n <= 3; n++) JOB_FIELDS.forEach(([s]) => { out['job' + n + s] = val('job' + n + s); });
  const cons = [...document.querySelectorAll('input[name="consent"]')];
  out.consent = cons.every(c => c.checked) ? cons.map(c => c.value).join(', ') : '';
  return out;
}
function requiredKeys(){
  const keys = [];
  SECTIONS.forEach(sec => (sec.fields || []).forEach(f => { if (f.req) keys.push(f.k); }));
  JOB_FIELDS.forEach(([s]) => keys.push('job1' + s));
  keys.push('consent');
  return keys;
}
function markBad(keys, msg){
  document.querySelectorAll('.ap-f.bad').forEach(x => x.classList.remove('bad'));
  keys.forEach(k => { const f = document.querySelector(`.ap-f[data-k="${k}"]`); if (f) f.classList.add('bad'); });
  $('#msg').textContent = msg || '';
  const first = keys.length ? document.querySelector(`.ap-f[data-k="${keys[0]}"]`) : null;
  if (first) { first.scrollIntoView({behavior:'smooth', block:'center'}); const i = first.querySelector('input,textarea'); if (i) setTimeout(() => i.focus({preventScroll:true}), 300); }
}
async function loadSlots(){
  if (!URL_) { st.loadErr = '系統尚未設定完成，請稍後再試。'; return; }
  try {
    const r = await fetch(URL_ + (URL_.includes('?') ? '&' : '?') + 'action=slots&_=' + Date.now(), {cache:'no-store', redirect:'follow'});
    const j = await r.json();
    if (!j.ok) throw new Error(j.message || '讀取失敗');
    st.slots = Array.isArray(j.slots) ? j.slots : []; st.loadErr = '';
    if (st.slotId && !st.slots.some(s => s.id === st.slotId)) st.slotId = '';
  } catch (e) { st.loadErr = navigator.onLine === false ? '目前沒有網路，連上網路後再重新讀取。' : '讀不到面試時段，請稍後再試。'; }
}
async function submit(){
  if (st.busy) return;
  if (!st.slotId) { $('#sec-slot').scrollIntoView({behavior:'smooth'}); $('#msg').textContent = '請先選擇面試時段。'; return; }
  const form = collect(), miss = requiredKeys().filter(k => !form[k]);
  if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) miss.unshift('email');
  if (miss.length) { markBad(miss, miss.includes('consent') && miss.length === 1 ? '請勾選全部的聲明與同意。' : '還有必填的欄位沒有填（紅色標示）。'); return; }
  markBad([]);
  st.busy = true; const btn = $('#go'); btn.disabled = true; btn.textContent = '送出中…';
  try {
    const r = await fetch(URL_, {method:'POST', redirect:'follow', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'apply', slotId:st.slotId, website:$('#f-website').value, inv:INV, form})});
    const j = await r.json();
    if (j.ok) { st.done = {date:(j.slot || {}).date || '', time:(j.slot || {}).time || '', name:form.name}; render(); window.scrollTo(0, 0); return; }
    if (j.error === 'slot_taken') {
      await loadSlots(); $('#slot-box').innerHTML = slotsHTML(); updateSum();
      $('#sec-slot').scrollIntoView({behavior:'smooth'});
      $('#msg').textContent = j.message;
    } else if (Array.isArray(j.fields) && j.fields.length) markBad(j.fields, j.message);
    else $('#msg').textContent = j.message || '送出失敗，請再試一次。';
  } catch (e) {
    $('#msg').textContent = navigator.onLine === false ? '目前沒有網路，連上網路後再按一次送出。' : '送出失敗，請再按一次送出。';
  }
  st.busy = false; btn.disabled = false; btn.textContent = '送出並預約';
}

document.addEventListener('click', e => {
  const s = e.target.closest('[data-slot]');
  if (s) { st.slotId = s.dataset.slot; $('#slot-box').innerHTML = slotsHTML(); updateSum(); $('#msg').textContent = ''; return; }
  if (e.target.id === 'more-job' && st.jobs < 3) {
    st.jobs++;
    $('#jobs').insertAdjacentHTML('beforeend', jobHTML(st.jobs));
    if (st.jobs >= 3) e.target.remove();
    return;
  }
  if (e.target.id === 'reload') { loadSlots().then(() => { $('#slot-box').innerHTML = slotsHTML(); updateSum(); }); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'same-addr' && t.checked) { $('#f-addrMail').value = $('#f-addrReg').value; }
  const f = t.closest && t.closest('.ap-f.bad'); if (f) f.classList.remove('bad');
});
document.addEventListener('input', e => { const f = e.target.closest && e.target.closest('.ap-f.bad'); if (f) f.classList.remove('bad'); if (e.target.id === 'f-addrReg' && $('#same-addr') && $('#same-addr').checked) $('#f-addrMail').value = e.target.value; });
document.addEventListener('submit', e => { if (e.target.id === 'ap-form') { e.preventDefault(); submit(); } });

loadSlots().then(render);
})();

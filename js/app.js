/*
 * 人事工作看板｜全部畫面
 * ---------------------------------------------------------------
 * 頁面（網址 #overview #pipeline #routine #users）：總覽、新進人員・勞健保、例行工作、管理（只有管理員）。
 * 資料（HRStore，見 cloud-store.js），每一筆都有 id：
 *   hires     { id, name, position, dept, phone, note, interviewDate, startDate (YYYY-MM-DD),
 *               stage: interview|docs|apollo_up|apollo_down|insurance|done|rejected, result: pending|hired|rejected,
 *               steps: { 步驟: { at, by } }（完成該步驟的時間與人；退回時刪掉）,
 *               docs: { id_front|id_back|bank|other_*: { id: 雲端檔案 id, mime, at, by } }（檔案在雲端後端「證件照片」資料夾）,
 *               interviewer, rating: A|B|C|D, comment, ivAt, ivBy（面試紀錄）,
 *               form: {...}, formAt, source: 'form'（從「起士公爵人事資料表」回覆匯入；id 是 form-雜湊，重複匯入會略過）,
 *               createdAt, createdBy, updatedAt, updatedBy }
 *   routines  { id, freq: daily|weekly|monthly, title, due, order, createdAt, createdBy }
 *   checks    { id: d-YYYY-MM-DD | w-YYYY-Www | m-YYYY-MM, date: 期間第一天, freq, done: { 項目 id: { at, by } } }
 * 權限（HRAuth.can）：edit 人事資料編輯、pii 查看證件、routine 例行工作設定；管理員全部都有。
 *   這是畫面權限：雲端後端擋的是「不在名單的人」；證件照片另外由後端檢查 pii。例行工作每個人都能打勾。
 */
(function () {
'use strict';
const AU = window.HRAuth, ST = window.HRStore;

/* ================= 定義 ================= */
const STAGES = [
  {key:'interview',   n:1, title:'面試資料',    hint:'等待面試結果'},
  {key:'docs',        n:2, title:'錄取・證件',  hint:'拍照上傳證件'},
  {key:'apollo_up',   n:3, title:'APOLLO 上傳', hint:'人事資料上傳 APOLLO'},
  {key:'apollo_down', n:4, title:'APOLLO 下載', hint:'自 APOLLO 下載檔案'},
  {key:'insurance',   n:5, title:'勞健保上傳',  hint:'申報勞健保加保'},
  {key:'done',        n:0, title:'已完成',      hint:''}
];
const FLOW = STAGES.map(s => s.key);
const ACTIVE = ['docs','apollo_up','apollo_down','insurance'];
const TITLE = {interview:'面試資料',docs:'錄取・證件',apollo_up:'APOLLO 上傳',apollo_down:'APOLLO 下載',insurance:'勞健保上傳',done:'已完成',rejected:'未錄取'};
const STEP_DEFS = [
  {key:'interview',   label:'面試結果'},
  {key:'docs',        label:'錄取・證件上傳'},
  {key:'apollo_up',   label:'APOLLO 上傳'},
  {key:'apollo_down', label:'APOLLO 下載'},
  {key:'insurance',   label:'勞健保上傳（加保）'}
];
const STEP_HINT = {
  interview:'確認面試結果後，按「錄取」或「未錄取」。',
  docs:'拍照上傳身分證／居留證正反面，存摺封面可一併上傳。',
  apollo_up:'將新人人事資料上傳至 APOLLO。',
  apollo_down:'自 APOLLO 下載加保所需檔案。',
  insurance:'至勞保局 e 化服務系統申報勞保、就保、健保加保。'
};
const ADV_LABEL = {docs:'證件齊全，下一步', apollo_up:'已上傳 APOLLO', apollo_down:'已下載', insurance:'已完成加保'};
const EMPTY = {
  interview:'按「新增面試者」或「匯入表單回覆」',
  docs:'錄取後的新人會出現在這裡',
  apollo_up:'證件齊全的新人會移到這裡',
  apollo_down:'已上傳 APOLLO 的新人',
  insurance:'等待申報勞健保的新人',
  done:'這個月還沒有人完成加保'
};
const DOC_SLOTS = [
  {key:'id_front', label:'身分證／居留證 正面', required:true},
  {key:'id_back',  label:'身分證／居留證 反面', required:true},
  {key:'bank',     label:'存摺封面', required:false}
];
const ALLOWED = ['image/jpeg','image/png','image/webp','application/pdf'];
const RATING = {A:'優秀', B:'良好', C:'尚可', D:'不適合'};
const RATING_KEYS = ['A','B','C','D'];
const FREQS = [
  {key:'daily',   title:'每日', empty:'尚未設定每日項目',     ex:'確認今日到職人員已加保'},
  {key:'weekly',  title:'每週', empty:'尚未設定每週項目',     ex:'核對本週離職人員退保'},
  {key:'monthly', title:'每月', empty:'尚未設定每月固定項目', ex:'核對勞健保繳款單'}
];
const FREQ_KEYS = FREQS.map(f => f.key);
const PERMS = [
  {id:'edit',    label:'人事資料編輯', desc:'新增面試者、匯入表單回覆、填寫評語、推進流程、上傳證件'},
  {id:'pii',     label:'查看證件',     desc:'看證件照片與完整身分證字號'},
  {id:'routine', label:'例行工作設定', desc:'新增、修改、刪除每日／每週／每月項目（打勾不需要權限）'}
];
const PERM_LABEL = Object.fromEntries(PERMS.map(p => [p.id, p.label]));
const VIEWS = ['overview','pipeline','routine','users'];

/* 起士公爵人事資料表：回覆試算表的標題（去掉空白）→ 欄位，同名欄位依出現順序對應 */
const COLS = {
  '時間戳記':['ts'], 'Timestamp':['ts'],
  '電子郵件地址':['email'], 'Emailaddress':['email'], '電子郵件':['email2'],
  '應徵職務':['position'], '姓名':['name','ecName'],
  '性別':['gender'], '兵役狀況':['military'], '出生年月日':['birth'], '身分證字號':['idNo'], '身分狀態':['identity'],
  '手機號碼':['mobile'], '家電':['homePhone'], '戶籍地址':['addrReg'], '通訊地址':['addrMail'],
  '關係':['ecRel'], '聯絡電話':['ecPhone'],
  '最高學歷':['edu'], '學校名稱與科系':['school'], '畢業狀態':['gradStatus'], '畢業年份':['gradYear'],
  '語言能力-英文':['langEn'], '語言能力-台語':['langTw'], '語言能力-日文':['langJp'],
  '專業證照':['cert'], '電腦技能':['computer'],
  '服務公司與職稱':['job1Co'], '服務公司與職稱-2':['job2Co'], '服務公司與職稱-3':['job3Co'],
  '工作時間(年/月/日~年/月/日)':['job1Time','job2Time','job3Time'], '工作時間':['job3TimeAlt'],
  '服務內容與薪資':['job1Desc','job2Desc','job3Desc'], '離職原因':['job1Leave','job2Leave','job3Leave'],
  '最快可到職時間':['available'], '希望待遇(不低於多少)':['salary'], '個人資料蒐集同意':['consent']
};
const FORM_KEYS = [...new Set(Object.values(COLS).flat())];
const DATE_KEYS = ['birth','available','gradYear'];

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const curMonth = () => today().slice(0,7);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const md = s => isDate(s) ? `${+s.slice(5,7)}/${+s.slice(8,10)}` : '';
const dayDiff = (a,b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
const tsDate = ts => (typeof ts === 'number' && isFinite(ts)) ? ymd(new Date(ts)) : '';
const fmtTime = ts => { if (typeof ts !== 'number' || !isFinite(ts)) return ''; const d = new Date(ts); return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDateTime = ts => { const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const str = v => typeof v === 'string' ? v.trim() : '';
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const validFileId = a => typeof a === 'string' && /^[A-Za-z0-9_\-]{10,80}$/.test(a);
const validDocKey = k => DOC_SLOTS.some(s => s.key === k) || /^other_[A-Za-z0-9_-]{1,40}$/.test(k);
const nm = h => h.name || '（未填姓名）';
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const isAdmin = () => !!AU && AU.isAdmin();
const canEdit = () => !!AU && AU.can('edit');
const canPii = () => !!AU && AU.can('pii');
const canRoutine = () => !!AU && AU.can('routine');
const myName = () => (AU && (AU.name() || AU.email())) || '我';

/* ================= 狀態 ================= */
const S = {
  hires:new Map(), routines:new Map(), checks:{daily:{done:{}}, weekly:{done:{}}, monthly:{done:{}}}, loaded:false,
  month:curMonth(), q:'', tab:'interview', rejOpen:false, view:'overview',
  openId:null, creating:false, confirm:null, uploading:{}, pendingSlot:null, showId:false,
  rtEdit:{}, rtConfirm:null, imp:null,
  batch:false, sel:new Set(), batchConfirm:false, batchDate:''
};
const U = {list:null, admins:[], loading:false, error:'', confirm:null, editing:null};
const inMonth = s => !!s && s.slice(0,7) === S.month;

function norm(id, d){
  d = obj(d);
  const stage = (FLOW.includes(d.stage) || d.stage === 'rejected') ? d.stage : 'interview';
  const docs = {};
  for (const [k, v] of Object.entries(obj(d.docs))) {
    if (validDocKey(k) && v && typeof v === 'object' && validFileId(v.id)) {
      docs[k] = {id:v.id, mime: ALLOWED.includes(v.mime) ? v.mime : 'image/jpeg', at:v.at, by:str(v.by)};
    }
  }
  return {
    id, name:str(d.name), position:str(d.position), dept:str(d.dept), phone:str(d.phone), note:str(d.note),
    interviewDate: isDate(d.interviewDate) ? d.interviewDate : '', startDate: isDate(d.startDate) ? d.startDate : '',
    interviewTime: /^\d{2}:\d{2}$/.test(d.interviewTime || '') ? d.interviewTime : '', slotId: str(d.slotId), source: str(d.source),
    stage, result: ['hired','rejected'].includes(d.result) ? d.result : 'pending',
    docs, steps:obj(d.steps), createdAt: typeof d.createdAt === 'number' ? d.createdAt : null, createdBy:str(d.createdBy),
    interviewer:str(d.interviewer), rating: RATING_KEYS.includes(d.rating) ? d.rating : '', comment:str(d.comment),
    ivAt: typeof d.ivAt === 'number' ? d.ivAt : null, ivBy:str(d.ivBy),
    form: normForm(d.form), formAt: typeof d.formAt === 'number' ? d.formAt : null,
    docUrl: /^https:\/\/docs\.google\.com\//.test(typeof d.docUrl === 'string' ? d.docUrl : '') ? d.docUrl : ''
  };
}
function normForm(f){
  f = obj(f);
  if (!Object.keys(f).length) return null;
  const out = {};
  for (const k of FORM_KEYS) if (typeof f[k] === 'string') out[k] = f[k].slice(0, 3000);
  out.extra = Array.isArray(f.extra) ? f.extra.filter(e => e && typeof e.k === 'string' && typeof e.v === 'string').slice(0, 30) : [];
  return out;
}
function normRt(id, d){
  d = obj(d);
  if (!FREQ_KEYS.includes(d.freq) || !str(d.title)) return null;
  return {id, freq:d.freq, title:str(d.title), due:str(d.due), order: typeof d.order === 'number' ? d.order : 0};
}
function pullFromStore(){
  S.hires = new Map(ST.list('hires').map(d => [d.id, norm(d.id, d)]));
  S.routines = new Map(ST.list('routines').map(d => [d.id, normRt(d.id, d)]).filter(([, r]) => r));
  const keys = periodKeys();
  for (const f of FREQS) { const rec = ST.get('checks', keys[f.key]); S.checks[f.key] = {done: rec ? obj(rec.done) : {}}; }
  S.loaded = !!ST.status().loaded;
}

const docsReady = h => DOC_SLOTS.filter(s => s.required).every(s => h.docs[s.key]);
const docCount = h => { const req = DOC_SLOTS.filter(s => s.required); return {have:req.filter(s => h.docs[s.key]).length, need:req.length}; };
const doneDate = h => tsDate(obj(h.steps.insurance).at);
const cmpDate = (a,b) => (a||'9999') < (b||'9999') ? -1 : (a||'9999') > (b||'9999') ? 1 : 0;
const ivDay = h => h.interviewDate || tsDate(h.formAt) || tsDate(h.createdAt);
function visible(h){
  if (!S.q) return true;
  const q = S.q.toLowerCase();
  return [h.name,h.position,h.dept].some(x => x.toLowerCase().includes(q));
}
function columnItems(key){
  const all = [...S.hires.values()].filter(visible);
  if (key === 'done') return all.filter(h => h.stage === 'done' && inMonth(doneDate(h))).sort((a,b) => (obj(b.steps.insurance).at||0) - (obj(a.steps.insurance).at||0));
  const items = all.filter(h => h.stage === key);
  return key === 'interview' ? items.sort((a,b) => cmpDate(a.interviewDate, b.interviewDate)) : items.sort((a,b) => cmpDate(a.startDate, b.startDate));
}
const rejectedItems = () => [...S.hires.values()].filter(visible).filter(h => h.stage === 'rejected' && inMonth(ivDay(h)));
function dueInfo(h){
  if (!h.startDate) return {text:'未填到職日', cls:''};
  const d = dayDiff(today(), h.startDate);
  if (d > 3) return {text:`到職 ${md(h.startDate)}・${d} 天後`, cls:''};
  if (d > 0) return {text:`到職 ${md(h.startDate)}・${d} 天後`, cls:'warn'};
  if (d === 0) return {text:'今日到職・須當日加保', cls:'warn'};
  return {text:`已到職 ${-d} 天・未加保`, cls:'danger'};
}

/* ================= 寫入（本機先存，背景同步到雲端） ================= */
function saveHire(id, mutate){
  const cur = ST.get('hires', id);
  if (!cur) return false;
  const rec = JSON.parse(JSON.stringify(cur));
  mutate(rec);
  rec.updatedAt = Date.now(); rec.updatedBy = myName();
  ST.save('hires', rec);
  return true;
}
function decide(id, hired){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  saveHire(id, r => { r.stage = hired ? 'docs' : 'rejected'; r.result = hired ? 'hired' : 'rejected'; r.steps = obj(r.steps); r.steps.interview = {at:Date.now(), by:myName()}; });
  toast(hired ? `${nm(h)} 已錄取，請上傳證件` : `${nm(h)} 已標記為未錄取`, () => backTo(id, 'interview'));
}
function advance(id){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  const i = FLOW.indexOf(h.stage);
  if (i < 1 || i >= FLOW.length - 1) return;
  if (h.stage === 'docs' && !docsReady(h)) { openDrawer(id); toast('請先上傳身分證／居留證正反面'); return; }
  const cur = h.stage, next = FLOW[i + 1];
  saveHire(id, r => { r.stage = next; r.steps = obj(r.steps); r.steps[cur] = {at:Date.now(), by:myName()}; });
  toast(next === 'done' ? `${nm(h)} 已完成勞健保加保` : `${nm(h)} 移到「${TITLE[next]}」`, () => backTo(id, cur));
}
function backTo(id, target){
  saveHire(id, r => { r.stage = target; r.steps = obj(r.steps); delete r.steps[target]; if (target === 'interview') r.result = 'pending'; });
}
function stepBack(id){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  const target = h.stage === 'rejected' ? 'interview' : FLOW[FLOW.indexOf(h.stage) - 1];
  if (!target) return;
  backTo(id, target);
  toast(`${nm(h)} 退回「${TITLE[target]}」`);
}

/* ================= 證件照片 ================= */
const PH = new Map(); // 檔案 id → { state: loading|ok|err, url, mime, msg }（只存在記憶體，關掉 App 就清掉）
function b64ToBlob(b64, mime){
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], {type:mime});
}
function blobToB64(blob){
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('讀不到檔案')); r.readAsDataURL(blob); });
}
function photoOf(fid){
  let p = PH.get(fid);
  if (p) return p;
  p = {state:'loading'};
  PH.set(fid, p);
  AU.api('photo', {id:fid}).then(j => {
    p.state = 'ok'; p.mime = j.mime; p.url = URL.createObjectURL(b64ToBlob(j.data, j.mime));
    refreshDrawer();
  }).catch(e => { p.state = 'err'; p.msg = e.message; refreshDrawer(); });
  return p;
}
async function prepare(file){
  if (file.type === 'application/pdf') return file;
  let url;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, hgt = img.naturalHeight;
    const sc = Math.min(1, 1800 / Math.max(w, hgt));
    if (sc === 1 && file.size < 1.2e6 && ALLOWED.includes(file.type)) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(w * sc); c.height = Math.round(hgt * sc);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return b || file;
  } catch { return file; }
  finally { if (url) URL.revokeObjectURL(url); }
}
async function uploadOne(id, key, file, label){
  if (navigator.onLine === false) { toast('目前沒有網路，連上網路後才能上傳證件'); return; }
  const tag = id + ':' + key;
  S.uploading[tag] = true; refreshDrawer();
  try {
    const blob = await prepare(file);
    const type = blob.type || file.type;
    if (!ALLOWED.includes(type)) throw new Error('證件只能是 JPG、PNG、WebP 或 PDF');
    if (blob.size > 2000000) throw new Error('檔案太大（約 2MB 以內），請重新拍攝');
    const h0 = S.hires.get(id);
    const ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1].replace('jpeg', 'jpg');
    const j = await AU.api('photoUp', {image:{mime:type, name:`${(h0 && h0.name) || '未命名'}_${label}.${ext}`, data:await blobToB64(blob)}});
    PH.set(j.photo.id, {state:'ok', mime:type, url:URL.createObjectURL(blob)});
    let old = null;
    const ok = saveHire(id, r => { r.docs = obj(r.docs); old = r.docs[key] && r.docs[key].id; r.docs[key] = {id:j.photo.id, mime:type, at:Date.now(), by:myName()}; });
    if (!ok) { AU.api('photoDel', {id:j.photo.id}).catch(() => {}); return; }
    if (old && old !== j.photo.id) AU.api('photoDel', {id:old}).catch(() => {});
    toast(`已上傳：${label}`);
  } catch (e) { toast((e && e.message) || '上傳失敗，請再試一次'); }
  finally { delete S.uploading[tag]; refreshDrawer(); }
}
async function handleFiles(input){
  const slot = S.pendingSlot; S.pendingSlot = null;
  const files = [...(input.files || [])];
  input.value = '';
  if (!slot || !files.length || !canEdit()) return;
  if (slot.key === 'other_new') {
    S.uploading[slot.id + ':other_new'] = true; refreshDrawer();
    for (let i = 0; i < files.length; i++) await uploadOne(slot.id, `other_${Date.now()}_${i}`, files[i], '其他文件');
    delete S.uploading[slot.id + ':other_new']; refreshDrawer();
  } else {
    const def = DOC_SLOTS.find(s => s.key === slot.key);
    await uploadOne(slot.id, slot.key, files[0], def ? def.label : '其他文件');
  }
}
function deletePhoto(id, key){
  const h = S.hires.get(id); if (!h || !h.docs[key] || !canEdit()) return;
  const fid = h.docs[key].id;
  S.confirm = null;
  saveHire(id, r => { r.docs = obj(r.docs); delete r.docs[key]; });
  AU.api('photoDel', {id:fid}).catch(() => {});
  toast('已刪除證件');
}
function deleteRecord(id){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  const files = Object.values(h.docs).map(d => d.id);
  closeDrawer(true);
  ST.remove('hires', id);
  files.forEach(fid => AU.api('photoDel', {id:fid}).catch(() => {}));
  toast(`已刪除 ${nm(h)} 的資料`);
}

/* ================= 頁首、頁尾、同步狀態 ================= */
function renderViews(){
  const inFlow = [...S.hires.values()].filter(h => h.stage === 'interview' || ACTIVE.includes(h.stage)).length;
  let left = 0;
  for (const f of FREQS) { const d = S.checks[f.key].done; left += rtItems(f.key).filter(r => !(d[r.id] && d[r.id].at)).length; }
  const urgent = S.loaded ? overviewAlerts().filter(a => a.sev >= 2).length : 0;
  const tabs = [
    ['overview', '總覽', urgent ? `${urgent} 項緊急` : ''],
    ['pipeline', '新進人員・勞健保', S.loaded ? `${inFlow} 人` : ''],
    ['routine', '例行工作', S.loaded && S.routines.size ? `未完成 ${left}` : '']
  ];
  if (isAdmin()) tabs.push(['users', '管理', '']);
  $('#views').innerHTML = tabs.map(([k, t, b]) =>
    `<button class="view-btn" type="button" aria-selected="${S.view === k}" data-view="${k}">${t}${b ? `<span class="badge">${esc(b)}</span>` : ''}</button>`).join('');
}
function renderBanner(){
  const msgs = [];
  if (!((window.HR_CLOUD || {}).url || '').trim()) msgs.push('尚未設定雲端網址（config.js 的 HR_CLOUD.url），資料只存在這台裝置。');
  if (AU && AU.user() && !canEdit() && (S.view === 'pipeline' || S.view === 'overview')) msgs.push('你目前只能查看人事資料；需要修改請向管理員申請「人事資料編輯」權限。');
  const b = $('#banner');
  b.textContent = msgs.join(' ');
  b.hidden = !msgs.length;
}
function renderSync(){
  const st = ST.status(), el = $('#sync');
  const map = {loading:['busy','讀取中…'], syncing:['busy','同步中…'], pending:['busy','等待上傳'], synced:['ok','已同步'], offline:['warn','離線'], error:['bad','連線失敗']};
  const [cls, txt] = map[st.state] || ['', st.state];
  el.className = 'sync ' + cls;
  el.querySelector('span').textContent = txt;
  el.title = (st.detail ? st.detail + '。' : '') + (st.lastSync ? '上次同步 ' + new Date(st.lastSync).toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'}) + '。' : '') + '按一下立即同步';
}
function renderFoot(){
  const u = AU && AU.user();
  const me = u ? `<span>登入：<b>${esc(myName())}</b>${isAdmin() ? '（管理員）' : canEdit() ? '' : '（只能查看）'} <button type="button" class="link" data-act="logout">登出</button></span>` : '';
  const n = S.hires.size;
  $('#foot').innerHTML = `${me}<span>${n} 筆人事資料 · ${S.routines.size} 項例行工作</span>`;
}
function showView(){
  for (const k of VIEWS) $('#' + k + '-view').hidden = S.view !== k;
}

/* ================= 新進人員・勞健保 ================= */
function renderToolbar(){
  const [y, m] = S.month.split('-');
  $('#m-label').textContent = `${y} 年 ${+m} 月`;
  $('#m-next').disabled = S.month >= curMonth();
  $('#imp-btn').hidden = !canEdit();
  $('#slot-btn').hidden = !canEdit();
  const bb = $('#batch-btn');
  bb.hidden = !canEdit();
  bb.classList.toggle('on', S.batch);
  bb.setAttribute('aria-pressed', String(S.batch));
  bb.textContent = S.batch ? '結束批次整理' : '批次整理';
  $('#add-btn').hidden = !canEdit();
}
function renderStats(){
  const all = [...S.hires.values()];
  const mLabel = `${+S.month.slice(5)} 月`;
  const interviewed = all.filter(h => inMonth(ivDay(h)));
  const hired = interviewed.filter(h => h.result === 'hired' || ACTIVE.includes(h.stage) || h.stage === 'done');
  const rejected = interviewed.filter(h => h.stage === 'rejected');
  const decided = hired.length + rejected.length;
  const rate = decided ? Math.round(hired.length / decided * 100) + '%' : '—';
  const active = all.filter(h => ACTIVE.includes(h.stage));
  const t = today();
  const late = active.filter(h => h.startDate && h.startDate <= t);
  const done = all.filter(h => h.stage === 'done' && inMonth(doneDate(h)));
  const v = n => S.loaded ? n : '–';
  const items = [
    ['面試人數', v(interviewed.length), `${mLabel}面試`, ''],
    ['錄取人數', v(hired.length), `錄取率 ${S.loaded ? rate : '—'}`, ''],
    ['辦理中', v(active.length), '證件至勞健保之間', ''],
    ['已到職未加保', v(late.length), late.length ? '請立即申報加保' : '目前沒有', late.length ? 'alert' : ''],
    ['完成加保', v(done.length), `${mLabel}完成`, '']
  ];
  $('#stats').innerHTML = items.map(([k, val, s, cls]) =>
    `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${esc(s)}</div></div>`).join('');
}
function renderTabs(){
  $('#tabs').innerHTML = STAGES.map(st =>
    `<button class="tab" type="button" role="tab" aria-selected="${S.tab === st.key}" data-tab="${st.key}">${st.title}<span>${S.loaded ? columnItems(st.key).length : ''}</span></button>`).join('');
}
const chip = (text, cls) => `<span class="chip ${cls || ''}">${esc(text)}</span>`;
function cardHTML(h){
  const id = esc(h.id), canW = canEdit();
  const chips = [], acts = [];
  if (h.stage === 'interview') {
    if (h.interviewDate) chips.push(h.interviewDate === today() ? chip(`今天 ${h.interviewTime || ''} 面試`, 'warn') : chip(`面試 ${md(h.interviewDate)}${h.interviewTime ? ' ' + h.interviewTime : ''}`));
    if (h.source === 'web') chips.push(chip('線上應徵', 'ok'));
    else if (h.formAt) chips.push(chip(`填表 ${md(tsDate(h.formAt))}`));
    if (h.rating) chips.push(chip(`評分：${RATING[h.rating]}`, h.rating === 'D' ? 'danger' : (h.rating === 'A' || h.rating === 'B') ? 'ok' : ''));
    else if (h.comment) chips.push(chip('已填評語'));
    if (h.startDate) chips.push(chip(`預計到職 ${md(h.startDate)}`));
    if (canW) acts.push(
      `<button class="btn sm" type="button" data-act="comment" data-id="${id}">${h.comment ? '查看評語' : '填寫評語'}</button>`,
      `<button class="btn sm primary" type="button" data-act="hire" data-id="${id}">錄取</button>`,
      `<button class="btn sm" type="button" data-act="reject" data-id="${id}">未錄取</button>`);
  } else if (h.stage === 'done') {
    if (h.startDate) chips.push(chip(`到職 ${md(h.startDate)}`));
    const dd = doneDate(h); if (dd) chips.push(chip(`加保 ${md(dd)}`, 'ok'));
  } else {
    const due = dueInfo(h);
    chips.push(chip(due.text, due.cls));
    if (h.stage === 'docs') {
      const c = docCount(h);
      chips.push(chip(`證件 ${c.have}/${c.need}`, c.have >= c.need ? 'ok' : ''));
      if (canW) {
        acts.push(`<button class="btn sm" type="button" data-act="open" data-id="${id}">${c.have ? '查看證件' : '上傳證件'}</button>`);
        if (c.have >= c.need) acts.push(`<button class="btn sm primary" type="button" data-act="advance" data-id="${id}">下一步 →</button>`);
      }
    } else if (canW) {
      acts.push(`<button class="btn sm primary" type="button" data-act="advance" data-id="${id}">${ADV_LABEL[h.stage]}</button>`);
    }
  }
  const role = [h.position, h.dept].filter(Boolean).join('・');
  const batch = S.batch, picked = batch && S.sel.has(h.id);
  return `<article class="card${h.stage === 'done' ? ' is-done' : ''}${batch ? ' is-batch' : ''}${picked ? ' picked' : ''}">
    ${batch ? `<label class="pick"><input type="checkbox" data-pick="${id}"${picked ? ' checked' : ''} aria-label="選取 ${esc(nm(h))}"></label>` : ''}
    ${h.stage === 'done' ? '<span class="stamp" aria-hidden="true">已加保</span>' : ''}
    <button class="card-open" type="button" data-act="open" data-id="${id}"><span class="c-name">${esc(nm(h))}</span>${role ? `<span class="c-role">${esc(role)}</span>` : ''}</button>
    ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    ${acts.length && !batch ? `<div class="c-act">${acts.join('')}</div>` : ''}
  </article>`;
}
function renderBoard(){
  const mNum = +S.month.slice(5);
  $('#board').innerHTML = STAGES.map(st => {
    const items = S.loaded ? columnItems(st.key) : [];
    let body;
    if (!S.loaded) body = '<div class="col-empty">讀取中…</div>';
    else if (!items.length) body = `<div class="col-empty">${esc(S.q ? '沒有符合搜尋的人' : EMPTY[st.key])}</div>`;
    else body = items.map(cardHTML).join('');
    let extra = '';
    if (st.key === 'interview' && S.loaded) {
      const rej = rejectedItems();
      if (rej.length) extra = `<details class="rej"${S.rejOpen || S.batch ? ' open' : ''}><summary>未錄取・${mNum} 月 ${rej.length} 位</summary><ul>${rej.map(h =>
        S.batch
          ? `<li><label><input type="checkbox" class="pick-r" data-pick="${esc(h.id)}"${S.sel.has(h.id) ? ' checked' : ''}><span class="link">${esc(nm(h))}</span></label><span>${esc(h.position)}</span></li>`
          : `<li><button class="link" type="button" data-act="open" data-id="${esc(h.id)}">${esc(nm(h))}</button><span>${esc(h.position)}</span></li>`).join('')}</ul></details>`;
    }
    const hint = st.key === 'done' ? `${mNum} 月完成加保` : st.hint;
    const allPicked = items.length && items.every(h => S.sel.has(h.id));
    const colPick = S.batch && items.length ? `<button class="col-pick" type="button" data-pick-col="${st.key}">${allPicked ? '取消全選' : '全選'}</button>` : '';
    return `<section class="col${S.tab === st.key ? ' is-tab' : ''}" aria-labelledby="col-${st.key}">
      <header class="col-h">${st.n ? `<span class="col-n">${st.n}</span>` : '<span class="col-n fin">✓</span>'}<h2 class="col-t" id="col-${st.key}">${st.title}</h2><span class="col-c">${S.loaded ? items.length : ''}</span>${colPick}</header>
      <p class="col-hint">${esc(hint)}</p>
      <div class="col-body">${body}${extra}</div>
    </section>`;
  }).join('');
  const det = $('#board details.rej');
  if (det) det.addEventListener('toggle', () => { S.rejOpen = det.open; });
}

/* ================= 面試時段（線上應徵表單 apply.html 讓應徵者選） ================= */
const APPLY_URL = new URL('apply.html', location.href).href.replace(/[?#].*$/, '');
const SL = {confirm:null, msg:'', msgErr:false};
const WD_ = '日一二三四五六';
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WD_[d.getDay()]}）`; };
function slotList(){
  return ST.list('slots').filter(s => s && isDate(s.date) && /^\d{2}:\d{2}$/.test(s.time || ''))
    .map(s => ({id:String(s.id), date:s.date, time:s.time, cap:Math.max(1, Number(s.cap) || 1), closed:!!s.closed}))
    .sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
}
function slotBookings(){
  const m = new Map();
  for (const h of S.hires.values()) if (h.slotId) { if (!m.has(h.slotId)) m.set(h.slotId, []); m.get(h.slotId).push(h); }
  return m;
}
function openSlots(){ if (!canEdit()) return; SL.confirm = null; SL.msg = ''; renderSlots(); $('#slm').hidden = false; document.documentElement.classList.add('lock'); }
function closeSlots(){ $('#slm').hidden = true; if ($('#drawer').hidden) document.documentElement.classList.remove('lock'); }
function renderSlots(){
  if ($('#slm').hidden && !SL.rendering) { /* 視窗沒開就不畫 */ }
  const root = $('#sl-body'), t = today();
  const keep = {}; root.querySelectorAll('input').forEach(i => { if (i.id) keep[i.id] = i.value; });
  const all = slotList(), books = slotBookings();
  const upcoming = all.filter(s => s.date >= t), pastN = all.length - upcoming.length;
  const byDay = new Map();
  upcoming.forEach(s => { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });
  const days = [...byDay.entries()].map(([d, list]) => `<section class="sl-day"><h3>${dayLabel(d)}</h3>${list.map(s => {
    const who = books.get(s.id) || [], full = who.length >= s.cap, sid = esc(s.id);
    const acts = SL.confirm === s.id
      ? `<button class="btn sm danger-solid" type="button" data-sl="del-yes" data-id="${sid}">確定刪除</button><button class="btn sm ghost" type="button" data-sl="cancel">取消</button>`
      : `<button class="btn sm ghost" type="button" data-sl="toggle" data-id="${sid}">${s.closed ? '重新開放' : '關閉'}</button>${who.length ? '' : `<button class="btn sm ghost danger" type="button" data-sl="del" data-id="${sid}">刪除</button>`}`;
    return `<div class="sl-row${s.closed ? ' closed' : ''}"><span class="sl-time">${esc(s.time)}</span>
      <span class="sl-cnt">${s.closed ? '已關閉' : full ? `<b>額滿</b> ${who.length}/${s.cap}` : `${who.length}/${s.cap} 人`}</span>
      <span class="sl-who">${who.map(h => `<button class="link" type="button" data-sl="open" data-id="${esc(h.id)}">${esc(nm(h))}</button>`).join('') || '<span class="muted">還沒有人預約</span>'}</span>
      <span class="sl-acts">${acts}</span></div>`;
  }).join('')}</section>`).join('');
  root.innerHTML = `
    <div class="f"><span class="lbl">應徵連結（傳給應徵者，不用登入）</span>
      <div class="sl-link"><input id="sl-url" readonly value="${esc(APPLY_URL)}" aria-label="應徵連結"><button class="btn sm" type="button" data-sl="copy">複製</button><a class="btn sm" href="${esc(APPLY_URL)}" target="_blank" rel="noopener">開啟</a></div>
      <p class="note top" style="margin-top:6px">應徵者打開連結，先選一個還有空位的時段，再填人事資料表；送出後直接出現在「面試資料」，面試日期和時間都會帶入。用 LINE 傳時在網址後面加 <code>?openExternalBrowser=1</code>。</p></div>
    <form class="sl-add" id="sl-form" novalidate>
      <div class="f"><label for="sl-date">日期</label><input id="sl-date" type="date" value="${esc(keep['sl-date'] || '')}"></div>
      <div class="f"><label for="sl-times">時間（可以一次填多個，用空白或逗號分開）</label><input id="sl-times" placeholder="例如 10:00 10:30 14:00" value="${esc(keep['sl-times'] || '')}"></div>
      <div class="f"><label for="sl-cap">每個時段幾人</label><input id="sl-cap" type="number" min="1" max="20" value="${esc(keep['sl-cap'] || '1')}"></div>
      <button class="btn primary" type="submit">新增時段</button>
    </form>
    <p class="imp-msg${SL.msgErr ? ' err' : ''}" id="sl-msg" role="status">${esc(SL.msg)}</p>
    ${days || '<p class="rt-empty">還沒有今天以後的面試時段。先選日期、填時間，按「新增時段」。</p>'}
    ${pastN ? `<p class="muted">另有 ${pastN} 個過去的時段（不再顯示，也不能預約）。</p>` : ''}`;
}
function addSlots(){
  const date = $('#sl-date').value, cap = Math.min(20, Math.max(1, parseInt($('#sl-cap').value, 10) || 1));
  const fail = t => { SL.msg = t; SL.msgErr = true; renderSlots(); };
  const times = [...new Set(($('#sl-times').value.match(/\d{1,2}[:：]\d{2}/g) || []).map(x => { const [h, m] = x.replace('：', ':').split(':'); return pad(+h) + ':' + m; }))].filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
  if (!isDate(date)) return fail('請選日期。');
  if (date < today()) return fail('不能新增過去的日期。');
  if (!times.length) return fail('請填時間，例如 10:00 14:30。');
  const have = new Set(slotList().filter(s => s.date === date).map(s => s.time));
  const fresh = times.filter(x => !have.has(x)), now = Date.now(), by = myName();
  if (fresh.length) ST.saveMany('slots', fresh.map(time => ({id:rid('s'), date, time, cap, closed:false, createdAt:now, createdBy:by})));
  $('#sl-times').value = '';
  SL.msg = `已新增 ${dayLabel(date)} ${fresh.length} 個時段${times.length > fresh.length ? `（${times.length - fresh.length} 個已經有了）` : ''}。`; SL.msgErr = false;
  renderSlots();
}

/* ================= 批次整理（勾選多人一次錄取、未錄取、刪除） ================= */
const defaultBatchDate = () => ymd(new Date(Date.now() - 30 * 86400000));
function setBatch(on){
  S.batch = !!on && canEdit(); S.sel.clear(); S.batchConfirm = false;
  render();
}
function togglePick(id, on){
  if (on === undefined) on = !S.sel.has(id);
  if (on) S.sel.add(id); else S.sel.delete(id);
  S.batchConfirm = false;
  renderBoard(); renderBatchBar();
}
function togglePickCol(key){
  const items = columnItems(key), all = items.length && items.every(h => S.sel.has(h.id));
  items.forEach(h => { if (all) S.sel.delete(h.id); else S.sel.add(h.id); });
  S.batchConfirm = false;
  renderBoard(); renderBatchBar();
}
function pickBefore(date){
  if (!isDate(date)) { toast('請先選日期'); return; }
  const list = [...S.hires.values()].filter(visible).filter(h => h.stage === 'interview' && ivDay(h) && ivDay(h) <= date);
  list.forEach(h => S.sel.add(h.id));
  S.batchConfirm = false;
  renderBoard(); renderBatchBar();
  toast(list.length ? `選取了 ${list.length} 位 ${md(date)} 前（含當天）填表的面試者` : `沒有 ${md(date)} 前填表、還在面試資料的人`);
}
function batchPhotoCount(){ let n = 0; S.sel.forEach(id => { const h = S.hires.get(id); if (h) n += Object.keys(h.docs).length; }); return n; }
function renderBatchBar(){
  const bar = $('#batch-bar'), pv = $('#pipeline-view');
  if (!S.batch || S.view !== 'pipeline') { bar.hidden = true; pv.classList.remove('batching'); return; }
  for (const id of [...S.sel]) if (!S.hires.has(id)) S.sel.delete(id);
  const n = S.sel.size, dis = n ? '' : ' disabled', photos = batchPhotoCount();
  bar.hidden = false; pv.classList.add('batching');
  bar.innerHTML = `<div class="batch-in">
    <span class="batch-n">已選 <b>${n}</b> 人</span>
    ${S.batchConfirm
      ? `<span class="batch-confirm">確定刪除這 ${n} 人的所有資料？${photos ? `${photos} 份證件照片會一併刪除（雲端硬碟垃圾桶保留 30 天）。` : ''}刪除後不會再被表單自動匯入加回來。</span><button class="btn sm danger-solid" type="button" data-b="del-yes">確定刪除</button><button class="btn sm ghost" type="button" data-b="del-no">取消</button>`
      : `<button class="btn sm primary" type="button" data-b="hire"${dis}>錄取</button><button class="btn sm" type="button" data-b="reject"${dis}>未錄取</button><button class="btn sm ghost danger" type="button" data-b="del"${dis}>刪除</button><button class="btn sm ghost" type="button" data-b="clear"${dis}>清除選取</button>`}
    <span class="batch-date"><label for="batch-date">選取</label><input type="date" id="batch-date" value="${esc(S.batchDate || defaultBatchDate())}"><span>前（含當天）填表、還在「面試資料」的人</span><button class="btn sm" type="button" data-b="pick-date">選取</button></span>
    <span class="sp"></span><button class="btn sm" type="button" data-b="done">結束批次整理</button>
  </div>`;
}
function batchStage(hired){
  if (!canEdit()) return;
  const recs = [], before = []; let skipped = 0;
  const now = Date.now(), by = myName();
  S.sel.forEach(id => {
    const h = S.hires.get(id), cur = ST.get('hires', id);
    if (!h || !cur) return;
    if (h.stage !== 'interview') { if (!(h.stage === 'rejected' && !hired)) skipped++; return; }
    before.push(JSON.parse(JSON.stringify(cur)));
    const r = JSON.parse(JSON.stringify(cur));
    r.stage = hired ? 'docs' : 'rejected'; r.result = hired ? 'hired' : 'rejected';
    r.steps = obj(r.steps); r.steps.interview = {at:now, by};
    r.updatedAt = now; r.updatedBy = by;
    recs.push(r);
  });
  if (recs.length) ST.saveMany('hires', recs);
  S.sel.clear(); S.batchConfirm = false;
  const skip = skipped ? `（${skipped} 人不在「面試資料」這一步，沒有改）` : '';
  toast(recs.length ? `${recs.length} 人${hired ? '已錄取，移到「錄取・證件」' : '已標記為未錄取'}${skip}` : `沒有可以改的人${skip}`, recs.length ? () => ST.saveMany('hires', before) : null);
  render();
}
function batchDelete(){
  if (!canEdit()) return;
  const ids = [...S.sel].filter(id => S.hires.has(id));
  const files = [], before = [];
  ids.forEach(id => { Object.values(S.hires.get(id).docs).forEach(d => files.push(d.id)); const cur = ST.get('hires', id); if (cur) before.push(JSON.parse(JSON.stringify(cur))); });
  ST.removeMany('hires', ids);
  files.forEach(fid => AU.api('photoDel', {id:fid}).catch(() => {}));
  S.sel.clear(); S.batchConfirm = false;
  toast(`已刪除 ${ids.length} 人的資料`, files.length ? null : () => ST.saveMany('hires', before));
  render();
}

/* ================= 總覽 ================= */
function overviewAlerts(){
  const t = today(), out = [];
  for (const h of S.hires.values()) {
    if (!ACTIVE.includes(h.stage)) continue;
    if (!h.startDate) { out.push({h, sev:0, text:'未填到職日', cls:''}); continue; }
    const d = dayDiff(t, h.startDate);
    if (d < 0) out.push({h, sev:3, text:`已到職 ${-d} 天・未加保`, cls:'danger'});
    else if (d === 0) out.push({h, sev:2, text:'今日到職・須當日加保', cls:'warn'});
    else if (d <= 3) out.push({h, sev:1, text:`${d} 天後到職`, cls:'warn'});
  }
  return out.sort((a, b) => b.sev - a.sev || cmpDate(a.h.startDate, b.h.startDate));
}
function renderOverview(){
  const root = $('#overview-view');
  const d = new Date();
  const dateLabel = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
  let alertBody;
  if (!S.loaded) alertBody = '<p class="rt-empty">讀取中…</p>';
  else {
    const rows = overviewAlerts().map(a =>
      `<li><button class="ov-row" type="button" data-open="${esc(a.h.id)}"><span class="ov-who"><span class="ov-name">${esc(nm(a.h))}</span><span class="ov-sub">${esc([a.h.position, '目前：' + TITLE[a.h.stage]].filter(Boolean).join('・'))}</span></span>${chip(a.text, a.cls)}</button></li>`).join('');
    const pending = [...S.hires.values()].filter(h => h.stage === 'interview').length;
    const docsMissing = [...S.hires.values()].filter(h => h.stage === 'docs' && !docsReady(h)).length;
    alertBody = (rows ? `<ul class="ov-list">${rows}</ul>` : '<p class="rt-empty">目前沒有到職加保需要處理。</p>')
      + (docsMissing ? `<button class="ov-more" type="button" data-go="pipeline" data-tab="docs">證件未齊 ${docsMissing} 位 →</button>` : '')
      + (pending ? `<button class="ov-more" type="button" data-go="pipeline" data-tab="interview">面試待決定 ${pending} 位 →</button>` : '');
  }
  const flow = STAGES.filter(s => s.key !== 'done').map(s => {
    const n = S.loaded ? [...S.hires.values()].filter(h => h.stage === s.key).length : '–';
    return `<button class="fm" type="button" data-go="pipeline" data-tab="${s.key}"><span class="fm-n">${n}</span><span class="fm-t">${s.title}</span></button>`;
  }).join('');
  const rt = FREQS.map((f, i) => {
    const items = rtItems(f.key), done = S.checks[f.key].done;
    const left = items.filter(r => !(done[r.id] && done[r.id].at));
    const n = items.length - left.length;
    let body;
    if (!S.loaded) body = '<p class="rt-empty">讀取中…</p>';
    else if (!items.length) body = `<p class="rt-empty">${f.empty}</p>`;
    else if (!left.length) body = '<p class="rt-empty ok">✓ 全部完成</p>';
    else body = `<ul class="rt-list">${left.slice(0, 5).map(r => {
      const cid = esc(`ov-chk-${r.freq}-${r.id}`);
      return `<li class="rt-item"><input type="checkbox" id="${cid}" data-rt="check" data-id="${esc(r.id)}" data-freq="${r.freq}"><label for="${cid}"><span class="rt-t">${esc(r.title)}</span>${r.due ? `<span class="rt-due">${esc(r.due)}</span>` : ''}</label></li>`;
    }).join('')}</ul>${left.length > 5 ? `<button class="ov-more" type="button" data-go="routine">還有 ${left.length - 5} 項 →</button>` : ''}`;
    const pct = items.length ? Math.round(n / items.length * 100) : 0;
    return `<div class="ov-rt${i === 0 ? ' first' : ''}"><div class="rt-h"><h3>${f.title}</h3><span class="rt-period">${periodLabel(f.key)}</span><span class="rt-prog">${items.length ? `${n}/${items.length}` : ''}</span></div>${items.length ? `<div class="rt-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}${body}</div>`;
  }).join('');
  const t0 = today();
  const ups = [...S.hires.values()].filter(h => h.stage === 'interview' && h.interviewDate && h.interviewDate >= t0)
    .sort((a, b) => (a.interviewDate + (a.interviewTime || '99:99')) < (b.interviewDate + (b.interviewTime || '99:99')) ? -1 : 1);
  const upHTML = !S.loaded ? '<p class="rt-empty">讀取中…</p>' : ups.length
    ? `<ul class="ov-list">${ups.slice(0, 8).map(h => `<li><button class="ov-row" type="button" data-open="${esc(h.id)}"><span class="ov-who"><span class="ov-name">${esc(nm(h))}</span><span class="ov-sub">${esc([h.position, h.source === 'web' ? '線上應徵' : ''].filter(Boolean).join('・'))}</span></span>${chip((h.interviewDate === t0 ? '今天' : dayLabel(h.interviewDate)) + (h.interviewTime ? ' ' + h.interviewTime : ''), h.interviewDate === t0 ? 'warn' : '')}</button></li>`).join('')}</ul>${ups.length > 8 ? `<button class="ov-more" type="button" data-go="pipeline" data-tab="interview">還有 ${ups.length - 8} 位 →</button>` : ''}`
    : '<p class="rt-empty">接下來沒有排定的面試。</p>';
  root.innerHTML = `<p class="ov-date">今天 ${dateLabel}</p>
    <div class="ov-grid">
      <div class="ov-col">
        <section class="ov-card" aria-labelledby="ov-up-h"><header class="ov-h"><h2 id="ov-up-h">近期面試</h2>${canEdit() ? '<button class="link" type="button" data-slots="1">面試時段 →</button>' : ''}</header>${upHTML}</section>
        <section class="ov-card" aria-labelledby="ov-alert-h"><header class="ov-h"><h2 id="ov-alert-h">需要處理</h2></header>${alertBody}</section>
        <section class="ov-card" aria-labelledby="ov-flow-h"><header class="ov-h"><h2 id="ov-flow-h">新進人員・勞健保</h2><button class="link" type="button" data-go="pipeline">開啟看板 →</button></header><div class="flow-mini">${flow}</div></section>
      </div>
      <section class="ov-card" aria-labelledby="ov-rt-h"><header class="ov-h"><h2 id="ov-rt-h">例行工作・未完成</h2><button class="link" type="button" data-go="routine">${canRoutine() ? '管理清單' : '查看全部'} →</button></header>${rt}</section>
    </div>`;
}

/* ================= 例行工作 ================= */
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  return {y, w:Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)};
}
const mondayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);
function periodKeys(){
  const d = new Date(), wk = isoWeek(d);
  return {daily:'d-' + ymd(d), weekly:`w-${wk.y}-W${pad(wk.w)}`, monthly:'m-' + ymd(d).slice(0, 7)};
}
function periodStart(freq){
  const d = new Date();
  if (freq === 'daily') return ymd(d);
  if (freq === 'weekly') return ymd(mondayOf(d));
  return ymd(d).slice(0, 7) + '-01';
}
function periodLabel(freq){
  const d = new Date();
  if (freq === 'daily') return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
  if (freq === 'weekly') {
    const mon = mondayOf(d), sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return `${mon.getMonth() + 1}/${mon.getDate()}–${sun.getMonth() + 1}/${sun.getDate()}`;
  }
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}
const rtItems = freq => [...S.routines.values()].filter(r => r.freq === freq).sort((a, b) => a.order - b.order);
function rtItemHTML(r, st){
  const checked = !!(st && st.at);
  const cid = esc(`chk-${r.freq}-${r.id}`);
  return `<li class="rt-item${checked ? ' checked' : ''}"><input type="checkbox" id="${cid}" data-rt="check" data-id="${esc(r.id)}" data-freq="${r.freq}"${checked ? ' checked' : ''}>
    <label for="${cid}"><span class="rt-t">${esc(r.title)}</span>${r.due ? `<span class="rt-due">${esc(r.due)}</span>` : ''}${checked ? `<span class="rt-by">${fmtTime(st.at)}${st.by ? '・' + esc(st.by) : ''}</span>` : ''}</label></li>`;
}
function rtEditRow(r){
  const confirming = S.rtConfirm === r.id, id = esc(r.id);
  return `<div class="rt-edit"><input class="inp t" id="rt-t-${id}" data-rt-field="title" data-id="${id}" value="${esc(r.title)}" maxlength="80" aria-label="項目名稱">
    <input class="inp due" id="rt-d-${id}" data-rt-field="due" data-id="${id}" value="${esc(r.due)}" maxlength="30" placeholder="期限（選填）" aria-label="期限">
    <button class="btn sm ${confirming ? 'danger-solid' : 'ghost danger'}" type="button" data-rt="${confirming ? 'del-yes' : 'del'}" data-id="${id}">${confirming ? '確定刪除' : '刪除'}</button></div>`;
}
function rtColHTML(f){
  const items = rtItems(f.key), done = S.checks[f.key].done;
  const n = items.filter(r => done[r.id] && done[r.id].at).length;
  const manage = canRoutine();
  const editing = !!S.rtEdit[f.key] && manage;
  let list;
  if (!S.loaded) list = '<p class="rt-empty">讀取中…</p>';
  else if (editing) list = items.map(rtEditRow).join('') +
    `<form class="rt-add" data-freq="${f.key}"><input class="inp t" id="rt-new-${f.key}" maxlength="80" placeholder="例如：${esc(f.ex)}" aria-label="新增${f.title}項目">
      <input class="inp due" id="rt-newdue-${f.key}" maxlength="30" placeholder="期限（選填）" aria-label="期限"><button class="btn sm primary" type="submit">新增</button></form>`;
  else if (!items.length) list = `<p class="rt-empty">${f.empty}${manage ? '，按「編輯」新增項目。' : '。'}</p>`;
  else list = `<ul class="rt-list">${items.map(r => rtItemHTML(r, done[r.id])).join('')}</ul>`;
  const pct = items.length ? Math.round(n / items.length * 100) : 0;
  return `<section class="rt-col" aria-labelledby="rt-${f.key}">
    <header class="rt-h"><h2 id="rt-${f.key}">${f.title}</h2><span class="rt-period">${periodLabel(f.key)}</span><span class="rt-prog">${items.length ? `${n}/${items.length}` : ''}</span>${manage && S.loaded ? `<button class="btn sm ghost" type="button" data-rt="edit" data-freq="${f.key}">${editing ? '完成' : '編輯'}</button>` : ''}</header>
    ${items.length && !editing ? `<div class="rt-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}
    ${list}
  </section>`;
}
function renderRoutine(){
  const root = $('#routine-view');
  const active = document.activeElement;
  const aid = active && root.contains(active) ? active.id : null;
  let sel = null;
  try { if (aid && typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd]; } catch {}
  const vals = {};
  root.querySelectorAll('.inp').forEach(i => { if (i.id) vals[i.id] = i.value; });
  root.innerHTML = `<p class="rt-intro">勾選紀錄依期間自動重新開始：每日於午夜、每週於週一、每月於 1 日。每個人都可以打勾，會記下時間和打勾的人。</p>
    <div class="rt-grid">${FREQS.map(rtColHTML).join('')}</div>`;
  for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el && root.contains(el)) el.value = v; }
  if (aid) {
    const el = document.getElementById(aid);
    if (el && root.contains(el)) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} }
  }
}
function toggleCheck(freq, itemId, on){
  if (!FREQ_KEYS.includes(freq)) return;
  const key = periodKeys()[freq], cur = ST.get('checks', key);
  const rec = cur ? JSON.parse(JSON.stringify(cur)) : {id:key, date:periodStart(freq), freq, done:{}};
  rec.done = obj(rec.done);
  if (on) rec.done[itemId] = {at:Date.now(), by:myName()}; else delete rec.done[itemId];
  ST.save('checks', rec);
}
function addRoutine(freq){
  if (!FREQ_KEYS.includes(freq) || !canRoutine()) return;
  const t = $('#rt-new-' + freq), du = $('#rt-newdue-' + freq);
  const title = t.value.trim(), due = du.value.trim();
  if (!title) { t.focus(); return; }
  t.value = ''; du.value = '';
  const items = rtItems(freq);
  const order = items.length ? Math.max(...items.map(i => i.order)) + 1 : 1;
  ST.save('routines', {id:rid('r'), freq, title, due, order, createdAt:Date.now(), createdBy:myName()});
  const t2 = $('#rt-new-' + freq); if (t2) t2.focus();
}

/* ================= 管理（人員與權限） ================= */
async function loadUsers(){
  U.loading = true; renderUsers();
  try { const j = await AU.api('users'); U.list = j.users || []; U.admins = j.admins || []; U.error = ''; }
  catch (e) { U.error = e.message; }
  U.loading = false; renderUsers();
}
function renderUsers(){
  const root = $('#users-view');
  if (!isAdmin()) { root.innerHTML = '<div class="adm"><p class="rt-empty">只有管理員可以看這一頁。</p></div>'; return; }
  if (!U.list && !U.loading && !U.error) setTimeout(loadUsers, 0);
  const when = ms => ms ? new Date(ms).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '還沒登入過';
  let people;
  if (!U.list) people = U.error ? `<p class="imp-msg err">讀不到人員名單：${esc(U.error)}</p><button class="btn sm" type="button" data-u="reload">重試</button>` : '<p class="rt-empty">正在讀取人員名單…</p>';
  else {
    const admins = U.admins.map(a => `<div class="urow"><div class="urow-main"><b>${esc(a)}</b><div class="uchips"><span class="chip ok">管理員：全部權限</span></div></div><span class="muted">要更換管理員，請改雲端後端 Code.gs 的 ADMIN_EMAILS_</span></div>`).join('');
    const rows = U.list.map(u => {
      const e = esc(u.email);
      const confirming = U.confirm === u.email;
      return `<div class="urow"><div class="urow-main"><b>${esc(u.name || u.email)}</b><span class="hint">${e} · 最後登入 ${esc(when(u.lastLogin))}</span>
        <div class="uchips">${u.enabled ? '' : '<span class="chip danger">已停用</span>'}${(u.pages || []).map(p => `<span class="chip ok">${esc(PERM_LABEL[p] || p)}</span>`).join('') || '<span class="chip">只能查看</span>'}</div></div>
        <div class="urow-act">${confirming
          ? `<span class="confirm-q" style="width:auto">確定移除？</span><button class="btn sm danger-solid" type="button" data-u="del-yes" data-email="${e}">移除</button><button class="btn sm ghost" type="button" data-u="cancel">取消</button>`
          : `<button class="btn sm" type="button" data-u="edit" data-email="${e}">編輯</button><button class="btn sm" type="button" data-u="toggle" data-email="${e}">${u.enabled ? '停用' : '啟用'}</button><button class="btn sm ghost danger" type="button" data-u="del" data-email="${e}">移除</button>`}</div></div>`;
    }).join('');
    people = admins + rows + (U.list.length ? '' : '<p class="rt-empty">還沒有加入任何同事。按「＋ 新增人員」，輸入同事的 Gmail 並勾選權限。</p>') + (U.loading ? '<p class="rt-empty">更新中…</p>' : '');
  }
  root.innerHTML = `<div class="adm">
    <h1>管理</h1>
    <section class="ov-card"><header class="ov-h"><h2>人員與權限</h2><span class="sp"></span><button class="btn primary" type="button" data-u="add">＋ 新增人員</button></header>
      <p class="muted">用 Gmail 加入同事。名單內的人都能查看人事資料與打勾例行工作；其他動作依勾選的權限。</p>
      ${people}
    </section>
    ${formSectionHTML()}
  </div>`;
}

/* ---------- 人事資料表自動匯入（管理員連結雲端硬碟資料夾） ---------- */
const FS = {configured:null, url:'', sheetName:'', mode:'', lastSync:0, lastError:'', days:30, shareTo:'', draft:null, draftDays:null, busy:false, msg:'', msgErr:false, confirmUnlink:false, loaded:false};
let formSyncAt = 0;
function applyFormStatus(j){
  if (!j || typeof j !== 'object') return;
  FS.configured = !!j.configured;
  FS.lastSync = j.lastSync || 0; FS.lastError = j.lastError || ''; FS.sheetName = j.sheetName || ''; FS.mode = j.mode || '';
  if (typeof j.days === 'number') FS.days = j.days;
  if (typeof j.url === 'string') FS.url = j.url;
  if (j.shareTo) FS.shareTo = j.shareTo;
  FS.loaded = true;
}
async function formSync(force){
  if (!AU || !AU.user() || navigator.onLine === false) return;
  if (!force && Date.now() - formSyncAt < 60000) return;
  formSyncAt = Date.now();
  try {
    const j = await AU.api('formSync', force ? {force:true} : {});
    applyFormStatus(j);
    if (j.added) { toast(`人事資料表有 ${j.added} 筆新資料，已加入「面試資料」`); ST.syncNow(); }
    else if (j.updated) ST.syncNow();
    if (S.view === 'users') renderUsers();
  } catch (e) { /* 同步失敗不打擾使用者，下次再試 */ }
}
async function loadFormStatus(){
  FS.loading = true;
  try {
    const j = await AU.api('formSync', {});
    applyFormStatus(j);
    if (j.added) { toast(`人事資料表有 ${j.added} 筆新資料，已加入「面試資料」`); ST.syncNow(); }
  } catch (e) { FS.msg = e.message; FS.msgErr = true; }
  FS.loading = false; FS.loaded = true;
  if (S.view === 'users') renderUsers();
}
function formSectionHTML(){
  if (!FS.loaded && !FS.loading) setTimeout(loadFormStatus, 0);
  const when = ms => ms ? new Date(ms).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '還沒同步過';
  const src = FS.mode === 'docs' ? '人事資料表文件' : FS.mode === 'sheet' ? '回覆試算表' : '';
  const status = !FS.loaded ? '讀取中…'
    : FS.configured ? `已連結「${FS.sheetName || '資料夾'}」${src ? `（${src}）` : ''}・上次同步 ${when(FS.lastSync)}・每 10 分鐘自動同步`
    : '尚未連結：新的應徵者要用「匯入表單回覆」手動匯入。';
  const days = FS.draftDays != null ? FS.draftDays : FS.days;
  const url = FS.draft != null ? FS.draft : FS.url;
  const opt = (v, t) => `<option value="${v}"${Number(days) === v ? ' selected' : ''}>${t}</option>`;
  return `<section class="ov-card" aria-labelledby="fl-h"><header class="ov-h"><h2 id="fl-h">人事資料表自動匯入</h2></header>
    <p class="muted">貼上放「人事資料表文件」的雲端硬碟資料夾網址（或表單的回覆試算表）。要先用擁有資料夾的帳號，把資料夾共用給 <b>${esc(FS.shareTo || '管理員的 Gmail')}</b>（檢視者）。之後每 10 分鐘、以及有人打開 App 時，新的應徵者會自動加進「面試資料」；文件之後被修改，App 裡的資料也會跟著更新（評語、進度不會被蓋掉）。</p>
    <p class="${FS.configured ? '' : 'muted'}">${esc(status)}</p>
    ${FS.lastError ? `<p class="imp-msg err">上次同步失敗：${esc(FS.lastError)}</p>` : ''}
    <div class="fl-row">
      <input class="inp" id="fl-url" type="url" value="${esc(url)}" placeholder="https://drive.google.com/drive/folders/…" aria-label="資料夾或試算表網址">
      <select class="inp" id="fl-days" aria-label="第一次匯入的範圍">${opt(30, '最近 30 天')}${opt(90, '最近 90 天')}${opt(0, '全部')}</select>
      <button class="btn primary" type="button" data-u="fl-link"${FS.busy ? ' disabled' : ''}>${FS.configured ? '重新連結' : '連結'}</button>
    </div>
    <p class="muted">第一次連結只匯入所選範圍內的資料；之後只加新的，在看板上刪掉的人不會被加回來。</p>
    ${FS.msg ? `<p class="imp-msg${FS.msgErr ? ' err' : ''}" role="status">${esc(FS.msg)}</p>` : ''}
    ${FS.configured ? `<div class="fl-row">${FS.confirmUnlink
      ? '<span class="confirm-q" style="width:auto">確定取消連結？已匯入的資料會留著。</span><button class="btn sm danger-solid" type="button" data-u="fl-unlink-yes">取消連結</button><button class="btn sm ghost" type="button" data-u="fl-cancel">不要</button>'
      : `<button class="btn sm" type="button" data-u="fl-sync"${FS.busy ? ' disabled' : ''}>立即同步</button><button class="btn sm ghost danger" type="button" data-u="fl-unlink">取消連結</button>`}</div>` : ''}
  </section>`;
}
async function formAdmin(action, payload, okMsg){
  FS.busy = true; FS.msg = action === 'formLink' ? '連結中，第一次讀取資料夾可能要一兩分鐘…' : '處理中…'; FS.msgErr = false; renderUsers();
  try {
    const j = await AU.api(action, payload || {});
    applyFormStatus(j);
    FS.draft = null; FS.draftDays = null; FS.confirmUnlink = false;
    FS.msg = okMsg(j); FS.msgErr = false;
    if (j.added || j.updated) ST.syncNow();
  } catch (e) { FS.msg = e.message; FS.msgErr = true; }
  FS.busy = false; renderUsers();
}
function openUserForm(u){
  U.editing = u ? u.email : null;
  $('#u-title').textContent = u ? '編輯人員' : '新增人員';
  const em = $('#u-email');
  em.value = u ? u.email : ''; em.readOnly = !!u;
  $('#u-name').value = u ? (u.name || '') : '';
  const sel = u ? (u.pages || []) : ['edit'];
  $('#u-perms').innerHTML = PERMS.map(p => `<label class="permopt" for="u-p-${p.id}"><input type="checkbox" id="u-p-${p.id}" value="${p.id}"${sel.includes(p.id) ? ' checked' : ''}><span><b>${p.label}</b><small>${p.desc}</small></span></label>`).join('');
  $('#u-err').textContent = '';
  $('#umodal').hidden = false;
  document.documentElement.classList.add('lock');
  setTimeout(() => (u ? $('#u-name') : em).focus(), 0);
}
function closeUserForm(){ $('#umodal').hidden = true; U.editing = null; if ($('#drawer').hidden) document.documentElement.classList.remove('lock'); }
async function userCall(action, payload, okMsg){
  try { const j = await AU.api(action, payload); U.list = j.users || U.list; U.confirm = null; renderUsers(); toast(okMsg); }
  catch (e) { toast(e.message); }
}

/* ================= 詳細資料（抽屜） ================= */
const byHTML = name => name ? `・${esc(name)}` : '';
function stepsHTML(h){
  const canW = canEdit();
  if (h.stage === 'rejected') {
    const s = obj(h.steps.interview);
    return `<section class="sec"><h3>流程進度</h3><ol class="steps"><li class="step rej"><span class="dot">✕</span><div>
      <div class="step-t">面試結果：未錄取</div>${s.at ? `<div class="step-m">${fmtTime(s.at)}${byHTML(s.by)}</div>` : ''}
      ${canW ? '<div class="step-a"><button class="btn sm" type="button" data-act="back">重新列入面試</button></div>' : ''}
    </div></li></ol></section>`;
  }
  const cur = FLOW.indexOf(h.stage);
  const rows = STEP_DEFS.map((d, i) => {
    const st = obj(h.steps[d.key]);
    const state = i < cur ? 'done' : i === cur ? 'cur' : 'todo';
    let meta = '', act = '';
    if (state === 'done') meta = st.at ? `${fmtTime(st.at)}${byHTML(st.by)}` : '已完成';
    if (state === 'cur') {
      meta = esc(STEP_HINT[d.key]);
      if (canW) {
        if (d.key === 'interview') act = '<button class="btn sm primary" type="button" data-act="hire">錄取</button><button class="btn sm" type="button" data-act="reject">未錄取</button>';
        else if (d.key === 'docs') {
          const ok = docsReady(h);
          act = `<button class="btn sm primary" type="button" data-act="advance"${ok ? '' : ' disabled'}>${ADV_LABEL.docs}</button>` + (ok ? '' : '<span class="step-note">需先上傳身分證／居留證正反面</span>');
        } else act = `<button class="btn sm primary" type="button" data-act="advance">${ADV_LABEL[d.key]}</button>`;
        if (i > 0) act += '<button class="btn sm ghost" type="button" data-act="back">退回上一步</button>';
      }
    }
    const title = (d.key === 'interview' && state === 'done') ? '面試結果：錄取' : d.label;
    return `<li class="step ${state}"><span class="dot">${state === 'done' ? '✓' : i + 1}</span><div>
      <div class="step-t">${title}</div>${meta ? `<div class="step-m">${meta}</div>` : ''}${act ? `<div class="step-a">${act}</div>` : ''}
    </div></li>`;
  }).join('');
  const tail = h.stage === 'done'
    ? `<div class="all-done"><span class="stamp lg">已加保</span><span>全部步驟完成</span>${canW ? '<button class="btn sm ghost" type="button" data-act="back">退回上一步</button>' : ''}</div>` : '';
  return `<section class="sec"><h3>流程進度</h3><ol class="steps">${rows}</ol>${tail}</section>`;
}
function slotHTML(h, s, canUp){
  const e = h.docs[s.key];
  const busy = S.uploading[h.id + ':' + s.key];
  const confirming = S.confirm && S.confirm.type === 'photo' && S.confirm.key === s.key;
  const k = esc(s.key), label = esc(s.label);
  let thumb;
  if (busy) thumb = '<div class="thumb empty busy">上傳中…</div>';
  else if (e && !canPii()) thumb = '<div class="thumb empty">已上傳<br>（需要「查看證件」權限才能看）</div>';
  else if (e) {
    const p = photoOf(e.id);
    if (p.state === 'loading') thumb = '<div class="thumb empty busy">載入中…</div>';
    else if (p.state === 'err') thumb = `<button class="thumb empty" type="button" data-act="photo-retry" data-fid="${esc(e.id)}">讀取失敗，按一下重試<br><small>${esc(p.msg || '')}</small></button>`;
    else if (e.mime === 'application/pdf') thumb = `<button class="thumb pdf" type="button" data-act="pdf" data-fid="${esc(e.id)}">PDF 檔案・開啟</button>`;
    else thumb = `<button class="thumb" type="button" data-act="zoom" data-fid="${esc(e.id)}" aria-label="放大檢視 ${label}"><img src="${esc(p.url)}" alt="${label}"></button>`;
  } else thumb = '<div class="thumb empty">尚未上傳</div>';
  let btns = '';
  if (canUp && !busy) {
    btns = confirming
      ? `<span class="confirm-q">刪除這份證件？</span><button class="btn sm danger-solid" type="button" data-act="photo-del-yes" data-key="${k}">刪除</button><button class="btn sm ghost" type="button" data-act="cancel">取消</button>`
      : `<button class="btn sm" type="button" data-act="cam" data-key="${k}">${e ? '重拍' : '拍照'}</button><button class="btn sm" type="button" data-act="pick" data-key="${k}">${e ? '換檔' : '選檔'}</button>${e ? `<button class="btn sm ghost danger" type="button" data-act="photo-del" data-key="${k}" aria-label="刪除 ${label}">刪除</button>` : ''}`;
  }
  const meta = e && e.at ? `<div class="slot-m">${fmtTime(e.at)}${byHTML(e.by)}</div>` : '';
  return `<div class="slot${e ? ' has' : ''}"><div class="slot-l">${label}${s.required ? '<span class="req">必要</span>' : ''}</div>${thumb}${meta}${btns ? `<div class="slot-btns">${btns}</div>` : ''}</div>`;
}
function docsHTML(h){
  const canUp = canEdit();
  const others = Object.keys(h.docs).filter(k => k.startsWith('other_')).sort();
  const slots = [...DOC_SLOTS, ...others.map((k, i) => ({key:k, label:`其他文件 ${i + 1}`, required:false}))];
  const busyOther = S.uploading[h.id + ':other_new'];
  const add = canUp ? `<div class="slot add"><div class="slot-l">新增其他文件</div><div class="thumb empty${busyOther ? ' busy' : ''}">${busyOther ? '上傳中…' : '健保眷屬、學歷證明等'}</div>${busyOther ? '' : '<div class="slot-btns"><button class="btn sm" type="button" data-act="cam" data-key="other_new">拍照</button><button class="btn sm" type="button" data-act="pick" data-key="other_new">選檔</button></div>'}</div>` : '';
  const c = docCount(h);
  return `<section class="sec"><h3>證件照片 <span class="h-count">必要 ${c.have}/${c.need}</span></h3>
    <div class="slots">${slots.map(s => slotHTML(h, s, canUp)).join('')}${add}</div>
    <p class="note">手機按「拍照」會直接開相機；照片自動縮小後存在公司雲端硬碟的「證件照片」資料夾，只有名單內、有「查看證件」權限的人看得到。</p></section>`;
}
function footHTML(h){
  const created = h.createdAt ? `建立於 ${fmtTime(h.createdAt)}${byHTML(h.createdBy)}` : '';
  let del = '';
  if (canEdit()) {
    del = (S.confirm && S.confirm.type === 'record')
      ? `<div class="confirm-box"><p>確定刪除 ${esc(nm(h))} 的所有資料？證件照片會一併刪除（雲端硬碟垃圾桶保留 30 天）。</p><div class="row"><button class="btn sm danger-solid" type="button" data-act="rec-del-yes">確定刪除</button><button class="btn sm ghost" type="button" data-act="cancel">取消</button></div></div>`
      : '<button class="btn sm ghost danger" type="button" data-act="rec-del">刪除此筆資料</button>';
  }
  return `<div class="p-foot"><span class="muted">${created}</span>${del}</div>`;
}
function maskId(s){ return s.length > 5 ? s.slice(0, 2) + '*'.repeat(s.length - 5) + s.slice(-3) : s; }
function ageOf(b){
  if (!isDate(b)) return '';
  const t = today();
  let a = +t.slice(0, 4) - +b.slice(0, 4);
  if (t.slice(5) < b.slice(5)) a--;
  return (a >= 0 && a < 120) ? `${a} 歲` : '';
}
const slash = s => isDate(s) ? s.replace(/-/g, '/') : (s || '');
function langDots(v){
  const n = parseInt(v, 10);
  if (!(n >= 1 && n <= 3)) return esc(v);
  return `<span class="dots" aria-label="${n} 分，滿分 3">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>`;
}
function formDataHTML(h){
  const F = h.form;
  const row = (label, v) => v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : '';
  const rowHTML = (label, html) => html ? `<dt>${label}</dt><dd>${html}</dd>` : '';
  const dl = s => s ? `<dl class="fd">${s}</dl>` : '<p class="fd-small">未填寫</p>';
  const age = ageOf(F.birth);
  const birth = F.birth ? slash(F.birth) + (age ? `（${age}）` : '') : '';
  const showFull = canPii() && S.showId;
  const idHTML = F.idNo ? `<span class="idv">${esc(showFull ? F.idNo : maskId(F.idNo))}</span>${canPii() ? `<button class="btn sm ghost" type="button" data-act="toggle-id">${S.showId ? '隱藏' : '顯示'}</button>` : ''}` : '';
  const eduLine = [F.edu, F.gradStatus].filter(Boolean).join('・');
  const key = [['最快可到職', slash(F.available)], ['希望待遇', F.salary || ''], ['最高學歷', eduLine]].filter(([, v]) => v);
  const langs = [['英文', F.langEn], ['台語', F.langTw], ['日文', F.langJp]].filter(([, v]) => v).map(([l, v]) => `${l} ${langDots(v)}`).join('　');
  const jobs = [1, 2, 3].map(i => ({co:F['job' + i + 'Co'], time:F['job' + i + 'Time'] || (i === 3 ? F.job3TimeAlt : ''), desc:F['job' + i + 'Desc'], leave:F['job' + i + 'Leave']}))
    .filter(j => j.co || j.time || j.desc || j.leave);
  const jobsHTML = jobs.length
    ? jobs.map(j => `<div class="job">${j.co ? `<div class="job-h">${esc(j.co)}</div>` : ''}<dl class="fd">${row('工作時間', j.time)}${row('內容與薪資', j.desc)}${row('離職原因', j.leave)}</dl></div>`).join('')
    : '<p class="fd-small">未填寫</p>';
  const filled = h.formAt ? `應徵者於 ${fmtTime(h.formAt)} 填寫` : (F.ts ? `填寫時間 ${F.ts}` : '');
  return `<section class="sec fdata"><h3>面試資料 <span class="h-count">${esc(filled)}</span>${h.docUrl ? `<a class="link doc-link" href="${esc(h.docUrl)}" target="_blank" rel="noopener">開啟原始文件 ↗</a>` : ''}</h3>
    ${key.length ? `<div class="fd-key">${key.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    <h4>基本資料</h4>${dl(row('應徵職務', F.position) + row('姓名', F.name) + row('性別', F.gender) + row('出生年月日', birth) + row('兵役狀況', F.military) + row('身分狀態', F.identity) + rowHTML('身分證字號', idHTML))}
    <h4>聯絡資料</h4>${dl(row('手機', F.mobile) + row('家電', F.homePhone) + row('電子郵件', F.email || F.email2) + row('戶籍地址', F.addrReg) + row('通訊地址', F.addrMail))}
    <h4>學歷與能力</h4>${dl(row('最高學歷', eduLine) + row('學校科系', F.school) + row('畢業年份', slash(F.gradYear)) + rowHTML('語言能力', langs) + row('專業證照', F.cert) + row('電腦技能', F.computer))}
    <h4>工作經歷</h4>${jobsHTML}
    <h4>緊急聯絡人</h4>${dl(row('姓名', F.ecName) + row('關係', F.ecRel) + row('電話', F.ecPhone))}
    ${F.extra.length ? `<h4>其他欄位</h4>${dl(F.extra.map(e => row(esc(e.k), e.v)).join(''))}` : ''}
    ${F.consent ? `<h4>聲明與同意</h4><p class="fd-small">${esc(F.consent)}</p>` : ''}
  </section>`;
}
function refreshDrawer(){
  if (!S.openId || S.creating) return;
  const h = S.hires.get(S.openId);
  if (!h) { if (S.loaded) { closeDrawer(true); toast('這筆資料已被刪除'); } return; }
  $('#d-title').textContent = nm(h);
  const pill = $('#d-pill');
  pill.textContent = TITLE[h.stage];
  pill.className = 'pill' + (h.stage === 'rejected' ? ' rej' : '');
  pill.hidden = false;
  $('#iv-form').hidden = false;
  const panel = $('.panel');
  panel.classList.toggle('st-interview', h.stage === 'interview');
  panel.classList.toggle('wide', h.stage === 'interview' && !!h.form);
  $('#d-form').innerHTML = h.form ? formDataHTML(h) : '';
  $('#iv-meta').textContent = h.ivAt ? `最後更新 ${fmtTime(h.ivAt)}${h.ivBy ? '・' + h.ivBy : ''}` : '';
  const steps = stepsHTML(h);
  const docs = (h.stage !== 'interview' && h.stage !== 'rejected') ? docsHTML(h) : '';
  $('#d-dyn').innerHTML = h.stage === 'docs' ? docs + steps : steps + docs;
  $('#d-foot').innerHTML = footHTML(h);
}
const FIELDS = [['f-name','name'],['f-position','position'],['f-dept','dept'],['f-phone','phone'],['f-interview','interviewDate'],['f-ivtime','interviewTime'],['f-start','startDate'],['f-note','note']];
function fillForm(h){
  const ro = !canEdit();
  for (const [fid, key] of FIELDS) { const el = $('#' + fid); el.value = h ? h[key] : ''; el.disabled = ro; }
  if (!h) $('#f-interview').value = today();
  $('#f-submit').textContent = S.creating ? '建立' : '儲存';
  $('#f-submit').hidden = ro;
  setSaveState('');
}
function readForm(){
  const v = {};
  for (const [fid, key] of FIELDS) v[key] = $('#' + fid).value.trim();
  if (!isDate(v.interviewDate)) v.interviewDate = '';
  if (!isDate(v.startDate)) v.startDate = '';
  if (!/^\d{2}:\d{2}$/.test(v.interviewTime)) v.interviewTime = '';
  return v;
}
function setSaveState(t, err){ const el = $('#save-state'); el.textContent = t; el.className = 'save-state' + (err ? ' err' : ''); }
function setIvState(t, err){ const el = $('#iv-state'); el.textContent = t; el.className = 'save-state' + (err ? ' err' : ''); }
function fillIv(h){
  const ro = !canEdit();
  $('#iv-interviewer').value = h ? h.interviewer : '';
  $('#iv-comment').value = h ? h.comment : '';
  document.querySelectorAll('input[name="iv-rating"]').forEach(r => { r.checked = !!h && r.value === h.rating; r.disabled = ro; });
  $('#iv-interviewer').disabled = ro;
  $('#iv-comment').disabled = ro;
  $('#iv-submit').hidden = ro;
  setIvState('');
}
function readIv(){
  const r = document.querySelector('input[name="iv-rating"]:checked');
  return {interviewer:$('#iv-interviewer').value.trim(), rating: r && RATING_KEYS.includes(r.value) ? r.value : '', comment:$('#iv-comment').value.trim()};
}
function saveIv(auto){
  const id = S.openId;
  if (!id || S.creating || !canEdit()) return;
  const h = S.hires.get(id); if (!h) return;
  const v = readIv(), changed = {};
  for (const k of Object.keys(v)) if (v[k] !== h[k]) changed[k] = v[k];
  if (!Object.keys(changed).length) { if (!auto) setIvState('沒有變更'); return; }
  saveHire(id, r => Object.assign(r, changed, {ivAt:Date.now(), ivBy:myName()}));
  setIvState(auto ? '已自動儲存' : '已儲存');
}
let lastFocus = null;
function showDrawer(){
  const d = $('#drawer');
  if (d.hidden) { lastFocus = document.activeElement; d.hidden = false; document.documentElement.classList.add('lock'); }
}
function openDrawer(id, focus){
  if (S.openId && S.openId !== id && !S.creating) saveIv(true);
  S.openId = id; S.creating = false; S.confirm = null; S.showId = false;
  showDrawer();
  const h = S.hires.get(id);
  fillForm(h); fillIv(h);
  refreshDrawer();
  $('.panel').scrollTop = 0;
  if (focus === 'comment' && canEdit()) $('#iv-comment').focus();
  else $('#d-close').focus();
}
function openCreate(){
  if (!canEdit()) return;
  S.openId = null; S.creating = true; S.confirm = null;
  showDrawer();
  $('#d-title').textContent = '新增面試者';
  $('#d-pill').hidden = true;
  $('#iv-form').hidden = true;
  $('.panel').classList.remove('st-interview', 'wide');
  $('#d-form').innerHTML = ''; $('#d-dyn').innerHTML = ''; $('#d-foot').innerHTML = '';
  fillForm(null);
  $('#f-name').focus();
}
function closeDrawer(skipSave){
  if (!skipSave && S.openId && !S.creating) saveIv(true);
  $('#drawer').hidden = true;
  document.documentElement.classList.remove('lock');
  S.openId = null; S.creating = false; S.confirm = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

/* ================= 匯入人事資料表回覆 ================= */
function parseDelimited(text, delim){
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"' && f === '') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const normH = s => String(s).replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
function normDateStr(s){
  const m = String(s).trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : String(s).trim();
}
function parseTs(s){
  const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*(上午|下午|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(上午|下午|AM|PM|am|pm)?/);
  if (!m) return null;
  let hh = +m[5];
  const ap = m[4] || m[8];
  if (ap) { const pm = /下午|PM|pm/.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  const d = new Date(+m[1], +m[2] - 1, +m[3], hh, +m[6], +(m[7] || 0));
  return isNaN(d.getTime()) ? null : d.getTime();
}
function hashStr(s){
  let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
function mapRows(rows){
  if (rows.length < 2) return {error:'找不到資料。請連同第一列標題一起複製貼上。'};
  const rawHead = rows[0], head = rawHead.map(normH), seen = {};
  const keys = head.map(hd => {
    const list = Object.prototype.hasOwnProperty.call(COLS, hd) ? COLS[hd] : null;
    if (!list) return null;
    const n = seen[hd] || 0; seen[hd] = n + 1;
    return list[n] || null;
  });
  if (!keys.includes('name')) return {error:'第一列標題對不上人事資料表的欄位（找不到「姓名」）。請確認有複製到標題列。'};
  const out = [], ids = new Set();
  for (const r of rows.slice(1)) {
    const rec = {}, extra = [];
    head.forEach((hd, i) => {
      const v = String(r[i] == null ? '' : r[i]).trim();
      if (!v) return;
      const k = keys[i];
      if (k) { if (!rec[k]) rec[k] = DATE_KEYS.includes(k) ? normDateStr(v) : v.slice(0, 3000); }
      else if (extra.length < 30) extra.push({k:String(rawHead[i] || `欄位 ${i + 1}`).trim().slice(0, 60), v:v.slice(0, 3000)});
    });
    if (!rec.name) continue;
    const id = 'form-' + hashStr(`${rec.ts || ''}|${rec.name}|${rec.mobile || rec.email || rec.email2 || ''}`);
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({id, at: rec.ts ? parseTs(rec.ts) : null, rec, form:{...rec, extra}});
  }
  if (!out.length) return {error:'有標題列，但沒有任何一列填了姓名。'};
  return {rows:out};
}
let impTimer = null;
function setImpMsg(t, err){ const el = $('#imp-msg'); el.textContent = t; el.className = 'imp-msg' + (err ? ' err' : ''); }
function openImport(){
  if (!canEdit()) return;
  S.imp = {rows:[], sel:new Set()};
  $('#imp-paste').value = ''; $('#imp-file-name').textContent = ''; $('#imp-preview').innerHTML = '';
  $('#imp-auto').textContent = FS.configured ? '人事資料表已設定自動匯入，新的應徵者會自己出現在「面試資料」。這裡用來補匯入較早的回覆。' : '';
  $('#imp-auto').hidden = !FS.configured;
  setImpMsg(''); updateImpGo();
  $('#imp').hidden = false;
  document.documentElement.classList.add('lock');
  $('#imp-paste').focus();
}
function closeImport(){
  $('#imp').hidden = true;
  S.imp = null;
  $('#imp-paste').value = ''; $('#imp-preview').innerHTML = '';
  if ($('#drawer').hidden) document.documentElement.classList.remove('lock');
}
const freshIdx = () => S.imp.rows.map((r, i) => S.hires.has(r.id) ? -1 : i).filter(i => i >= 0);
function loadImportText(text){
  text = String(text || '').replace(/^﻿/, '');
  const reset = msg => { S.imp.rows = []; S.imp.sel = new Set(); $('#imp-preview').innerHTML = ''; setImpMsg(msg || '', !!msg); updateImpGo(); };
  if (!text.trim()) return reset('');
  const first = text.split(/\r?\n/, 1)[0];
  const res = mapRows(parseDelimited(text, first.includes('\t') ? '\t' : ','));
  if (res.error) return reset(res.error);
  S.imp.rows = res.rows.sort((a, b) => (b.at || 0) - (a.at || 0));
  S.imp.sel = new Set(freshIdx());
  renderImportPreview();
}
function renderImportPreview(){
  const rows = S.imp.rows, fresh = freshIdx().length;
  setImpMsg(`讀到 ${rows.length} 筆：新資料 ${fresh} 筆、已在看板 ${rows.length - fresh} 筆。`);
  const allOn = fresh > 0 && rows.every((r, i) => S.hires.has(r.id) || S.imp.sel.has(i));
  $('#imp-preview').innerHTML = `<div class="imp-tbl-wrap"><table class="imp-tbl"><thead><tr>
    <th><input type="checkbox" id="imp-all" aria-label="全選"${allOn ? ' checked' : ''}${fresh ? '' : ' disabled'}></th><th>姓名</th><th>應徵職務</th><th>手機</th><th>填表時間</th><th>狀態</th></tr></thead><tbody>
    ${rows.map((r, i) => {
      const dup = S.hires.has(r.id);
      return `<tr class="${dup ? 'dup' : ''}"><td><input type="checkbox" id="imp-r-${i}" data-i="${i}" aria-label="匯入 ${esc(r.rec.name)}"${dup ? ' disabled' : (S.imp.sel.has(i) ? ' checked' : '')}></td>
        <td>${esc(r.rec.name)}</td><td>${esc(r.rec.position || '')}</td><td>${esc((r.rec.mobile || '').split('\n')[0])}</td>
        <td class="num">${esc(r.at ? fmtDateTime(r.at) : (r.rec.ts || ''))}</td><td>${dup ? '已在看板' : '新資料'}</td></tr>`;
    }).join('')}
    </tbody></table></div>`;
  updateImpGo();
}
function updateImpGo(){
  const n = S.imp ? [...S.imp.sel].filter(i => S.imp.rows[i] && !S.hires.has(S.imp.rows[i].id)).length : 0;
  const b = $('#imp-go');
  b.disabled = !n;
  b.textContent = n ? `匯入 ${n} 筆` : '匯入';
}
function runImport(){
  if (!S.imp || !canEdit()) return;
  const list = [...S.imp.sel].sort((a, b) => a - b).map(i => S.imp.rows[i]).filter(r => r && !S.hires.has(r.id));
  if (!list.length) return;
  const now = Date.now(), by = myName();
  ST.saveMany('hires', list.map(r => ({
    id:r.id, name:r.rec.name.slice(0, 40), position:(r.rec.position || '').slice(0, 60), dept:'',
    phone:(r.rec.mobile || '').split('\n')[0].trim().slice(0, 30), note:'', interviewDate:'', startDate:'',
    stage:'interview', result:'pending', docs:{}, steps:{}, createdAt:now, createdBy:by, updatedAt:now, updatedBy:by,
    source:'form', formAt:r.at, form:r.form
  })));
  S.tab = 'interview';
  closeImport();
  toast(`已匯入 ${list.length} 筆面試資料`);
  render();
}
async function loadJSZip(){
  if (window.JSZip) return window.JSZip;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.JSZip;
}
async function readImportFile(file){
  let buf = await file.arrayBuffer();
  if (/\.zip$/i.test(file.name) || /zip/.test(file.type)) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(buf);
    const entry = Object.values(zip.files).find(f => !f.dir && /\.csv$/i.test(f.name));
    if (!entry) throw new Error('nocsv');
    buf = await entry.async('arraybuffer');
  }
  try { return new TextDecoder('utf-8', {fatal:true}).decode(buf); }
  catch { return new TextDecoder('big5').decode(buf); }
}

/* ================= 提示、放大圖 ================= */
let toastTimer;
function toast(msg, undo){
  const t = $('#toast');
  t.textContent = '';
  const span = document.createElement('span'); span.textContent = msg; t.append(span);
  if (undo && canEdit()) {
    const b = document.createElement('button');
    b.className = 'toast-undo'; b.type = 'button'; b.textContent = '復原';
    b.addEventListener('click', () => { t.hidden = true; undo(); });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3200);
}
function openLightbox(url){ $('#lb-img').src = url; $('#lightbox').hidden = false; $('#lb-close').focus(); }
function closeLightbox(){ $('#lightbox').hidden = true; $('#lb-img').removeAttribute('src'); }

/* ================= 畫面總更新 ================= */
let rq = 0;
function schedule(){ if (rq) return; rq = requestAnimationFrame(() => { rq = 0; render(); }); }
function render(){
  showView();
  renderViews(); renderBanner(); renderFoot(); renderSync();
  if (S.view === 'overview') renderOverview();
  else if (S.view === 'pipeline') { renderToolbar(); renderStats(); renderTabs(); renderBoard(); renderBatchBar(); }
  else if (S.view === 'routine') renderRoutine();
  else if (S.view === 'users') renderUsers();
  if (S.openId && !S.creating) refreshDrawer();
  if (S.imp && S.imp.rows.length) renderImportPreview();
  if (!$('#slm').hidden) renderSlots();
}
function viewFromHash(){ const h = location.hash.slice(1); return VIEWS.includes(h) && (h !== 'users' || isAdmin()) ? h : 'overview'; }
function setView(v){
  S.view = VIEWS.includes(v) && (v !== 'users' || isAdmin()) ? v : 'overview';
  if (location.hash.slice(1) !== S.view) { try { history.replaceState(null, '', '#' + S.view); } catch {} }
  render();
  window.scrollTo(0, 0);
  if (S.view === 'pipeline' || S.view === 'overview') formSync();
}

/* ================= 事件 ================= */
$('#views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v !== S.view) setView(v); });
$('#sync').addEventListener('click', () => { ST.syncNow(); });
$('#foot').addEventListener('click', e => { if (e.target.closest('[data-act="logout"]')) AU.logout(); });
$('#m-prev').addEventListener('click', () => shiftMonth(-1));
$('#m-next').addEventListener('click', () => shiftMonth(1));
function shiftMonth(delta){
  const [y, m] = S.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  S.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  render();
}
$('#q').addEventListener('input', e => { S.q = e.target.value.trim(); renderTabs(); renderBoard(); });
$('#add-btn').addEventListener('click', openCreate);
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; renderTabs(); renderBoard(); });
$('#batch-btn').addEventListener('click', () => setBatch(!S.batch));
$('#batch-bar').addEventListener('change', e => { if (e.target.id === 'batch-date') S.batchDate = e.target.value; });
$('#batch-bar').addEventListener('click', e => {
  const b = e.target.closest('[data-b]'); if (!b) return;
  switch (b.dataset.b) {
    case 'hire': batchStage(true); break;
    case 'reject': batchStage(false); break;
    case 'del': S.batchConfirm = true; renderBatchBar(); break;
    case 'del-yes': batchDelete(); break;
    case 'del-no': S.batchConfirm = false; renderBatchBar(); break;
    case 'clear': S.sel.clear(); S.batchConfirm = false; renderBoard(); renderBatchBar(); break;
    case 'pick-date': pickBefore($('#batch-date').value); break;
    case 'done': setBatch(false); break;
  }
});
$('#board').addEventListener('change', e => {
  const t = e.target;
  if (S.batch && t.matches('input[data-pick]') && S.hires.has(t.dataset.pick)) togglePick(t.dataset.pick, t.checked);
});
$('#board').addEventListener('click', e => {
  const pc = e.target.closest('[data-pick-col]');
  if (pc) { togglePickCol(pc.dataset.pickCol); return; }
  if (S.batch) {
    const c = e.target.closest('.card-open');
    if (c && S.hires.has(c.dataset.id)) togglePick(c.dataset.id);
    return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id; if (!id || !S.hires.has(id)) return;
  const act = b.dataset.act;
  if (act === 'open') openDrawer(id, S.hires.get(id).stage === 'interview' ? 'comment' : null);
  else if (act === 'comment') openDrawer(id, 'comment');
  else if (act === 'hire') decide(id, true);
  else if (act === 'reject') decide(id, false);
  else if (act === 'advance') advance(id);
});
$('#overview-view').addEventListener('click', e => {
  if (e.target.closest('[data-slots]')) { openSlots(); return; }
  const g = e.target.closest('[data-go]');
  if (g) { if (g.dataset.tab && FLOW.includes(g.dataset.tab)) S.tab = g.dataset.tab; setView(g.dataset.go); return; }
  const o = e.target.closest('[data-open]');
  if (o && S.hires.has(o.dataset.open)) openDrawer(o.dataset.open, S.hires.get(o.dataset.open).stage === 'interview' ? 'comment' : null);
});
$('#overview-view').addEventListener('change', e => {
  const t = e.target;
  if (t.matches('input[data-rt="check"]')) toggleCheck(t.dataset.freq, t.dataset.id, t.checked);
});
const rv = $('#routine-view');
rv.addEventListener('click', e => {
  const b = e.target.closest('button[data-rt]'); if (!b) return;
  const act = b.dataset.rt;
  if (act === 'edit') { const f = b.dataset.freq; S.rtEdit[f] = !S.rtEdit[f]; S.rtConfirm = null; renderRoutine(); }
  else if (act === 'del') { S.rtConfirm = b.dataset.id; renderRoutine(); }
  else if (act === 'del-yes') { const id = b.dataset.id; S.rtConfirm = null; if (S.routines.has(id) && canRoutine()) { ST.remove('routines', id); toast('已刪除項目'); } }
});
rv.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('input[data-rt="check"]')) { toggleCheck(t.dataset.freq, t.dataset.id, t.checked); return; }
  if (t.matches('[data-rt-field]') && canRoutine()) {
    const cur = ST.get('routines', t.dataset.id); if (!cur) return;
    const field = t.dataset.rtField === 'due' ? 'due' : 'title';
    const v = t.value.trim();
    if (field === 'title' && !v) { t.value = cur.title; return; }
    if (v === (cur[field] || '')) return;
    ST.save('routines', Object.assign(JSON.parse(JSON.stringify(cur)), {[field]:v}));
  }
});
rv.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-rt-field]')) { e.preventDefault(); e.target.blur(); } });
rv.addEventListener('submit', e => { const f = e.target.closest('form.rt-add'); if (!f) return; e.preventDefault(); addRoutine(f.dataset.freq); });

$('#users-view').addEventListener('click', e => {
  const b = e.target.closest('[data-u]'); if (!b) return;
  const act = b.dataset.u, u = (U.list || []).find(x => x.email === b.dataset.email);
  if (act === 'reload') { U.error = ''; loadUsers(); }
  else if (act === 'add') openUserForm(null);
  else if (act === 'edit' && u) openUserForm(u);
  else if (act === 'toggle' && u) userCall('userSave', {email:u.email, name:u.name, pages:u.pages, enabled:!u.enabled}, u.enabled ? `已停用 ${u.email}` : `已啟用 ${u.email}`);
  else if (act === 'del' && u) { U.confirm = u.email; renderUsers(); }
  else if (act === 'del-yes' && u) userCall('userDelete', {email:u.email}, `已移除 ${u.email}`);
  else if (act === 'cancel') { U.confirm = null; renderUsers(); }
  else if (act === 'fl-link') {
    const url = $('#fl-url').value.trim(), days = Number($('#fl-days').value);
    if (!/^https:\/\/(drive|docs)\.google\.com\//.test(url)) { FS.msg = '請貼 Google 雲端硬碟資料夾或試算表的網址。'; FS.msgErr = true; FS.draft = url; renderUsers(); return; }
    FS.draft = url; FS.draftDays = days;
    formAdmin('formLink', {url, days}, j => `已連結。這次匯入 ${j.added || 0} 筆${j.updated ? `、更新 ${j.updated} 筆` : ''}。`);
  }
  else if (act === 'fl-sync') formAdmin('formSync', {force:true}, j => j.lastError ? '同步失敗，原因見上方。' : `已同步，新增 ${j.added || 0} 筆${j.updated ? `、更新 ${j.updated} 筆` : ''}。`);
  else if (act === 'fl-unlink') { FS.confirmUnlink = true; renderUsers(); }
  else if (act === 'fl-unlink-yes') formAdmin('formUnlink', {}, () => '已取消連結，已匯入的資料都還在。');
  else if (act === 'fl-cancel') { FS.confirmUnlink = false; renderUsers(); }
});
$('#users-view').addEventListener('input', e => { if (e.target.id === 'fl-url') FS.draft = e.target.value; });
$('#users-view').addEventListener('change', e => { if (e.target.id === 'fl-days') FS.draftDays = Number(e.target.value); });
$('#umodal').addEventListener('click', e => { if (e.target.closest('[data-u-close]')) closeUserForm(); });
$('#u-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#u-email').value.trim(), name = $('#u-name').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#u-err').textContent = '請輸入正確的 Gmail 地址。'; return; }
  const pages = PERMS.filter(p => $('#u-p-' + p.id).checked).map(p => p.id);
  const cur = (U.list || []).find(x => x.email === U.editing);
  const btn = $('#u-save'); btn.disabled = true; btn.textContent = '儲存中…';
  try {
    const j = await AU.api('userSave', {email, name, pages, enabled: cur ? cur.enabled !== false : true});
    U.list = j.users || U.list;
    closeUserForm(); renderUsers();
    toast(cur ? '已更新' : `已加入 ${email}，請他用這個 Gmail 登入`);
  } catch (err) { $('#u-err').textContent = err.message; }
  btn.disabled = false; btn.textContent = '儲存';
});

$('#drawer').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) { closeDrawer(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = S.openId; if (!id) return;
  const act = b.dataset.act, key = b.dataset.key;
  switch (act) {
    case 'hire': decide(id, true); break;
    case 'reject': decide(id, false); break;
    case 'advance': advance(id); break;
    case 'back': stepBack(id); break;
    case 'zoom': { const p = PH.get(b.dataset.fid); if (p && p.url) openLightbox(p.url); break; }
    case 'pdf': { const p = PH.get(b.dataset.fid); if (p && p.url) window.open(p.url, '_blank', 'noopener'); break; }
    case 'photo-retry': PH.delete(b.dataset.fid); refreshDrawer(); break;
    case 'cam': case 'pick':
      if (!canEdit()) return;
      S.pendingSlot = {id, key};
      $(act === 'cam' ? '#file-cam' : '#file-pick').click();
      break;
    case 'photo-del': S.confirm = {type:'photo', key}; refreshDrawer(); break;
    case 'photo-del-yes': deletePhoto(id, key); break;
    case 'rec-del': S.confirm = {type:'record'}; refreshDrawer(); break;
    case 'rec-del-yes': deleteRecord(id); break;
    case 'cancel': S.confirm = null; refreshDrawer(); break;
    case 'toggle-id': S.showId = !S.showId; refreshDrawer(); break;
  }
});
$('#d-close').addEventListener('click', () => closeDrawer());
$('#iv-form').addEventListener('submit', e => { e.preventDefault(); saveIv(false); });
$('#iv-form').addEventListener('change', () => saveIv(true));
$('#info-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!canEdit()) return;
  const v = readForm();
  if (!v.name) { setSaveState('請填寫姓名', true); $('#f-name').focus(); return; }
  if (S.creating) {
    const id = rid('h'), now = Date.now(), by = myName();
    ST.save('hires', {id, ...v, stage:'interview', result:'pending', docs:{}, steps:{}, createdAt:now, createdBy:by, updatedAt:now, updatedBy:by});
    S.tab = 'interview';
    toast(`已新增 ${v.name}，可以開始填寫面試評語`);
    pullFromStore(); render();
    openDrawer(id, 'comment');
  } else {
    const h = S.hires.get(S.openId); if (!h) return;
    const changed = {};
    for (const k of Object.keys(v)) if (v[k] !== h[k]) changed[k] = v[k];
    if (!Object.keys(changed).length) { setSaveState('沒有變更'); return; }
    saveHire(h.id, r => Object.assign(r, changed));
    setSaveState('已儲存');
  }
});
$('#file-cam').addEventListener('change', e => handleFiles(e.target));
$('#file-pick').addEventListener('change', e => handleFiles(e.target));
$('#lightbox').addEventListener('click', e => { if (e.target.id !== 'lb-img') closeLightbox(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').hidden) closeLightbox();
  else if (!$('#umodal').hidden) closeUserForm();
  else if (!$('#slm').hidden) closeSlots();
  else if (!$('#imp').hidden) closeImport();
  else if (!$('#drawer').hidden) closeDrawer();
});
$('#imp-btn').addEventListener('click', openImport);
$('#slot-btn').addEventListener('click', openSlots);
$('#slm').addEventListener('click', e => {
  if (e.target.closest('[data-sl-close]')) { closeSlots(); return; }
  const b = e.target.closest('[data-sl]'); if (!b) return;
  const id = b.dataset.id, cur = id ? ST.get('slots', id) : null;
  switch (b.dataset.sl) {
    case 'copy': {
      const inp = $('#sl-url');
      Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(inp.value)).then(() => toast('已複製應徵連結')).catch(() => { inp.select(); toast('請按 Ctrl+C 複製'); });
      break;
    }
    case 'toggle': if (cur) { ST.save('slots', Object.assign(JSON.parse(JSON.stringify(cur)), {closed:!cur.closed})); renderSlots(); } break;
    case 'del': SL.confirm = id; renderSlots(); break;
    case 'del-yes': if (cur) ST.remove('slots', id); SL.confirm = null; renderSlots(); break;
    case 'cancel': SL.confirm = null; renderSlots(); break;
    case 'open': if (S.hires.has(id)) { closeSlots(); openDrawer(id, S.hires.get(id).stage === 'interview' ? 'comment' : null); } break;
  }
});
$('#slm').addEventListener('submit', e => { if (e.target.id === 'sl-form') { e.preventDefault(); addSlots(); } });
$('#imp-close').addEventListener('click', closeImport);
$('#imp-cancel').addEventListener('click', closeImport);
$('#imp').addEventListener('click', e => { if (e.target.closest('[data-imp-close]')) closeImport(); });
$('#imp-paste').addEventListener('input', e => {
  clearTimeout(impTimer);
  const v = e.target.value;
  impTimer = setTimeout(() => { if (S.imp) { $('#imp-file-name').textContent = ''; loadImportText(v); } }, 250);
});
$('#imp-file-btn').addEventListener('click', () => $('#imp-file').click());
$('#imp-file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !S.imp) return;
  if (/\.xlsx?$/i.test(file.name)) { setImpMsg('請把試算表下載成 CSV 格式（檔案 → 下載 → 逗號分隔值 .csv），或直接複製貼上。', true); return; }
  setImpMsg('讀取中…');
  try {
    const text = await readImportFile(file);
    if (!S.imp) return;
    $('#imp-paste').value = '';
    $('#imp-file-name').textContent = file.name;
    loadImportText(text);
  } catch (err) {
    setImpMsg(err && err.message === 'nocsv' ? 'ZIP 檔裡找不到 CSV 檔。' : '讀不到這個檔案，請改用複製貼上。', true);
  }
});
$('#imp-preview').addEventListener('change', e => {
  const t = e.target;
  if (!S.imp) return;
  if (t.id === 'imp-all') { S.imp.sel = new Set(t.checked ? freshIdx() : []); renderImportPreview(); return; }
  const i = +t.dataset.i;
  if (!Number.isInteger(i)) return;
  if (t.checked) S.imp.sel.add(i); else S.imp.sel.delete(i);
  updateImpGo();
  const all = $('#imp-all');
  if (all) all.checked = S.imp.rows.every((r, j) => S.hires.has(r.id) || S.imp.sel.has(j));
});
$('#imp-go').addEventListener('click', runImport);

/* ================= 啟動 ================= */
ST.on(type => {
  if (type === 'change') { pullFromStore(); schedule(); }
  else if (type === 'status') { renderSync(); const l = !!ST.status().loaded; if (l !== S.loaded) { pullFromStore(); schedule(); } }
  else if (type === 'conflict') toast('有同事同時修改了同一筆資料，已自動合併；同一個欄位以你的修改為準。');
});
AU.on(() => { U.list = null; schedule(); });
S.view = viewFromHash();
pullFromStore(); render();
AU.ready.then(() => { S.view = viewFromHash(); pullFromStore(); render(); formSync(); });
// 打開 App、切回 App 時順便同步人事資料表（雲端後端另外每 10 分鐘同步一次）
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') formSync(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
}
// 跨日（App 開著過午夜）時，「今天」和例行工作的期間跟著更新
let lastDay = today();
setInterval(() => { const d = today(); if (d !== lastDay) { lastDay = d; pullFromStore(); schedule(); } }, 60000);
})();

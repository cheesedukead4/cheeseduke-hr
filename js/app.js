/*
 * 人事工作看板｜全部畫面
 * ---------------------------------------------------------------
 * 頁面（網址 #overview #recruit #pipeline #routine #users）：總覽、招募、新進人員・勞健保、例行工作、管理（只有管理員）。
 * 流程（白板）：Gmail 撈履歷 → AI 篩選 → 邀約（選時 → 人事表）→ 面試（錄／不錄）→ 確認入職（要／不要）→ Offer → 報到 → 證件 → APOLLO → 勞健保。
 *   「招募」頁前三欄（履歷篩選、邀約中、已約面試）是 hr@ 的「履歷篩選」試算表的進度：雲端後端每 10 分鐘讀一次存成 recruit，這裡只能看；
 *   應徵者的人事資料表進來（自動匯入或線上應徵）後才變成看板上的人（hires），從「面試」開始由 App 推進。
 * 資料（HRStore，見 cloud-store.js），每一筆都有 id：
 *   hires     { id, name, position, dept, phone, note, interviewDate, startDate (YYYY-MM-DD),
 *               stage: interview|confirm|offer|docs|apollo_up|apollo_down|insurance|done|rejected|declined, result: pending|hired|rejected,
 *               steps: { 步驟: { at, by } }（完成該步驟的時間與人；退回時刪掉）,
 *               docs: { id_front|id_back|bank|other_*: { id: 雲端檔案 id, mime, at, by } }（檔案在雲端後端「證件照片」資料夾）,
 *               interviewer, rating: A|B|C|D, comment, ivAt, ivBy（面試紀錄）,
 *               form: {...}, formAt, source: 'form'（從「起士公爵人事資料表」回覆匯入；id 是 form-雜湊，重複匯入會略過）,
 *               createdAt, createdBy, updatedAt, updatedBy }
 *   routines  { id, freq: daily|weekly|monthly, title, due, order, createdAt, createdBy }
 *   checks    { id: d-YYYY-MM-DD | w-YYYY-Www | m-YYYY-MM, date: 期間第一天, freq, done: { 項目 id: { at, by } } }
 *   jobs      { id, title, keys: 應徵職位關鍵字（逗號分開）, text: 條件（# 段落、- 條件）, order }（職缺條件，管理頁編輯）；hires.crit = { job, ok: [已勾條件的 key] }
 *   manual    （只能讀，雲端後端從「HR工作清冊」試算表寫）{ id, sec, kind: daily|weekly|monthly|yearly|adhoc|project, weekday, day, months, title, owner, parts:[說明、程序、參考…], dues:[到期提醒] }
 *             例行工作清單＝清冊項目（rtItems 的 sheet: true）＋ routines；「工作手冊」頁（#manual）列出全部；總覽提醒 dues。
 *   recruit   （只能讀，雲端後端寫）{ id, src: screen 篩選名單 | invite 面試邀約 | result 面試結果追蹤 | meta, name, job, ... }
 *             對到看板上的人：result 用「資料表連結」的文件 id（= hires 的 doc-文件id），其他用姓名＋日期相近（extFor）。
 * 權限（HRAuth.can）：edit 人事資料編輯、pii 查看證件、routine 例行工作設定；管理員全部都有。
 *   這是畫面權限：雲端後端擋的是「不在名單的人」；證件照片另外由後端檢查 pii。例行工作每個人都能打勾。
 */
(function () {
'use strict';
const AU = window.HRAuth, ST = window.HRStore;

/* ================= 定義 ================= */
const STAGES = [
  {key:'x_screen',    board:'recruit',  n:1, title:'履歷篩選',    hint:'104 收到、看板已評分分級的履歷'},
  {key:'x_invite',    board:'recruit',  n:2, title:'邀約中',      hint:'已送出邀約，等應徵者選時間'},
  {key:'x_booked',    board:'recruit',  n:3, title:'已約面試',    hint:'舊流程（Google 預約）選好時間的人；看板邀約選好時間的直接進「面試」'},
  {key:'interview',   board:'recruit',  n:4, title:'面試',        hint:'面試後決定錄取或不錄取'},
  {key:'confirm',     board:'recruit',  n:5, title:'確認入職',    hint:'錄取後確認要不要來'},
  {key:'offer',       board:'recruit',  n:6, title:'Offer',       hint:'寄 Offer，等報到'},
  {key:'docs',        board:'pipeline', n:1, title:'報到・證件',  hint:'報到時拍照上傳證件'},
  {key:'apollo_up',   board:'pipeline', n:2, title:'APOLLO 上傳', hint:'人事資料上傳 APOLLO'},
  {key:'apollo_down', board:'pipeline', n:3, title:'APOLLO 下載', hint:'自 APOLLO 下載檔案'},
  {key:'insurance',   board:'pipeline', n:4, title:'勞健保上傳',  hint:'申報勞健保加保'},
  {key:'done',        board:'pipeline', n:0, title:'已完成',      hint:''}
];
const BOARDS = {recruit:STAGES.filter(s => s.board === 'recruit'), pipeline:STAGES.filter(s => s.board === 'pipeline')};
const BOARD_OF = Object.fromEntries(STAGES.map(s => [s.key, s.board]));
const FLOW = ['interview','confirm','offer','docs','apollo_up','apollo_down','insurance','done'];
const EXT = ['x_screen','x_invite','x_booked'];   // 「履歷篩選」試算表的進度（只能看）
const ACTIVE = ['docs','apollo_up','apollo_down','insurance'];
const TITLE = Object.assign(Object.fromEntries(STAGES.map(s => [s.key, s.title])), {rejected:'未錄取', declined:'婉拒入職'});
const STEP_DEFS = [   // 和 FLOW 前 7 步一一對應
  {key:'interview',   label:'面試結果'},
  {key:'confirm',     label:'確認入職'},
  {key:'offer',       label:'Offer・等報到'},
  {key:'docs',        label:'報到・證件上傳'},
  {key:'apollo_up',   label:'APOLLO 上傳'},
  {key:'apollo_down', label:'APOLLO 下載'},
  {key:'insurance',   label:'勞健保上傳（加保）'}
];
const STEP_DONE = {interview:'面試結果：錄取', confirm:'確認入職：要來', offer:'Offer・已報到'};
const STEP_HINT = {
  interview:'確認面試結果後，按「錄取」或「未錄取」。',
  confirm:'和應徵者確認要不要來：要 → 寄 Offer；不要 → 婉拒入職。',
  offer:'在下方「Offer 錄取通知書」填好資料產生 Offer、確認報到日；報到當天按「已報到」。',
  docs:'拍照上傳身分證／居留證正反面，存摺封面可一併上傳。',
  apollo_up:'將新人人事資料上傳至 APOLLO。',
  apollo_down:'自 APOLLO 下載加保所需檔案。',
  insurance:'至勞保局 e 化服務系統申報勞保、就保、健保加保。'
};
const ADV_LABEL = {offer:'已報到 →', docs:'證件齊全，下一步', apollo_up:'已上傳 APOLLO', apollo_down:'已下載', insurance:'已完成加保'};
const EMPTY = {
  x_screen:'最近 14 天沒有新的履歷',
  x_invite:'沒有等回覆的邀約',
  x_booked:'沒有已約面試、還沒填人事資料表的人',
  interview:'人事資料表進來的應徵者會出現在這裡',
  confirm:'錄取的人會出現在這裡',
  offer:'確認要來的人會出現在這裡',
  docs:'按「已報到」的新人會出現在這裡',
  apollo_up:'證件齊全的新人會移到這裡',
  apollo_down:'已上傳 APOLLO 的新人',
  insurance:'等待申報勞健保的新人',
  done:'這個月還沒有人完成加保'
};
const RC_DAYS = {screen:14, invite:21, booked:3, cancel:30, match:45};   // 招募三欄顯示的天數、對人時日期相差幾天內算同一人
const DOC_SLOTS = [   // 和雲端後端 ONB_SLOTS_（報到連結上傳）一樣
  {key:'id_front', label:'身分證／居留證 正面', required:true},
  {key:'id_back',  label:'身分證／居留證 反面', required:true},
  {key:'bank',     label:'存摺封面', required:true},
  {key:'photo',    label:'大頭照', required:true},
  {key:'health',   label:'體檢／健康證明', required:true},
  {key:'cert',     label:'畢業證書／專業證照', required:false}
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
  {id:'edit',    label:'人事資料編輯', desc:'填寫評語、錄取與推進流程、面試時段、批次整理、上傳證件'},
  {id:'pii',     label:'查看證件',     desc:'看證件照片與完整身分證字號'},
  {id:'routine', label:'例行工作設定', desc:'新增、修改、刪除每日／每週／每月項目（打勾不需要權限）'}
];
const PERM_LABEL = Object.fromEntries(PERMS.map(p => [p.id, p.label]));
const VIEWS = ['overview','recruit','pipeline','routine','manual','users'];
const BOX = {overview:'overview', recruit:'pipeline', pipeline:'pipeline', routine:'routine', manual:'manual', users:'users'}; // 招募與新進人員共用同一個看板畫面

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
  month:curMonth(), q:'', tabs:{recruit:'interview', pipeline:'docs'}, open:{}, view:'overview',
  openId:null, creating:false, confirm:null, uploading:{}, pendingSlot:null, showId:false,
  rtEdit:{}, rtConfirm:null, imp:null,
  batch:false, sel:new Set(), batchConfirm:false, batchDate:'', jobs:[],
  mnQ:'', mnOpen:new Set(), mnFocus:'', rtMn:new Set(),
  outbox:[], tpl:[], cfg:{company:'起士公爵', place:'', contactName:'', contactPhone:'', replyDays:3},
  chat:{unread:0, total:0, items:[]}, chatAll:false
};
const U = {list:null, admins:[], loading:false, error:'', confirm:null, editing:null};
const inMonth = s => !!s && s.slice(0,7) === S.month;

function norm(id, d){
  d = obj(d);
  const stage = (FLOW.includes(d.stage) || d.stage === 'rejected' || d.stage === 'declined') ? d.stage : 'interview';
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
    docUrl: /^https:\/\/docs\.google\.com\//.test(typeof d.docUrl === 'string' ? d.docUrl : '') ? d.docUrl : '',
    crit: normCrit(d.crit), onb: normOnb(d.onb), offer: d.offer ? normOffer(d.offer) : null
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
  S.jobs = ST.list('jobs').map(normJob).filter(Boolean).sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : 1));
  S.outbox = ST.list('outbox').map(normOb).filter(Boolean);
  const chl = ST.list('chat'), chm = obj(chl.find(x => x && x.id === '_meta'));
  S.chat = {unread: Number(chm.unread) || 0, total: Number(chm.total) || 0, items: chl.filter(x => x && x.id !== '_meta').map(normChat).filter(Boolean)};
  const tp = ST.list('tpl');
  S.cfg = normCfg(tp.find(t => t && t.id === '_cfg'));
  S.tpl = tp.filter(t => t && t.id !== '_cfg').map(normTpl).filter(Boolean).sort((a, b) => a.order - b.order);
  buildRecruit();
  buildManual();
  S.loaded = !!ST.status().loaded;
}

/* ================= 招募進度（「履歷篩選」試算表，只能看） ================= */
const R = {meta:null, screen:[], invite:[], result:[], byDoc:new Map(), byName:new Map(), hireByName:new Map(), ext:new Map()};
const normName = s => String(s || '').replace(/[\s　]+/g, '').toLowerCase();
const httpsUrl = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : '';
const isDT = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
const isHM = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const addDays = (d, n) => ymd(new Date(new Date(d + 'T00:00:00').getTime() + n * 86400000));
const shortDT = s => isDT(s) ? `${md(s.slice(0, 10))} ${s.slice(11)}` : '';
const rowDay = r => r.src === 'invite' ? (isDate(r.ivD) ? r.ivD : (r.at || '').slice(0, 10)) : r.src === 'result' ? r.ivD : (r.at || '').slice(0, 10);
function cleanRow(r){
  const s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return {
    id:String(r.id), src:r.src, name:s(r.name, 40), job:s(r.job, 80), plat:s(r.plat, 20), tier:s(r.tier, 10),
    at: isDT(r.at) ? r.at : '', score: typeof r.score === 'number' && isFinite(r.score) ? r.score : null,
    sum:s(r.sum, 300), why:s(r.why, 300), st:s(r.st, 40), type:s(r.type, 20), cv:httpsUrl(r.cv), mail:httpsUrl(r.mail),
    ivD: isDate(r.ivD) ? r.ivD : '', ivT: isHM(r.ivT) ? r.ivT : '', formSt:s(r.formSt, 20), formFill:s(r.formFill, 20), ev:s(r.ev, 20),
    doc: validFileId(r.doc) ? r.doc : '', res:s(r.res, 20), iv2:s(r.iv2, 40), dec:s(r.dec, 20), n104:s(r.n104, 80), offer:s(r.offer, 30),
    start: isDate(r.start) ? r.start : '', startRaw:s(r.startRaw, 30), dept:s(r.dept, 30), title:s(r.title, 40), time:s(r.time, 30),
    place:s(r.place, 60), boss:s(r.boss, 30), pdf:httpsUrl(r.pdf), note:s(r.note, 200)
  };
}
function buildRecruit(){
  const all = ST.list('recruit').filter(r => r && typeof r === 'object' && r.id != null);
  const m = all.find(r => r.id === '_meta');
  R.meta = m ? {lastMail: isDT(m.lastMail) ? m.lastMail : '', mail7: Number(m.mail7) || 0} : null;
  const rows = all.filter(r => ['screen','invite','result'].includes(r.src) && typeof r.name === 'string' && r.name.trim()).map(cleanRow);
  R.screen = rows.filter(r => r.src === 'screen');
  R.invite = rows.filter(r => r.src === 'invite');
  R.result = rows.filter(r => r.src === 'result');
  R.byDoc = new Map(R.result.filter(r => r.doc).map(r => [r.doc, r]));
  R.byName = new Map();
  for (const r of rows) { const k = normName(r.name); if (!R.byName.has(k)) R.byName.set(k, []); R.byName.get(k).push(r); }
  R.hireByName = new Map();
  for (const h of S.hires.values()) { const k = normName(h.name); if (!k) continue; if (!R.hireByName.has(k)) R.hireByName.set(k, []); R.hireByName.get(k).push(h); }
  R.ext = new Map();
}
const hireDay = h => ivDay(h) || today();
const near = (a, b) => isDate(a) && isDate(b) && Math.abs(dayDiff(a, b)) <= RC_DAYS.match;
/** 試算表裡對到這個人的資料 { screen, invite, result }（面試結果用文件 id，其他用姓名＋日期相近） */
function extFor(h){
  if (R.ext.has(h.id)) return R.ext.get(h.id);
  const d = hireDay(h), list = R.byName.get(normName(h.name)) || [];
  const pick = src => {
    const c = list.filter(r => r.src === src && (isDate(rowDay(r)) ? near(rowDay(r), d) : src === 'result'));
    return c.sort((a, b) => (isDate(rowDay(a)) ? Math.abs(dayDiff(rowDay(a), d)) : 999) - (isDate(rowDay(b)) ? Math.abs(dayDiff(rowDay(b), d)) : 999))[0] || null;
  };
  const x = {result: (h.id.startsWith('doc-') && R.byDoc.get(h.id.slice(4))) || pick('result'), invite:pick('invite'), screen:pick('screen')};
  R.ext.set(h.id, x);
  return x;
}
/** 這列試算表資料已經是看板上的人了嗎（姓名相同、日期相近） */
const rowHired = r => (R.hireByName.get(normName(r.name)) || []).some(h => !isDate(rowDay(r)) || near(hireDay(h), rowDay(r)));
const screenTaken = r => rowHired(r) || R.invite.some(i => (r.cv && i.cv === r.cv) || (normName(i.name) === normName(r.name) && near(rowDay(i), rowDay(r))));
/* 104「聯絡訊息」的事件進度（試算表「面試邀約」的「104事件進度」欄）優先；沒有這一欄或空白時看「邀約結果」 */
const EV_CANCEL = /^(無意願|面試婉拒|面試取消|意願已取消)$/;
const inviteDone = r => /^(感謝函|到職日期提醒)/.test(r.ev);   // 已經過了面試這一關，不放在前三欄
const inviteCancel = r => EV_CANCEL.test(r.ev) || /取消/.test(r.st);
const inviteBooked = r => !inviteCancel(r) && !inviteDone(r) && (r.ev === '面試同意' || /^已預約/.test(r.st));
const inviteWaiting = r => !inviteCancel(r) && !inviteDone(r) && !inviteBooked(r);
const evCls = ev => /同意|有意願/.test(ev) ? 'ok' : /未回覆/.test(ev) ? 'warn' : /婉拒|取消|無意願/.test(ev) ? 'danger' : '';
const evChip = ev => ev ? chip(`104：${ev}`, evCls(ev)) : '';
const TIER_RANK = {'推薦面試':0, '可評估':1, '不推薦':2};   // 和 AI 篩選規則相同：80 分以上、60–79、59 以下
/** 招募前三欄的卡片；useQ＝套用搜尋框 */
function extItems(key, useQ = true){
  const t = today(), q = useQ ? S.q.toLowerCase() : '';
  const vis = r => !q || [r.name, r.job].some(x => x.toLowerCase().includes(q));
  if (key === 'x_screen' || key === 'x_pause') {
    const floor = addDays(t, -RC_DAYS.screen);
    return R.screen.filter(r => (key === 'x_pause') === (r.tier === '不推薦') && rowDay(r) >= floor && !screenTaken(r) && !obDecided(obFor(refOf(r))) && vis(r))
      .sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3) || (b.score ?? -1) - (a.score ?? -1) || (a.at < b.at ? 1 : -1));
  }
  if (key === 'x_invite') {
    const floor = addDays(t, -RC_DAYS.invite);
    const yes = r => /^(有意願|面試同意)$/.test(r.ev) ? 0 : 1;
    return R.invite.filter(r => inviteWaiting(r) && rowDay(r) >= floor && !rowHired(r) && vis(r)).concat(obInviteRows(q).filter(r => !inviteCancel(r)))
      .sort((a, b) => yes(a) - yes(b) || (a.at < b.at ? 1 : -1));
  }
  if (key === 'x_booked') {
    return R.invite.filter(r => inviteBooked(r) && !rowHired(r) && vis(r) && (r.ivD ? r.ivD >= addDays(t, -RC_DAYS.booked) : (r.at || '').slice(0, 10) >= addDays(t, -14)))
      .sort((a, b) => ((a.ivD || '9999') + a.ivT) < ((b.ivD || '9999') + b.ivT) ? -1 : 1);
  }
  if (key === 'x_cancel') {
    const floor = addDays(t, -RC_DAYS.cancel);
    return R.invite.filter(r => inviteCancel(r) && rowDay(r) >= floor && vis(r)).concat(obInviteRows(q).filter(r => inviteCancel(r) && rowDay(r) >= floor))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  return [];
}
/** 預計報到日：看板上填的到職日，沒填就用試算表的預計報到日 */
const planStart = h => h.startDate || (extFor(h).result || {}).start || '';

/* ================= 104 寄件匣（outbox）：看板排入，瀏覽器擴充功能「104 小幫手」在 104 送出；也可以「複製並打開 104」手動送（via: 'manual'）================= */
const OB_TYPES = ['invite', 'thanks', 'message', 'skip', 'chat'];
const OB_ST = ['queued', 'sending', 'sent', 'failed', 'canceled', 'done'];
const OB_LABEL = {invite:'邀約面試', thanks:'感謝函', message:'訊息', skip:'不邀約', chat:'聊聊'};
const TPL_KINDS = [['invite', '邀約面試'], ['thanks', '感謝函／婉拒'], ['message', '一般訊息']];
const RN = {configured:false, lastSeen:0, login:'', version:'', note:'', chatAt:0};   // 自動送出程式的狀態（formSync 帶回）
const AIS = {configured:null, model:''};
function normOb(d){
  d = obj(d);
  if (d.id == null || !OB_TYPES.includes(d.type)) return null;
  const to = obj(d.to), op = obj(d.opts), s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return {id:String(d.id), type:d.type, status: OB_ST.includes(d.status) ? d.status : 'queued',
    to:{name:s(to.name, 40), job:s(to.job, 80), cv:httpsUrl(to.cv), ref:s(to.ref, 400), room: (rm => rm.jobNo && rm.pId ? {id:s(rm.id, 40), jobNo:s(rm.jobNo, 20), pId:s(rm.pId, 20)} : null)(obj(to.room))}, text:s(d.text, 1000),
    opts:{job:s(op.job, 80), place:s(op.place, 120), contactName:s(op.contactName, 40), contactPhone:s(op.contactPhone, 40), replyDays: Number.isInteger(op.replyDays) ? op.replyDays : 3},
    createdAt: Number(d.createdAt) || 0, createdBy:s(d.createdBy, 40), sentAt: Number(d.sentAt) || 0, via:s(d.via, 10), result:s(d.result, 300), tries: Number(d.tries) || 0};
}
function normTpl(d){
  d = obj(d);
  const title = str(d.title).slice(0, 40);
  if (d.id == null || !title) return null;
  return {id:String(d.id), kind: TPL_KINDS.some(k => k[0] === d.kind) ? d.kind : 'message', title, text: typeof d.text === 'string' ? d.text.slice(0, 1000) : '', order: Number(d.order) || 0};
}
function normCfg(d){
  d = obj(d);
  const s = (v, n, dft) => typeof v === 'string' ? v.slice(0, n) : dft;
  return {company:s(d.company, 40, '起士公爵'), place:s(d.place, 120, ''), contactName:s(d.contactName, 40, ''), contactPhone:s(d.contactPhone, 40, ''),
    reportTime:s(d.reportTime, 20, '09:00'), reportPlace:s(d.reportPlace, 120, ''), reportNote:s(d.reportNote, 300, ''),
    replyDays: Number.isInteger(d.replyDays) && d.replyDays >= 1 && d.replyDays <= 14 ? d.replyDays : 3};
}
/** 寄件匣用來對人的鍵：104 履歷連結（沒有就用試算表那一列的 id） */
const refOf = r => r.ob ? r.ob.to.ref : (r.cv || ('row:' + r.id));
function obFor(ref){ let best = null; for (const o of S.outbox) if (o.to.ref === ref && (!best || o.createdAt > best.createdAt)) best = o; return best; }
/** 已經決定邀約或不邀約（排隊中、送出中、已送出，或只標記不邀約） */
const obDecided = o => !!o && (o.type === 'skip' || ((o.type === 'invite' || o.type === 'thanks') && ['queued', 'sending', 'sent'].includes(o.status)));
const rnOnline = () => !!RN.lastSeen && Date.now() - RN.lastSeen < 5 * 60000;
function obChip(o){
  if (!o) return '';
  const what = OB_LABEL[o.type];
  if (o.type === 'skip') return chip('已標記不邀約');
  if (o.status === 'queued') return chip(`${what}・排隊中`, 'warn');
  if (o.status === 'sending') return chip(`${what}・送出中`, 'warn');
  if (o.status === 'sent') return chip(`${what}・${fmtTime(o.sentAt)} ${o.via === 'manual' ? '手動' : ''}已送出`, 'ok');
  if (o.status === 'failed') return chip(`${what}・送出失敗`, 'danger');
  if (o.status === 'canceled') return chip(`${what}・已取消`);
  return '';
}
/** 範本裡的 {{職缺}} 這類欄位換成實際內容；沒有資料的保留原樣，送出前看得到 */
const fillTpl = (text, ctx) => String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => ctx[k] ? ctx[k] : m);
const obCtx = (row, job) => ({'職缺': job || row.job || '', '姓名': row.name || '', '面試地點': S.cfg.place, '公司名稱': S.cfg.company, '應徵連結': APPLY_URL, '人事資料表單連結': APPLY_URL});
/** 看板上自己邀約、試算表裡還沒有的人（放在「邀約中」） */
function obInviteRows(q){
  const seen = new Set(), out = [];
  [...S.outbox].sort((a, b) => b.createdAt - a.createdAt).forEach(o => {
    if (o.type !== 'invite' || !['queued', 'sending', 'sent', 'failed'].includes(o.status) || seen.has(o.to.ref)) return;
    seen.add(o.to.ref);
    if (R.invite.some(i => o.to.cv && i.cv === o.to.cv)) return;
    const r = {id:'ob:' + o.id, src:'outbox', name:o.to.name, job:o.to.job, cv:o.to.cv, at: o.createdAt ? ymd(new Date(o.createdAt)) + 'T' + pad(new Date(o.createdAt).getHours()) + ':' + pad(new Date(o.createdAt).getMinutes()) : '',
      ob:o, st:'', ev:'', ivD:'', ivT:'', plat:'看板邀約', formSt:'', formFill:'', mail:'', sum:'', why:'', tier:'', score:null, type:''};
    const ch = o.status === 'sent' ? chatFor(r) : null, chT = ch ? Date.parse(String(ch.time).replace(' ', 'T') + '+08:00') : 0;
    if (ch && chT >= (o.sentAt || o.createdAt || 0) - 10 * 60000) r.ev = chatEv(ch);
    if (rowHired(r) || (q && ![r.name, r.job].some(x => x.toLowerCase().includes(q)))) return;
    out.push(r);
  });
  return out;
}
/* ---------- 104 聊聊：104 小幫手每分鐘讀 104 的對話清單（不打開對話，104 的未讀不會變已讀），只能看；回覆走寄件匣 type chat ---------- */
function normChat(d){
  d = obj(d);
  const s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  if (d.id == null || !d.jobNo || !d.pId) return null;
  return {id:String(d.id), name:s(d.name, 40), job:s(d.job, 120), jobNo:s(d.jobNo, 20), pId:s(d.pId, 20), last:s(d.last, 160),
    from: d.from === 'us' ? 'us' : 'them', unread: !!d.unread, time:s(d.time, 19), ev: Number(d.ev) || 0,
    evs: Number.isFinite(Number(d.evs)) && d.evs !== null && d.evs !== '' ? Number(d.evs) : -1};
}
/* 104 聊聊的事件進度（104 網頁的對照：eventType 1 面試邀約、2 詢問意願、4 感謝函、5 到職日期提醒；eventStatus 1 同意、2 婉拒、3 未回覆、4／5 過期或取消）
   看板的「邀約」用 104「詢問意願」：應徵者按「我有興趣」＝有意願、按「婉拒」＝無意願 */
const EV_NAMES = {1:{1:'面試同意', 2:'面試婉拒', 3:'面試未回覆', 4:'面試取消', 5:'面試取消'}, 2:{1:'有意願', 2:'無意願', 3:'意願未回覆', 4:'意願已過期', 5:'意願已取消'},
  5:{1:'到職日期提醒同意', 2:'到職日期提醒婉拒', 3:'到職日期提醒未回覆', 4:'到職日期提醒取消', 5:'到職日期提醒取消'}};
const chatEv = c => !c ? '' : c.ev === 4 ? '感謝函' : (EV_NAMES[c.ev] || {})[c.evs] || '';
const jobKey = s => String(s || '').replace(/【[^】]*】/g, '').replace(/[\s()（）<>＜＞_\-－—–・·,，/、|]/g, '').toLowerCase();
/** 這位應徵者在 104 聊聊的對話（姓名相同；同名的再看職缺） */
function chatFor(r){
  if (!r || !S.chat.items.length) return null;
  const same = S.chat.items.filter(c => normName(c.name) === normName(r.name));
  if (same.length <= 1) return same[0] || null;
  const j = jobKey(r.job);
  return same.find(c => j && (jobKey(c.job).includes(j) || j.includes(jobKey(c.job)))) || same[0];
}
const chatWhen = t => t && t.length >= 16 ? `${+t.slice(5, 7)}/${+t.slice(8, 10)} ${t.slice(11, 16)}` : '';
/** 聊聊對話 → 編寫視窗用的資料列（找得到看板上的同一個人就帶 104 履歷連結） */
function chatRow(c){
  const rs = [...R.screen, ...R.invite].filter(x => normName(x.name) === normName(c.name));
  const withCv = rs.filter(x => x.cv);
  const hit = withCv.find(x => jobKey(x.job) && (jobKey(c.job).includes(jobKey(x.job)) || jobKey(x.job).includes(jobKey(c.job)))) || (withCv.length === 1 ? withCv[0] : null);
  return {id:'chat:' + c.id, name:c.name, job: c.job.replace(/【[^】]*】/g, '').trim() || (hit ? hit.job : ''), cv: hit ? hit.cv : '', chat:c};
}
function chatPanelHTML(){
  const items = S.chat.items, unread = items.filter(c => c.unread);
  // 小幫手每分鐘讀一次，沒變就不重送；最近 15 分鐘有送過，就用小幫手最後連線的時間當「檢查」時間
  const ckAt = RN.chatAt && Date.now() - RN.chatAt < 15 * 60000 ? Math.max(RN.chatAt, RN.lastSeen) : RN.chatAt;
  const upd = ckAt ? `${new Date(ckAt).toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})} 檢查` : '';
  if (!items.length) return `<div class="chat-h"><b>104 聊聊</b><span class="muted">${RN.chatAt ? `目前沒有對話・${esc(upd)}` : '104 小幫手讀到聊聊後會顯示在這裡（每分鐘更新）'}</span></div>`;
  const list = S.chatAll ? items.slice(0, 30) : unread.slice(0, 8);
  const rows = list.map(c => {
    const r = chatRow(c);
    return `<li class="chat-row${c.unread ? ' unread' : ''}">
      <div class="chat-who"><span class="c-name">${esc(c.name)}</span>${c.unread ? chip('未讀', 'warn') : ''}<span class="chat-job">${esc(r.job)}</span></div>
      <p class="chat-last"><span class="chat-from">${c.from === 'us' ? '我們' : '對方'}：</span>${esc(c.last || '（檔案或系統訊息）')}</p>
      <div class="chat-meta"><span class="muted">${esc(chatWhen(c.time))}</span>${r.cv ? extLink(r.cv, '104 履歷') : ''}${canEdit() ? `<button class="btn sm" type="button" data-chat-reply="${esc(c.id)}">回覆</button>` : ''}</div>
    </li>`;
  }).join('');
  return `<div class="chat-h"><b>104 聊聊</b>${S.chat.unread ? chip(`未讀 ${S.chat.unread}`, 'warn') : chip('沒有未讀', 'ok')}<span class="muted">${esc(upd)}</span><span class="sp"></span>
      <button class="btn sm ghost" type="button" data-chat-all="1" aria-pressed="${S.chatAll}">${S.chatAll ? '只看未讀' : `全部對話（${items.length}）`}</button></div>
    ${rows ? `<ul class="chat-list">${rows}</ul>` : `<p class="muted chat-empty">沒有未讀的聊聊。</p>`}`;
}
function renderChat(){
  const el = $('#chat-panel'); if (!el) return;
  const show = curBoard() === 'recruit' && S.loaded && (RN.configured || S.chat.items.length > 0);
  el.hidden = !show;
  if (show) el.innerHTML = chatPanelHTML();
}
/* ---------- 報到連結：新人自己用手機上傳報到文件（onboard.html#t=代碼；104 小幫手用聊聊送連結）---------- */
const ONB_DAYS = 14;
function normOnb(d){
  d = obj(d);
  if (!/^[a-f0-9]{32}$/.test(d.t || '')) return null;
  const i = obj(d.info), s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return {t:d.t, exp: Number(d.exp) || 0, at: Number(d.at) || 0, by:s(d.by, 40), n: Number(d.n) || 0, last: Number(d.last) || 0,
    info:{date:s(i.date, 10), time:s(i.time, 20), place:s(i.place, 120), note:s(i.note, 500)}};
}
const onbLive = h => !!(h && h.onb && h.onb.exp > Date.now());
const onbLink = h => h && h.onb ? `${ONBOARD_URL}#t=${h.onb.t}` : '';
function onbToken(){ const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
/** 沒有連結、過期或要換新 → 產生新的代碼（舊代碼馬上失效）；報到日期用看板上的預計報到日，時間、地點、提醒用管理頁的預設值 */
function onbEnsure(id, fresh){
  const h = S.hires.get(id); if (!h || !canEdit()) return null;
  if (onbLive(h) && !fresh) return h;
  const info = {date: planStart(h) || '', time: S.cfg.reportTime, place: S.cfg.reportPlace || S.cfg.place, note: S.cfg.reportNote};
  if (!saveHire(id, r => { r.onb = {t: onbToken(), exp: Date.now() + ONB_DAYS * 86400000, info, at: Date.now(), by: myName()}; })) return null;
  pullFromStore();
  return S.hires.get(id);
}
function onbText(h){
  const i = h.onb.info;
  const when = i.date ? [slash(i.date), i.time].filter(Boolean).join(' ') : `日期另行通知${i.time ? `（當天 ${i.time}）` : ''}`;
  return `${h.name}您好，歡迎加入起士公爵！\n\n【報到資訊】\n▸ 報到時間：${when}\n▸ 報到地點：${i.place || '另行通知'}${i.note ? `\n▸ 提醒：${i.note}` : ''}\n\n`
    + `請在報到前用手機打開下面的連結，上傳報到需要的文件（身分證正反面、存摺封面、大頭照、體檢／健康證明、畢業證書或專業證照），報到當天就不用再準備影本：\n${onbLink(h)}\n\n`
    + `連結 ${ONB_DAYS} 天內有效，只限您本人使用。有任何問題，歡迎直接在這裡回覆我們。`;
}
function onbHTML(h){
  if (['interview', 'rejected', 'declined', 'done'].includes(h.stage)) return '';
  const c = docCount(h), live = onbLive(h), ch = chatFor({name:h.name, job:h.position});
  const day = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const status = !h.onb ? '還沒傳報到連結。錄取、確定要來之後，按下面的按鈕把報到資訊和上傳連結傳給新人。'
    : !live ? `報到連結已經過期（${day(h.onb.exp)}），要再傳請按「換新連結」。`
    : `報到連結 ${fmtTime(h.onb.at)} 產生、${day(h.onb.exp)} 前有效${h.onb.last ? `・新人最後上傳 ${fmtTime(h.onb.last)}` : '・新人還沒上傳'}`;
  const btns = !canEdit() ? [] : [
    ch ? `<button class="btn sm primary" type="button" data-act="onb-send">${h.onb && live ? '再傳一次（104 聊聊）' : '傳報到連結（104 聊聊）'}</button>` : '',
    `<button class="btn sm" type="button" data-act="onb-copy">複製報到訊息</button>`,
    h.onb ? `<button class="btn sm ghost" type="button" data-act="onb-new">換新連結</button>` : ''].filter(Boolean);
  return `<section class="sec"><h3>報到連結 <span class="h-count">必要文件 ${c.have}/${c.need}</span></h3>
    <p class="muted">${esc(status)}</p>
    ${canEdit() && !ch ? '<p class="note">找不到這位在 104 聊聊的對話：請按「複製報到訊息」，用 LINE 或簡訊傳給新人。</p>' : ''}
    ${btns.length ? `<div class="fl-row">${btns.join('')}</div>` : ''}</section>`;
}
/* ---------- Offer 錄取通知書：看板填好排隊，hr@ 的履歷篩選程式約 5 分鐘內用部門範本產生 PDF、用 hr@ 寄出，PDF 傳回看板 ---------- */
const OFFER_FORMAL = true;    // 2026-11-26 測試成功後打開：可以正式寄給新人（寄出前再確認一次），寄出後可用 104 聊聊通知
const OFFER_DEPTS = [['直營部', '直營部（門市部範本）'], ['生產部', '生產部'], ['物管部', '物管部']];
const OFFER_NO_TPL = ['管理部', '通路部', '電商部'];
const OFFER_TITLES = ['甜點專櫃服務員', '包裝出貨人員', '行政人員', '生產廚務助理'];
const OFFER_TIMES = ['09:30', '10:00', '11:00', '14:00'];
const OFFER_PLACES = ['台南市永康區自強路32號', '新光西門', '永康東橋', '新光A11', '京站'];
const OFFER_KEYS = ['sal', 'email', 'dept', 'title', 'date', 'time', 'pay', 'place', 'boss'];
const OF = {drafts:{}, err:'', errId:'', confirmId:'', confirmTo:''};
function normOffer(d){
  d = obj(d);
  const f = obj(d.f), s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const out = {f:{sal:s(f.sal, 10), email:s(f.email, 120), dept:s(f.dept, 20), title:s(f.title, 40), date: isDate(f.date) ? f.date : '', time:s(f.time, 20), pay:s(f.pay, 60), place:s(f.place, 80), boss:s(f.boss, 30)},
    st: ['queued', 'working', 'done', 'failed', 'canceled'].includes(d.st) ? d.st : '', msg:s(d.msg, 300), to:s(d.to, 120),
    sentAt: Number(d.sentAt) || 0, sentMode: d.sentMode === 'formal' ? 'formal' : d.sentMode === 'test' ? 'test' : '',
    pdf: d.pdf && validFileId(d.pdf.id) ? {id:d.pdf.id, at:Number(d.pdf.at) || 0} : null};
  const r = obj(d.req);
  out.req = r.id ? {id:String(r.id), mode: r.mode === 'formal' ? 'formal' : 'test', at:Number(r.at) || 0, by:s(r.by, 40)} : null;
  return out;
}
/** 欄位預設值：還沒送出的修改 → 已存的 Offer 資料 → 人事資料表（性別、Email）→ 看板（應徵職位、預計報到日）→ 管理頁報到預設值 */
function offerVals(h){
  const d = OF.drafts[h.id], f = h.offer ? h.offer.f : null, F = h.form || {};
  const def = {sal: /女/.test(F.gender || '') ? '小姐' : /男/.test(F.gender || '') ? '先生' : '', email: F.email || F.email2 || '', dept:'',
    title: OFFER_TITLES.find(t => (h.position || '').includes(t)) || (h.position || '').replace(/【[^】]*】/g, '').split(/[_＿(（<＜]/)[0].trim().slice(0, 40),
    date: planStart(h) || '', time: S.cfg.reportTime || '', pay:'', place: S.cfg.reportPlace || S.cfg.place || '', boss:''};
  const out = {};
  for (const k of OFFER_KEYS) out[k] = d && k in d ? d[k] : f && f[k] ? f[k] : def[k];
  return out;
}
function offerStatus(o){
  if (!o || !o.st) return '';
  const where = o.req && o.req.mode === 'formal' ? '寄給新人' : '測試寄到 hr@';
  if (o.st === 'queued') return `排隊中：hr@ 的履歷篩選程式約 5 分鐘內產生 PDF 並${where}`;
  if (o.st === 'working') return `產生中：hr@ 的履歷篩選程式正在產生 PDF 並${where}`;
  if (o.st === 'done') return `${o.sentMode === 'formal' ? 'Offer' : '測試信'}已在 ${fmtTime(o.sentAt)} 寄到 ${o.to || '—'}`;
  if (o.st === 'failed') return `沒有寄出：${o.msg || '原因不明'}`;
  if (o.st === 'canceled') return '已取消排隊';
  return '';
}
function offerHTML(h){
  if (!['confirm', 'offer', 'docs'].includes(h.stage)) return '';
  const o = h.offer, v = offerVals(h), ed = canEdit() && h.stage !== 'docs', busy = !!o && ['queued', 'working'].includes(o.st);
  const dis = ed && !busy ? '' : ' disabled';
  const inp = (k, label, attrs = '') => `<div class="f"><label for="of-${k}">${label}</label><input class="inp" id="of-${k}" data-of="${k}" value="${esc(v[k])}" ${attrs}${dis}></div>`;
  const deptOpts = '<option value="">請選擇</option>' + OFFER_DEPTS.map(([k, t]) => `<option value="${k}"${v.dept === k ? ' selected' : ''}>${esc(t)}</option>`).join('')
    + OFFER_NO_TPL.map(k => `<option value="${k}" disabled>${k}（還沒有範本）</option>`).join('');
  const st = offerStatus(o), cls = !o ? '' : o.st === 'failed' ? ' err' : '';
  let pdf = '';
  if (o && o.pdf) {
    if (!canPii()) pdf = '<span class="muted">已產生 PDF（需要「查看證件」權限才能看）</span>';
    else { const p = PH.get(o.pdf.id); pdf = p && p.state === 'ok' ? `<button class="btn sm" type="button" data-act="pdf" data-fid="${esc(o.pdf.id)}">打開 Offer PDF</button>` : p && p.state === 'loading' ? '<span class="muted">讀取 PDF 中…</span>' : `<button class="btn sm" type="button" data-act="offer-pdf" data-fid="${esc(o.pdf.id)}">看 Offer PDF</button>`; }
  }
  const ask = ed && !busy && OF.confirmId === h.id;
  const btns = !ed ? [] : busy ? (o.st === 'queued' ? ['<button class="btn sm ghost" type="button" data-act="offer-cancel">取消排隊</button>'] : [])
    : ask ? [`<span class="confirm-q" style="width:auto">確定把 Offer 正式寄給 ${esc(OF.confirmTo)}？寄出後無法收回。</span>`, '<button class="btn sm danger-solid" type="button" data-act="offer-formal-yes">確定寄出</button>', '<button class="btn sm ghost" type="button" data-act="offer-formal-no">不要</button>']
    : [
    OFFER_FORMAL ? `<button class="btn sm primary" type="button" data-act="offer-formal">${o && o.st === 'done' && o.sentMode === 'formal' ? '重新寄給新人' : '正式寄給新人'}</button>` : '',
    `<button class="btn sm${OFFER_FORMAL ? '' : ' primary'}" type="button" data-act="offer-test">${o && o.st === 'done' ? '重新產生（測試寄到 hr@）' : '產生 Offer（測試寄到 hr@）'}</button>`].filter(Boolean);
  const ch = OFFER_FORMAL && o && o.st === 'done' && o.sentMode === 'formal' && canEdit() ? chatFor({name:h.name, job:h.position}) : null;
  if (ch) btns.push('<button class="btn sm" type="button" data-act="offer-chat">用 104 聊聊通知新人</button>');
  return `<section class="sec"><h3>Offer 錄取通知書 <span class="h-count">${OFFER_FORMAL ? '' : '測試模式'}</span></h3>
    <p class="muted">填好後按「產生 Offer」：hr@ 的履歷篩選程式約 5 分鐘內用部門的 Google 文件範本產生 PDF、用 hr@ 寄出，PDF 會傳回這裡。${OFFER_FORMAL ? '「正式寄給新人」寄到上面填的 Email（寄出前會再確認一次），寄出後可以按「用 104 聊聊通知新人」；想先看 PDF 可以按「測試寄到 hr@」。' : '目前是測試模式：信寄到 hr@cheeseduke.com.tw（標題有［測試］），不會寄給新人，也不會傳 104 聊聊。'}</p>
    <div class="grid2">
      <div class="f"><label for="of-sal">稱謂</label><select class="inp" id="of-sal" data-of="sal"${dis}><option value="">請選擇</option>${['小姐', '先生'].map(x => `<option${v.sal === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      ${inp('email', 'Email', 'type="email" maxlength="120"')}
      <div class="f"><label for="of-dept">報到部門</label><select class="inp" id="of-dept" data-of="dept"${dis}>${deptOpts}</select></div>
      ${inp('title', 'Offer 職稱', 'list="of-titles" maxlength="40"')}
      ${inp('date', '報到日期', 'type="date"')}
      ${inp('time', '報到時間', 'list="of-times" maxlength="20" placeholder="例如：09:30"')}
      ${inp('pay', '薪資', 'maxlength="60" placeholder="例如：時薪 200 元、月薪 32,000 元"')}
      ${inp('place', '報到地點', 'list="of-places" maxlength="80"')}
      ${inp('boss', '報到主管', 'maxlength="30"')}
    </div>
    <datalist id="of-titles">${OFFER_TITLES.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="of-times">${OFFER_TIMES.map(t => `<option value="${t}">`).join('')}</datalist>
    <datalist id="of-places">${OFFER_PLACES.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    ${st ? `<p class="imp-msg${cls}" role="status">${esc(st)}</p>` : ''}
    ${OF.err && OF.errId === h.id ? `<p class="imp-msg err" role="alert">${esc(OF.err)}</p>` : ''}
    ${btns.length || pdf ? `<div class="fl-row">${btns.join('')}${pdf}</div>` : ''}
  </section>`;
}
function offerRead(){
  const f = {};
  for (const k of OFFER_KEYS) { const el = $('#of-' + k); f[k] = el ? String(el.value || '').trim() : ''; }
  return f;
}
function offerQueue(id, mode, confirmed){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  const f = offerRead(), miss = [];
  const L = {sal:'稱謂', email:'Email', dept:'報到部門', title:'Offer 職稱', date:'報到日期', time:'報到時間', pay:'薪資', place:'報到地點', boss:'報到主管'};
  for (const k of OFFER_KEYS) if (!f[k]) miss.push(L[k]);
  OF.errId = id;
  if (miss.length) { OF.err = `還沒填：${miss.join('、')}`; refreshDrawer(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) { OF.err = 'Email 格式不對'; refreshDrawer(); return; }
  if (!OFFER_DEPTS.some(([k]) => k === f.dept)) { OF.err = `「${f.dept}」還沒有 Offer 範本`; refreshDrawer(); return; }
  OF.err = '';
  if (mode === 'formal' && !confirmed) { OF.confirmId = id; OF.confirmTo = f.email; OF.drafts[id] = Object.assign({}, OF.drafts[id], f); refreshDrawer(); return; }
  OF.confirmId = '';
  saveHire(id, r => { const old = obj(r.offer); r.offer = {f, req:{id: rid('of'), mode, at:Date.now(), by:myName()}, st:'queued', tries:0, pdf: old.pdf || null}; if (!r.startDate) r.startDate = f.date; });
  delete OF.drafts[id];
  pullFromStore(); refreshDrawer();
  toast(mode === 'formal' ? '已排入：約 5 分鐘內由 hr@ 寄給新人' : '已排入：約 5 分鐘內由 hr@ 產生 Offer，測試寄到 hr@cheeseduke.com.tw');
}
function offerChatText(h){
  const f = h.offer.f, t = (S.tpl.find(x => x.id === 'tpl-offer') || {}).text || '';
  const ctx = {'職缺': f.title, '姓名': h.name, '公司名稱': S.cfg.company, '報到日期': f.date ? slash(f.date) : '', '報到時間': f.time};
  return (t ? fillTpl(t, ctx) : `${h.name}您好，恭喜您錄取起士公爵「${f.title}」！`) + `\n\n錄取通知書已寄到您的 Email（${f.email}），請查收並回覆是否接受錄取。`;
}
function rowById(id){
  if (String(id).startsWith('ob:')) return obInviteRows('').find(r => r.id === id) || null;
  return R.screen.find(r => r.id === id) || R.invite.find(r => r.id === id) || null;
}

/* ================= 工作清冊（「HR工作清冊」試算表，只能看）：例行工作項目、工作手冊、到期提醒 ================= */
const M = {meta:null, items:[], byId:new Map()};
const MN_KINDS = ['daily','weekly','monthly','yearly','adhoc','project'];
const MN_GROUPS = [['daily','每日'],['weekly','每週'],['monthly','每月'],['yearly','每年'],['adhoc','不定期'],['project','專案性']];
function cleanManual(d){
  const s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const parts = (Array.isArray(d.parts) ? d.parts : []).slice(0, 20).map(p => { p = obj(p); return {desc:s(p.desc, 2000), steps:s(p.steps, 2000), ref:s(p.ref, 2000), file:s(p.file, 600), teachFile:s(p.teachFile, 200), teachVideo:s(p.teachVideo, 400)}; });
  const dues = (Array.isArray(d.dues) ? d.dues : []).slice(0, 8).map(obj)
    .filter(x => (x.type === 'date' && isDate(x.date)) || (x.type === 'md' && /^\d{2}-\d{2}$/.test(x.md || '')) || ((x.type === 'mstart' || x.type === 'mend') && Number.isInteger(x.month) && x.month >= 1 && x.month <= 12))
    .map(x => ({type:x.type, date:x.date || '', md:x.md || '', month:x.month || 0, label:s(x.label, 60), lead:Math.min(Math.max(Number(x.lead) || 30, 1), 400)}));
  return {id:String(d.id), sec: d.sec === 'project' ? 'project' : 'routine', kind: MN_KINDS.includes(d.kind) ? d.kind : 'adhoc', freqRaw:s(d.freqRaw, 40), title:s(d.title, 80),
    weekday: Number.isInteger(d.weekday) ? d.weekday : -1, day: Number.isInteger(d.day) ? d.day : 0,
    months: Array.isArray(d.months) ? d.months.filter(m => Number.isInteger(m) && m >= 1 && m <= 12) : [],
    owner:s(d.owner, 40), taught:s(d.taught, 40), duration:s(d.duration, 40), parts, dues};
}
function buildManual(){
  const all = ST.list('manual').filter(r => r && typeof r === 'object' && r.id != null);
  const m = all.find(r => r.id === '_meta');
  M.meta = m ? {sheet: typeof m.sheet === 'string' ? m.sheet : ''} : null;
  M.items = all.filter(r => r.id !== '_meta' && typeof r.title === 'string' && r.title.trim()).map(cleanManual);
  M.byId = new Map(M.items.map(i => [i.id, i]));
}
const WD7 = '日一二三四五六';
function mnDue(i){
  if (i.kind === 'weekly') return i.weekday >= 0 ? `每週${WD7[i.weekday]}` : '';
  if (i.kind === 'monthly') return i.day ? `每月 ${i.day} 號` : '';
  if (i.kind === 'yearly') return `每年 ${i.months.join('、')} 月`;
  return '';
}
/** 工作清冊裡這個期間要做的項目（每年的項目只在那幾個月出現在「每月」） */
function mnRoutineItems(freq){
  const month = new Date().getMonth() + 1;
  return M.items.filter(i => i.sec === 'routine' && (freq === 'daily' ? i.kind === 'daily' : freq === 'weekly' ? i.kind === 'weekly' : (i.kind === 'monthly' || (i.kind === 'yearly' && i.months.includes(month)))))
    .map((i, n) => ({id:i.id, freq, title:i.title, due:mnDue(i), order:n, sheet:true}));
}
/** 到期提醒：下一次的日期（每年的日期過了 14 天就算明年的） */
function dueNext(d, t){
  if (d.type === 'date') return d.date;
  const y = +t.slice(0, 4);
  const mk = yy => d.type === 'md' ? `${yy}-${d.md}` : d.type === 'mstart' ? `${yy}-${pad(d.month)}-01` : ymd(new Date(yy, d.month, 0));
  let x = mk(y);
  if (dayDiff(t, x) < -14) x = mk(y + 1);
  return x;
}
function mnReminders(){
  const t = today(), out = [];
  for (const i of M.items) for (const d of i.dues) {
    const date = dueNext(d, t), n = dayDiff(t, date);
    if (isFinite(n) && n <= d.lead && n >= (d.type === 'date' ? -30 : -14)) out.push({i, d, date, n});
  }
  return out.sort((a, b) => a.n - b.n);
}
const dueText = n => n > 0 ? `還有 ${n} 天` : n === 0 ? '今天' : `已過 ${-n} 天`;
const lineHTML = t => esc(t).replace(/\n/g, '<br>');
/** 參考事項：Z 槽等路徑可以複製、https 連結可以點 */
function refHTML(t){
  return String(t).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    if (/^[A-Za-z]:\\|^\\\\/.test(l)) return `<div class="mn-path"><code>${esc(l)}</code><button class="btn sm ghost" type="button" data-copy="${esc(l)}">複製</button></div>`;
    const u = l.match(/https:\/\/[^\s"'<>，。]+/);
    if (u) { const k = l.indexOf(u[0]); return `<div>${esc(l.slice(0, k))}<a class="link" href="${esc(u[0])}" target="_blank" rel="noopener">${esc(u[0].length > 64 ? u[0].slice(0, 61) + '…' : u[0])}</a>${esc(l.slice(k + u[0].length))}</div>`; }
    return `<div>${esc(l)}</div>`;
  }).join('');
}
function mnDetailHTML(i){
  const multi = i.parts.length > 1;
  const parts = i.parts.map((p, n) => {
    const f = (label, html) => html ? `<div class="mn-f"><span>${label}</span><div>${html}</div></div>` : '';
    const body = f('工作說明', p.desc && lineHTML(p.desc)) + f('程序', p.steps && lineHTML(p.steps)) + f('參考事項', p.ref && refHTML(p.ref))
      + f('檔案', p.file && lineHTML(p.file)) + f('教學', (p.teachFile || p.teachVideo) && refHTML([p.teachFile, p.teachVideo].filter(Boolean).join('\n')));
    return body ? `<div class="mn-part">${multi ? `<b class="mn-pn">${n + 1}</b>` : ''}<div>${body}</div></div>` : '';
  }).join('');
  const meta = [i.owner && `建議執行人：${i.owner}`, i.taught && `教學：${i.taught}`, i.duration && `時間：${i.duration}`].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  return `${meta ? `<div class="mn-meta">${meta}</div>` : ''}${parts || '<p class="muted">工作清冊裡沒有寫說明。</p>'}`;
}

/* ================= 職缺條件（面試時對照；資料類別 jobs，管理頁編輯） ================= */
function normJob(d){
  d = obj(d);
  const title = str(d.title).slice(0, 60);
  if (!title || d.id == null) return null;
  return {id:String(d.id), title, keys:str(d.keys).slice(0, 200), text: typeof d.text === 'string' ? d.text.slice(0, 8000) : '', order: typeof d.order === 'number' ? d.order : 0};
}
function normCrit(c){
  c = obj(c);
  return {job: typeof c.job === 'string' ? c.job.slice(0, 60) : '', ok: Array.isArray(c.ok) ? c.ok.filter(k => typeof k === 'string' && /^[0-9a-f]{6,16}$/.test(k)).slice(0, 300) : []};
}
const JOB_PARSE = new Map();
/** 條件文字 → [{title, warn, notes, items:[{key, text}]}]：「#」開頭是段落、「-」開頭是一項條件，其他文字是段落說明；段落名稱有「不符合」的只提醒、不勾選 */
function parseJob(text){
  if (JOB_PARSE.has(text)) return JOB_PARSE.get(text);
  const secs = []; let cur = null;
  const open = t => { cur = {title:t || '條件', warn:/不符合|淘汰/.test(t), notes:[], items:[]}; secs.push(cur); };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { open(line.replace(/^#+\s*/, '')); continue; }
    if (!cur) open('條件');
    const m = line.match(/^[-－–•・*]\s*(.*)$/);
    if (m) { if (m[1]) cur.items.push({key:hashStr(cur.title + '|' + m[1]).slice(0, 12), text:m[1]}); }
    else cur.notes.push(line);
  }
  const out = secs.filter(s => s.items.length || s.notes.length);
  if (JOB_PARSE.size > 50) JOB_PARSE.clear();
  JOB_PARSE.set(text, out);
  return out;
}
const normPos = s => String(s || '').replace(/烘培/g, '烘焙').replace(/[\s　]+/g, '').toLowerCase();
const jobKeys = j => j.keys.split(/[,，、;；\s]+/).map(normPos).filter(Boolean);
/** 這個人要對照哪個職缺：面試畫面選過的優先，否則依應徵職位（看板、人事資料表、試算表）裡的關鍵字 */
function jobFor(h){
  if (h.crit.job) { const j = S.jobs.find(x => x.id === h.crit.job); if (j) return j; }
  const x = R.meta ? extFor(h) : {};
  for (const p of [h.position, h.form && h.form.position, x.result && x.result.job, x.invite && x.invite.job, x.screen && x.screen.job]) {
    const n = normPos(p);
    const j = n && S.jobs.find(jb => jobKeys(jb).some(k => n.includes(k)));
    if (j) return j;
  }
  return null;
}
/** 已勾的項目數（不含「不符合」段落） */
function critCount(h, j){
  const ok = new Set(h.crit.ok), items = parseJob(j.text).filter(s => !s.warn).flatMap(s => s.items);
  return {n: items.filter(i => ok.has(i.key)).length, of: items.length};
}
function jobHTML(h){
  const canW = canEdit();
  if (!S.jobs.length) return `<h3>職缺條件</h3><p class="note lead">${isAdmin() ? '還沒有設定職缺條件。到「管理」頁的「職缺條件」新增後，面試時這裡會出現該職缺的條件，可以逐項勾選對照。' : '管理員還沒有設定職缺條件。'}</p>`;
  const j = jobFor(h), auto = h.crit.job ? jobFor(Object.assign({}, h, {crit:{job:'', ok:h.crit.ok}})) : j;
  const sel = `<select class="inp" id="job-sel" aria-label="對照的職缺"${canW ? '' : ' disabled'}><option value="">${auto ? `依應徵職位自動判斷（${esc(auto.title)}）` : '選擇職缺…'}</option>${S.jobs.map(x => `<option value="${esc(x.id)}"${h.crit.job === x.id ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</select>`;
  if (!j) return `<h3>職缺條件</h3><div class="job-head">${sel}</div><p class="note lead">看不出應徵職位「${esc(h.position || '未填')}」對應哪個職缺，請在上面選擇。</p>`;
  const ok = new Set(h.crit.ok), c = critCount(h, j);
  const body = parseJob(j.text).map(s => {
    const n = s.items.filter(i => ok.has(i.key)).length;
    const list = !s.items.length ? '' : s.warn
      ? `<ul class="job-list warn">${s.items.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>`
      : `<ul class="job-list">${s.items.map(i => `<li><input type="checkbox" id="jc-${i.key}" data-crit="${i.key}"${ok.has(i.key) ? ' checked' : ''}${canW ? '' : ' disabled'}><label for="jc-${i.key}">${esc(i.text)}</label></li>`).join('')}</ul>`;
    return `<div class="job-sec"><h4>${esc(s.title)}${s.items.length && !s.warn ? `<span class="h-count">${n}/${s.items.length}</span>` : ''}</h4>${s.notes.map(t => `<p class="job-note">${esc(t)}</p>`).join('')}${list}</div>`;
  }).join('');
  return `<h3>職缺條件 <span class="h-count">勾選符合的項目・${c.n}/${c.of}</span></h3><div class="job-head"><b>${esc(j.title)}</b>${sel}</div>${body}`;
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
  if (key === 'interview') return items.sort((a,b) => cmpDate(a.interviewDate, b.interviewDate));
  if (key === 'confirm') return items.sort((a,b) => (obj(a.steps.interview).at || 0) - (obj(b.steps.interview).at || 0));
  if (key === 'offer') return items.sort((a,b) => cmpDate(planStart(a), planStart(b)));
  return items.sort((a,b) => cmpDate(a.startDate, b.startDate));
}
const rejectedItems = () => [...S.hires.values()].filter(visible).filter(h => h.stage === 'rejected' && inMonth(ivDay(h)));
const declinedItems = () => [...S.hires.values()].filter(visible).filter(h => h.stage === 'declined' && inMonth(tsDate(obj(h.steps.confirm).at) || ivDay(h)));
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
  saveHire(id, r => { r.stage = hired ? 'confirm' : 'rejected'; r.result = hired ? 'hired' : 'rejected'; r.steps = obj(r.steps); r.steps.interview = {at:Date.now(), by:myName()}; });
  toast(hired ? `${nm(h)} 已錄取，移到「確認入職」` : `${nm(h)} 已標記為未錄取`, () => backTo(id, 'interview'));
}
/** 錄取後確認要不要來：要 → Offer；不要 → 婉拒入職 */
function confirmJoin(id, yes){
  const h = S.hires.get(id); if (!h || !canEdit() || h.stage !== 'confirm') return;
  saveHire(id, r => { r.stage = yes ? 'offer' : 'declined'; r.steps = obj(r.steps); r.steps.confirm = {at:Date.now(), by:myName()}; });
  toast(yes ? `${nm(h)} 要來，移到「Offer」` : `${nm(h)} 婉拒入職`, () => backTo(id, 'confirm'));
}
function advance(id){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  if (h.stage === 'confirm') { confirmJoin(id, true); return; }
  const i = FLOW.indexOf(h.stage);
  if (i < 1 || i >= FLOW.length - 1) return;
  if (h.stage === 'docs' && !docsReady(h)) { openDrawer(id); toast('請先上傳身分證／居留證正反面'); return; }
  const cur = h.stage, next = FLOW[i + 1];
  if (cur === 'offer') {   // 已報到：沒填到職日就記下（試算表的預計報到日已到就用它，否則用今天）
    const t = today(), plan = (extFor(h).result || {}).start || '';
    const start = h.startDate || (isDate(plan) && plan <= t ? plan : t), setStart = !h.startDate;
    saveHire(id, r => { r.stage = next; r.steps = obj(r.steps); r.steps.offer = {at:Date.now(), by:myName()}; if (setStart) r.startDate = start; });
    toast(`${nm(h)} 已報到，移到「新進人員・勞健保」${setStart ? `，到職日記為 ${md(start)}` : ''}`,
      () => saveHire(id, r => { r.stage = 'offer'; r.steps = obj(r.steps); delete r.steps.offer; if (setStart) r.startDate = ''; }));
    return;
  }
  saveHire(id, r => { r.stage = next; r.steps = obj(r.steps); r.steps[cur] = {at:Date.now(), by:myName()}; });
  toast(next === 'done' ? `${nm(h)} 已完成勞健保加保` : `${nm(h)} 移到「${TITLE[next]}」`, () => backTo(id, cur));
}
function backTo(id, target){
  saveHire(id, r => { r.stage = target; r.steps = obj(r.steps); delete r.steps[target]; if (target === 'interview') r.result = 'pending'; });
}
function stepBack(id){
  const h = S.hires.get(id); if (!h || !canEdit()) return;
  const target = h.stage === 'rejected' ? 'interview' : h.stage === 'declined' ? 'confirm' : FLOW[FLOW.indexOf(h.stage) - 1];
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
  const files = Object.values(h.docs).map(d => d.id).concat(h.offer && h.offer.pdf ? [h.offer.pdf.id] : []);   // 證件照片和 Offer PDF 一起丟垃圾桶
  closeDrawer(true);
  ST.remove('hires', id);
  files.forEach(fid => AU.api('photoDel', {id:fid}).catch(() => {}));
  toast(`已刪除 ${nm(h)} 的資料`);
}

/* ================= 頁首、頁尾、同步狀態 ================= */
function renderViews(){
  const all = [...S.hires.values()];
  const inRecruit = all.filter(h => ['interview','confirm','offer'].includes(h.stage)).length;
  const inFlow = all.filter(h => ACTIVE.includes(h.stage)).length;
  let left = 0;
  for (const f of FREQS) { const d = S.checks[f.key].done; left += rtItems(f.key).filter(r => !(d[r.id] && d[r.id].at)).length; }
  const urgent = S.loaded ? overviewAlerts().filter(a => a.sev >= 2).length : 0;
  const remN = M.meta ? mnReminders().length : 0;
  const tabs = [
    ['overview', '總覽', urgent ? `${urgent} 項緊急` : ''],
    ['recruit', '招募', S.loaded ? `${inRecruit} 人` : ''],
    ['pipeline', '新進人員・勞健保', S.loaded ? `${inFlow} 人` : ''],
    ['routine', '例行工作', S.loaded && left ? `未完成 ${left}` : ''],
    ['manual', '工作手冊', S.loaded && M.meta && remN ? `${remN} 項到期` : '']
  ];
  if (isAdmin()) tabs.push(['users', '管理', '']);
  $('#views').innerHTML = tabs.map(([k, t, b]) =>
    `<button class="view-btn" type="button" aria-selected="${S.view === k}" data-view="${k}">${t}${b ? `<span class="badge">${esc(b)}</span>` : ''}</button>`).join('');
}
function renderBanner(){
  const msgs = [];
  if (!((window.HR_CLOUD || {}).url || '').trim()) msgs.push('尚未設定雲端網址（config.js 的 HR_CLOUD.url），資料只存在這台裝置。');
  if (AU && AU.user() && !canEdit() && ['recruit','pipeline','overview'].includes(S.view)) msgs.push('你目前只能查看人事資料；需要修改請向管理員申請「人事資料編輯」權限。');
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
  for (const k of ['overview','pipeline','routine','manual','users']) $('#' + k + '-view').hidden = BOX[S.view] !== k;
}

/* ================= 招募／新進人員・勞健保（同一個看板畫面，欄位不同） ================= */
const curBoard = () => S.view === 'pipeline' ? 'pipeline' : 'recruit';
const batchOn = () => S.batch && S.view === 'recruit';
function curTab(){ const b = curBoard(), t = S.tabs[b]; return BOARDS[b].some(s => s.key === t) ? t : BOARDS[b][0].key; }
const colItems = (key, useQ) => EXT.includes(key) ? extItems(key, useQ) : columnItems(key);
function renderToolbar(){
  const [y, m] = S.month.split('-'), rec = curBoard() === 'recruit', canW = canEdit();
  $('#m-label').textContent = `${y} 年 ${+m} 月`;
  $('#m-next').disabled = S.month >= curMonth();
  $('#q').placeholder = rec ? '搜尋姓名、職缺' : '搜尋姓名、職位、部門';
  $('#slot-btn').hidden = !canW || !rec;
  const bb = $('#batch-btn');
  bb.hidden = !canW || !rec;
  bb.classList.toggle('on', S.batch);
  bb.setAttribute('aria-pressed', String(S.batch));
  bb.textContent = S.batch ? '結束批次整理' : '批次整理';
  $('#ins-note').hidden = rec;
  $('#rc-note').hidden = !rec;
  const rn = $('#rn-note'); rn.hidden = !rec || !canEdit(); rn.textContent = `104 小幫手：${rnLine()}`;
}
function renderStats(){
  const all = [...S.hires.values()];
  const mLabel = `${+S.month.slice(5)} 月`;
  const v = n => S.loaded ? n : '–';
  let items;
  if (curBoard() === 'recruit') {
    const interviewed = all.filter(h => inMonth(ivDay(h)));
    const hired = interviewed.filter(h => h.result === 'hired' || ACTIVE.includes(h.stage) || h.stage === 'done');
    const rejected = interviewed.filter(h => h.stage === 'rejected');
    const decided = hired.length + rejected.length;
    const rate = decided ? Math.round(hired.length / decided * 100) + '%' : '—';
    const scr = R.meta ? extItems('x_screen', false) : null, inv = R.meta ? extItems('x_invite', false) : null;
    const waiting = all.filter(h => h.stage === 'offer');
    items = [
      ['新履歷', scr ? v(scr.length) : '–', scr ? `近 ${RC_DAYS.screen} 天・推薦面試 ${scr.filter(r => r.tier === '推薦面試').length} 位` : '還沒有履歷', ''],
      ['邀約中', inv ? v(inv.length) : '–', inv ? '等應徵者選時間' : '尚未連結', ''],
      ['面試人數', v(interviewed.length), `${mLabel}面試`, ''],
      ['錄取人數', v(hired.length), `錄取率 ${S.loaded ? rate : '—'}`, ''],
      ['等報到', v(waiting.length), '已確認要來', '']
    ];
  } else {
    const active = all.filter(h => ACTIVE.includes(h.stage));
    const t = today();
    const late = active.filter(h => h.startDate && h.startDate <= t);
    const joined = all.filter(h => (ACTIVE.includes(h.stage) || h.stage === 'done') && inMonth(h.startDate));
    const done = all.filter(h => h.stage === 'done' && inMonth(doneDate(h)));
    items = [
      ['本月到職', v(joined.length), `${mLabel}報到`, ''],
      ['辦理中', v(active.length), '報到至勞健保之間', ''],
      ['已到職未加保', v(late.length), late.length ? '請立即申報加保' : '目前沒有', late.length ? 'alert' : ''],
      ['完成加保', v(done.length), `${mLabel}完成`, '']
    ];
  }
  $('#stats').innerHTML = items.map(([k, val, s, cls]) =>
    `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${esc(s)}</div></div>`).join('');
}
function renderTabs(){
  const tab = curTab();
  $('#tabs').innerHTML = BOARDS[curBoard()].map(st =>
    `<button class="tab" type="button" role="tab" aria-selected="${tab === st.key}" data-tab="${st.key}">${st.title}<span>${S.loaded && (!EXT.includes(st.key) || R.meta) ? colItems(st.key).length : ''}</span></button>`).join('');
}
const chip = (text, cls) => `<span class="chip ${cls || ''}">${esc(text)}</span>`;
const extLink = (u, t) => httpsUrl(u) ? `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>` : '';
const decCls = s => /確認錄取|^錄取/.test(s) ? 'ok' : /不錄取|婉拒|取消/.test(s) ? 'danger' : '';
/** 試算表的面試結果／錄取決策，放在卡片上提醒 */
function sheetDecChip(h){
  const rs = extFor(h).result;
  const s = rs && (rs.dec || rs.res);
  return s ? chip(`舊紀錄：${s}`, decCls(s)) : '';
}
function startChip(h){
  const d = planStart(h);
  if (!isDate(d)) return chip('還沒有報到日');
  const n = dayDiff(today(), d);
  return n === 0 ? chip('今天報到', 'warn') : n < 0 ? chip(`預計 ${md(d)} 報到・已過`, 'warn') : chip(`預計 ${md(d)} 報到`);
}
/** 招募前三欄（試算表資料，只能看）的卡片 */
function extCardHTML(r, key){
  const chips = [], t = today();
  let text = '';
  if (key === 'x_screen') {
    chips.push(chip(r.tier + (r.score != null ? ` ${r.score} 分` : ''), r.tier === '推薦面試' ? 'ok' : ''));
    if (r.at) chips.push(chip(`${shortDT(r.at)} 收到`));
    if (r.st && r.st !== '未處理') chips.push(chip(r.st, 'warn'));
    if (r.type) chips.push(chip(r.type));
    const why = r.why.replace(/^[^：:]{0,40}[：:]\s*評分\s*\d+\s*分[，,。]?\s*/, '');
    text = [r.sum, why].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('');
  } else {
    if (r.ivD) chips.push(r.ivD === t ? chip(`今天 ${r.ivT} 面試`, 'warn') : chip(`面試 ${md(r.ivD)}${r.ivT ? ' ' + r.ivT : ''}`, r.ivD < t ? 'warn' : ''));
    else if (r.at && r.src !== 'outbox') chips.push(chip(`${shortDT(r.at)} 送出邀約`));
    if (r.ev) chips.push(evChip(r.ev));
    if (key === 'x_booked') chips.push(r.formFill === '已填寫' ? chip('人事表已填', 'ok') : r.formSt === '已發送' ? chip('人事表已發送') : chip(r.formSt ? `人事表${r.formSt}` : '人事表未發送', 'warn'));
    if (r.plat) chips.push(chip(r.plat));
  }
  const o = r.ob || obFor(refOf(r)), acts = [], ch = chatFor(r);
  if (o) chips.push(obChip(o));
  if (ch && ch.unread) chips.push(chip('聊聊未讀', 'warn'));
  if (canEdit()) {
    const rid_ = esc(r.id);
    const chatBtn = ch ? `<button class="btn sm${ch.unread ? ' primary' : ''}" type="button" data-ob="chat" data-row="${rid_}" data-room="${esc(ch.id)}">${ch.unread ? '回覆聊聊' : '傳聊聊'}</button>` : '';
    if (key === 'x_screen') { acts.push(`<button class="btn sm primary" type="button" data-ob="invite" data-row="${rid_}">邀約</button>`, `<button class="btn sm" type="button" data-ob="reject" data-row="${rid_}">不邀約</button>`); if (ch && ch.unread) acts.push(chatBtn); }
    else acts.push(chatBtn || `<button class="btn sm" type="button" data-ob="message" data-row="${rid_}">傳訊息</button>`);
    if (o && o.status === 'failed') acts.push(`<button class="btn sm" type="button" data-ob="retry" data-ob-id="${esc(o.id)}">重送</button>`);
    if (o && o.status === 'failed' && o.text && is104(o.to.cv)) acts.push(`<button class="btn sm" type="button" data-ob="manual" data-ob-id="${esc(o.id)}">改手動送</button>`);
    if (o && o.status === 'queued') acts.push(`<button class="btn sm ghost" type="button" data-ob="cancel" data-ob-id="${esc(o.id)}">取消送出</button>`);
  }
  const links = [extLink(r.cv, '104 履歷'), extLink(r.mail, 'Gmail')].filter(Boolean).join('');
  return `<article class="card ext">
    <div class="c-head"><span class="c-name">${esc(r.name)}</span>${r.job ? `<span class="c-role">${esc(r.job)}</span>` : ''}</div>
    ${text ? `<p class="c-why">${text}</p>` : ''}
    <div class="chips">${chips.join('')}</div>
    ${o && o.status === 'failed' && o.result ? `<p class="c-why"><span class="ob-err">送出失敗：${esc(o.result)}</span></p>` : ''}
    ${links ? `<div class="c-links">${links}</div>` : ''}
    ${acts.length ? `<div class="c-act">${acts.join('')}</div>` : ''}
  </article>`;
}
function cardHTML(h){
  const id = esc(h.id), canW = canEdit();
  const chips = [], acts = [];
  if (h.stage === 'interview') {
    const inv = extFor(h).invite, ivD = h.interviewDate || (inv && inv.ivD) || '', ivT = h.interviewDate ? h.interviewTime : (inv && inv.ivT) || '';
    if (ivD) chips.push(ivD === today() ? chip(`今天 ${ivT} 面試`, 'warn') : chip(`面試 ${md(ivD)}${ivT ? ' ' + ivT : ''}`));
    if (h.source === 'web') chips.push(chip('線上應徵', 'ok'));
    else if (h.formAt) chips.push(chip(`填表 ${md(tsDate(h.formAt))}`));
    if (h.rating) chips.push(chip(`評分：${RATING[h.rating]}`, h.rating === 'D' ? 'danger' : (h.rating === 'A' || h.rating === 'B') ? 'ok' : ''));
    else if (h.comment) chips.push(chip('已填評語'));
    const dc = sheetDecChip(h); if (dc) chips.push(dc);
    const iev = (extFor(h).invite || {}).ev || ''; if (/婉拒|取消|無意願/.test(iev)) chips.push(evChip(iev));
    const jb = h.crit.ok.length ? jobFor(h) : null;
    if (jb) { const c = critCount(h, jb); chips.push(chip(`條件 ${c.n}/${c.of}`, c.of && c.n / c.of >= 0.8 ? 'ok' : '')); }
    if (canW) acts.push(
      `<button class="btn sm" type="button" data-act="comment" data-id="${id}">${h.comment ? '查看評語' : '填寫評語'}</button>`,
      `<button class="btn sm primary" type="button" data-act="hire" data-id="${id}">錄取</button>`,
      `<button class="btn sm" type="button" data-act="reject" data-id="${id}">未錄取</button>`);
  } else if (h.stage === 'confirm') {
    const s = obj(h.steps.interview);
    if (s.at) chips.push(chip(`${md(tsDate(s.at))} 錄取`));
    const dc = sheetDecChip(h); if (dc) chips.push(dc);
    if (planStart(h)) chips.push(startChip(h));
    if (canW) acts.push(
      `<button class="btn sm primary" type="button" data-act="join-yes" data-id="${id}">要，寄 Offer</button>`,
      `<button class="btn sm" type="button" data-act="join-no" data-id="${id}">不要</button>`);
  } else if (h.stage === 'offer') {
    const rs = extFor(h).result;
    chips.push(startChip(h));
    const oev = (extFor(h).invite || {}).ev || ''; if (/^到職日期提醒/.test(oev)) chips.push(chip(`104 報到：${oev.replace('到職日期提醒', '')}`, evCls(oev)));
    if (rs && rs.offer) chips.push(chip(`Offer ${rs.offer}`, rs.offer === '已寄出' ? 'ok' : /未寄送/.test(rs.offer) ? 'warn' : ''));
    if (rs && rs.pdf) acts.push(`<a class="btn sm" href="${esc(rs.pdf)}" target="_blank" rel="noopener">Offer PDF ↗</a>`);
    if (canW) acts.push(`<button class="btn sm primary" type="button" data-act="advance" data-id="${id}">${ADV_LABEL.offer}</button>`);
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
  const batch = batchOn(), picked = batch && S.sel.has(h.id);
  return `<article class="card${h.stage === 'done' ? ' is-done' : ''}${batch ? ' is-batch' : ''}${picked ? ' picked' : ''}">
    ${batch ? `<label class="pick"><input type="checkbox" data-pick="${id}"${picked ? ' checked' : ''} aria-label="選取 ${esc(nm(h))}"></label>` : ''}
    ${h.stage === 'done' ? '<span class="stamp" aria-hidden="true">已加保</span>' : ''}
    <button class="card-open" type="button" data-act="open" data-id="${id}"><span class="c-name">${esc(nm(h))}</span>${role ? `<span class="c-role">${esc(role)}</span>` : ''}</button>
    ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    ${acts.length && !batch ? `<div class="c-act">${acts.join('')}</div>` : ''}
  </article>`;
}
/** 欄位最下面可展開的清單（未錄取、婉拒入職、暫緩、應徵者取消） */
/** 收合區裡放完整卡片（不推薦的人也要能邀約、不邀約） */
function foldCardsHTML(key, summary, cards){
  if (!cards.length) return '';
  return `<details class="rej" data-fold="${key}"${S.open[key] ? ' open' : ''}><summary>${esc(summary)}</summary><div class="fold-cards">${cards.join('')}</div></details>`;
}
function foldHTML(key, summary, lis){
  if (!lis.length) return '';
  const open = S.open[key] || (key === 'rej' && batchOn());
  return `<details class="rej" data-fold="${key}"${open ? ' open' : ''}><summary>${esc(summary)}</summary><ul>${lis.join('')}</ul></details>`;
}
const hireLi = h => batchOn()
  ? `<li><label><input type="checkbox" class="pick-r" data-pick="${esc(h.id)}"${S.sel.has(h.id) ? ' checked' : ''}><span class="link">${esc(nm(h))}</span></label><span>${esc(h.position)}</span></li>`
  : `<li><button class="link" type="button" data-act="open" data-id="${esc(h.id)}">${esc(nm(h))}</button><span>${esc(h.position)}</span></li>`;
const extLi = (r, note) => `<li>${r.cv ? `<a class="link" href="${esc(r.cv)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : `<b>${esc(r.name)}</b>`}<span>${esc(note || r.job)}</span></li>`;
function colExtraHTML(key, mNum){
  if (key === 'interview') { const rej = rejectedItems(); return foldHTML('rej', `未錄取・${mNum} 月 ${rej.length} 位`, rej.map(hireLi)); }
  if (key === 'confirm') { const dec = declinedItems(); return foldHTML('dec', `婉拒入職・${mNum} 月 ${dec.length} 位`, dec.map(hireLi)); }
  if (key === 'x_screen' && R.meta) {
    const p = extItems('x_pause');
    const nd = R.screen.filter(r => { const o = obFor(refOf(r)); return o && (o.type === 'skip' || o.type === 'thanks') && obDecided(o); });
    return foldCardsHTML('pause', `不推薦・近 ${RC_DAYS.screen} 天 ${p.length} 位`, p.map(r => extCardHTML(r, 'x_screen')))
      + foldHTML('noinv', `已決定不邀約・${nd.length} 位`, nd.map(r => extLi(r, obFor(refOf(r)).type === 'skip' ? '只標記不邀約' : '感謝函' + ({queued:'排隊中', sending:'送出中', sent:'已送出'}[obFor(refOf(r)).status] || ''))));
  }
  if (key === 'x_invite' && R.meta) { const c = extItems('x_cancel'); return foldHTML('cancel', `婉拒或取消・近 ${RC_DAYS.cancel} 天 ${c.length} 位`, c.map(r => extLi(r, [r.ev || r.st, r.job].filter(Boolean).join('・')))); }
  return '';
}
function renderBoard(){
  const mNum = +S.month.slice(5), stages = BOARDS[curBoard()], tab = curTab(), board = $('#board');
  board.style.setProperty('--cols', stages.length);
  board.innerHTML = stages.map(st => {
    const ext = EXT.includes(st.key);
    const items = S.loaded && (!ext || R.meta) ? colItems(st.key) : [];
    let body;
    if (!S.loaded) body = '<div class="col-empty">讀取中…</div>';
    else if (ext && !R.meta) body = `<div class="col-empty">${st.key === 'x_screen' ? '104 應徵履歷進來後會出現在這裡（hr@ 的履歷篩選程式每 5 分鐘送一次，看板自動評分）。' : '還沒有資料'}</div>`;
    else if (!items.length) body = `<div class="col-empty">${esc(S.q ? '沒有符合搜尋的人' : EMPTY[st.key])}</div>`;
    else body = items.map(x => ext ? extCardHTML(x, st.key) : cardHTML(x)).join('');
    const extra = S.loaded ? colExtraHTML(st.key, mNum) : '';
    let hint = st.key === 'done' ? `${mNum} 月完成加保` : st.hint;
    if (st.key === 'x_screen' && R.meta && R.meta.lastMail) hint = `上次收信 ${shortDT(R.meta.lastMail)}・7 天內 ${R.meta.mail7} 封`;
    const allPicked = items.length && items.every(h => S.sel.has(h.id));
    const colPick = batchOn() && !ext && items.length ? `<button class="col-pick" type="button" data-pick-col="${st.key}">${allPicked ? '取消全選' : '全選'}</button>` : '';
    return `<section class="col${tab === st.key ? ' is-tab' : ''}${ext ? ' is-ext' : ''}" aria-labelledby="col-${st.key}">
      <header class="col-h">${st.n ? `<span class="col-n">${st.n}</span>` : '<span class="col-n fin">✓</span>'}<h2 class="col-t" id="col-${st.key}">${st.title}</h2><span class="col-c">${S.loaded && (!ext || R.meta) ? items.length : ''}</span>${colPick}</header>
      <p class="col-hint">${esc(hint)}</p>
      <div class="col-body">${body}${extra}</div>
    </section>`;
  }).join('');
  board.querySelectorAll('details[data-fold]').forEach(det => det.addEventListener('toggle', () => { S.open[det.dataset.fold] = det.open; }));
}

/* ================= 面試時段（線上應徵表單 apply.html 讓應徵者選） =================
 * 像 Google 日曆的預約時間表：設定每週固定可以面試的時間（slots 裡 id '_week' 的一筆），
 * 系統自動產生未來幾天的時段（id 'w日期T時間'）；某個時段不要了就「關閉」（存一筆同 id、closed 的紀錄蓋過去）。
 * 另外也可以加開單次時段（隨機 id，照舊）。產生規則和雲端後端 Code.gs 的 slotExpand_ 相同，改一邊要改另一邊。 */
const APPLY_URL = new URL('apply.html', location.href).href.replace(/[?#].*$/, '');
const ONBOARD_URL = new URL('onboard.html', location.href).href.replace(/[?#].*$/, '');
const SL = {confirm:null, msg:'', msgErr:false, wk:null, dirty:false, copyFrom:null};
const WD_ = '日一二三四五六';
const SL_DURS = [15, 20, 30, 45, 60, 90, 120];
const SL_AHEAD = [7, 14, 21, 30, 60];
const SL_NOTICE = [0, 1, 2, 3, 4, 6, 12, 24, 48];
const dayLabel = s => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WD_[d.getDay()]}）`; };
const slHm = s => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : -1; };
const slFmt = n => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
const slNum = (v, lo, hi, dft) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dft; };
/** 每週規則（存的格式：days 的值是 [['15:00','16:30'], …]） */
function slWeekNorm(w){
  if (!w || typeof w !== 'object') return null;
  const days = {};
  for (let d = 0; d < 7; d++) days[d] = (w.days && Array.isArray(w.days[d]) ? w.days[d] : [])
    .filter(r => Array.isArray(r) && slHm(r[0]) >= 0 && slHm(r[1]) > slHm(r[0])).map(r => [r[0], r[1]]).slice(0, 12);
  return {on: w.on !== false, dur: SL_DURS.includes(Number(w.dur)) ? Number(w.dur) : 30, cap: slNum(w.cap, 1, 20, 1), ahead: slNum(w.ahead, 1, 90, 14), notice: slNum(w.notice, 0, 72, 2), days};
}
const slWeekStored = () => slWeekNorm(ST.get('slots', '_week'));
const slNowStr = () => { const d = new Date(); return today() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
/** 最晚可以預約的時間點（現在＋notice 小時） */
const slCut = week => { const d = new Date(Date.now() + (week ? week.notice : 0) * 3600000); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
/** 單次時段＋每週規則產生的時段（和 Code.gs slotExpand_ 相同） */
function slotExpand(week){
  const out = [], seen = new Set();
  ST.list('slots').forEach(s => {
    if (!s || s.id === '_week' || !isDate(s.date) || slHm(s.time) < 0) return;
    out.push({id:String(s.id), date:s.date, time:s.time, cap:Math.max(1, Number(s.cap) || 1), closed:!!s.closed, rec:true, ovr:!!s.gen});
    seen.add(String(s.id)); seen.add(s.date + 'T' + s.time);
  });
  if (week && week.on) {
    const t0 = today();
    for (let i = 0; i < week.ahead; i++) {
      const date = addDays(t0, i), wd = new Date(date + 'T00:00:00').getDay();
      week.days[wd].forEach(r => {
        for (let t = slHm(r[0]); t + week.dur <= slHm(r[1]); t += week.dur) {
          const time = slFmt(t), id = 'w' + date + 'T' + time;
          if (seen.has(id) || seen.has(date + 'T' + time)) continue;
          seen.add(id); seen.add(date + 'T' + time);
          out.push({id, date, time, cap:week.cap, closed:false, gen:true});
        }
      });
    }
  }
  return out;
}
function slotList(){ return slotExpand(slWeekStored()).sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1); }
function slotBookings(){
  const m = new Map();
  for (const h of S.hires.values()) if (h.slotId) { if (!m.has(h.slotId)) m.set(h.slotId, []); m.get(h.slotId).push(h); }
  return m;
}
const slEmptyWeek = () => ({on:true, dur:30, cap:1, ahead:14, notice:2, days:{0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[]}});
function openSlots(){
  if (!canEdit()) return;
  SL.confirm = null; SL.msg = ''; SL.copyFrom = null;
  if (!SL.dirty) SL.wk = JSON.parse(JSON.stringify(slWeekStored() || slEmptyWeek()));   // 上次沒儲存的變更還留著
  renderSlots(); $('#slm').hidden = false; document.documentElement.classList.add('lock');
}
function closeSlots(){
  if (SL.dirty && $('#sw-on')) { slReadWeek(); toast('每週時間還沒儲存，再打開「面試時段」還在'); }
  $('#slm').hidden = true; if ($('#drawer').hidden) document.documentElement.classList.remove('lock');
}
/** 依目前編輯中的每週設定，未來幾天會有幾個時段 */
function slWeekCount(w){
  let n = 0;
  for (let i = 0; i < w.ahead; i++) {
    const wd = new Date(addDays(today(), i) + 'T00:00:00').getDay();
    w.days[wd].forEach(r => { const a = slHm(r[0]), b = slHm(r[1]); if (a >= 0 && b > a) n += Math.floor((b - a) / w.dur); });
  }
  return n;
}
function slWeekHTML(){
  const w = SL.wk, opt = (list, v, f) => list.map(x => `<option value="${x}"${x === v ? ' selected' : ''}>${f(x)}</option>`).join('');
  const rows = [0, 1, 2, 3, 4, 5, 6].map(d => {
    const rs = w.days[d];
    const ranges = rs.length ? rs.map((r, i) => `<div class="sw-rg">
        <input type="time" step="300" class="sw-t" data-d="${d}" data-i="${i}" data-k="0" value="${esc(r[0])}" aria-label="週${WD_[d]}第 ${i + 1} 段開始">
        <span aria-hidden="true">–</span>
        <input type="time" step="300" class="sw-t" data-d="${d}" data-i="${i}" data-k="1" value="${esc(r[1])}" aria-label="週${WD_[d]}第 ${i + 1} 段結束">
        <button class="btn sm ghost icon-txt" type="button" data-sl="rg-del" data-d="${d}" data-i="${i}" aria-label="刪除週${WD_[d]}這一段" title="刪除這一段">⊘</button>
      </div>`).join('') : '<p class="sw-off">不開放預約</p>';
    const copy = SL.copyFrom === d ? `<div class="sw-copy" role="group" aria-label="把週${WD_[d]}的時間複製到">
        <span>複製到：</span>${[0, 1, 2, 3, 4, 5, 6].filter(x => x !== d).map(x => `<label><input type="checkbox" class="sw-cp" value="${x}">週${WD_[x]}</label>`).join('')}
        <button class="btn sm primary" type="button" data-sl="cp-yes" data-d="${d}">套用</button><button class="btn sm ghost" type="button" data-sl="cp-no">取消</button></div>` : '';
    return `<div class="sw-day"><span class="sw-dn">週${WD_[d]}</span><div class="sw-rgs">${ranges}${copy}</div>
      <span class="sw-acts"><button class="btn sm ghost" type="button" data-sl="rg-add" data-d="${d}" aria-label="週${WD_[d]}加一段時間" title="加一段時間">＋</button>${rs.length ? `<button class="btn sm ghost" type="button" data-sl="cp" data-d="${d}" aria-label="把週${WD_[d]}的時間複製到其他天" title="複製到其他天">複製</button>` : ''}</span></div>`;
  }).join('');
  const bad = [0, 1, 2, 3, 4, 5, 6].some(d => w.days[d].some(r => !(slHm(r[0]) >= 0 && slHm(r[1]) > slHm(r[0]))));
  return `<section class="sw" aria-labelledby="sw-h">
    <div class="sw-head"><h3 id="sw-h">每週可預約時間</h3>
      <label class="sw-on"><input type="checkbox" id="sw-on"${w.on ? ' checked' : ''}> 開放每週預約</label></div>
    <p class="note lead">像 Google 日曆的預約時間表：設定每週固定可以面試的時間，系統自動切成一個個時段讓應徵者選。某一天不行，就在下面的時段清單按「關閉」。</p>
    <div class="sw-opts">
      <div class="f"><label for="sw-dur">預約時間長度</label><select class="inp" id="sw-dur">${opt(SL_DURS, w.dur, x => x + ' 分鐘')}</select></div>
      <div class="f"><label for="sw-cap">每個時段幾人</label><input id="sw-cap" type="number" min="1" max="20" value="${esc(String(w.cap))}"></div>
      <div class="f"><label for="sw-ahead">開放預約</label><select class="inp" id="sw-ahead">${opt(SL_AHEAD.includes(w.ahead) ? SL_AHEAD : [...SL_AHEAD, w.ahead].sort((a, b) => a - b), w.ahead, x => `未來 ${x} 天`)}</select></div>
      <div class="f"><label for="sw-notice">最晚預約</label><select class="inp" id="sw-notice">${opt(SL_NOTICE.includes(w.notice) ? SL_NOTICE : [...SL_NOTICE, w.notice].sort((a, b) => a - b), w.notice, x => x ? `面試前 ${x} 小時` : '開始前都可以')}</select></div>
    </div>
    <div class="sw-days">${rows}</div>
    <div class="sw-foot">
      <span class="sw-sum" id="sw-sum">${bad ? '<span class="ob-err">有時間段的結束早於開始，請修正。</span>' : w.on ? `依這個設定，未來 ${w.ahead} 天共 ${slWeekCount(w)} 個時段。` : '目前不開放每週預約（只有另外加開的單次時段）。'}${SL.dirty ? '<b>（還沒儲存）</b>' : ''}</span>
      ${SL.dirty ? '<button class="btn sm ghost" type="button" data-sl="wk-reset">還原</button>' : ''}
      <button class="btn sm primary" type="button" data-sl="wk-save"${SL.dirty && !bad ? '' : ' disabled'}>儲存每週時間</button>
    </div>
  </section>`;
}
function renderSlots(){
  const root = $('#sl-body'), t = today();
  if (!SL.wk) SL.wk = JSON.parse(JSON.stringify(slWeekStored() || slEmptyWeek()));
  if (!SL.dirty) { const st = slWeekStored(); if (st) SL.wk = JSON.parse(JSON.stringify(st)); }   // 別人改了、自己沒在改 → 跟著更新
  const keep = {}; root.querySelectorAll('.sl-add input').forEach(i => { if (i.id) keep[i.id] = i.value; });
  const cut = slCut(slWeekStored()), books = slotBookings();
  const all = slotList(), have = new Set(all.map(s => s.id));
  // 有人預約、但已經不在規則裡的時段（例如改了每週時間），照樣列出來
  for (const [id, hs] of books) if (!have.has(id)) { const h = hs[0]; if (isDate(h.interviewDate) && h.interviewDate >= t) all.push({id, date:h.interviewDate, time:h.interviewTime || '', cap:hs.length, closed:false, orphan:true}); }
  all.sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
  const upcoming = all.filter(s => s.date >= t);
  const byDay = new Map();
  upcoming.forEach(s => { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });
  const days = [...byDay.entries()].map(([d, list]) => {
    const anyOpen = list.some(s => !s.closed && !s.orphan);
    return `<section class="sl-day"><h3>${dayLabel(d)}<button class="btn sm ghost" type="button" data-sl="${anyOpen ? 'day-close' : 'day-open'}" data-date="${esc(d)}">${anyOpen ? '關閉這一天' : '重新開放這一天'}</button></h3>${list.map(s => {
      const who = books.get(s.id) || [], full = who.length >= s.cap, sid = esc(s.id), late = (s.date + 'T' + s.time) <= cut;
      const acts = s.orphan ? '' : SL.confirm === s.id
        ? `<button class="btn sm danger-solid" type="button" data-sl="del-yes" data-id="${sid}">確定刪除</button><button class="btn sm ghost" type="button" data-sl="cancel">取消</button>`
        : `<button class="btn sm ghost" type="button" data-sl="toggle" data-id="${sid}">${s.closed ? '重新開放' : '關閉'}</button>${who.length || s.gen || s.ovr ? '' : `<button class="btn sm ghost danger" type="button" data-sl="del" data-id="${sid}">刪除</button>`}`;
      const cnt = s.orphan ? '已不在每週時間內' : s.closed ? '已關閉' : full ? `<b>額滿</b> ${who.length}/${s.cap}` : late ? `${who.length}/${s.cap}・已截止預約` : `${who.length}/${s.cap} 人`;
      return `<div class="sl-row${s.closed ? ' closed' : ''}"><span class="sl-time">${esc(s.time)}</span>
        <span class="sl-cnt">${cnt}${s.rec && !s.ovr ? '<span class="sl-tag">單次</span>' : ''}</span>
        <span class="sl-who">${who.map(h => `<button class="link" type="button" data-sl="open" data-id="${esc(h.id)}">${esc(nm(h))}</button>`).join('') || '<span class="muted">還沒有人預約</span>'}</span>
        <span class="sl-acts">${acts}</span></div>`;
    }).join('')}</section>`;
  }).join('');
  root.innerHTML = `
    <div class="f"><span class="lbl">應徵連結（傳給應徵者，不用登入）</span>
      <div class="sl-link"><input id="sl-url" readonly value="${esc(APPLY_URL)}" aria-label="應徵連結"><button class="btn sm" type="button" data-sl="copy">複製</button><a class="btn sm" href="${esc(APPLY_URL)}" target="_blank" rel="noopener">開啟</a></div>
      <p class="note lead" style="margin-top:6px">應徵者打開連結，先選一個還有空位的時段，再填人事資料表；送出後直接出現在「招募」頁的「面試」，面試日期和時間都會帶入。用 LINE 傳時在網址後面加 <code>?openExternalBrowser=1</code>。</p></div>
    ${slWeekHTML()}
    <details class="sl-more"${keep['sl-date'] || keep['sl-times'] ? ' open' : ''}><summary>另外加開單次時段</summary>
      <form class="sl-add" id="sl-form" novalidate>
        <div class="f"><label for="sl-date">日期</label><input id="sl-date" type="date" value="${esc(keep['sl-date'] || '')}"></div>
        <div class="f"><label for="sl-times">時間（可以一次填多個，用空白或逗號分開）</label><input id="sl-times" placeholder="例如 10:00 10:30 14:00" value="${esc(keep['sl-times'] || '')}"></div>
        <div class="f"><label for="sl-cap">每個時段幾人</label><input id="sl-cap" type="number" min="1" max="20" value="${esc(keep['sl-cap'] || '1')}"></div>
        <button class="btn primary" type="submit">新增時段</button>
      </form>
    </details>
    <p class="imp-msg${SL.msgErr ? ' err' : ''}" id="sl-msg" role="status">${esc(SL.msg)}</p>
    <h3 class="sl-list-h">接下來的時段</h3>
    ${days || '<p class="rt-empty">還沒有今天以後的面試時段。設定上面的「每週可預約時間」後按「儲存每週時間」，或另外加開單次時段。</p>'}`;
}
/** 編輯中的每週設定：讀畫面上的欄位（不重畫，免得游標跳走） */
function slReadWeek(){
  const w = SL.wk;
  w.on = $('#sw-on').checked;
  w.dur = Number($('#sw-dur').value) || 30;
  w.cap = slNum($('#sw-cap').value, 1, 20, 1);
  w.ahead = Number($('#sw-ahead').value) || 14;
  w.notice = Number($('#sw-notice').value) || 0;
  document.querySelectorAll('#sl-body .sw-t').forEach(i => { const r = w.days[i.dataset.d][i.dataset.i]; if (r) r[+i.dataset.k] = i.value; });
}
function slWeekEdited(full){
  slReadWeek(); SL.dirty = true;
  if (full) renderSlots();
  else { const tmp = document.createElement('div'); tmp.innerHTML = slWeekHTML(); $('#sw-sum').parentElement.replaceWith(tmp.querySelector('.sw-foot')); }
}
function slSaveWeek(){
  slReadWeek();
  const w = SL.wk, days = {};
  for (let d = 0; d < 7; d++) {
    days[d] = w.days[d].filter(r => r[0] || r[1]);
    if (days[d].some(r => !(slHm(r[0]) >= 0 && slHm(r[1]) > slHm(r[0])))) { SL.msg = `週${WD_[d]}有一段時間的結束早於開始（或沒填完整），請修正。`; SL.msgErr = true; renderSlots(); return; }
    days[d].sort((a, b) => slHm(a[0]) - slHm(b[0]));
  }
  ST.save('slots', {id:'_week', on:w.on, dur:w.dur, cap:w.cap, ahead:w.ahead, notice:w.notice, days, updatedAt:Date.now(), updatedBy:myName()});
  SL.wk = JSON.parse(JSON.stringify(slWeekNorm(ST.get('slots', '_week'))));
  SL.dirty = false; SL.copyFrom = null;
  SL.msg = w.on ? `已儲存每週時間，未來 ${w.ahead} 天共 ${slWeekCount(SL.wk)} 個時段，應徵連結上馬上看得到。` : '已儲存：不開放每週預約。'; SL.msgErr = false;
  renderSlots();
}
/** 關閉／重新開放一個時段：產生的時段用一筆同 id 的紀錄蓋過去，重新開放就刪掉那筆 */
function slToggle(s, close){
  const cur = ST.get('slots', s.id);
  if (s.gen && close) ST.save('slots', {id:s.id, date:s.date, time:s.time, cap:s.cap, closed:true, gen:true, createdAt:Date.now(), createdBy:myName()});
  else if (s.ovr && !close) ST.remove('slots', s.id);
  else if (cur) ST.save('slots', Object.assign(JSON.parse(JSON.stringify(cur)), {closed:close}));
}
function addSlots(){
  const date = $('#sl-date').value, cap = Math.min(20, Math.max(1, parseInt($('#sl-cap').value, 10) || 1));
  const fail = t => { SL.msg = t; SL.msgErr = true; renderSlots(); };
  const times = [...new Set(($('#sl-times').value.match(/\d{1,2}[:：]\d{2}/g) || []).map(x => { const [h, m] = x.replace('：', ':').split(':'); return pad(+h) + ':' + m; }))].filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
  if (!isDate(date)) return fail('請選日期。');
  if (date < today()) return fail('不能新增過去的日期。');
  if (!times.length) return fail('請填時間，例如 10:00 14:30。');
  const have = new Set(slotList().filter(s => s.date === date && !s.gen).map(s => s.time));
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
  toast(list.length ? `選取了 ${list.length} 位 ${md(date)} 前（含當天）填表的面試者` : `沒有 ${md(date)} 前填表、還在「面試」的人`);
}
function batchPhotoCount(){ let n = 0; S.sel.forEach(id => { const h = S.hires.get(id); if (h) n += Object.keys(h.docs).length; }); return n; }
function renderBatchBar(){
  const bar = $('#batch-bar'), pv = $('#pipeline-view');
  if (!batchOn()) { bar.hidden = true; pv.classList.remove('batching'); return; }
  for (const id of [...S.sel]) if (!S.hires.has(id)) S.sel.delete(id);
  const n = S.sel.size, dis = n ? '' : ' disabled', photos = batchPhotoCount();
  bar.hidden = false; pv.classList.add('batching');
  bar.innerHTML = `<div class="batch-in">
    <span class="batch-n">已選 <b>${n}</b> 人</span>
    ${S.batchConfirm
      ? `<span class="batch-confirm">確定刪除這 ${n} 人的所有資料？${photos ? `${photos} 份證件照片會一併刪除（雲端硬碟垃圾桶保留 30 天）。` : ''}刪除後不會再被表單自動匯入加回來。</span><button class="btn sm danger-solid" type="button" data-b="del-yes">確定刪除</button><button class="btn sm ghost" type="button" data-b="del-no">取消</button>`
      : `<button class="btn sm primary" type="button" data-b="hire"${dis}>錄取</button><button class="btn sm" type="button" data-b="reject"${dis}>未錄取</button><button class="btn sm ghost danger" type="button" data-b="del"${dis}>刪除</button><button class="btn sm ghost" type="button" data-b="clear"${dis}>清除選取</button>`}
    <span class="batch-date"><label for="batch-date">選取</label><input type="date" id="batch-date" value="${esc(S.batchDate || defaultBatchDate())}"><span>前（含當天）填表、還在「面試」這一步的人</span><button class="btn sm" type="button" data-b="pick-date">選取</button></span>
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
    r.stage = hired ? 'confirm' : 'rejected'; r.result = hired ? 'hired' : 'rejected';
    r.steps = obj(r.steps); r.steps.interview = {at:now, by};
    r.updatedAt = now; r.updatedBy = by;
    recs.push(r);
  });
  if (recs.length) ST.saveMany('hires', recs);
  S.sel.clear(); S.batchConfirm = false;
  const skip = skipped ? `（${skipped} 人不在「面試」這一步，沒有改）` : '';
  toast(recs.length ? `${recs.length} 人${hired ? '已錄取，移到「確認入職」' : '已標記為未錄取'}${skip}` : `沒有可以改的人${skip}`, recs.length ? () => ST.saveMany('hires', before) : null);
  render();
}
function batchDelete(){
  if (!canEdit()) return;
  const ids = [...S.sel].filter(id => S.hires.has(id));
  const files = [], before = [];
  ids.forEach(id => { const h = S.hires.get(id); Object.values(h.docs).forEach(d => files.push(d.id)); if (h.offer && h.offer.pdf) files.push(h.offer.pdf.id); const cur = ST.get('hires', id); if (cur) before.push(JSON.parse(JSON.stringify(cur))); });
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
    if (h.stage === 'offer') {   // 等報到：報到日到了提醒按「已報到」
      const p = planStart(h);
      if (isDate(p)) { const d = dayDiff(t, p); if (d < 0) out.push({h, sev:1, text:`預計 ${md(p)} 報到・還沒按已報到`, cls:'warn', d:p}); else if (d === 0) out.push({h, sev:1, text:'今天報到', cls:'warn', d:p}); }
      continue;
    }
    if (!ACTIVE.includes(h.stage)) continue;
    if (!h.startDate) { out.push({h, sev:0, text:'未填到職日', cls:''}); continue; }
    const d = dayDiff(t, h.startDate);
    if (d < 0) out.push({h, sev:3, text:`已到職 ${-d} 天・未加保`, cls:'danger'});
    else if (d === 0) out.push({h, sev:2, text:'今日到職・須當日加保', cls:'warn'});
    else if (d <= 3) out.push({h, sev:1, text:`${d} 天後到職`, cls:'warn'});
  }
  return out.sort((a, b) => b.sev - a.sev || cmpDate(a.d || a.h.startDate, b.d || b.h.startDate));
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
    const cnt = st => [...S.hires.values()].filter(h => h.stage === st).length;
    const pending = cnt('interview'), confirming = cnt('confirm');
    const docsMissing = [...S.hires.values()].filter(h => h.stage === 'docs' && !docsReady(h)).length;
    const fresh = R.meta ? extItems('x_screen', false) : [], top = fresh.filter(r => r.tier === '推薦面試').length;
    const remRows = (M.meta ? mnReminders() : []).map(x => `<li><button class="ov-row" type="button" data-mn-go="${esc(x.i.id)}"><span class="ov-who"><span class="ov-name">${esc(x.d.label || x.i.title)}</span><span class="ov-sub">${esc(x.i.title)}・${x.date.replace(/-/g, '/')}</span></span>${chip(dueText(x.n), x.n <= 7 ? 'warn' : '')}</button></li>`).join('');
    alertBody = (rows || remRows ? `<ul class="ov-list">${rows}${remRows}</ul>` : '<p class="rt-empty">目前沒有報到、加保或到期事項需要處理。</p>')
      + (docsMissing ? `<button class="ov-more" type="button" data-go="pipeline" data-tab="docs">證件未齊 ${docsMissing} 位 →</button>` : '')
      + (S.chat.unread ? `<button class="ov-more" type="button" data-go="recruit" data-tab="x_screen">104 聊聊未讀 ${S.chat.unread} 則 →</button>` : '')
      + (S.outbox.some(o => o.status === 'failed') ? `<button class="ov-more" type="button" data-go="recruit" data-tab="x_screen">104 送出失敗 ${S.outbox.filter(o => o.status === 'failed').length} 筆 →</button>` : '')
      + (confirming ? `<button class="ov-more" type="button" data-go="recruit" data-tab="confirm">錄取待確認入職 ${confirming} 位 →</button>` : '')
      + (pending ? `<button class="ov-more" type="button" data-go="recruit" data-tab="interview">面試待決定 ${pending} 位 →</button>` : '')
      + (fresh.length ? `<button class="ov-more" type="button" data-go="recruit" data-tab="x_screen">新履歷 ${fresh.length} 位${top ? `（推薦面試 ${top} 位）` : ''} →</button>` : '');
  }
  const fm = s => {
    const n = !S.loaded ? '–' : EXT.includes(s.key) ? (R.meta ? extItems(s.key, false).length : '–') : [...S.hires.values()].filter(h => h.stage === s.key).length;
    return `<button class="fm" type="button" data-go="${s.board}" data-tab="${s.key}"><span class="fm-n">${n}</span><span class="fm-t">${s.title}</span></button>`;
  };
  const flow = `<h3 class="fm-h">招募</h3><div class="flow-mini">${BOARDS.recruit.map(fm).join('')}</div>`
    + `<h3 class="fm-h">新進人員・勞健保</h3><div class="flow-mini">${BOARDS.pipeline.filter(s => s.key !== 'done').map(fm).join('')}</div>`;
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
  // 近期面試：看板上的人（面試日期沒填就用試算表的面試時間）＋試算表裡已約、還沒填人事資料表的人
  const ups = [...S.hires.values()].filter(h => h.stage === 'interview').map(h => {
    const inv = h.interviewDate ? null : extFor(h).invite;
    return {h, d:h.interviewDate || (inv && inv.ivD) || '', t:h.interviewDate ? h.interviewTime : (inv && inv.ivT) || '', sub:[h.position, h.source === 'web' ? '線上應徵' : ''].filter(Boolean).join('・')};
  }).concat(R.meta ? extItems('x_booked', false).map(r => ({r, d:r.ivD, t:r.ivT, sub:[r.job, r.formFill === '已填寫' ? '人事表已填' : '人事表未填'].filter(Boolean).join('・')})) : [])
    .filter(x => isDate(x.d) && x.d >= t0)
    .sort((a, b) => (a.d + (a.t || '99:99')) < (b.d + (b.t || '99:99')) ? -1 : 1);
  const upRow = x => `<li><button class="ov-row" type="button" ${x.h ? `data-open="${esc(x.h.id)}"` : 'data-go="recruit" data-tab="x_booked"'}><span class="ov-who"><span class="ov-name">${esc(x.h ? nm(x.h) : x.r.name)}</span><span class="ov-sub">${esc(x.sub)}</span></span>${chip((x.d === t0 ? '今天' : dayLabel(x.d)) + (x.t ? ' ' + x.t : ''), x.d === t0 ? 'warn' : '')}</button></li>`;
  const upHTML = !S.loaded ? '<p class="rt-empty">讀取中…</p>' : ups.length
    ? `<ul class="ov-list">${ups.slice(0, 8).map(upRow).join('')}</ul>${ups.length > 8 ? `<button class="ov-more" type="button" data-go="recruit" data-tab="interview">還有 ${ups.length - 8} 位 →</button>` : ''}`
    : '<p class="rt-empty">接下來沒有排定的面試。</p>';
  root.innerHTML = `<p class="ov-date">今天 ${dateLabel}</p>
    <div class="ov-grid">
      <div class="ov-col">
        <section class="ov-card" aria-labelledby="ov-up-h"><header class="ov-h"><h2 id="ov-up-h">近期面試</h2>${canEdit() ? '<button class="link" type="button" data-slots="1">面試時段 →</button>' : ''}</header>${upHTML}</section>
        <section class="ov-card" aria-labelledby="ov-alert-h"><header class="ov-h"><h2 id="ov-alert-h">需要處理</h2></header>${alertBody}</section>
        <section class="ov-card" aria-labelledby="ov-flow-h"><header class="ov-h"><h2 id="ov-flow-h">招募・新進人員</h2><button class="link" type="button" data-go="recruit">開啟招募 →</button></header>${flow}</section>
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
/** 例行工作清單：工作清冊的項目（sheet: true，只能在試算表改）＋在 App 裡新增的項目 */
const rtItems = freq => mnRoutineItems(freq).concat([...S.routines.values()].filter(r => r.freq === freq).sort((a, b) => a.order - b.order));
function rtItemHTML(r, st){
  const checked = !!(st && st.at);
  const cid = esc(`chk-${r.freq}-${r.id}`), mi = r.sheet ? M.byId.get(r.id) : null, open = !!mi && S.rtMn.has(r.id);
  return `<li class="rt-item${checked ? ' checked' : ''}"><input type="checkbox" id="${cid}" data-rt="check" data-id="${esc(r.id)}" data-freq="${r.freq}"${checked ? ' checked' : ''}>
    <label for="${cid}"><span class="rt-t">${esc(r.title)}</span>${r.due ? `<span class="rt-due">${esc(r.due)}</span>` : ''}${checked ? `<span class="rt-by">${fmtTime(st.at)}${st.by ? '・' + esc(st.by) : ''}</span>` : ''}</label>
    ${mi ? `<button class="rt-more" type="button" data-mn-open="${esc(r.id)}" aria-expanded="${open}">${open ? '收起' : '步驟'}</button>` : ''}
    ${open ? `<div class="rt-detail">${mnDetailHTML(mi)}</div>` : ''}</li>`;
}
function rtEditRow(r){
  if (r.sheet) return `<div class="rt-edit locked"><span class="t">${esc(r.title)}</span><span class="muted">工作清冊・請改試算表</span></div>`;
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
  root.innerHTML = `<p class="rt-intro">勾選紀錄依期間自動重新開始：每日於午夜、每週於週一、每月於 1 日。每個人都可以打勾，會記下時間和打勾的人。項目來自「HR工作清冊」試算表（每年的項目只在那幾個月出現），按「步驟」看說明與程序；也可以在 App 裡另外新增。</p>
    <div class="rt-grid">${FREQS.map(rtColHTML).join('')}</div>`;
  for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el && root.contains(el)) el.value = v; }
  if (aid) {
    const el = document.getElementById(aid);
    if (el && root.contains(el)) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} }
  }
}
/* ================= 工作手冊（工作清冊的全部工作，可以搜尋） ================= */
function mnCardHTML(i){
  const t = today();
  const chips = [i.freqRaw && chip(i.freqRaw), i.owner && chip(i.owner), i.duration && chip(i.duration)]
    .concat(i.dues.map(d => { const x = dueNext(d, t), n = dayDiff(t, x), lb = d.label || '到期'; return chip(d.type === 'date' && /\d/.test(lb) ? lb : `${lb}・${md(x)}`, isFinite(n) && n <= d.lead && n >= -14 ? 'warn' : ''); }))
    .filter(Boolean).join('');
  return `<details class="mn-item" id="mn-${esc(i.id)}" data-mn="${esc(i.id)}"${S.mnOpen.has(i.id) ? ' open' : ''}><summary><span class="mn-t">${esc(i.title)}</span><span class="chips">${chips}</span></summary><div class="mn-body">${mnDetailHTML(i)}</div></details>`;
}
function renderManual(){
  const root = $('#manual-view');
  if (!root.querySelector('#mn-q')) root.innerHTML = `<div class="mn-top"><input class="inp" type="search" id="mn-q" placeholder="搜尋工作項目、說明、程序、路徑" aria-label="搜尋工作手冊"><span class="muted" id="mn-src"></span></div><div id="mn-body"></div>`;
  $('#mn-src').textContent = M.meta ? `來源：「HR工作清冊」試算表的「${M.meta.sheet || '工作清冊'}」分頁・共 ${M.items.length} 項・要修改請改試算表` : '';
  const q = S.mnQ.toLowerCase();
  const hit = i => !q || [i.title, i.freqRaw, i.owner].concat(i.parts.flatMap(p => Object.values(p))).some(v => String(v).toLowerCase().includes(q));
  let body;
  if (!S.loaded) body = '<p class="rt-empty">讀取中…</p>';
  else if (!M.meta) body = `<p class="rt-empty">${isAdmin() ? '還沒有連結「HR工作清冊」試算表。到「管理」頁的「工作清冊」貼上試算表網址。' : '管理員還沒有連結「HR工作清冊」試算表。'}</p>`;
  else body = MN_GROUPS.map(([k, title]) => {
    const list = M.items.filter(i => i.kind === k && hit(i));
    return list.length ? `<section class="mn-group" aria-labelledby="mn-g-${k}"><h2 id="mn-g-${k}">${title}<span class="h-count">${list.length}</span></h2>${list.map(mnCardHTML).join('')}</section>` : '';
  }).join('') || '<p class="rt-empty">沒有符合搜尋的工作。</p>';
  $('#mn-body').innerHTML = body;
  if (S.mnFocus) {
    const el = document.getElementById('mn-' + S.mnFocus);
    S.mnFocus = '';
    if (el) { el.open = true; el.scrollIntoView({block:'start'}); el.querySelector('summary').focus(); }
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
  const items = rtItems(freq).filter(i => !i.sheet);
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
    ${recruitSectionHTML()}
    ${manualSectionHTML()}
    ${obAdminHTML()}
    ${jobsSectionHTML()}
    ${formSectionHTML()}
  </div>`;
}

/* ---------- 工作清冊：連結「HR工作清冊」試算表（只讀） ---------- */
const MC = {configured:null, url:'', name:'', sheet:'', count:0, lastSync:0, lastError:'', shareTo:'', draft:null, busy:false, msg:'', msgErr:false, confirmUnlink:false};
function applyManualStatus(j){
  if (!j || typeof j !== 'object') return;
  MC.configured = !!j.configured;
  if (typeof j.url === 'string') MC.url = j.url;
  MC.name = typeof j.name === 'string' ? j.name : MC.name; MC.sheet = typeof j.sheet === 'string' ? j.sheet : MC.sheet;
  MC.count = Number(j.count) || 0; MC.lastSync = j.lastSync || 0; MC.lastError = j.lastError || '';
  if (j.shareTo) MC.shareTo = j.shareTo;
}
function manualSectionHTML(){
  const when = ms => ms ? new Date(ms).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '還沒同步過';
  const status = !FS.loaded ? '讀取中…'
    : MC.configured ? `已連結「${MC.name || 'HR工作清冊'}」的「${MC.sheet || '工作清冊'}」分頁・上次同步 ${when(MC.lastSync)}・每 10 分鐘自動同步${MC.lastSync ? `（${MC.count} 項工作）` : ''}`
    : '尚未連結：「例行工作」只有在 App 裡新增的項目，「工作手冊」頁是空的。';
  const url = MC.draft != null ? MC.draft : MC.url;
  return `<section class="ov-card" aria-labelledby="mc-h"><header class="ov-h"><h2 id="mc-h">工作清冊（例行工作與工作手冊）</h2></header>
    <p class="muted">貼上 hr@cheeseduke.com.tw 的「HR工作清冊」試算表網址（讀「工作清冊」分頁）。要先用擁有試算表的帳號，把試算表共用給 <b>${esc(MC.shareTo || FS.shareTo || '管理員的 Gmail')}</b>（檢視者）。App 只讀不寫：每日、每週、每月、每年的項目會出現在「例行工作」可以打勾，全部工作的說明與程序在「工作手冊」，清冊裡寫的到期日會在總覽提醒。項目要新增或修改，請改試算表。</p>
    <p class="${MC.configured ? '' : 'muted'}">${esc(status)}</p>
    ${MC.lastError ? `<p class="imp-msg err">上次同步失敗：${esc(MC.lastError)}</p>` : ''}
    <div class="fl-row">
      <input class="inp" id="mc-url" type="url" value="${esc(url)}" placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="HR工作清冊試算表網址">
      <button class="btn primary" type="button" data-u="mc-link"${MC.busy ? ' disabled' : ''}>${MC.configured ? '重新連結' : '連結'}</button>
    </div>
    ${MC.msg ? `<p class="imp-msg${MC.msgErr ? ' err' : ''}" role="status">${esc(MC.msg)}</p>` : ''}
    ${MC.configured ? `<div class="fl-row">${MC.confirmUnlink
      ? '<span class="confirm-q" style="width:auto">確定取消連結？例行工作裡清冊的項目和工作手冊會清空（打勾紀錄留著），試算表不受影響。</span><button class="btn sm danger-solid" type="button" data-u="mc-unlink-yes">取消連結</button><button class="btn sm ghost" type="button" data-u="mc-cancel">不要</button>'
      : `<button class="btn sm" type="button" data-u="mc-sync"${MC.busy ? ' disabled' : ''}>立即同步</button><button class="btn sm ghost danger" type="button" data-u="mc-unlink">取消連結</button>`}</div>` : ''}
  </section>`;
}
async function manualAdmin(action, payload, okMsg){
  MC.busy = true; MC.msg = action === 'manualLink' ? '連結中…' : '處理中…'; MC.msgErr = false; renderUsers();
  try {
    const j = await AU.api(action, payload || {});
    if (action === 'formSync') applyFormStatus(j); else applyManualStatus(j);
    const st = action === 'formSync' ? j.mc : j;
    MC.draft = null; MC.confirmUnlink = false;
    MC.msg = okMsg(st || {}); MC.msgErr = !!(st && st.lastError);
    ST.syncNow();
  } catch (e) { MC.msg = e.message; MC.msgErr = true; }
  MC.busy = false; renderUsers();
}

/* ================= 邀約／不邀約／訊息：編寫視窗 ================= */
const OBM = {row:null, type:'invite', mode:'send', tplId:'', err:'', guide:null};
const tplOf = kind => S.tpl.filter(t => t.kind === kind);
function openOb(type, row){
  if (!canEdit() || !row) return;
  OBM.row = row; OBM.type = type; OBM.mode = 'send'; OBM.err = ''; OBM.guide = null; OBM.preset = row.preset || '';
  const list = type === 'message' || type === 'chat' ? S.tpl : tplOf(type === 'reject' ? 'thanks' : 'invite');
  OBM.tplId = type === 'message' || type === 'chat' ? '' : list[0] ? list[0].id : '';
  renderOb(true);
  $('#obm').hidden = false;
  document.documentElement.classList.add('lock');
  const ta = $('#ob-text'); if (ta) ta.focus();
}
function closeOb(){ $('#obm').hidden = true; OBM.row = null; OBM.guide = null; if ($('#drawer').hidden) document.documentElement.classList.remove('lock'); }
function obTplText(){
  const t = S.tpl.find(x => x.id === OBM.tplId);
  return t ? fillTpl(t.text, obCtx(OBM.row, ($('#ob-job') || {}).value)) : '';
}
function renderOb(fresh){
  const r = OBM.row, type = OBM.type, send = !(type === 'reject' && OBM.mode === 'skip');
  const keep = {};
  ['ob-job', 'ob-text', 'ob-place', 'ob-days', 'ob-cname', 'ob-cphone'].forEach(id => { const el = document.getElementById(id); if (el && !fresh) keep[id] = el.value; });
  const v = (id, dft) => keep[id] != null ? keep[id] : dft;
  const list = type === 'message' || type === 'chat' ? S.tpl : tplOf(type === 'reject' ? 'thanks' : 'invite');
  const opts = (type === 'message' || type === 'chat' ? '<option value="">（空白）</option>' : '') + list.map(t => `<option value="${esc(t.id)}"${t.id === OBM.tplId ? ' selected' : ''}>${esc(t.title)}</option>`).join('');
  const text = v('ob-text', fresh ? (OBM.preset || fillTpl((S.tpl.find(x => x.id === OBM.tplId) || {}).text || '', obCtx(r, r.job))) : '');
  const title = {invite:'邀約面試', reject:'不邀約', message:'傳送訊息', chat:'104 聊聊'}[type];
  $('#ob-title').textContent = `${title}・${r.name}`;
  const warn = !RN.configured ? '還沒有設定 104 小幫手（管理頁），排入後要等小幫手設定好才會送出；也可以按「複製並打開 104」自己送。'
    : !rnOnline() ? '104 小幫手目前沒有在執行（裝了小幫手的瀏覽器沒開），排入後要等它開了才會送出；急的話按「複製並打開 104」自己送。'
    : RN.login === 'logged_out' ? '104 小幫手那邊還沒登入 104，請在裝了小幫手的瀏覽器登入；或按「複製並打開 104」自己送。' : '';
  $('#ob-body').innerHTML = `
    <p class="ob-to"><b>${esc(r.name)}</b>${r.job ? `・${esc(r.job)}` : ''}${r.cv ? ` <a class="link" href="${esc(r.cv)}" target="_blank" rel="noopener">104 履歷 ↗</a>` : ''}</p>
    ${type === 'reject' ? `<div class="ob-mode" role="radiogroup" aria-label="不邀約的方式">
      <label><input type="radio" name="ob-mode" value="send"${send ? ' checked' : ''}> 送感謝函</label>
      <label><input type="radio" name="ob-mode" value="skip"${send ? '' : ' checked'}> 只標記不邀約，不送訊息</label></div>` : ''}
    ${type === 'chat' && r.chat ? `<p class="chat-ctx"><span class="chat-from">${r.chat.from === 'us' ? '我們' : '對方'}最後說（${esc(chatWhen(r.chat.time))}）：</span>${esc(r.chat.last || '（檔案或系統訊息）')}</p>` : ''}
    ${send ? `
    <div class="grid2">
      <div class="f"><label for="ob-tpl">範本</label><select class="inp" id="ob-tpl">${opts}</select></div>
      ${type === 'chat' ? '' : `<div class="f"><label for="ob-job">104 通知職務</label><input id="ob-job" value="${esc(v('ob-job', r.job || ''))}" maxlength="80"></div>`}
      <div class="f full"><label for="ob-text">內容 <span class="h-count" id="ob-count">${text.length}/1000</span></label><textarea id="ob-text" rows="11" maxlength="1000">${esc(text)}</textarea></div>
      ${type === 'invite' ? `
      <div class="f"><label for="ob-place">面試地點</label><input id="ob-place" value="${esc(v('ob-place', S.cfg.place))}" maxlength="120"></div>
      <div class="f"><label for="ob-days">回覆期限（天內）</label><input id="ob-days" type="number" min="1" max="14" value="${esc(v('ob-days', String(S.cfg.replyDays)))}"></div>
      <div class="f"><label for="ob-cname">聯絡窗口</label><input id="ob-cname" value="${esc(v('ob-cname', S.cfg.contactName))}" maxlength="40"></div>
      <div class="f"><label for="ob-cphone">聯絡電話</label><input id="ob-cphone" value="${esc(v('ob-cphone', S.cfg.contactPhone))}" maxlength="40"></div>` : ''}
    </div>
    <p class="note">${type === 'chat' ? '「排入送出」：104 小幫手約 1 分鐘內在 104 聊聊送出這段文字（那則對話在 104 會變成已讀）。' : ''}「排入送出」：104 小幫手約 1 分鐘內在 104 自動送出，還沒送出前可以在卡片上按「取消送出」。「複製並打開 104」：內容先複製好、打開這位應徵者的 104 履歷，你在 104 貼上、按確認（任何電腦都能用）。內容裡還留著 {{…}} 的地方請先改好。</p>`
    : '<p class="note">只在看板上記下「不邀約」，不會傳任何訊息給應徵者。</p>'}
    ${send && warn ? `<p class="imp-msg">${esc(warn)}</p>` : ''}
    ${OBM.err ? `<p class="imp-msg err" role="alert">${esc(OBM.err)}</p>` : ''}
    <div class="form-foot"><button class="btn" type="button" data-ob-close="1">取消</button>${send ? `<button class="btn" type="button" id="ob-manual"${is104(r.cv) ? '' : ' disabled title="這位應徵者沒有 104 履歷連結"'}>複製並打開 104</button>` : ''}<button class="btn primary" type="button" id="ob-send">${send ? '排入送出' : '標記不邀約'}</button></div>`;
}
function sendOb(manual){
  const r = OBM.row; if (!r || !canEdit()) return;
  const type = OBM.type === 'reject' ? (OBM.mode === 'skip' ? 'skip' : 'thanks') : OBM.type;
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const text = type === 'skip' ? '' : val('ob-text'), job = val('ob-job') || r.job || '';
  const room = type === 'chat' && r.chat ? {id:r.chat.id, jobNo:r.chat.jobNo, pId:r.chat.pId} : null;
  const err = type === 'skip' ? '' : !text ? '請填寫內容。' : text.length > 1000 ? '內容最多 1000 字（104 的上限）。'
    : /\{\{[^}]*\}\}/.test(text) ? '內容裡還有 {{…}} 沒有改，請換成實際內容。' : type === 'invite' && !job ? '請填 104 通知職務。' : type === 'chat' && !room ? '找不到這位應徵者的 104 聊聊對話。' : '';
  if (!err && manual && !is104(r.cv)) { OBM.err = '這位應徵者沒有 104 履歷連結，不能在 104 送出。'; renderOb(false); return; }
  if (err) { OBM.err = err; renderOb(false); return; }
  const days = Math.min(14, Math.max(1, parseInt(val('ob-days'), 10) || S.cfg.replyDays));
  const how = manual && type !== 'skip' ? manualSend(text, r.cv, type) : '';   // 要在按鈕的點擊裡複製、開分頁
  const rec = {id:rid('ob'), type, status: type === 'skip' ? 'done' : how ? 'sent' : 'queued', ...(how ? {via:'manual', sentAt:Date.now(), result:'在 104 手動送出'} : {}), to:{name:r.name, job:r.job || '', cv:r.cv || '', ref:refOf(r), ...(room ? {room} : {})}, text,
    opts:{job, place: val('ob-place') || S.cfg.place, contactName: val('ob-cname') || S.cfg.contactName, contactPhone: val('ob-cphone') || S.cfg.contactPhone, replyDays: days},
    createdAt:Date.now(), createdBy:myName()};
  ST.save('outbox', rec);
  // 排入後小幫手送不出去：留在視窗裡帶著做登入步驟
  const need = how || type === 'skip' ? '' : !RN.configured ? 'setup' : RN.login === 'logged_out' ? 'login' : !rnOnline() ? 'offline' : '';
  if (need) { OBM.guide = {need, id:rec.id, name:r.name, type, cv: is104(r.cv) ? r.cv : ''}; pullFromStore(); render(); renderGuide(); return; }
  closeOb();
  pullFromStore(); render();
  toast(type === 'skip' ? `${r.name} 標記為不邀約` : how || `${OB_LABEL[type]}已排入，104 小幫手會在 104 送出`, () => { const cur = ST.get('outbox', rec.id); if (cur && (cur.status === 'queued' || cur.status === 'done' || cur.via === 'manual')) { ST.remove('outbox', rec.id); pullFromStore(); render(); } }, how ? 15000 : 0);
}
/** 半自動：內容複製到剪貼簿、打開這位應徵者的 104 應徵履歷，使用者自己在 104 貼上按確認 */
const is104 = u => /^https:\/\/vip\.104\.com\.tw\//.test(u || '');
const MANUAL_HOW = {invite:'在 104 按【邀約】→【詢問意願】', thanks:'在 104 按【感謝函】', message:'在 104 按【邀約】→【詢問意願】', chat:'在 104 打開右下角【聊聊】，找到這位應徵者的對話'};
function copyText(text){
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}
function manualSend(text, cv, type){
  copyText(text);
  window.open(cv, '_blank', 'noopener');
  return `內容已複製：${MANUAL_HOW[type] || '在 104 打開表單'}，聯絡內容按 Ctrl+V 貼上，確認通知職務後按【確認】。沒送出就按復原。`;
}
/** 排入後小幫手送不出去（沒登入 104／沒在執行／還沒設定）：編寫視窗改成一步一步的引導 */
function renderGuide(){
  const g = OBM.guide; if (!g) return;
  const when = RN.lastSeen ? new Date(RN.lastSeen).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
  const head = {login:'還差一步：登入 104', offline:'還差一步：打開小幫手', setup:'還沒設定 104 小幫手'}[g.need];
  const steps = g.need === 'login' ? [
      '在<b>裝了小幫手的 Chrome</b> 打開 104 招募管理：<a class="btn sm primary" href="https://vip.104.com.tw/" target="_blank" rel="noopener">打開 104 登入頁 ↗</a>',
      '照平常的方式登入。登入頁出現「驗證您是人類」要自己勾。',
      '登入後停在 104 招募管理的頁面 <b>10 秒</b>，小幫手就會知道已經登入。',
      `小幫手約 1 分鐘內自動送出${esc(g.name)}這一筆，卡片會變成「已送出」。`]
    : g.need === 'offline' ? [
      '打開<b>裝了小幫手的那台電腦的 Chrome</b>（電腦和 Chrome 都要開著，視窗可以縮小）。',
      '確認那個 Chrome 有登入 104 招募管理：<a class="btn sm" href="https://vip.104.com.tw/" target="_blank" rel="noopener">打開 104 ↗</a>',
      `小幫手約 1 分鐘內自動送出${esc(g.name)}這一筆，卡片會變成「已送出」。${when ? `（小幫手上次連線：${esc(when)}）` : ''}`]
    : [
      '在 Chrome 裝好「起士公爵 104 小幫手」擴充功能（安裝步驟見資料夾裡的使用說明）。',
      '管理頁「104 小幫手」按「產生鑰匙」，貼到小幫手的設定頁。',
      '在那個 Chrome 登入 104 招募管理，排隊中的這一筆就會送出。'];
  $('#ob-title').textContent = head;
  $('#ob-body').innerHTML = `
    <p class="ob-to">${esc(g.name)} 的${esc(OB_LABEL[g.type] || '訊息')}<b>已排入</b>，但現在還送不出去：</p>
    <ol class="ob-guide">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    ${g.cv ? `<p class="note">急著送的話，也可以改成自己送：內容會先複製好、打開這位應徵者的 104 履歷，你在 104 貼上按確認。</p>` : ''}
    <div class="form-foot">${g.cv ? `<button class="btn" type="button" id="ob-guide-manual">改成自己送（複製並打開 104）</button>` : ''}<button class="btn primary" type="button" data-ob-close="1">知道了</button></div>`;
}
function guideManual(){
  const g = OBM.guide; if (!g) return;
  const cur = ST.get('outbox', g.id), o = normOb(cur);
  if (!o || o.status !== 'queued') { closeOb(); toast('小幫手已經在處理這一筆了，看卡片上的狀態'); return; }
  const how = manualSend(o.text, o.to.cv, o.type);
  obUpdate(o.id, {status:'sent', via:'manual', sentAt:Date.now(), result:'在 104 手動送出'});
  closeOb();
  toast(how, () => obUpdate(o.id, {status:'queued', via:'', sentAt:0, result:''}), 15000);
}
function obUpdate(id, patch){
  const cur = ST.get('outbox', id); if (!cur || !canEdit()) return;
  ST.save('outbox', Object.assign(JSON.parse(JSON.stringify(cur)), patch, {updatedAt:Date.now(), updatedBy:myName()}));
  pullFromStore(); render();
}

/* ---------- 管理頁：104 小幫手（瀏覽器擴充功能）、訊息預設值與範本、AI 篩選 ---------- */
const RK = {key:'', busy:false, msg:'', confirm:false};
const TE = {open:'', confirm:'', drafts:{}, msg:''};
const AT = {text:'', busy:false, result:null, msg:'', err:false};
function applyRunnerStatus(j){
  if (j && j.rn) Object.assign(RN, {configured:!!j.rn.configured, lastSeen:Number(j.rn.lastSeen) || 0, login:String(j.rn.login || ''), version:String(j.rn.version || ''), note:String(j.rn.note || ''), chatAt:Number(j.rn.chatAt) || 0});
  if (j && j.ai) Object.assign(AIS, {configured:!!j.ai.configured, model:String(j.ai.model || '')});
}
function rnLine(){
  const when = ms => new Date(ms).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
  if (!RN.configured) return '還沒有設定：產生鑰匙，貼到 104 小幫手（瀏覽器擴充功能）的設定頁。';
  if (!RN.lastSeen) return '已產生鑰匙，程式還沒連線過。';
  const login = RN.login === 'ok' ? '已登入 104' : RN.login === 'logged_out' ? '沒有登入 104（請在裝了小幫手的瀏覽器登入）' : '104 登入狀態不明';
  return `${rnOnline() ? '執行中' : '目前沒有在執行'}・上次連線 ${when(RN.lastSeen)}・${login}${RN.note ? '・' + RN.note : ''}`;
}
function obAdminHTML(){
  const c = S.cfg, q = (id, label, val, attrs) => `<div class="f"><label for="${id}">${label}</label><input id="${id}" class="ob-cfg" value="${esc(val)}" ${attrs || ''}></div>`;
  const tpls = S.tpl.map(t => {
    const id = esc(t.id), d = TE.drafts[t.id] || {}, v = k => d[k] != null ? d[k] : t[k];
    const btns = TE.confirm === t.id
      ? `<span class="confirm-q" style="width:auto">確定刪除「${esc(t.title)}」？</span><button class="btn sm danger-solid" type="button" data-u="te-del-yes" data-id="${id}">刪除</button><button class="btn sm ghost" type="button" data-u="te-cancel">取消</button>`
      : `<button class="btn sm primary" type="button" data-u="te-save" data-id="${id}">儲存</button><button class="btn sm ghost danger" type="button" data-u="te-del" data-id="${id}">刪除</button>`;
    return `<details class="tpl-ed" data-tpl="${id}"${TE.open === t.id ? ' open' : ''}><summary><b>${esc(t.title)}</b><span class="muted">${esc((TPL_KINDS.find(k => k[0] === t.kind) || [, ''])[1])}・${t.text.length} 字</span></summary>
      <div class="job-ed-in">
        <div class="grid2"><div class="f"><label for="te-title-${id}">名稱</label><input id="te-title-${id}" data-te="title" data-id="${id}" value="${esc(v('title'))}" maxlength="40"></div>
        <div class="f"><label for="te-kind-${id}">用在</label><select class="inp" id="te-kind-${id}" data-te="kind" data-id="${id}">${TPL_KINDS.map(([k, l]) => `<option value="${k}"${v('kind') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
        <div class="f"><label for="te-text-${id}">內容（可用 {{職缺}} {{姓名}} {{面試地點}} {{應徵連結}} {{公司名稱}}）</label><textarea id="te-text-${id}" data-te="text" data-id="${id}" rows="10" maxlength="1000">${esc(v('text'))}</textarea></div>
        <div class="fl-row">${btns}</div>
      </div></details>`;
  }).join('');
  const r = AT.result;
  return `<section class="ov-card" aria-labelledby="ob-h"><header class="ov-h"><h2 id="ob-h">104 自動送出・訊息範本・AI 篩選</h2></header>
    <h3 class="fm-h">104 小幫手（瀏覽器擴充功能）</h3>
    <p>${esc(rnLine())}</p>
    ${RK.key ? `<div class="mn-path"><code>${esc(RK.key)}</code><button class="btn sm ghost" type="button" data-copy="${esc(RK.key)}">複製</button></div><p class="muted">鑰匙只顯示這一次：貼到 104 小幫手的設定頁（點小幫手圖示 →「設定」）。</p>` : ''}
    <div class="fl-row">${RK.confirm
      ? '<span class="confirm-q" style="width:auto">換新鑰匙後，舊鑰匙馬上失效，每個裝了小幫手的瀏覽器都要改貼新的。確定？</span><button class="btn sm danger-solid" type="button" data-u="rk-new-yes">換新鑰匙</button><button class="btn sm ghost" type="button" data-u="rk-cancel">不要</button>'
      : `<button class="btn sm" type="button" data-u="rk-new"${RK.busy ? ' disabled' : ''}>${RN.configured ? '換新鑰匙' : '產生鑰匙'}</button>`}</div>
    ${RK.msg ? `<p class="imp-msg" role="status">${esc(RK.msg)}</p>` : ''}
    <h3 class="fm-h">邀約預設值</h3>
    <div class="grid2">${q('cfg-company', '公司名稱', c.company, 'maxlength="40"')}${q('cfg-place', '面試地點', c.place, 'maxlength="120"')}${q('cfg-cname', '聯絡窗口', c.contactName, 'maxlength="40"')}${q('cfg-cphone', '聯絡電話', c.contactPhone, 'maxlength="40"')}${q('cfg-days', '回覆期限（天內）', String(c.replyDays), 'type="number" min="1" max="14"')}</div>
    <h3 class="fm-h">報到預設值 <span class="h-count">「傳報到連結」會帶入</span></h3>
    <div class="grid2">${q('cfg-rtime', '報到時間', c.reportTime, 'maxlength="20" placeholder="例如：09:00"')}${q('cfg-rplace', '報到地點（空白＝面試地點）', c.reportPlace, 'maxlength="120"')}${q('cfg-rnote', '報到提醒', c.reportNote, 'maxlength="300" placeholder="例如：請攜帶印章、穿著輕便服裝"')}</div>
    <h3 class="fm-h">訊息範本 <button class="btn sm" type="button" data-u="te-add">＋ 新增範本</button></h3>
    ${tpls || '<p class="rt-empty">還沒有範本。</p>'}
    ${TE.msg ? `<p class="imp-msg" role="status">${esc(TE.msg)}</p>` : ''}
    <h3 class="fm-h">AI 篩選履歷（Claude）</h3>
    <p class="${AIS.configured ? '' : 'muted'}">${AIS.configured === null ? '讀取中…' : AIS.configured ? `已設定 Claude API 金鑰（型號 ${esc(AIS.model)}）。` : '還沒設定金鑰：打開 Apps Script 專案「人事工作看板_雲端後端」→ 左側齒輪「專案設定」→「指令碼屬性」→ 新增屬性 ANTHROPIC_API_KEY，值貼上 Anthropic 的 API 金鑰 → 儲存。'}</p>
    <div class="f"><label for="at-text">貼一段履歷內容試評分（不會存起來）</label><textarea id="at-text" rows="5" maxlength="20000">${esc(AT.text)}</textarea></div>
    <div class="fl-row"><button class="btn sm" type="button" data-u="ai-test"${AT.busy ? ' disabled' : ''}>${AT.busy ? '評分中…' : '試評分'}</button></div>
    ${AT.msg ? `<p class="imp-msg${AT.err ? ' err' : ''}" role="status">${esc(AT.msg)}</p>` : ''}
    ${r ? `<dl class="fd"><dt>分級</dt><dd>${esc(r.tier)}・${esc(r.score)} 分</dd><dt>對應職缺</dt><dd>${esc(r.matched_job)}（履歷寫：${esc(r.applied_job)}）</dd><dt>履歷重點</dt><dd>${esc(r.summary)}</dd><dt>理由</dt><dd>${esc(r.reason)}</dd><dt>用量</dt><dd>${esc(`${r.model}・輸入 ${r.usage.input} + 快取 ${r.usage.cacheRead}・輸出 ${r.usage.output} tokens`)}</dd></dl>` : ''}
  </section>`;
}
function saveCfg(){
  if (!canEdit()) return;
  const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const cur = ST.get('tpl', '_cfg');
  const next = Object.assign(cur ? JSON.parse(JSON.stringify(cur)) : {id:'_cfg'}, {company:g('cfg-company') || '起士公爵', place:g('cfg-place'), contactName:g('cfg-cname'), contactPhone:g('cfg-cphone'),
    replyDays: Math.min(14, Math.max(1, parseInt(g('cfg-days'), 10) || 3)), reportTime:g('cfg-rtime'), reportPlace:g('cfg-rplace'), reportNote:g('cfg-rnote'), updatedAt:Date.now(), updatedBy:myName()});
  ST.save('tpl', next);
}

/* ---------- 職缺條件（管理員編輯；打到一半的內容存在 JE.drafts，畫面重畫不會不見） ---------- */
const JE = {open:'', confirm:'', drafts:{}, msg:'', msgErr:false};
function jobsSectionHTML(){
  const rows = S.jobs.map(j => {
    const id = esc(j.id), d = JE.drafts[j.id] || {}, v = k => d[k] != null ? d[k] : j[k];
    const n = parseJob(j.text).filter(s => !s.warn).reduce((a, s) => a + s.items.length, 0);
    const btns = JE.confirm === j.id
      ? `<span class="confirm-q" style="width:auto">確定刪除「${esc(j.title)}」？面試時勾過的紀錄會留著，但不會再顯示。</span><button class="btn sm danger-solid" type="button" data-j="del-yes" data-id="${id}">刪除</button><button class="btn sm ghost" type="button" data-j="cancel">取消</button>`
      : `<button class="btn sm primary" type="button" data-j="save" data-id="${id}">儲存</button><button class="btn sm ghost danger" type="button" data-j="del" data-id="${id}">刪除</button>${JE.drafts[j.id] ? '<span class="muted">有還沒儲存的修改</span>' : ''}`;
    return `<details class="job-ed" data-job="${id}"${JE.open === j.id ? ' open' : ''}><summary><b>${esc(j.title)}</b><span class="muted">關鍵字：${esc(j.keys || '（未設定）')}・${n} 項條件</span></summary>
      <div class="job-ed-in">
        <div class="f"><label for="je-title-${id}">職缺名稱</label><input id="je-title-${id}" data-je="title" data-id="${id}" value="${esc(v('title'))}" maxlength="60"></div>
        <div class="f"><label for="je-keys-${id}">應徵職位裡有這些字就套用（逗號分開）</label><input id="je-keys-${id}" data-je="keys" data-id="${id}" value="${esc(v('keys'))}" maxlength="200"></div>
        <div class="f"><label for="je-text-${id}">條件：「#」開頭是段落標題，「-」開頭是一項條件，其他文字是說明；段落名稱有「不符合」的只提醒、不勾選</label><textarea id="je-text-${id}" data-je="text" data-id="${id}" rows="12" maxlength="8000">${esc(v('text'))}</textarea></div>
        <div class="fl-row">${btns}</div>
      </div></details>`;
  }).join('');
  return `<section class="ov-card" aria-labelledby="jb-h"><header class="ov-h"><h2 id="jb-h">職缺條件（面試對照用）</h2><span class="sp"></span><button class="btn" type="button" data-j="add">＋ 新增職缺</button></header>
    <p class="muted">面試時，抽屜裡會依應徵職位顯示對應職缺的條件，面試官逐項勾選符合的項目。條件存在雲端資料，只有名單內的人看得到，不在公開的網站檔案裡。</p>
    ${rows || '<p class="rt-empty">還沒有職缺條件。按「＋ 新增職缺」。</p>'}
    ${JE.msg ? `<p class="imp-msg${JE.msgErr ? ' err' : ''}" role="status">${esc(JE.msg)}</p>` : ''}
  </section>`;
}

/* ---------- 招募流程：連結「履歷篩選」試算表（只讀） ---------- */
const RC = {configured:null, url:'', name:'', lastSync:0, lastError:'', counts:{}, missing:[], shareTo:'', frozen:0, rs:{lastMail:0, lastAdd:0}, draft:null, busy:false, msg:'', msgErr:false, confirmUnlink:false, confirmFreeze:false};
function applyRecruitStatus(j){
  if (!j || typeof j !== 'object') return;
  RC.configured = !!j.configured;
  if (typeof j.url === 'string') RC.url = j.url;
  RC.name = typeof j.name === 'string' ? j.name : RC.name;
  RC.lastSync = j.lastSync || 0; RC.lastError = j.lastError || '';
  RC.counts = obj(j.counts); RC.missing = Array.isArray(j.missing) ? j.missing.filter(x => typeof x === 'string') : [];
  if (j.shareTo) RC.shareTo = j.shareTo;
  RC.frozen = Number(j.frozen) || 0;
  const rs = obj(j.rs); RC.rs = {lastMail: Number(rs.lastMail) || 0, lastAdd: Number(rs.lastAdd) || 0};
}
function recruitSectionHTML(){
  const when = ms => ms ? new Date(ms).toLocaleString('zh-TW', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '還沒有';
  const c = RC.counts, rs = RC.rs, stale = rs.lastMail && Date.now() - rs.lastMail > 30 * 60000;
  const intake = !FS.loaded ? '讀取中…'
    : rs.lastMail ? `hr@ 的履歷篩選程式上次送來 ${when(rs.lastMail)}・上次收進新履歷 ${when(rs.lastAdd)}`
    : '還沒收到 hr@ 履歷篩選程式送來的履歷。';
  const sheet = RC.configured ? `還在讀舊「${RC.name || '履歷篩選'}」試算表（試算表裡的邀約、面試結果）・上次同步 ${when(RC.lastSync)}${RC.lastSync ? `（篩選名單 ${c.screen | 0}、面試邀約 ${c.invite | 0}、面試結果 ${c.result | 0} 筆）` : ''}`
    : RC.frozen ? `舊「履歷篩選」試算表已在 ${when(RC.frozen)} 停用；之前讀到的資料留著，照日期慢慢不顯示。`
    : '沒有連結舊「履歷篩選」試算表。';
  const url = RC.draft != null ? RC.draft : RC.url;
  const linkRow = `<div class="fl-row">
      <input class="inp" id="rc-url" type="url" value="${esc(url)}" placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="履歷篩選試算表網址">
      <button class="btn${RC.configured ? ' primary' : ''}" type="button" data-u="rc-link"${RC.busy ? ' disabled' : ''}>${RC.configured || RC.frozen ? '重新連結' : '連結'}</button>
    </div>`;
  const btns = !RC.configured ? '' : RC.confirmFreeze
    ? '<span class="confirm-q" style="width:auto">確定停用舊試算表？之後不再讀它，已讀到的資料留著；邀約、面試、錄取都在看板操作。</span><button class="btn sm danger-solid" type="button" data-u="rc-freeze-yes">停用</button><button class="btn sm ghost" type="button" data-u="rc-cancel">不要</button>'
    : RC.confirmUnlink
    ? '<span class="confirm-q" style="width:auto">確定取消連結？「招募」頁前三欄會清空（看板收到的履歷也一起清掉），試算表不受影響。</span><button class="btn sm danger-solid" type="button" data-u="rc-unlink-yes">取消連結</button><button class="btn sm ghost" type="button" data-u="rc-cancel">不要</button>'
    : `<button class="btn sm" type="button" data-u="rc-sync"${RC.busy ? ' disabled' : ''}>立即同步</button><button class="btn sm primary" type="button" data-u="rc-freeze"${RC.busy ? ' disabled' : ''}>停用試算表（保留資料）</button><button class="btn sm ghost danger" type="button" data-u="rc-unlink">取消連結</button>`;
  return `<section class="ov-card" aria-labelledby="rc-h"><header class="ov-h"><h2 id="rc-h">招募流程（履歷收件）</h2></header>
    <p class="muted">104 應徵履歷由 hr@ 的「履歷篩選」程式每 5 分鐘撈 hr@ 信箱、直接送進看板，看板用「職缺條件」的關鍵字規則評分、分級，出現在「招募」頁的「履歷篩選」。邀約、不邀約、面試、錄取、Offer、報到都在看板操作（104 訊息由 104 小幫手送出）。</p>
    <p>${esc(intake)}</p>
    ${stale ? '<p class="imp-msg err">hr@ 的履歷篩選程式超過 30 分鐘沒有送履歷來：請用 hr@ 打開「履歷篩選」試算表的 Apps Script，看「觸發條件」裡的 runFiveMinuteScreening 和「執行項目」有沒有失敗。</p>' : ''}
    <h3 class="fm-h">舊「履歷篩選」試算表</h3>
    <p class="muted">${esc(sheet)}</p>
    ${RC.missing.length && RC.configured ? `<p class="imp-msg">試算表裡找不到這些工作表，對應的欄位會是空的：${esc(RC.missing.join('、'))}</p>` : ''}
    ${RC.lastError && RC.configured ? `<p class="imp-msg err">上次同步失敗：${esc(RC.lastError)}</p>` : ''}
    ${RC.configured ? '' : `<details class="rc-relink"><summary>重新連結舊試算表</summary><p class="muted">要先用擁有試算表的帳號，把試算表共用給 <b>${esc(RC.shareTo || FS.shareTo || '管理員的 Gmail')}</b>（檢視者）。</p>${linkRow}</details>`}
    ${RC.msg ? `<p class="imp-msg${RC.msgErr ? ' err' : ''}" role="status">${esc(RC.msg)}</p>` : ''}
    ${btns ? `<div class="fl-row">${btns}</div>` : ''}
  </section>`;
}
async function recruitAdmin(action, payload, okMsg){
  RC.busy = true; RC.msg = action === 'recruitLink' ? '連結中，第一次讀取試算表要幾秒鐘…' : '處理中…'; RC.msgErr = false; renderUsers();
  try {
    const j = await AU.api(action, payload || {});
    if (action === 'formSync') { applyFormStatus(j); } else applyRecruitStatus(j);
    const st = action === 'formSync' ? j.rc : j;
    RC.draft = null; RC.confirmUnlink = false; RC.confirmFreeze = false;
    RC.msg = okMsg(st || {}); RC.msgErr = !!(st && st.lastError);
    ST.syncNow();
  } catch (e) { RC.msg = e.message; RC.msgErr = true; }
  RC.busy = false; renderUsers();
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
  if (j.rc) applyRecruitStatus(j.rc);
  if (j.mc) applyManualStatus(j.mc);
  applyRunnerStatus(j);
  FS.loaded = true;
}
async function formSync(force){
  if (!AU || !AU.user() || navigator.onLine === false) return;
  if (!force && Date.now() - formSyncAt < 60000) return;
  formSyncAt = Date.now();
  try {
    const j = await AU.api('formSync', force ? {force:true} : {});
    applyFormStatus(j);
    if (j.added) { toast(`人事資料表有 ${j.added} 筆新資料，已加入「面試」`); ST.syncNow(); }
    else if (j.updated || (j.rc && j.rc.changed) || (j.mc && j.mc.changed)) ST.syncNow();
    if (S.view === 'users') renderUsers();
    else if (S.view === 'recruit') { renderToolbar(); renderChat(); }   // 小幫手狀態、聊聊檢查時間跟著更新
  } catch (e) { /* 同步失敗不打擾使用者，下次再試 */ }
}
async function loadFormStatus(){
  FS.loading = true;
  try {
    const j = await AU.api('formSync', {});
    applyFormStatus(j);
    if (j.added) { toast(`人事資料表有 ${j.added} 筆新資料，已加入「面試」`); ST.syncNow(); }
    else if ((j.rc && j.rc.changed) || (j.mc && j.mc.changed)) ST.syncNow();
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
    : '尚未連結：人事資料表的回覆不會自動進看板（線上應徵表單的資料仍會直接進來）。';
  const days = FS.draftDays != null ? FS.draftDays : FS.days;
  const url = FS.draft != null ? FS.draft : FS.url;
  const opt = (v, t) => `<option value="${v}"${Number(days) === v ? ' selected' : ''}>${t}</option>`;
  return `<section class="ov-card" aria-labelledby="fl-h"><header class="ov-h"><h2 id="fl-h">人事資料表自動匯入</h2></header>
    <p class="muted">貼上放「人事資料表文件」的雲端硬碟資料夾網址（或表單的回覆試算表）。要先用擁有資料夾的帳號，把資料夾共用給 <b>${esc(FS.shareTo || '管理員的 Gmail')}</b>（檢視者）。之後每 10 分鐘、以及有人打開 App 時，新的應徵者會自動加進「招募」頁的「面試」；文件之後被修改，App 裡的資料也會跟著更新（評語、進度不會被蓋掉）。</p>
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
  if (h.stage === 'rejected' || h.stage === 'declined') {
    const rej = h.stage === 'rejected', s = obj(h.steps[rej ? 'interview' : 'confirm']);
    return `<section class="sec"><h3>流程進度</h3><ol class="steps"><li class="step rej"><span class="dot">✕</span><div>
      <div class="step-t">${rej ? '面試結果：未錄取' : '確認入職：不來了（婉拒）'}</div>${s.at ? `<div class="step-m">${fmtTime(s.at)}${byHTML(s.by)}</div>` : ''}
      ${canW ? `<div class="step-a"><button class="btn sm" type="button" data-act="back">${rej ? '重新列入面試' : '改回確認入職'}</button></div>` : ''}
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
        else if (d.key === 'confirm') act = '<button class="btn sm primary" type="button" data-act="join-yes">要，寄 Offer</button><button class="btn sm" type="button" data-act="join-no">不要（婉拒）</button>';
        else if (d.key === 'docs') {
          const ok = docsReady(h);
          act = `<button class="btn sm primary" type="button" data-act="advance"${ok ? '' : ' disabled'}>${ADV_LABEL.docs}</button>` + (ok ? '' : '<span class="step-note">需先上傳身分證／居留證正反面</span>');
        } else act = `<button class="btn sm primary" type="button" data-act="advance">${ADV_LABEL[d.key]}</button>`;
        if (i > 0) act += '<button class="btn sm ghost" type="button" data-act="back">退回上一步</button>';
      }
    }
    const title = (state === 'done' && STEP_DONE[d.key]) || d.label;
    return `<li class="step ${state}"><span class="dot">${state === 'done' ? '✓' : i + 1}</span><div>
      <div class="step-t">${title}</div>${meta ? `<div class="step-m">${meta}</div>` : ''}${act ? `<div class="step-a">${act}</div>` : ''}
    </div></li>`;
  }).join('');
  const tail = h.stage === 'done'
    ? `<div class="all-done"><span class="stamp lg">已加保</span><span>全部步驟完成</span>${canW ? '<button class="btn sm ghost" type="button" data-act="back">退回上一步</button>' : ''}</div>` : '';
  return `<section class="sec"><h3>流程進度</h3><ol class="steps">${rows}</ol>${tail}</section>`;
}
/** 抽屜裡的「招募進度」：試算表對到這個人的資料（只能看） */
function extHTML(h){
  if (!R.meta) return '';
  const x = extFor(h), sc = x.screen, iv = x.invite, rs = x.result;
  if (!sc && !iv && !rs) return '';
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  const links = [extLink((rs && rs.cv) || (iv && iv.cv) || (sc && sc.cv), '104 履歷'), extLink(sc && sc.mail, 'Gmail'), extLink(rs && rs.pdf, 'Offer PDF')].filter(Boolean).join('');
  const body = (sc ? row('AI 篩選', sc.tier + (sc.score != null ? `・${sc.score} 分` : '')) + row('履歷重點', sc.sum) + row('AI 說明', sc.why) : '')
    + (iv ? row('邀約', [iv.plat, iv.st].filter(Boolean).join('・')) + row('104 事件進度', iv.ev) + row('面試時間', iv.ivD ? `${slash(iv.ivD)} ${iv.ivT}` : '') + row('人事資料表', [iv.formSt && '表單' + iv.formSt, iv.formFill].filter(Boolean).join('・')) : '')
    + (rs ? row('面試結果', rs.res) + row('二面', rs.iv2) + row('錄取決策', rs.dec) + row('104 通知', rs.n104) + row('Offer', rs.offer)
      + row('預計報到', rs.start ? slash(rs.start) : rs.startRaw) + row('報到安排', [rs.dept, rs.title, rs.time, rs.place, rs.boss && '主管 ' + rs.boss].filter(Boolean).join('・')) + row('備註', rs.note) : '');
  return `<section class="sec"><h3>招募紀錄 <span class="h-count">履歷收件與舊試算表・只能看</span></h3>
    ${body ? `<dl class="fd">${body}</dl>` : ''}${links ? `<p class="ext-links">${links}</p>` : ''}</section>`;
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
  pill.className = 'pill' + (h.stage === 'rejected' || h.stage === 'declined' ? ' rej' : '');
  pill.hidden = false;
  $('#iv-form').hidden = false;
  const panel = $('.panel');
  panel.classList.toggle('st-interview', h.stage === 'interview');
  panel.classList.toggle('wide', h.stage === 'interview' && !!h.form);
  $('#d-form').innerHTML = h.form ? formDataHTML(h) : '';
  $('#iv-meta').textContent = h.ivAt ? `最後更新 ${fmtTime(h.ivAt)}${h.ivBy ? '・' + h.ivBy : ''}` : '';
  const steps = stepsHTML(h), ext = extHTML(h);
  const docs = !['interview','rejected','confirm','declined'].includes(h.stage) ? docsHTML(h) : '', onb = onbHTML(h), offer = offerHTML(h);
  $('#d-dyn').innerHTML = h.stage === 'docs' ? onb + docs + steps + offer + ext : offer + onb + steps + ext + docs;
  $('#d-foot').innerHTML = footHTML(h);
  const jb = $('#d-job'), af = jb.contains(document.activeElement) ? document.activeElement.id : '';
  jb.hidden = h.stage !== 'interview' || (!S.jobs.length && !isAdmin());
  jb.innerHTML = jb.hidden ? '' : jobHTML(h);
  if (af) { const el = document.getElementById(af); if (el) el.focus(); }   // 勾選後畫面重畫，焦點留在原來的項目
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
  $('#d-form').innerHTML = ''; $('#d-dyn').innerHTML = ''; $('#d-foot').innerHTML = ''; $('#d-job').hidden = true;
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
  $('#imp-auto').textContent = FS.configured ? '人事資料表已設定自動匯入，新的應徵者會自己出現在「招募」頁的「面試」。這裡用來補匯入較早的回覆。' : '';
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
  S.tabs.recruit = 'interview';
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
function toast(msg, undo, ms){
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
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || (undo ? 6000 : 3200));
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
  else if (S.view === 'pipeline' || S.view === 'recruit') { renderToolbar(); renderStats(); renderTabs(); renderChat(); renderBoard(); renderBatchBar(); }
  else if (S.view === 'routine') renderRoutine();
  else if (S.view === 'manual') renderManual();
  else if (S.view === 'users') { if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.job-ed, .tpl-ed, .ob-cfg, #at-text'))) renderUsers(); } // 正在編輯職缺條件時不重畫
  if (S.openId && !S.creating) refreshDrawer();
  if (S.imp && S.imp.rows.length) renderImportPreview();
  if (!$('#slm').hidden && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#sl-body input, #sl-body select'))) renderSlots();   // 正在填時段時不重畫
}
function viewFromHash(){ const h = location.hash.slice(1); return VIEWS.includes(h) && (h !== 'users' || isAdmin()) ? h : 'overview'; }
function setView(v){
  S.view = VIEWS.includes(v) && (v !== 'users' || isAdmin()) ? v : 'overview';
  if (S.view !== 'recruit' && S.batch) { S.batch = false; S.sel.clear(); S.batchConfirm = false; }
  if (location.hash.slice(1) !== S.view) { try { history.replaceState(null, '', '#' + S.view); } catch {} }
  render();
  window.scrollTo(0, 0);
  if (['recruit','pipeline','overview','routine','manual'].includes(S.view)) formSync();
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
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tabs[curBoard()] = b.dataset.tab; renderTabs(); renderBoard(); });
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
  if (batchOn() && t.matches('input[data-pick]') && S.hires.has(t.dataset.pick)) togglePick(t.dataset.pick, t.checked);
});
$('#board').addEventListener('click', e => {
  const pc = e.target.closest('[data-pick-col]');
  if (pc) { togglePickCol(pc.dataset.pickCol); return; }
  if (batchOn()) {
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
  else if (act === 'join-yes') confirmJoin(id, true);
  else if (act === 'join-no') confirmJoin(id, false);
});
$('#overview-view').addEventListener('click', e => {
  const mg = e.target.closest('[data-mn-go]');
  if (mg) { S.mnFocus = mg.dataset.mnGo; S.mnOpen.add(S.mnFocus); setView('manual'); return; }
  if (e.target.closest('[data-slots]')) { openSlots(); return; }
  const g = e.target.closest('[data-go]');
  if (g) { const tb = g.dataset.tab; if (tb && BOARD_OF[tb]) S.tabs[BOARD_OF[tb]] = tb; setView(g.dataset.go); return; }
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
  else if (act === 'rc-link') {
    const url = $('#rc-url').value.trim();
    RC.draft = url;
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) { RC.msg = '請貼「履歷篩選」Google 試算表的網址（https://docs.google.com/spreadsheets/…）。'; RC.msgErr = true; renderUsers(); return; }
    recruitAdmin('recruitLink', {url}, j => j.lastError ? '已連結，但讀取失敗，原因見上方。' : `已連結。篩選名單 ${obj(j.counts).screen | 0}、面試邀約 ${obj(j.counts).invite | 0}、面試結果 ${obj(j.counts).result | 0} 筆。`);
  }
  else if (act === 'rc-sync') recruitAdmin('formSync', {force:true}, j => j.lastError ? '同步失敗，原因見上方。' : j.changed ? '已同步，有新的變動。' : '已同步，試算表沒有新的變動。');
  else if (act === 'rc-unlink') { RC.confirmUnlink = true; renderUsers(); }
  else if (act === 'rc-unlink-yes') recruitAdmin('recruitUnlink', {}, () => '已取消連結。');
  else if (act === 'rc-freeze') { RC.confirmFreeze = true; RC.confirmUnlink = false; renderUsers(); }
  else if (act === 'rc-freeze-yes') recruitAdmin('recruitFreeze', {}, () => '已停用舊試算表，之前讀到的資料都還在。之後履歷由看板自己收，邀約、面試都在看板操作。');
  else if (act === 'rc-cancel') { RC.confirmUnlink = false; RC.confirmFreeze = false; renderUsers(); }
  else if (act === 'mc-link') {
    const url = $('#mc-url').value.trim();
    MC.draft = url;
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) { MC.msg = '請貼「HR工作清冊」Google 試算表的網址（https://docs.google.com/spreadsheets/…）。'; MC.msgErr = true; renderUsers(); return; }
    manualAdmin('manualLink', {url}, j => j.lastError ? '已連結，但讀取失敗，原因見上方。' : `已連結，讀到 ${j.count | 0} 項工作。`);
  }
  else if (act === 'mc-sync') manualAdmin('formSync', {force:true}, j => j.lastError ? '同步失敗，原因見上方。' : j.changed ? '已同步，有新的變動。' : '已同步，工作清冊沒有新的變動。');
  else if (act === 'mc-unlink') { MC.confirmUnlink = true; renderUsers(); }
  else if (act === 'mc-unlink-yes') manualAdmin('manualUnlink', {}, () => '已取消連結。');
  else if (act === 'mc-cancel') { MC.confirmUnlink = false; renderUsers(); }
});
$('#users-view').addEventListener('input', e => { if (e.target.id === 'fl-url') FS.draft = e.target.value; else if (e.target.id === 'rc-url') RC.draft = e.target.value; else if (e.target.id === 'mc-url') MC.draft = e.target.value; });
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
    case 'join-yes': confirmJoin(id, true); break;
    case 'join-no': confirmJoin(id, false); break;
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
    case 'onb-send': { const h1 = onbEnsure(id); const ch = h1 && chatFor({name:h1.name, job:h1.position}); if (h1 && ch) openOb('chat', {id:'hire:' + id, name:h1.name, job:h1.position, cv:'', chat:ch, preset:onbText(h1)}); else if (h1) toast('找不到 104 聊聊對話，請改用「複製報到訊息」'); refreshDrawer(); break; }
    case 'onb-copy': { const h1 = onbEnsure(id); if (h1) { copyText(onbText(h1)); toast('已複製報到訊息，貼到 LINE 或簡訊傳給新人'); } refreshDrawer(); break; }
    case 'onb-new': { const h1 = onbEnsure(id, true); if (h1) toast('已換新報到連結，舊連結不能再用'); refreshDrawer(); break; }
    case 'offer-test': offerQueue(id, 'test'); break;
    case 'offer-formal': if (OFFER_FORMAL) offerQueue(id, 'formal'); break;
    case 'offer-formal-yes': if (OFFER_FORMAL && OF.confirmId === id) offerQueue(id, 'formal', true); break;
    case 'offer-formal-no': OF.confirmId = ''; refreshDrawer(); break;
    case 'offer-cancel': saveHire(id, r => { if (r.offer && r.offer.st === 'queued') r.offer.st = 'canceled'; }); pullFromStore(); refreshDrawer(); break;
    case 'offer-pdf': photoOf(b.dataset.fid); refreshDrawer(); break;
    case 'offer-chat': { const h1 = S.hires.get(id); const ch = h1 && chatFor({name:h1.name, job:h1.position}); if (h1 && ch && h1.offer) openOb('chat', {id:'hire:' + id, name:h1.name, job:h1.position, cv:'', chat:ch, preset:offerChatText(h1)}); break; }
    case 'cancel': S.confirm = null; refreshDrawer(); break;
    case 'toggle-id': S.showId = !S.showId; refreshDrawer(); break;
  }
});
$('#d-close').addEventListener('click', () => closeDrawer());
// Offer 欄位：打到一半畫面重畫也不會不見
const ofDraft = e => { const k = e.target.dataset && e.target.dataset.of; if (!k || !S.openId) return; (OF.drafts[S.openId] = OF.drafts[S.openId] || {})[k] = e.target.value; };
$('#d-dyn').addEventListener('input', ofDraft);
$('#d-dyn').addEventListener('change', ofDraft);
$('#obm').addEventListener('click', e => {
  if (e.target.closest('[data-ob-close]')) { closeOb(); return; }
  if (e.target.closest('#ob-send')) sendOb(false);
  else if (e.target.closest('#ob-manual')) sendOb(true);
  else if (e.target.closest('#ob-guide-manual')) guideManual();
});
$('#obm').addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'ob-mode') { OBM.mode = t.value; OBM.err = ''; renderOb(true); }
  else if (t.id === 'ob-tpl') { OBM.tplId = t.value; const ta = $('#ob-text'); ta.value = obTplText(); $('#ob-count').textContent = `${ta.value.length}/1000`; }
});
$('#obm').addEventListener('input', e => { if (e.target.id === 'ob-text') $('#ob-count').textContent = `${e.target.value.length}/1000`; });
$('#chat-panel').addEventListener('click', e => {
  if (e.target.closest('[data-chat-all]')) { S.chatAll = !S.chatAll; renderChat(); return; }
  const b = e.target.closest('[data-chat-reply]'); if (!b || !canEdit()) return;
  const c = S.chat.items.find(x => x.id === b.dataset.chatReply);
  if (c) openOb('chat', chatRow(c));
});
$('#board').addEventListener('click', e => {
  const b = e.target.closest('[data-ob]'); if (!b || !canEdit()) return;
  e.stopPropagation();
  const act = b.dataset.ob;
  if (act === 'manual') {   // 小幫手送不出去：改成自己在 104 送
    const cur = ST.get('outbox', b.dataset.obId), o = normOb(cur);
    if (!o || o.status !== 'failed' || !o.text || !is104(o.to.cv)) { toast('這筆沒有內容或 104 履歷連結，不能手動送'); return; }
    const how = manualSend(o.text, o.to.cv, o.type);
    obUpdate(o.id, {status:'sent', via:'manual', sentAt:Date.now(), result:'在 104 手動送出'});
    toast(how, () => obUpdate(o.id, {status:'failed', via:'', sentAt:0, result:o.result}), 15000);
    return;
  }
  if (act === 'chat') { const r = rowById(b.dataset.row), c = S.chat.items.find(x => x.id === b.dataset.room); if (r && c) openOb('chat', Object.assign({}, r, {chat:c})); return; }
  if (act === 'retry') { obUpdate(b.dataset.obId, {status:'queued', tries:0, result:''}); toast('已重新排入送出'); return; }
  if (act === 'cancel') { const cur = ST.get('outbox', b.dataset.obId); if (cur && cur.status === 'queued') { obUpdate(b.dataset.obId, {status:'canceled'}); toast('已取消送出'); } else toast('已經在送出中，來不及取消'); return; }
  openOb(act, rowById(b.dataset.row));
}, true);
$('#users-view').addEventListener('click', async e => {
  const b = e.target.closest('[data-u]'); if (!b || !isAdmin()) return;
  const act = b.dataset.u, id = b.dataset.id;
  if (act === 'rk-new') { if (RN.configured) { RK.confirm = true; renderUsers(); } else rkNew(); }
  else if (act === 'rk-new-yes') rkNew();
  else if (act === 'rk-cancel') { RK.confirm = false; renderUsers(); }
  else if (act === 'te-add') {
    const nid = rid('t');
    ST.save('tpl', {id:nid, kind:'message', title:'新範本', text:'', order:S.tpl.reduce((m, t) => Math.max(m, t.order), 0) + 1, updatedAt:Date.now(), updatedBy:myName()});
    TE.open = nid; pullFromStore(); renderUsers();
  }
  else if (act === 'te-save') {
    const cur = ST.get('tpl', id); if (!cur) return;
    const d = TE.drafts[id] || {}, title = str(d.title != null ? d.title : cur.title);
    if (!title) { TE.msg = '請填範本名稱。'; renderUsers(); return; }
    ST.save('tpl', Object.assign(JSON.parse(JSON.stringify(cur)), {title, kind: d.kind || cur.kind, text: d.text != null ? d.text : cur.text, updatedAt:Date.now(), updatedBy:myName()}));
    delete TE.drafts[id]; TE.msg = `已儲存「${title}」。`; pullFromStore(); renderUsers();
  }
  else if (act === 'te-del') { TE.confirm = id; renderUsers(); }
  else if (act === 'te-del-yes') { ST.remove('tpl', id); delete TE.drafts[id]; TE.confirm = ''; TE.msg = '已刪除範本。'; pullFromStore(); renderUsers(); }
  else if (act === 'te-cancel') { TE.confirm = ''; renderUsers(); }
  else if (act === 'ai-test') {
    AT.text = ($('#at-text') || {}).value || AT.text;
    AT.busy = true; AT.msg = ''; AT.result = null; renderUsers();
    try { const j = await AU.api('aiTest', {text:AT.text}); AT.result = j.result; AT.msg = ''; AT.err = false; }
    catch (err) { AT.msg = err.message; AT.err = true; }
    AT.busy = false; renderUsers();
  }
});
async function rkNew(){
  RK.busy = true; RK.confirm = false; RK.msg = '產生中…'; renderUsers();
  try { const j = await AU.api('runnerKeyNew', {}); RK.key = j.key; applyRunnerStatus({rn:j.runner}); RK.msg = ''; }
  catch (err) { RK.msg = err.message; }
  RK.busy = false; renderUsers();
}
$('#users-view').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.te && t.dataset.id) (TE.drafts[t.dataset.id] = TE.drafts[t.dataset.id] || {})[t.dataset.te] = t.value;
  else if (t.id === 'at-text') AT.text = t.value;
});
$('#users-view').addEventListener('change', e => {
  const t = e.target;
  if (t.classList && t.classList.contains('ob-cfg')) saveCfg();
  else if (t.dataset && t.dataset.te === 'kind' && t.dataset.id) (TE.drafts[t.dataset.id] = TE.drafts[t.dataset.id] || {}).kind = t.value;
});
$('#users-view').addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.tpl-ed')) { if (d.open) TE.open = d.dataset.tpl; else if (TE.open === d.dataset.tpl) TE.open = ''; } }, true);
$('#manual-view').addEventListener('input', e => { if (e.target.id === 'mn-q') { S.mnQ = e.target.value.trim(); renderManual(); } });
$('#manual-view').addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.mn-item')) { if (d.open) S.mnOpen.add(d.dataset.mn); else S.mnOpen.delete(d.dataset.mn); } }, true);
document.addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  const v = c.dataset.copy;
  Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(v)).then(() => toast('已複製路徑')).catch(() => toast('無法自動複製，請手動選取'));
});
$('#routine-view').addEventListener('click', e => { const b = e.target.closest('[data-mn-open]'); if (!b) return; const id = b.dataset.mnOpen; if (S.rtMn.has(id)) S.rtMn.delete(id); else S.rtMn.add(id); renderRoutine(); });
$('#d-job').addEventListener('change', e => {
  const id = S.openId, t = e.target;
  if (!id || S.creating || !canEdit() || !S.hires.has(id)) return;
  if (t.id === 'job-sel') { const v = t.value; saveHire(id, r => { r.crit = Object.assign({}, obj(r.crit), {job:v}); }); return; }
  const k = t.dataset.crit;
  if (k) saveHire(id, r => { const c = obj(r.crit), ok = new Set(Array.isArray(c.ok) ? c.ok : []); if (t.checked) ok.add(k); else ok.delete(k); r.crit = Object.assign({}, c, {ok:[...ok]}); });
});
$('#users-view').addEventListener('click', e => {
  const b = e.target.closest('[data-j]'); if (!b || !isAdmin()) return;
  const id = b.dataset.id, cur = id ? ST.get('jobs', id) : null;
  switch (b.dataset.j) {
    case 'add': {
      const nid = rid('j'), now = Date.now();
      ST.save('jobs', {id:nid, title:'新職缺', keys:'', text:'#必要條件\n- ', order:S.jobs.reduce((m, j) => Math.max(m, j.order), 0) + 1, updatedAt:now, updatedBy:myName()});
      JE.open = nid; JE.msg = ''; pullFromStore(); renderUsers();
      const el = document.getElementById('je-title-' + nid); if (el) el.select();
      break;
    }
    case 'save': {
      if (!cur) return;
      const d = JE.drafts[id] || {}, title = str(d.title != null ? d.title : cur.title);
      if (!title) { JE.msg = '請填職缺名稱。'; JE.msgErr = true; renderUsers(); return; }
      ST.save('jobs', Object.assign(JSON.parse(JSON.stringify(cur)), {title, keys:str(d.keys != null ? d.keys : cur.keys), text: d.text != null ? d.text : cur.text, updatedAt:Date.now(), updatedBy:myName()}));
      delete JE.drafts[id]; JE.msg = `已儲存「${title}」。`; JE.msgErr = false; pullFromStore(); renderUsers();
      break;
    }
    case 'del': JE.confirm = id; renderUsers(); break;
    case 'del-yes': if (cur) ST.remove('jobs', id); delete JE.drafts[id]; JE.confirm = ''; JE.msg = '已刪除。'; JE.msgErr = false; pullFromStore(); renderUsers(); break;
    case 'cancel': JE.confirm = ''; renderUsers(); break;
  }
});
$('#users-view').addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.je && t.dataset.id) (JE.drafts[t.dataset.id] = JE.drafts[t.dataset.id] || {})[t.dataset.je] = t.value; });
$('#users-view').addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.job-ed')) { if (d.open) JE.open = d.dataset.job; else if (JE.open === d.dataset.job) JE.open = ''; } }, true);
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
    S.tabs.recruit = 'interview';
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
  else if (!$('#obm').hidden) closeOb();
  else if (!$('#slm').hidden) closeSlots();
  else if (!$('#imp').hidden) closeImport();
  else if (!$('#drawer').hidden) closeDrawer();
});
$('#slot-btn').addEventListener('click', openSlots);
$('#slm').addEventListener('click', e => {
  if (e.target.closest('[data-sl-close]')) { closeSlots(); return; }
  const b = e.target.closest('[data-sl]'); if (!b) return;
  const id = b.dataset.id, cur = id ? ST.get('slots', id) : null, d = b.dataset.d;
  switch (b.dataset.sl) {
    case 'rg-add': {
      slReadWeek();
      const rs = SL.wk.days[d], last = rs.length ? slHm(rs[rs.length - 1][1]) : -1;
      if (last < 0) rs.push(['09:00', '17:00']);
      else if (last + SL.wk.dur < 24 * 60) rs.push([slFmt(last), slFmt(last + SL.wk.dur)]);
      SL.dirty = true; renderSlots(); break;
    }
    case 'rg-del': slReadWeek(); SL.wk.days[d].splice(+b.dataset.i, 1); SL.dirty = true; renderSlots(); break;
    case 'cp': slReadWeek(); SL.copyFrom = +d; renderSlots(); break;
    case 'cp-yes': {
      slReadWeek();
      const to = [...document.querySelectorAll('#sl-body .sw-cp:checked')].map(x => x.value);
      to.forEach(x => { SL.wk.days[x] = JSON.parse(JSON.stringify(SL.wk.days[d])); });
      SL.copyFrom = null; if (to.length) SL.dirty = true; renderSlots(); break;
    }
    case 'cp-no': slReadWeek(); SL.copyFrom = null; renderSlots(); break;
    case 'wk-save': slSaveWeek(); break;
    case 'wk-reset': SL.dirty = false; SL.copyFrom = null; SL.wk = JSON.parse(JSON.stringify(slWeekStored() || slEmptyWeek())); SL.msg = ''; renderSlots(); break;
    case 'day-close': case 'day-open': {
      const close = b.dataset.sl === 'day-close';
      slotList().filter(s => s.date === b.dataset.date && s.closed !== close).forEach(s => slToggle(s, close));
      SL.msg = `${dayLabel(b.dataset.date)} ${close ? '已關閉，應徵者不能選這一天' : '已重新開放'}。`; SL.msgErr = false;
      renderSlots(); break;
    }
    case 'copy': {
      const inp = $('#sl-url');
      Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(inp.value)).then(() => toast('已複製應徵連結')).catch(() => { inp.select(); toast('請按 Ctrl+C 複製'); });
      break;
    }
    case 'toggle': { const s = slotList().find(x => x.id === id); if (s) { slToggle(s, !s.closed); renderSlots(); } break; }
    case 'del': SL.confirm = id; renderSlots(); break;
    case 'del-yes': if (cur) ST.remove('slots', id); SL.confirm = null; renderSlots(); break;
    case 'cancel': SL.confirm = null; renderSlots(); break;
    case 'open': if (S.hires.has(id)) { closeSlots(); openDrawer(id, S.hires.get(id).stage === 'interview' ? 'comment' : null); } break;
  }
});
$('#slm').addEventListener('submit', e => { if (e.target.id === 'sl-form') { e.preventDefault(); addSlots(); } });
$('#slm').addEventListener('change', e => { if (e.target.closest('.sw') && !e.target.classList.contains('sw-cp')) slWeekEdited(false); });
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
/** 雲端有新資料（同事修改、新人用報到連結上傳文件）：打開中的詳細資料跟著更新；正在詳細資料裡打字時先不重畫 */
function refreshDrawerRemote(){
  if ($('#drawer').hidden || !S.openId || S.creating) return;
  const a = document.activeElement;
  if (a && a.closest && a.closest('#d-dyn, #d-foot, #d-job') && a.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"])')) return;
  refreshDrawer();
}
ST.on((type, p) => {
  if (type === 'change') { pullFromStore(); schedule(); if (p && !p.local && (p.keys || []).includes('hires')) refreshDrawerRemote(); }
  else if (type === 'status') { renderSync(); const l = !!ST.status().loaded; if (l !== S.loaded) { pullFromStore(); schedule(); } }
  else if (type === 'conflict') toast('有同事同時修改了同一筆資料，已自動合併；同一個欄位以你的修改為準。');
});
AU.on(() => { U.list = null; schedule(); });
S.view = viewFromHash();
pullFromStore(); render();
AU.ready.then(() => { S.view = viewFromHash(); pullFromStore(); render(); formSync(); });
// 打開 App、切回 App 時順便同步人事資料表與履歷篩選試算表（雲端後端另外每 10 分鐘同步一次）
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') formSync(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
}
// 跨日（App 開著過午夜）時，「今天」和例行工作的期間跟著更新
let lastDay = today();
setInterval(() => { const d = today(); if (d !== lastDay) { lastDay = d; pullFromStore(); schedule(); } }, 60000);
})();

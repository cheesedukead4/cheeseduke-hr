/* 起士公爵 人事工作看板｜班表共用程式（看板 index.html 的「班表」頁、部門填寫頁 sched.html 共用）
 * ---------------------------------------------------------------
 * 資料（HRStore 類別 sched_YYYYMM，一位員工一個月一筆）：
 *   { id: 'YYYY-MM|員工 id', date: 'YYYY-MM', sid: 員工 id, dept: 部門名稱, days: { '01': 一天, … }, updatedAt, updatedBy }
 *   一天 { k: w 上班｜R 例假｜X 休息日｜H 國定假日｜L 請假,
 *          s: 上班 HH:MM, e: 下班 HH:MM（比上班早＝下班在隔天）, b: 休息時數, ot: 加班時數, c: 班別代碼, lv: 補／特休時數, lt: 假別, n: 備註 }
 *   班別＝Apollo 的班次代碼：人資在看板「班表」頁設定（depts 的 _cfg.shifts：[{ c: 代碼, n: 名稱, s, e, b（預設時間，可以空白）, d: 適用部門（空白＝全部） }]）。
 *   部門有班別可以選時，上班一定要選班別（Apollo 匯入「上班 W0001」要班次代碼）；選了會帶入預設時間，時間可以再調整，代碼 c 不變。
 * Apollo 匯入檔（apolloRows）：一人一天一列「工號、姓名、日期、狀態代碼、班次代碼、上班、下班」；例假 H0003、休息日 H0002，
 *   國定假日、請假（整天）照人資在看板設定的對照（預設國定假日 H0001 休假日、請假不匯出）。
 *   時數＝下班－上班－休息（和原本的 Excel 班表一樣）。
 *   雲端後端 Code.gs 的 schDay_ 是同一套欄位規則（部門連結存檔時用），改一邊要改另一邊。
 * 四週變形工時檢查（勞基法第 30 條之 1）：從起算日起每 28 天一個週期
 *   —— 正常工時 ≤ 160 小時、例假＋休息日 ≥ 8 天、前後 2 週各 ≥ 2 天例假；每天正常工時 ≤ 10 小時、含加班 ≤ 12 小時；
 *   繼續工作 4 小時要休息 30 分鐘；換班間隔 ≥ 11 小時（提醒）。跨月的週期會連同上、下個月的班表一起算。
 */
(function () {
'use strict';
const pad = n => String(n).padStart(2, '0');
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KINDS = [['w','上班'],['R','例假'],['X','休息日'],['H','國定假日'],['L','請假']];
const KIND_LABEL = Object.fromEntries(KINDS);
const SHORT = {R:'例', X:'休', H:'國', L:'假'};
const LEAVES = ['特休','補休','事假','病假','公假','婚假','喪假','產假','陪產假','其他'];
const WD = ['日','一','二','三','四','五','六'];
const DEFAULT_ANCHOR = '2026-01-05';   // 四週變形的起算日（週一）；看板「班表設定」可以改
const LIMITS = {cycle:160, off:8, rest2w:2, day:10, dayAll:12, gap:11};

/* ---------- 日期 ---------- */
const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
function daysIn(month){ const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const dateOf = (month, d) => month + '-' + pad(d);
const wday = date => new Date(date + 'T00:00:00Z').getUTCDay();
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
function shiftMonth(month, n){ const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
const md = date => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
const ddList = month => Array.from({length: daysIn(month)}, (_, i) => pad(i + 1));

/* ---------- 時間與工時 ---------- */
/** 7、7.5、7:30、730、0730、14.5、1430 → 'HH:MM'；空白 → ''；看不懂 → null */
function parseTime(v){
  const s = String(v == null ? '' : v).trim().replace(/[：﹕]/g, ':').replace(/[．。]/g, '.').replace(/\s+/g, '');
  if (!s) return '';
  let h, m, r;
  if ((r = /^(\d{1,2}):(\d{2})$/.exec(s))) { h = +r[1]; m = +r[2]; }
  else if ((r = /^(\d{1,2})(\d{2})$/.exec(s))) { h = +r[1]; m = +r[2]; }
  else if (/^\d{1,2}(\.\d+)?$/.test(s)) { const x = +s; h = Math.floor(x); m = Math.round((x - h) * 60); if (m === 60) { h++; m = 0; } }
  else return null;
  if (h > 24 || m > 59 || (h === 24 && m)) return null;
  return pad(h) + ':' + pad(m);
}
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const tShow = t => t ? String(+t.slice(0, 2)) + ':' + t.slice(3, 5) : '';
const round2 = x => Math.round(x * 100) / 100;
function numIn(v, max){ const x = Number(v); return isFinite(x) && x > 0 && x <= max ? round2(x) : 0; }
const fmtH = x => { x = round2(x || 0); return Number.isInteger(x) ? String(x) : String(x); };
const cleanCode = v => String(v == null ? '' : v).replace(/[\s<>"'`&]/g, '').slice(0, 12);
/** 班別設定整理成標準格式：代碼、上下班看得懂才留 */
function cleanShifts(list){
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(x => {
    if (!x || typeof x !== 'object') return null;
    const c = cleanCode(x.c), s = parseTime(x.s) || '', e = parseTime(x.e) || '';
    if (!c || seen.has(c)) return null;
    seen.add(c);
    return {c, n:String(x.n == null ? '' : x.n).replace(/\s+/g, ' ').trim().slice(0, 20), s, e, b:numIn(x.b, 12), d:String(x.d == null ? '' : x.d).replace(/\s+/g, ' ').trim().slice(0, 200)};
  }).filter(Boolean).slice(0, 300);
}
const deptsOf = x => String(x.d || '').split(/[,，、;；\s]+/).filter(Boolean);
/** 某個部門可以用的班別：有指定給這個部門的就只用那些；這個部門一個都沒指定時，用沒有指定部門的班別 */
function shiftsFor(list, dept){
  const all = cleanShifts(list), mine = all.filter(x => deptsOf(x).includes(dept));
  return mine.length ? mine : all.filter(x => !x.d);
}
const sameShift = (x, d) => x.s === d.s && x.e === d.e && round2(x.b || 0) === round2(d.b || 0);
/** 一天（上班）的班別代碼：指定的代碼在清單裡就用它（時間可以和預設不同）；沒指定才找上下班、休息都一樣的班別 */
function shiftCode(shifts, d, prefer){
  const list = shifts || [];
  if (prefer && list.some(x => x.c === prefer)) return prefer;
  if (!d || !d.s || !d.e) return '';
  const p = list.find(x => x.s && x.e && sameShift(x, d));
  return p ? p.c : '';
}
/* ---------- Apollo 班表匯入檔 ---------- */
const APOLLO_HEAD = ['*工號', '姓名', '*日期(YYYY/MM/DD)', '*狀態代碼', '班次代碼', '上班時間(HH:mm)', '下班時間(HH:mm)', '休息時間(hh:mm~hh:mm；如有多組以","分隔；最多3組)', '全天支援單位代碼',
  '(1)支援單位代碼', '(1)支援起時-hh:mm', '(1)支援迄時-hh:mm', '(2)支援單位代碼', '(2)支援起時-hh:mm', '(2)支援迄時-hh:mm', '(3)支援單位代碼', '(3)支援起時-hh:mm', '(3)支援迄時-hh:mm'];
const APOLLO_STATUS = [['W0001', '上班'], ['H0001', '休假日'], ['H0002', '休息日'], ['H0003', '例假日'], ['M0001', '月休'], ['M0002', '月休-國定假日'], ['M0003', '月休-休息日'], ['M0004', '月休-例假日']];
const APOLLO_DEF = {H:'H0001', L:''};
/**
 * list: [{ no: 工號, name, days: { DD: 一天 } }]；map: { H: 國定假日的狀態代碼, L: 整天請假的狀態代碼 }（空白＝不匯出）
 * 回傳 { rows: [[工號, 姓名, 'YYYY-MM-DD', 狀態代碼, 班次代碼, 上班, 下班]], skip: { noNo: [姓名], noCode: ['姓名 M/D'], noTime: [...], off: 不匯出的天數 } }
 */
function apolloRows(month, list, map){
  const m = Object.assign({}, APOLLO_DEF, map || {}), ok = c => APOLLO_STATUS.some(([k]) => k === c);
  const rows = [], skip = {noNo:[], noCode:[], noTime:[], off:0};
  for (const p of list || []) {
    const no = String(p.no == null ? '' : p.no).trim(), days = p.days || {};
    if (!no) { if (Object.keys(days).length) skip.noNo.push(p.name); continue; }
    for (const dd of ddList(month)) {
      const d = days[dd], date = dateOf(month, dd);
      if (!d) continue;
      if (d.k === 'w') {
        if (!d.c) { skip.noCode.push(`${p.name} ${md(date)}`); continue; }
        if (!d.s || !d.e) { skip.noTime.push(`${p.name} ${md(date)}`); continue; }
        rows.push([no, p.name, date, 'W0001', d.c, d.s, d.e]);
        continue;
      }
      const st = d.k === 'R' ? 'H0003' : d.k === 'X' ? 'H0002' : d.k === 'H' ? m.H : d.k === 'L' ? m.L : '';
      if (!st || !ok(st)) { skip.off++; continue; }
      rows.push([no, p.name, date, st]);
    }
  }
  return {rows, skip};
}
/** 一天的資料整理成標準格式（欄位不對就丟掉）；沒有內容回傳 null */
function cleanDay(d){
  if (!d || typeof d !== 'object') return null;
  const k = typeof d.k === 'string' && Object.prototype.hasOwnProperty.call(KIND_LABEL, d.k) ? d.k : '';
  if (!k) return null;
  const o = {k};
  if (k === 'w') {
    const s = parseTime(d.s), e = parseTime(d.e);
    if (s) o.s = s; if (e) o.e = e;
    const b = numIn(d.b, 12); if (b) o.b = b;
    const ot = numIn(d.ot, 12); if (ot) o.ot = ot;
    const c = cleanCode(d.c); if (c) o.c = c;
  }
  if (k === 'w' || k === 'L') {
    const lv = numIn(d.lv, 24); if (lv) o.lv = lv;
    if (LEAVES.includes(d.lt)) o.lt = d.lt;
  }
  const n = String(d.n == null ? '' : d.n).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (n) o.n = n;
  return o;
}
function cleanDays(days, month){
  const out = {};
  if (!days || typeof days !== 'object') return out;
  const max = month ? daysIn(month) : 31;
  for (const [dd, v] of Object.entries(days)) {
    if (!/^\d{2}$/.test(dd) || +dd < 1 || +dd > max) continue;
    const c = cleanDay(v);
    if (c) out[dd] = c;
  }
  return out;
}
function spanMins(d){ if (!d || d.k !== 'w' || !d.s || !d.e) return 0; let m = mins(d.e) - mins(d.s); if (m <= 0) m += 1440; return m; }
/** 正常工時（下班－上班－休息） */
function hoursOf(d){ const m = spanMins(d); return m ? Math.max(0, round2(m / 60 - (d.b || 0))) : 0; }
const shiftKey = d => d && d.k === 'w' && d.s && d.e ? `${d.s}-${d.e}-${d.b || 0}` : '';
function shiftText(d){ return d && d.s && d.e ? `${tShow(d.s)}–${tShow(d.e)}${d.b ? `（休 ${fmtH(d.b)}）` : ''}` : ''; }
/** 給螢幕閱讀器與匯出用的一天說明 */
function dayText(d){
  if (!d) return '未排';
  if (d.k === 'w') {
    const p = [d.s && d.e ? `${d.c ? `班別 ${d.c}，` : ''}上班 ${tShow(d.s)} 到 ${tShow(d.e)}，休息 ${fmtH(d.b || 0)} 小時，工時 ${fmtH(hoursOf(d))} 小時` : '上班（時間未填）'];
    if (d.ot) p.push(`加班 ${fmtH(d.ot)} 小時`);
    if (d.lv) p.push(`${d.lt || '補／特休'} ${fmtH(d.lv)} 小時`);
    if (d.n) p.push(d.n);
    return p.join('，');
  }
  return [d.k === 'L' ? (d.lt || '請假') + (d.lv ? ` ${fmtH(d.lv)} 小時` : '') : KIND_LABEL[d.k], d.n].filter(Boolean).join('，');
}

/* ---------- 四週變形工時檢查 ---------- */
/**
 * o: { month, days: { 'YYYY-MM-DD': 一天 }（可以包含上、下個月）, anchor, target（本月應排時數，0＝不比對）, hol: ['25', …] }
 * 回傳 { sum: { work, lv, ot, total, workDays, blank }, issues: [{ sev: 'err'|'warn', text }], marks: { DD: 'err'|'warn' } }
 */
function checkStaff(o){
  const month = o.month, days = o.days || {}, anchor = isDate(o.anchor) ? o.anchor : DEFAULT_ANCHOR;
  const issues = [], marks = {};
  const mark = (date, sev) => { if (date.slice(0, 7) !== month) return; const dd = date.slice(8); if (marks[dd] !== 'err') marks[dd] = sev; };
  const sum = {work:0, lv:0, ot:0, total:0, workDays:0, blank:0};
  const blanks = [];
  for (const dd of ddList(month)) {
    const date = dateOf(month, dd), d = days[date];
    if (!d) { sum.blank++; blanks.push(+dd); continue; }
    if (d.k === 'w') sum.workDays++;
    sum.work += hoursOf(d); sum.lv += d.lv || 0; sum.ot += d.ot || 0;
  }
  sum.work = round2(sum.work); sum.lv = round2(sum.lv); sum.ot = round2(sum.ot); sum.total = round2(sum.work + sum.lv);
  // 每一天
  const noCode = [];
  for (const dd of ddList(month)) {
    const date = dateOf(month, dd), d = days[date];
    if (!d || d.k !== 'w') continue;
    if (o.needCode && !d.c) noCode.push(date);
    if (!d.s || !d.e) { issues.push({sev:'err', text:`${md(date)} 上班沒有填上下班時間`}); mark(date, 'err'); continue; }
    const h = hoursOf(d), span = spanMins(d);
    if (h > LIMITS.day) { issues.push({sev:'err', text:`${md(date)} 正常工時 ${fmtH(h)} 小時，超過每天 ${LIMITS.day} 小時`}); mark(date, 'err'); }
    if (h + (d.ot || 0) > LIMITS.dayAll) { issues.push({sev:'err', text:`${md(date)} 工時含加班 ${fmtH(h + d.ot)} 小時，超過每天 ${LIMITS.dayAll} 小時`}); mark(date, 'err'); }
    if (span - (d.b || 0) * 60 > 240 && (d.b || 0) < 0.5) { issues.push({sev:'warn', text:`${md(date)} 連續工作超過 4 小時，至少要休息 30 分鐘`}); mark(date, 'warn'); }
    const pd = days[addDays(date, -1)];
    if (pd && pd.k === 'w' && pd.s && pd.e) {
      const prevEnd = mins(pd.s) + spanMins(pd) - 1440;   // 前一天下班，換算成今天 0 點起的分鐘（負數＝前一天）
      const gap = (mins(d.s) - prevEnd) / 60;
      if (gap < LIMITS.gap) { issues.push({sev:'warn', text:`${md(date)} 和前一天下班只隔 ${fmtH(round2(gap))} 小時（換班間隔至少 ${LIMITS.gap} 小時）`}); mark(date, 'warn'); }
    }
  }
  // 每 4 週一個週期（跨月的週期用上、下個月的資料）
  const first = dateOf(month, '01'), last = dateOf(month, pad(daysIn(month)));
  const c0 = Math.floor(diffDays(anchor, first) / 28), c1 = Math.floor(diffDays(anchor, last) / 28);
  for (let c = c0; c <= c1; c++) {
    const start = addDays(anchor, c * 28), end = addDays(start, 27), range = `${md(start)}–${md(end)}`;
    let work = 0, off = 0, miss = 0; const half = [{r:0, miss:0}, {r:0, miss:0}];
    for (let i = 0; i < 28; i++) {
      const d = days[addDays(start, i)], hf = half[i < 14 ? 0 : 1];
      if (!d) { miss++; hf.miss++; continue; }
      work += hoursOf(d);
      if (d.k === 'R' || d.k === 'X') off++;
      if (d.k === 'R') hf.r++;
    }
    work = round2(work);
    if (work > LIMITS.cycle) issues.push({sev:'err', text:`${range} 這 4 週正常工時 ${fmtH(work)} 小時，超過 ${LIMITS.cycle} 小時`});
    if (off + miss < LIMITS.off) issues.push({sev:'err', text:`${range} 這 4 週例假＋休息日 ${off} 天，至少要 ${LIMITS.off} 天`});
    half.forEach((hf, i) => {
      const s = addDays(start, i * 14), e = addDays(s, 13);
      if (hf.r + hf.miss < LIMITS.rest2w) issues.push({sev:'err', text:`${md(s)}–${md(e)} 這 2 週例假 ${hf.r} 天，至少要 ${LIMITS.rest2w} 天`});
    });
  }
  if (noCode.length) { issues.push({sev:'warn', text:`${noCode.length} 天上班沒有選班別（匯入 Apollo 需要班次代碼）：${noCode.slice(0, 8).map(x => +x.slice(8)).join('、')}${noCode.length > 8 ? '…' : ''} 日`}); noCode.forEach(x => mark(x, 'warn')); }
  if (blanks.length) issues.push({sev:'warn', text:`還有 ${blanks.length} 天沒排：${blanks.slice(0, 8).join('、')}${blanks.length > 8 ? '…' : ''} 日`});
  if (o.target > 0 && !blanks.length) {
    const diff = round2(sum.total - o.target);
    if (diff) issues.push({sev:'warn', text:`本月工時＋補／特休 ${fmtH(sum.total)} 小時，應排 ${fmtH(o.target)} 小時（${diff > 0 ? '多' : '少'} ${fmtH(Math.abs(diff))} 小時）`});
  }
  return {sum, issues, marks};
}
/** 正職才比對「應排時數」（沒填身分也當正職） */
const usesTarget = st => !st || !st.kind || /正職|全職/.test(st.kind);

/* ---------- 班表格子（總表：一列一位員工，一欄一天）＋編輯視窗 ----------
 * opt: { month, staff: [{id, name, title, kind}], data: { 員工 id: { DD: 一天 } }, ctx: { 員工 id: { 'YYYY-MM-DD': 一天 } }（上、下個月，檢查用）,
 *        anchor, target, hol: ['25'], readOnly, onChange(changes: [{sid, dd, v: 一天|null}]), onIssues(總數) }
 */
function Grid(root, opt){
  const G = {opt: Object.assign({data:{}, ctx:{}, staff:[], hol:[], shifts:[]}, opt), sel:new Set(), multi:false, undo:[], last:null, checks:{}, drag:null, ed:null};
  root.classList.add('sg');
  root.innerHTML = '<div class="sg-bar"></div><div class="sg-scroll" tabindex="-1"></div><div class="sg-selbar" hidden></div><div class="sg-issues"></div><div class="sg-ov" hidden></div>';
  const $ = s => root.querySelector(s);
  const ck = (sid, dd) => sid + '|' + dd;
  const getDay = (sid, dd) => (G.opt.data[sid] || {})[dd] || null;
  const staffOf = sid => G.opt.staff.find(s => s.id === sid);

  function allDays(sid){
    const out = Object.assign({}, G.opt.ctx[sid] || {});
    for (const [dd, v] of Object.entries(G.opt.data[sid] || {})) out[dateOf(G.opt.month, dd)] = v;
    return out;
  }
  function runChecks(){
    G.checks = {};
    let n = 0;
    for (const st of G.opt.staff) {
      const r = checkStaff({month:G.opt.month, days:allDays(st.id), anchor:G.opt.anchor, target: usesTarget(st) ? G.opt.target : 0, needCode:(G.opt.shifts || []).length > 0});
      G.checks[st.id] = r;
      n += r.issues.filter(i => i.sev === 'err').length;
    }
    if (G.opt.onIssues) G.opt.onIssues(n);
  }
  function codeUse(){ const n = new Map(); for (const days of Object.values(G.opt.data)) for (const d of Object.values(days || {})) if (d && d.c) n.set(d.c, (n.get(d.c) || 0) + 1); return n; }
  function orderShifts(){ const n = codeUse(), list = (G.opt.shifts || []).slice(); return list.map((x, i) => [x, i]).sort((a, b) => (n.get(b[0].c) || 0) - (n.get(a[0].c) || 0) || a[1] - b[1]).map(a => a[0]); }
  /** 班別的時間：班別有預設時間就用預設，沒有就用這個班別最常排的時間 */
  function timesFor(c){
    const x = (G.opt.shifts || []).find(y => y.c === c);
    if (x && x.s && x.e) return {s:x.s, e:x.e, b:x.b || 0};
    const cnt = new Map();
    for (const days of Object.values(G.opt.data)) for (const d of Object.values(days || {})) if (d && d.c === c && d.s && d.e) { const k = `${d.s}-${d.e}-${d.b || 0}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [s, e, b] = best[0].split('-');
    return {s, e, b:+b || 0};
  }
  const shLabel = x => `${esc(x.c)}${x.n ? ' ' + esc(x.n) : ''}${x.s ? '　' + esc(shiftText(x)) : ''}`;
  function commonShifts(){
    const cnt = new Map();
    for (const days of Object.values(G.opt.data)) for (const d of Object.values(days || {})) { const k = shiftKey(d); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); }
    if (G.last && shiftKey(G.last)) cnt.set(shiftKey(G.last), (cnt.get(shiftKey(G.last)) || 0) + 0.5);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => { const [s, e, b] = k.split('-'); return {k:'w', s, e, b:+b || 0}; });
  }

  /* ----- 畫面 ----- */
  function cellHTML(st, dd){
    const d = getDay(st.id, dd), m = (G.checks[st.id] || {marks:{}}).marks[dd], sel = G.sel.has(ck(st.id, dd));
    const date = dateOf(G.opt.month, dd), we = wday(date);
    let inner = '', cls = 'sg-c';
    if (!d) { cls += ' k-none'; }
    else if (d.k === 'w') { cls += ' k-w'; inner = !(d.s && d.e) ? '<span>上班</span><span>?</span>' : d.c ? `<b class="sg-code">${esc(d.c)}</b><span>${tShow(d.s)}</span>` : `<span>${tShow(d.s)}</span><span>${tShow(d.e)}</span>`; }
    else { cls += ' k-' + d.k; inner = `<b>${d.k === 'L' && d.lt ? esc(d.lt.slice(0, 1)) : SHORT[d.k]}</b>`; }
    if (d && (d.ot || d.lv || d.n)) inner += '<i class="sg-dot" aria-hidden="true"></i>';
    if (m) cls += ' m-' + m;
    if (sel) cls += ' sel';
    if (we === 0 || we === 6) cls += ' we';
    const label = `${st.name} ${md(date)}（${WD[we]}）${dayText(d)}${m === 'err' ? '，有問題' : m === 'warn' ? '，請確認' : ''}`;
    return `<td><button type="button" class="${cls}" data-sid="${esc(st.id)}" data-dd="${dd}" aria-label="${esc(label)}"${G.multi ? ` aria-pressed="${sel}"` : ''}${G.opt.readOnly ? ' aria-disabled="true"' : ''}>${inner}</button></td>`;
  }
  function render(){
    runChecks();
    const o = G.opt, dds = ddList(o.month), sc = $('.sg-scroll'), keepX = sc.scrollLeft, keepY = sc.scrollTop;
    const ro = !!o.readOnly;
    $('.sg-bar').innerHTML = ro ? '<span class="sg-note">只能查看</span>' : `
      <button type="button" class="sg-btn${G.multi ? ' on' : ''}" data-g="multi" aria-pressed="${G.multi}">${G.multi ? '結束多選' : '多選幾天一起設定'}</button>
      <button type="button" class="sg-btn" data-g="undo"${G.undo.length ? '' : ' disabled'}>復原</button>
      <span class="sg-note">${G.multi ? '點格子選取，選好按下面的「設定」' : '點格子設定那一天；點姓名可以整個月快速填入'}${matchMedia('(pointer:fine)').matches && !G.multi ? '；用滑鼠拖曳可以一次選好幾格' : ''}</span>`;
    if (!o.staff.length) { sc.innerHTML = '<p class="sg-empty">這個部門目前沒有員工。請人資在看板的「班表」頁匯入員工名單。</p>'; $('.sg-issues').innerHTML = ''; return; }
    const hol = new Set(o.hol || []);
    const head = dds.map(dd => {
      const date = dateOf(o.month, dd), w = wday(date);
      return `<th scope="col" class="sg-d${w === 0 || w === 6 ? ' we' : ''}${hol.has(dd) ? ' hol' : ''}"><b>${+dd}</b><i>${WD[w]}</i>${hol.has(dd) ? '<em>國定</em>' : ''}</th>`;
    }).join('');
    const rows = o.staff.map(st => {
      const r = G.checks[st.id], errs = r.issues.filter(i => i.sev === 'err').length, warns = r.issues.length - errs;
      const tgt = usesTarget(st) && o.target ? `<small>/ ${fmtH(o.target)}</small>` : '';
      const flag = errs ? `<a class="sg-flag err" href="#sg-i-${esc(st.id)}">${errs} 個問題</a>` : warns ? `<a class="sg-flag warn" href="#sg-i-${esc(st.id)}">${warns} 項確認</a>` : '<span class="sg-flag ok">符合</span>';
      const nm = `<span>${esc(st.name)}</span>${st.title || st.kind ? `<small>${esc([st.kind, st.title].filter(Boolean).join('・'))}</small>` : ''}`;
      return `<tr><th scope="row" class="sg-name">${ro ? `<div>${nm}</div>` : `<button type="button" data-qf="${esc(st.id)}" title="整個月快速填入">${nm}</button>`}</th>${dds.map(dd => cellHTML(st, dd)).join('')}
        <td class="sg-sum"><b>${fmtH(r.sum.total)}</b>${tgt}${r.sum.ot ? `<small>加班 ${fmtH(r.sum.ot)}</small>` : ''}${flag}</td></tr>`;
    }).join('');
    sc.innerHTML = `<table class="sg-t"><caption class="sr-only">${esc(o.month)} 班表</caption><thead><tr><th scope="col" class="sg-name">員工</th>${head}<th scope="col" class="sg-sum">時數</th></tr></thead><tbody>${rows}</tbody></table>`;
    sc.scrollLeft = keepX; sc.scrollTop = keepY;
    renderSelBar(); renderIssues();
  }
  function renderSelBar(){
    const b = $('.sg-selbar');
    b.hidden = !G.multi;
    if (!G.multi) return;
    b.innerHTML = `<span>已選 ${G.sel.size} 格</span><button type="button" class="sg-btn" data-g="clear"${G.sel.size ? '' : ' disabled'}>全部取消</button><button type="button" class="sg-btn primary" data-g="edit"${G.sel.size ? '' : ' disabled'}>設定選取的 ${G.sel.size} 格</button>`;
  }
  function renderIssues(){
    const list = G.opt.staff.filter(st => G.checks[st.id].issues.length);
    const errN = list.reduce((n, st) => n + G.checks[st.id].issues.filter(i => i.sev === 'err').length, 0);
    const head = errN ? `<p class="sg-ihead err">工時檢查：${errN} 個問題要修正</p>` : list.length ? '<p class="sg-ihead warn">工時檢查：沒有違規，有幾項請確認</p>' : '<p class="sg-ihead ok">工時檢查：全部符合四週變形工時規定</p>';
    $('.sg-issues').innerHTML = head + (list.length ? '<ul>' + list.map(st => `<li id="sg-i-${esc(st.id)}"><b>${esc(st.name)}</b><ul>${G.checks[st.id].issues.map(i => `<li class="${i.sev}">${i.sev === 'err' ? '✕ ' : '△ '}${esc(i.text)}</li>`).join('')}</ul></li>`).join('') + '</ul>' : '')
      + `<p class="sg-rule">規則（四週變形工時）：每 4 週正常工時不超過 ${LIMITS.cycle} 小時、例假＋休息日至少 ${LIMITS.off} 天、每 2 週至少 ${LIMITS.rest2w} 天例假；每天正常工時不超過 ${LIMITS.day} 小時、含加班不超過 ${LIMITS.dayAll} 小時。4 週週期從 ${md(isDate(G.opt.anchor) ? G.opt.anchor : DEFAULT_ANCHOR)}（${(isDate(G.opt.anchor) ? G.opt.anchor : DEFAULT_ANCHOR).slice(0, 4)} 年）起算，跨月的週期會連同上、下個月的班表一起檢查。</p>`;
  }

  /* ----- 修改 ----- */
  function apply(changes, noUndo){
    const real = [];
    for (const c of changes) {
      const before = getDay(c.sid, c.dd), v = c.v ? cleanDay(c.v) : null;
      if (JSON.stringify(before) === JSON.stringify(v)) continue;
      const days = Object.assign({}, G.opt.data[c.sid] || {});
      if (v) days[c.dd] = v; else delete days[c.dd];
      G.opt.data[c.sid] = days;
      real.push({sid:c.sid, dd:c.dd, v, before});
    }
    if (!real.length) return 0;
    if (!noUndo) { G.undo.push(real); if (G.undo.length > 30) G.undo.shift(); }
    if (G.opt.onChange) G.opt.onChange(real.map(c => ({sid:c.sid, dd:c.dd, v:c.v})));
    render();
    return real.length;
  }
  function undo(){
    const last = G.undo.pop();
    if (!last) return;
    apply(last.slice().reverse().map(c => ({sid:c.sid, dd:c.dd, v:c.before})), true);
  }

  /* ----- 編輯視窗（一天或好幾天） ----- */
  function openEditor(cells){
    if (G.opt.readOnly || !cells.length) return;
    const one = cells.length === 1 ? cells[0] : null, st = one && staffOf(one.sid);
    const cur = (one && getDay(one.sid, one.dd)) || (cells.map(c => getDay(c.sid, c.dd)).find(Boolean)) || G.last || {k:'w', b:0.5};
    const date = one && dateOf(G.opt.month, one.dd);
    const title = one ? `${esc(st ? st.name : '')} ${md(date)}（${WD[wday(date)]}）` : `設定選取的 ${cells.length} 格`;
    const chips = commonShifts(), shifts = G.opt.shifts || [], w = cur.k === 'w' ? cur : (G.last || chips[0] || shifts[0] || {});   // 不是上班的日子改成上班時，先帶最近用的班
    G.ed = {cells, k: cur.k, c: cur.k === 'w' ? cur.c || '' : w.c || ''};
    const ov = $('.sg-ov');
    ov.innerHTML = `<div class="sg-scrim" data-g="close"></div>
    <form class="sg-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-ed-t" novalidate>
      <h3 id="sg-ed-t">${title}</h3>
      <div class="sg-kinds" role="group" aria-label="這天是">${KINDS.map(([k, t]) => `<button type="button" class="sg-k k-${k}" data-k="${k}" aria-pressed="${cur.k === k}">${t}</button>`).join('')}</div>
      <div class="sg-part" data-for="w">
        ${shifts.length ? `<p class="sg-lbl" id="sg-sh-l">選班別 <span class="sg-req">必選（Apollo 班次代碼）</span></p>${shifts.length > 8 ? '<input class="sg-inp sg-shq" type="search" placeholder="找班別：代碼或名稱" aria-label="找班別" autocomplete="off">' : ''}<div class="sg-shifts${shifts.length > 8 ? ' many' : ''}" role="group" aria-labelledby="sg-sh-l">${orderShifts().map(x => `<button type="button" class="sg-chip sg-sh" data-c="${esc(x.c)}" data-s="${x.s && x.e ? x.s : ''}" data-e="${x.e}" data-b="${x.b || 0}" data-q="${esc((x.c + ' ' + x.n).toLowerCase())}" aria-pressed="false"><b>${esc(x.c)}</b>${x.n ? `<span>${esc(x.n)}</span>` : ''}${x.s && x.e ? `<small>${esc(shiftText(x))}</small>` : ''}</button>`).join('')}</div><p class="sg-lbl">上下班時間（可以調整）</p>`
          : chips.length ? `<div class="sg-chips" aria-label="常用時段">${chips.map(c => `<button type="button" class="sg-chip" data-s="${c.s}" data-e="${c.e}" data-b="${c.b}">${esc(shiftText(c))}</button>`).join('')}</div>` : ''}
        <div class="sg-row3">
          <label>上班<input class="sg-inp" name="s" inputmode="decimal" autocomplete="off" placeholder="7:00" value="${esc(tShow(w.s || ''))}"></label>
          <label>下班<input class="sg-inp" name="e" inputmode="decimal" autocomplete="off" placeholder="14:30" value="${esc(tShow(w.e || ''))}"></label>
          <label>休息（小時）<input class="sg-inp" name="b" inputmode="decimal" autocomplete="off" placeholder="0.5" value="${w.s ? fmtH(w.b || 0) : '0.5'}"></label>
        </div>
        <p class="sg-hint" data-hours></p>
        <details${cur.ot || (cur.k === 'w' && cur.lv) ? ' open' : ''}><summary>加班、補／特休時數</summary>
          <div class="sg-row3">
            <label>加班（小時）<input class="sg-inp" name="ot" inputmode="decimal" autocomplete="off" value="${cur.ot ? fmtH(cur.ot) : ''}"></label>
            <label>補／特休（小時）<input class="sg-inp" name="lvw" inputmode="decimal" autocomplete="off" value="${cur.k === 'w' && cur.lv ? fmtH(cur.lv) : ''}"></label>
            <label>假別<select class="sg-inp" name="ltw"><option value="">—</option>${LEAVES.map(l => `<option${cur.k === 'w' && cur.lt === l ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
        </details>
      </div>
      <div class="sg-part" data-for="L">
        <div class="sg-row3">
          <label>假別<select class="sg-inp" name="lt">${LEAVES.map(l => `<option${(cur.k === 'L' ? cur.lt : '特休') === l ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>時數<input class="sg-inp" name="lv" inputmode="decimal" autocomplete="off" placeholder="8" value="${cur.k === 'L' && cur.lv ? fmtH(cur.lv) : ''}"></label>
        </div>
      </div>
      <label class="sg-full">備註<input class="sg-inp" name="n" maxlength="60" autocomplete="off" value="${esc(cur.n || '')}"></label>
      <p class="sg-err" role="alert"></p>
      <div class="sg-acts">
        <button type="button" class="sg-btn" data-g="clear-cells">清除${one ? '這天' : '這些格'}</button>
        <span class="sg-sp"></span>
        <button type="button" class="sg-btn" data-g="close">取消</button>
        <button type="submit" class="sg-btn primary">套用</button>
      </div>
    </form>`;
    ov.hidden = false;
    document.documentElement.classList.add('sg-lock');
    syncEditor();
    const f = ov.querySelector(cur.k === 'w' ? '[name="s"]' : '.sg-k[aria-pressed="true"]');
    if (f) f.focus();
  }
  function edForm(){ return $('.sg-ov form'); }
  function syncEditor(){
    const f = edForm(); if (!f) return;
    f.querySelectorAll('.sg-k').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === G.ed.k)));
    f.querySelectorAll('.sg-part').forEach(p => { p.hidden = p.dataset.for !== G.ed.k; });
    const h = f.querySelector('[data-hours]');
    if (G.ed.k === 'w') {
      const fv = n => (f.querySelector(`[name="${n}"]`) || {}).value || '';
      const s = parseTime(fv('s')), e = parseTime(fv('e')), b = Number(fv('b') || 0), shifts = G.opt.shifts || [], sh = shifts.find(x => x.c === G.ed.c), parts = [];
      if (shifts.length) parts.push(sh ? `班別 ${sh.c}${sh.n ? ' ' + sh.n : ''}` : '還沒選班別');
      if (s && e && isFinite(b)) { const d = {k:'w', s, e, b}; parts.push(`工時 ${fmtH(hoursOf(d))} 小時${mins(e) <= mins(s) ? '（下班在隔天）' : ''}`); if (sh && sh.s && sh.e && !sameShift(sh, d)) parts.push('時間和班別預設不同'); }
      else parts.push('上下班可以打 7、7.5、7:30 或 0730');
      h.textContent = parts.join('・');
      f.querySelectorAll('.sg-sh').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === G.ed.c)));
    }
  }
  function readEditor(quiet){
    const f = edForm(), v = n => (f.querySelector(`[name="${n}"]`) || {}).value || '';
    const err = msg => { if (!quiet) f.querySelector('.sg-err').textContent = msg; return null; };
    const num = (n, max, label) => { const s = v(n).trim(); if (!s) return 0; const x = Number(s); if (!isFinite(x) || x < 0 || x > max) return NaN; return x; };
    const k = G.ed.k, o = {k, n: v('n')};
    if (k === 'w') {
      const s = parseTime(v('s')), e = parseTime(v('e'));
      if (!s || !e) return err(s === null || e === null ? '時間看不懂：請打 7、7.5、7:30 或 0730' : '請填上班和下班時間');
      const b = num('b', 12), ot = num('ot', 12), lv = num('lvw', 24);
      if ([b, ot, lv].some(x => isNaN(x))) return err('休息、加班、補／特休請填 0 到 12 之間的小時數（例如 0.5）');
      Object.assign(o, {s, e, b, ot, lv, lt: v('ltw')});
      o.c = shiftCode(G.opt.shifts, o, G.ed.c);
      if ((G.opt.shifts || []).length && !o.c) return err('請選班別（匯入 Apollo 需要班次代碼）');
      if (hoursOf(o) <= 0) return err('工時算出來是 0：請檢查上下班時間和休息時數');
    } else if (k === 'L') {
      const lv = num('lv', 24);
      if (isNaN(lv)) return err('請假時數請填 0 到 24 之間的數字');
      Object.assign(o, {lv, lt: v('lt')});
    }
    return cleanDay(o);
  }
  function closeEditor(){
    const ov = $('.sg-ov');
    if (ov.hidden) return;
    ov.hidden = true; ov.innerHTML = '';
    document.documentElement.classList.remove('sg-lock');
    const c = G.ed && G.ed.cells[0];
    G.ed = null;
    if (c) { const b = root.querySelector(`.sg-c[data-sid="${CSS.escape(c.sid)}"][data-dd="${c.dd}"]`); if (b) b.focus(); }
  }

  /* ----- 整月快速填入 ----- */
  function openQuickFill(sid){
    if (G.opt.readOnly) return;
    const shifts = G.opt.shifts || [], st = staffOf(sid), last = G.last && G.last.c ? G.last : null;
    const baseCode = last ? last.c : shifts.length ? (orderShifts()[0] || {}).c || '' : '';
    const base = last || (baseCode && timesFor(baseCode)) || commonShifts()[0] || G.last || {s:'07:00', e:'15:30', b:0.5};
    const hol = (G.opt.hol || []).length;
    G.ed = {qf: sid, cells: []};
    const ov = $('.sg-ov');
    ov.innerHTML = `<div class="sg-scrim" data-g="close"></div>
    <form class="sg-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-qf-t" novalidate data-qf="1">
      <h3 id="sg-qf-t">整個月快速填入：${esc(st.name)}</h3>
      <p class="sg-hint">先把整個月填好，再點個別日子修改。</p>
      ${shifts.length ? `<label class="sg-full">班別（必選，Apollo 班次代碼）<select class="sg-inp" name="sh"><option value="">請選班別</option>${orderShifts().map(x => `<option value="${esc(x.c)}"${baseCode === x.c ? ' selected' : ''}>${shLabel(x)}</option>`).join('')}</select></label>` : ''}
      <fieldset class="sg-wds"><legend>上班的日子</legend>${[1,2,3,4,5,6,0].map(w => `<label><input type="checkbox" name="wd" value="${w}"${w >= 1 && w <= 5 ? ' checked' : ''}>週${WD[w]}</label>`).join('')}</fieldset>
      <div class="sg-row3">
        <label>上班<input class="sg-inp" name="s" inputmode="decimal" autocomplete="off" value="${esc(tShow(base.s))}"></label>
        <label>下班<input class="sg-inp" name="e" inputmode="decimal" autocomplete="off" value="${esc(tShow(base.e))}"></label>
        <label>休息（小時）<input class="sg-inp" name="b" inputmode="decimal" autocomplete="off" value="${fmtH(base.b || 0)}"></label>
      </div>
      <div class="sg-row3">
        <label>例假<select class="sg-inp" name="r">${[6,0,1,2,3,4,5].map(w => `<option value="${w}"${w === 6 ? ' selected' : ''}>週${WD[w]}</option>`).join('')}</select></label>
        <label>休息日<select class="sg-inp" name="x">${[0,6,1,2,3,4,5].map(w => `<option value="${w}"${w === 0 ? ' selected' : ''}>週${WD[w]}</option>`).join('')}</select></label>
      </div>
      <label class="sg-check"><input type="checkbox" name="blank" checked>只填還沒排的日子（已經排好的不動）</label>
      ${hol ? `<label class="sg-check"><input type="checkbox" name="hol" checked>人資標的國定假日（${G.opt.hol.map(d => +d).join('、')} 日）排「國定假日」</label>` : ''}
      ${G.opt.staff.length > 1 ? `<label class="sg-check"><input type="checkbox" name="all">部門所有員工都用這個班（${G.opt.staff.length} 人）</label>` : ''}
      <p class="sg-err" role="alert"></p>
      <div class="sg-acts"><span class="sg-sp"></span><button type="button" class="sg-btn" data-g="close">取消</button><button type="submit" class="sg-btn primary">填入</button></div>
    </form>`;
    ov.hidden = false;
    document.documentElement.classList.add('sg-lock');
    ov.querySelector('[name="s"]').focus();
  }
  function runQuickFill(f){
    const v = n => (f.querySelector(`[name="${n}"]`) || {}).value || '', on = n => !!(f.querySelector(`[name="${n}"]`) || {}).checked;
    const err = m => { f.querySelector('.sg-err').textContent = m; };
    const s = parseTime(v('s')), e = parseTime(v('e')), b = Number(v('b') || 0);
    const wds = [...f.querySelectorAll('[name="wd"]:checked')].map(x => +x.value), r = +v('r'), x = +v('x');
    if ((G.opt.shifts || []).length && !v('sh')) return err('請選班別（匯入 Apollo 需要班次代碼）');
    if (!s || !e) return err('請填上班和下班時間（例如 7、7.5、7:30）');
    if (!isFinite(b) || b < 0 || b > 12) return err('休息時數請填 0 到 12 之間的數字');
    if (r === x) return err('例假和休息日要排在不同天');
    if (wds.includes(r) || wds.includes(x)) return err('例假、休息日那天不能同時勾成上班日');
    const shift = cleanDay({k:'w', s, e, b, c: shiftCode(G.opt.shifts, {s, e, b}, v('sh'))});
    if (!hoursOf(shift)) return err('工時算出來是 0：請檢查上下班時間和休息時數');
    G.last = shift;
    const hol = on('hol') ? new Set(G.opt.hol || []) : new Set(), onlyBlank = on('blank');
    const who = on('all') ? G.opt.staff.map(s => s.id) : [G.ed.qf], changes = [];
    for (const sid of who) for (const dd of ddList(G.opt.month)) {
      if (onlyBlank && getDay(sid, dd)) continue;
      const w = wday(dateOf(G.opt.month, dd));
      const day = w === r ? {k:'R'} : w === x ? {k:'X'} : hol.has(dd) ? {k:'H'} : wds.includes(w) ? shift : null;
      if (day) changes.push({sid, dd, v:day});
    }
    closeEditor();
    const n = apply(changes);
    flash(n ? `已填入 ${n} 天` : '沒有要填的日子（都已經排好了）');
  }
  function flash(msg){ if (G.opt.onToast) G.opt.onToast(msg); }

  /* ----- 事件 ----- */
  root.addEventListener('click', e => {
    const g = e.target.closest('[data-g]');
    if (g) {
      const act = g.dataset.g;
      if (act === 'multi') { G.multi = !G.multi; if (!G.multi) G.sel.clear(); render(); }
      else if (act === 'undo') undo();
      else if (act === 'clear') { G.sel.clear(); render(); }
      else if (act === 'edit') openEditor([...G.sel].map(k => { const i = k.lastIndexOf('|'); return {sid:k.slice(0, i), dd:k.slice(i + 1)}; }));
      else if (act === 'close') closeEditor();
      else if (act === 'clear-cells') { const cells = G.ed.cells; closeEditor(); apply(cells.map(c => ({sid:c.sid, dd:c.dd, v:null}))); if (G.multi) { G.sel.clear(); render(); } }
      return;
    }
    const k = e.target.closest('.sg-k');
    if (k) { G.ed.k = k.dataset.k; syncEditor(); return; }
    const chip = e.target.closest('.sg-chip');
    if (chip) {
      const f = edForm(), c = chip.dataset.c || '', t = chip.dataset.s ? {s:chip.dataset.s, e:chip.dataset.e, b:+chip.dataset.b || 0} : c ? timesFor(c) : null;
      if (t) { f.querySelector('[name="s"]').value = tShow(t.s); f.querySelector('[name="e"]').value = tShow(t.e); f.querySelector('[name="b"]').value = fmtH(t.b || 0); }
      if (chip.classList.contains('sg-sh')) G.ed.c = c;
      f.querySelector('.sg-err').textContent = '';
      syncEditor();
      if (!t) { const i = f.querySelector('[name="s"]'); if (i && !i.value) i.focus(); }
      return;
    }
    const qf = e.target.closest('[data-qf]');
    if (qf && qf.tagName === 'BUTTON') { openQuickFill(qf.dataset.qf); return; }
    const c = e.target.closest('.sg-c');
    if (c && !G.opt.readOnly) {
      if (G.dragged) { G.dragged = false; return; }   // 拖曳選取已經處理
      const key = ck(c.dataset.sid, c.dataset.dd);
      if (G.multi) { if (G.sel.has(key)) G.sel.delete(key); else G.sel.add(key); c.classList.toggle('sel'); c.setAttribute('aria-pressed', String(G.sel.has(key))); renderSelBar(); }
      else openEditor([{sid:c.dataset.sid, dd:c.dataset.dd}]);
    }
  });
  root.addEventListener('change', e => {   // 快速填入選班別 → 帶入上下班時間
    const t = e.target;
    if (t.name !== 'sh' || !t.closest('form[data-qf]')) return;
    const tm = t.value ? timesFor(t.value) : null, f = t.form;
    if (!tm) return;
    f.querySelector('[name="s"]').value = tShow(tm.s); f.querySelector('[name="e"]').value = tShow(tm.e); f.querySelector('[name="b"]').value = fmtH(tm.b || 0);
  });
  root.addEventListener('input', e => {   // 找班別
    const t = e.target;
    if (!t.classList || !t.classList.contains('sg-shq')) return;
    const q = t.value.trim().toLowerCase();
    t.form.querySelectorAll('.sg-sh').forEach(b => { b.hidden = !!q && !b.dataset.q.includes(q) && b.dataset.c !== G.ed.c; });
  });
  root.addEventListener('input', e => { if (e.target.closest('.sg-ov form:not([data-qf])') && !e.target.classList.contains('sg-shq')) { e.target.closest('form').querySelector('.sg-err').textContent = ''; syncEditor(); } });
  root.addEventListener('focusout', e => {
    const t = e.target;
    if (t.matches && t.matches('.sg-ov [name="s"], .sg-ov [name="e"]')) { const p = parseTime(t.value); if (p) t.value = tShow(p); }
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.qf) { runQuickFill(f); return; }
    const d = readEditor(false);
    if (!d) return;
    if (d.k === 'w') G.last = d;
    const cells = G.ed.cells;
    closeEditor();
    apply(cells.map(c => ({sid:c.sid, dd:c.dd, v:d})));
    if (G.multi) { G.sel.clear(); render(); }
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('.sg-ov').hidden) { e.preventDefault(); closeEditor(); return; }
    if (e.key === 'Tab' && !$('.sg-ov').hidden) {   // 編輯視窗開著時，Tab 只在視窗裡面轉
      const els = [...$('.sg-ov').querySelectorAll('button, input, select, summary')].filter(x => x.offsetParent !== null && !x.disabled);
      if (!els.length) return;
      const i = els.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
    }
  });
  // 滑鼠拖曳：一次選好幾格（觸控用「多選」按鈕）
  root.addEventListener('pointerdown', e => {
    const c = e.target.closest('.sg-c');
    if (!c || e.pointerType !== 'mouse' || e.button !== 0 || G.opt.readOnly) return;
    G.drag = {sid:c.dataset.sid, dd:c.dataset.dd, cur:null};
  });
  root.addEventListener('pointerover', e => {
    if (!G.drag) return;
    const c = e.target.closest('.sg-c');
    if (!c) return;
    G.drag.cur = {sid:c.dataset.sid, dd:c.dataset.dd};
    const cells = dragCells();
    root.querySelectorAll('.sg-c.drag').forEach(x => x.classList.remove('drag'));
    if (cells.length > 1) cells.forEach(k => { const b = root.querySelector(`.sg-c[data-sid="${CSS.escape(k.sid)}"][data-dd="${k.dd}"]`); if (b) b.classList.add('drag'); });
  });
  function dragCells(){
    const d = G.drag; if (!d || !d.cur) return [];
    const ids = G.opt.staff.map(s => s.id), r0 = ids.indexOf(d.sid), r1 = ids.indexOf(d.cur.sid);
    const out = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let x = Math.min(+d.dd, +d.cur.dd); x <= Math.max(+d.dd, +d.cur.dd); x++) out.push({sid:ids[r], dd:pad(x)});
    return out;
  }
  window.addEventListener('pointerup', () => {
    if (!G.drag) return;
    const cells = dragCells();
    G.drag = null;
    root.querySelectorAll('.sg-c.drag').forEach(x => x.classList.remove('drag'));
    if (cells.length > 1) { G.dragged = true; setTimeout(() => { G.dragged = false; }, 0); openEditor(cells); }
  });

  G.set = o => { Object.assign(G.opt, o); if (!G.ed) render(); };
  G.render = render;
  G.editing = () => !!G.ed;
  G.issues = () => G.checks;
  render();
  return G;
}

window.SchedCore = {
  pad, esc, KINDS, KIND_LABEL, LEAVES, WD, DEFAULT_ANCHOR, LIMITS,
  isMonth, isDate, daysIn, dateOf, wday, addDays, diffDays, shiftMonth, md, ddList,
  parseTime, tShow, fmtH, cleanDay, cleanDays, hoursOf, spanMins, shiftText, dayText, checkStaff, usesTarget, Grid,
  cleanCode, cleanShifts, shiftsFor, shiftCode, sameShift, APOLLO_HEAD, APOLLO_STATUS, APOLLO_DEF, apolloRows
};
})();

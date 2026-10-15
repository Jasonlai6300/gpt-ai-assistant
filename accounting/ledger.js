import pg from 'pg';
export const HELP = '📒 個人記帳（新臺幣）\n支出 午餐 120\n收入 薪水 50000\n支出 交通 80 2026-10-15\n本月｜明細｜刪除 123｜我的ID\n明細顯示最近20筆，CSV由主機管理者匯出。';
export function taipeiDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function money(cents) {
  const n = BigInt(cents); const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${(abs / 100n).toLocaleString('en-US')}.${String(abs % 100n).padStart(2,'0')}`;
}
export function parse(text, now = new Date()) {
  if (text === '本月') return {type:'summary', month:taipeiDay(now).slice(0,7)};
  if (text === '明細') return {type:'list'};
  const del = /^刪除\s+#?(\d{1,15})$/.exec(text);
  if (del) return {type:'delete', id:del[1]};
  const m = /^(收入|支出)\s+([^\r\n]{1,80}?)\s+(\d{1,9}(?:\.\d{1,2})?)(?:\s+(\d{4}-\d{2}-\d{2}))?$/.exec(text);
  if (!m) return {type:'help'};
  const [,kind,note,amount,date] = m;
  const day = date || taipeiDay(now);
  const d = new Date(day+'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==day || day<'1900-01-01') return {type:'error',text:'日期不正確，請用 YYYY-MM-DD（1900年起）。'};
  const [whole,frac=''] = amount.split('.');
  const cents = BigInt(whole)*100n + BigInt(frac.padEnd(2,'0'));
  if (cents <= 0n) return {type:'error',text:'金額必須大於 0。'};
  return {type:'add',kind,note:note.trim(),cents:String(cents),day};
}
let pool;
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL is missing');
    // Neon requires TLS. Strip URL SSL overrides so certificate validation remains enabled.
    const url = new URL(connectionString);
    for (const k of ['sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(k);
    pool = new pg.Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,statement_timeout:10000});
    pool.on('error',()=>console.error('Database connection error'));
  }
  return pool;
}
export async function ensureSchema(client) {
  // Serialize initialization across serverless instances; no destructive migrations.
  await client.query('SELECT pg_advisory_xact_lock(71739001)');
  await client.query(`CREATE TABLE IF NOT EXISTS personal_entries (
    id BIGSERIAL PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('收入','支出')),
    note TEXT NOT NULL, cents BIGINT NOT NULL CHECK(cents>0), day DATE NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS personal_entries_user_day ON personal_entries(uid,day)`);
  await client.query(`CREATE TABLE IF NOT EXISTS personal_events (
    eid TEXT PRIMARY KEY, uid TEXT NOT NULL, response TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
export async function runCommand(c,uid,cmd) {
  if(cmd.type==='help') return HELP;
  if(cmd.type==='error') return cmd.text;
  if(cmd.type==='add') {
    const {rows} = await c.query('INSERT INTO personal_entries(uid,kind,note,cents,day) VALUES($1,$2,$3,$4,$5) RETURNING id',[uid,cmd.kind,cmd.note,cmd.cents,cmd.day]);
    return `✅ 已記錄 #${rows[0].id}\n${cmd.day} ${cmd.kind}\n${cmd.note}：${money(cmd.cents)} 元`;
  }
  if(cmd.type==='delete') {
    const r = await c.query('UPDATE personal_entries SET deleted=TRUE WHERE id=$1 AND uid=$2 AND NOT deleted RETURNING id',[cmd.id,uid]);
    return r.rowCount ? `已刪除 #${cmd.id}。` : '找不到你的這筆紀錄。';
  }
  if(cmd.type==='list') {
    const {rows} = await c.query("SELECT id,to_char(day,'YYYY-MM-DD') AS day,kind,note,cents FROM personal_entries WHERE uid=$1 AND NOT deleted ORDER BY id DESC LIMIT 20",[uid]);
    return rows.map(r=>`#${r.id} ${r.day} ${r.kind} ${r.note} ${money(r.cents)}`).join('\n') || '目前沒有紀錄。';
  }
  const {rows} = await c.query("SELECT kind,SUM(cents)::text total FROM personal_entries WHERE uid=$1 AND NOT deleted AND day >= $2::date AND day < ($2::date + INTERVAL '1 month') GROUP BY kind",[uid,cmd.month+'-01']);
  const totals = Object.fromEntries(rows.map(r=>[r.kind,BigInt(r.total)]));
  const income=totals['收入']||0n, expense=totals['支出']||0n;
  return `📊 ${cmd.month}\n收入：${money(income)}\n支出：${money(expense)}\n收支差額：${money(income-expense)} 元`;
}
export async function processEvent(eid,uid,text,p=getPool()) {
  const c=await p.connect();
  try {
    await c.query('BEGIN');
    await ensureSchema(c);
    const {rows} = await c.query('SELECT uid,response FROM personal_events WHERE eid=$1',[eid]);
    if(rows.length && rows[0].uid!==uid) throw new Error('Event identity mismatch');
    const response=rows.length ? rows[0].response : await runCommand(c,uid,parse(text));
    if(!rows.length) await c.query('INSERT INTO personal_events(eid,uid,response) VALUES($1,$2,$3)',[eid,uid,response]);
    await c.query('COMMIT');
    return response;
  } catch(e) {
    await c.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {c.release();}
}
export function csvCell(value) {
  let text=String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}

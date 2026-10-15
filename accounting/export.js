import {writeFile} from 'node:fs/promises';
import {getPool,ensureSchema,csvCell} from './ledger.js';
const uid=process.env.OWNER_LINE_USER_ID;
if(!uid) throw new Error('Set OWNER_LINE_USER_ID');
const p=getPool(), c=await p.connect();
try {
  await c.query('BEGIN');
  await ensureSchema(c);
  const {rows}=await c.query("SELECT id,to_char(day,'YYYY-MM-DD') day,kind,note,cents FROM personal_entries WHERE uid=$1 AND NOT deleted ORDER BY day,id",[uid]);
  const out=[['編號','日期','收支','項目','金額'],...rows.map(r=>[r.id,r.day,r.kind,r.note,`${BigInt(r.cents)/100n}.${String(BigInt(r.cents)%100n).padStart(2,'0')}`])];
  await c.query('COMMIT');
  await writeFile(process.argv[2]||'accounting.csv','\uFEFF'+out.map(row=>row.map(csvCell).join(',')).join('\r\n'),'utf8');
  console.log(`Exported ${rows.length} entries.`);
} catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();await p.end();}

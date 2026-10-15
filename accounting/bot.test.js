import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import {parse,money,taipeiDay,csvCell,processEvent,runCommand} from './ledger.js';
import {createApp,validSignature} from '../api/index.js';

test('amount parsing is exact and invalid dates are rejected',()=>{
  assert.equal(parse('支出 午餐 120.01').cents,'12001');
  assert.equal(parse('收入 薪水 0').type,'error');
  assert.equal(parse('支出 午餐 -50').type,'help');
  assert.equal(parse('支出 午餐 50.123').type,'help');
  assert.equal(parse('支出 午餐 50 2026-02-30').type,'error');
  assert.equal(parse('支出 午餐 50 2024-02-29').type,'add');
  assert.equal(money(-12301n),'-123.01');
});
test('Taipei month boundary',()=>{
  assert.equal(taipeiDay(new Date('2026-10-31T16:00:00Z')),'2026-11-01');
  assert.equal(parse('本月',new Date('2026-10-31T15:59:59Z')).month,'2026-10');
});
test('CSV formula escaping',()=>{
  assert.equal(csvCell(' =1+2'),'"\' =1+2"');
  assert.equal(csvCell('便當"店'),'"便當""店"');
});
test('signature uses exact bytes',()=>{
  const raw=Buffer.from('{"events":[]}');
  const sig=createHmac('sha256','s').update(raw).digest('base64');
  assert.ok(validSignature(raw,sig,'s'));
  assert.ok(!validSignature(Buffer.from('{ "events":[]}'),sig,'s'));
  assert.ok(!validSignature(raw,'short','s'));
});
test('replayed event returns saved result without adding another entry',async()=>{
  const queries=[];let released=false;
  const c={query:async(q)=>{queries.push(q);return {rows:q.startsWith('SELECT uid,response')?[{uid:'u',response:'saved'}]:[]};},release:()=>{released=true;}};
  assert.equal(await processEvent('evt','u','支出 午餐 50',{connect:async()=>c}),'saved');
  assert.equal(queries.filter(q=>q.startsWith('INSERT')).length,0);
  assert.ok(queries.includes('COMMIT'));assert.ok(released);
});
test('database errors roll back and release connection',async()=>{
  const queries=[];let released=false;
  const c={query:async(q)=>{queries.push(q);if(q.startsWith('CREATE')) throw Error('failure');return {rows:[]};},release:()=>{released=true;}};
  await assert.rejects(processEvent('e','u','本月',{connect:async()=>c}));
  assert.ok(queries.includes('ROLLBACK'));assert.ok(released);
});
test('deletion and totals are scoped to sender; summary uses integer cents',async()=>{
  const calls=[];
  const c={query:async(q,params)=>{calls.push({q,params});return {rows:[{kind:'收入',total:'10000'},{kind:'支出',total:'1250'}],rowCount:0};}};
  assert.equal(await runCommand(c,'owner',{type:'delete',id:'7'}),'找不到你的這筆紀錄。');
  assert.deepEqual(calls[0].params,['7','owner']);
  assert.ok(calls[0].q.includes('uid=$2'));
  assert.match(await runCommand(c,'owner',{type:'summary',month:'2026-10'}),/87.50/);
  assert.deepEqual(calls[1].params,['owner','2026-10-01']);
});
test('webhook rejects forgery, keeps ledger closed before owner setup, ignores groups',async()=>{
  process.env.LINE_CHANNEL_SECRET='test';process.env.LINE_CHANNEL_ACCESS_TOKEN='dummy';delete process.env.OWNER_LINE_USER_ID;
  let writes=0;const sent=[];
  const app=createApp({process:async()=>{writes++;return 'saved';},send:async(t,s)=>sent.push(s)});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/webhook`;
  const event={type:'message',webhookEventId:'e',replyToken:'r',source:{type:'user',userId:'u'},message:{type:'text',text:'支出 午餐 50'}};
  async function post(events,forged=false){const body=JSON.stringify({events});const signature=forged?'bad':createHmac('sha256','test').update(body).digest('base64');return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Line-Signature':signature},body});}
  try {
    assert.equal((await post([event],true)).status,403);assert.equal(writes,0);
    assert.equal((await post([])).status,200);
    await post([event]);assert.equal(writes,0);assert.match(sent[0],/尚未設定/);
    await post([{...event,message:{type:'text',text:'我的ID'}}]);assert.match(sent[1],/u/);
    process.env.OWNER_LINE_USER_ID='owner';await post([event]);assert.equal(writes,0);
    process.env.OWNER_LINE_USER_ID='u';await post([{...event,source:{type:'group',userId:'u'}}]);assert.equal(writes,0);
    await post([event]);assert.equal(writes,1);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

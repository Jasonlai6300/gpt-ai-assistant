import express from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {processEvent} from '../accounting/ledger.js';

export function validSignature(raw,signature,secret) {
  if(!secret || typeof signature!=='string' || !Buffer.isBuffer(raw)) return false;
  const expected=Buffer.from(createHmac('sha256',secret).update(raw).digest('base64'));
  const actual=Buffer.from(signature);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export async function reply(token,text) {
  const r=await fetch('https://api.line.me/v2/bot/message/reply',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`},
    body:JSON.stringify({replyToken:token,messages:[{type:'text',text}]}),signal:AbortSignal.timeout(8000)
  });
  if(!r.ok) throw new Error('LINE reply rejected');
}
export function createApp({process=processEvent,send=reply}={}) {
  const app=express();
  app.disable('x-powered-by');
  app.get(['/', '/health'],(req,res)=>res.json({status:'ok',app:'personal-line-accounting',version:'1.0.0'}));
  app.post('/webhook',express.raw({type:'*/*',limit:'1mb'}),async(req,res)=>{
    if(!globalThis.process.env.LINE_CHANNEL_SECRET || !globalThis.process.env.LINE_CHANNEL_ACCESS_TOKEN) return res.sendStatus(503);
    if(!validSignature(req.body,req.get('x-line-signature'),globalThis.process.env.LINE_CHANNEL_SECRET)) return res.sendStatus(403);
    let payload;
    try {payload=JSON.parse(req.body.toString('utf8'));} catch {return res.sendStatus(400);}
    if(!Array.isArray(payload?.events)) return res.sendStatus(400);
    try {
      for(const e of payload.events) {
        if(e?.type!=='message' || e.source?.type!=='user' || e.message?.type!=='text') continue;
        const uid=e.source.userId;
        if(typeof uid!=='string' || typeof e.webhookEventId!=='string' || !e.replyToken || typeof e.message.text!=='string') continue;
        const text=e.message.text.trim();
        const owner=(globalThis.process.env.OWNER_LINE_USER_ID||'').trim();
        // Bootstrap only returns the sender's own ID; it never opens access to a ledger.
        if(text==='我的ID') {await send(e.replyToken,`你的 LINE user ID：\n${uid}`);continue;}
        if(!owner) {await send(e.replyToken,'尚未設定帳本主人。請傳「我的ID」，將回傳ID填入 Vercel 的 OWNER_LINE_USER_ID 後重新部署。');continue;}
        if(uid!==owner) continue;
        const response=await process(e.webhookEventId,uid,text);
        await send(e.replyToken,response);
      }
      return res.sendStatus(200);
    } catch {
      console.error('Webhook processing or reply failed; inspect configuration and use 明細 before resending a transaction.');
      return res.sendStatus(502);
    }
  });
  app.use((err,req,res,next)=>res.sendStatus(err.status===413?413:500));
  return app;
}
const app=createApp();
if(!process.env.VERCEL && process.argv[1]?.endsWith('/api/index.js')) app.listen(Number(process.env.PORT||3000));
export default app;

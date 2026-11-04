import express from 'express';
import type {Request,Response,NextFunction} from 'express';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Id,StartReceptionRun,PrepareReceptionPayment,CreateReceptionPaymentOrder,CaptureReceptionPayment,RefundReceptionPayment,TraceViewerFilters,TraceViewerEventQuery} from '@ally-ahead/contracts';
import {Database,type Transaction} from '../infrastructure/database.js';
import {AppError} from '../infrastructure/errors.js';
import {assertSafeText} from '../modules/agent/entry-codec.js';
import {initializeAgentModel} from '../modules/agent/model-factory.js';
import {loadReceptionPaymentConfig} from '../modules/reception-payments/reception-payments.config.js';
import {PayPalSandboxClient,type SandboxPaymentPort} from '../modules/reception-payments/paypal-sandbox.client.js';
import {ReceptionPaymentsService} from '../modules/reception-payments/reception-payments.service.js';
import {PaymentStore,paymentDocuments,lockSession,run} from './store.js';
import {Runner,type Agent} from './runner.js';
import {Documents} from './documents.js';
import type {Config} from './config.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export interface TestBindings {purpose:'synthetic-local-test';onError?:(error:unknown)=>void;agent?:Agent;paypal?:SandboxPaymentPort}
export async function createApp(cfg:Config,bindings?:TestBindings){
 if(bindings&&bindings.purpose!=='synthetic-local-test')throw Error('INVALID_TEST_BINDINGS');
 const db=new Database(cfg.databaseUrl);let agent=bindings?.agent;
 if(cfg.mode==='live'){const m=await initializeAgentModel(JSON.parse(await readFile(cfg.modelPath,'utf8')),cfg.apiKey);if(m.status!=='configured')throw Error('MODEL_NOT_CONFIGURED');agent=m;}
 const doc=new Documents(db,cfg.storage,agent?.documentProcessor);const runner=new Runner(db,agent,sid=>doc.reader(sid),[cfg.apiKey??'',cfg.traceToken]);
 const payConfig=bindings?.paypal?{clientId:'synthetic-test-only',secret:'synthetic-test-only'}:loadReceptionPaymentConfig();
 const payments=new ReceptionPaymentsService(new PaymentStore(),paymentDocuments,payConfig,bindings?.paypal??(payConfig?new PayPalSandboxClient(payConfig):undefined));
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin!==cfg.origin)return next(new AppError('FORBIDDEN',403));if(req.path.startsWith('/api/')&&req.path.includes('%'))return next(new AppError('NOT_FOUND',404));next();});
 app.use(express.json({limit:'300kb'}));app.use(express.raw({type:'application/octet-stream',limit:'20mb'}));
 const path='/api/v1/reception';
 async function access<T>(req:Request,fn:(tx:Transaction,sid:string)=>Promise<T>,requireCsrf=true){
 const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('poc_session='))?.slice(12)??'';
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError('UNAUTHENTICATED',401);
 return db.transaction(async tx=>{const session=(await tx.query('select * from sessions where token_hash=$1 and expires_at>now() for update',[hash(token)])).rows[0];if(!session)throw new AppError('UNAUTHENTICATED',401);
 if(requireCsrf&&!['GET','HEAD'].includes(req.method)&&!equal(String(req.headers['x-csrf-token']??''),session.csrf))throw new AppError('FORBIDDEN',403);return fn(tx,session.id);});
 }
 async function sessionView(tx:Transaction,sid:string){const s=(await tx.query('select * from sessions where id=$1',[sid])).rows[0];return {sessionId:sid,expiresAt:s.expires_at.toISOString(),csrfToken:s.csrf,configured:!!agent,run:await run(tx,sid)};}
 app.get('/api/v1/health/live',(_req,res)=>res.json({status:'ok',service:'ally-ahead-api'}));
 app.get('/api/v1/health/ready',async(_req,res)=>{await db.pool.query('select version from poc_schema where version=1');res.json({status:'ready',service:'ally-ahead-api'});});
 app.post(path+'/session',async(req,res)=>{
 let existing:unknown;try{existing=await access(req,(tx,sid)=>sessionView(tx,sid),false);}catch(e){if(!(e instanceof AppError&&e.status===401))throw e;}
 if(existing)return res.json(existing);
 const token=randomBytes(32).toString('base64url'),sid=randomUUID(),csrf=randomBytes(32).toString('base64url');
 const value=await db.transaction(async tx=>{await tx.query('insert into sessions(id,token_hash,csrf,expires_at) values($1,$2,$3,$4)',[sid,hash(token),csrf,new Date(Date.now()+cfg.ttl*3600000)]);return sessionView(tx,sid);});
 res.cookie('poc_session',token,{httpOnly:true,secure:cfg.secure,sameSite:'strict',path:'/',maxAge:cfg.ttl*3600000});res.json(value);
 });
 app.get(path+'/session',async(req,res)=>res.json(await access(req,(tx,sid)=>sessionView(tx,sid))));
 app.post(path+'/messages',async(req,res)=>{const input=StartReceptionRun.parse(req.body);assertSafeText(input.body);if(!agent)throw new AppError('NOT_READY',503);
 const receipt=await access(req,async(tx,sid)=>{const old=(await tx.query('select * from runs where session_id=$1 and client_key=$2',[sid,input.clientMessageKey])).rows[0];if(old){if(old.input_text!==input.body)throw new AppError('CONFLICT',409);return {runId:old.id,inputMessageId:old.input_id,state:old.state,sid,start:false};}
 if((await tx.query("select id from runs where session_id=$1 and state in ('pending','running')",[sid])).rowCount)throw new AppError('CONFLICT',409);
 const count=(await tx.query('select count(*)::int as n from native_entries where session_id=$1',[sid])).rows[0].n;if(count>950)throw new AppError('RATE_LIMITED',429);
 const id=randomUUID(),mid=randomUUID(),at=new Date();await tx.query("insert into runs(id,session_id,input_id,client_key,input_text,input_at,state) values($1,$2,$3,$4,$5,$6,'pending')",[id,sid,mid,input.clientMessageKey,input.body,at]);await tx.query("insert into messages(id,session_id,run_id,author,text,message_key) values($1,$2,$3,'user',$4,$5)",[mid,sid,id,input.body,mid]);return {runId:id,inputMessageId:mid,state:'pending',sid,start:true};});
 res.json({runId:receipt.runId,inputMessageId:receipt.inputMessageId,state:receipt.state});if(receipt.start)void runner.execute(receipt.sid,receipt.runId);
 });
 app.get(path+'/runs/:id',async(req,res)=>res.json(await access(req,(tx,sid)=>run(tx,sid,Id.parse(req.params.id)))));
 app.get(path+'/runs/:id/events',async(req,res)=>{const id=Id.parse(req.params.id);let last=-1;const read=()=>access(req,(tx,sid)=>run(tx,sid,id));await read();res.set({'Content-Type':'text/event-stream','Connection':'keep-alive'});res.flushHeaders();let closed=false;res.on('close',()=>closed=true);
 while(!closed){const view=await read();if(view&&view.revision!==last){last=view.revision;res.write(`id: ${last}\nevent: snapshot\ndata: ${JSON.stringify(view)}\n\n`);}if(view&&['done','failed','cancelled'].includes(view.state))break;await new Promise(r=>setTimeout(r,500));}res.end();});
 app.post(path+'/runs/:id/stop',async(req,res)=>{const id=Id.parse(req.params.id);const v=await access(req,async(tx,sid)=>{await run(tx,sid,id);await tx.query("update runs set state='cancelled',failure=null,snapshot=null,revision=revision+1 where id=$1 and state in ('pending','running')",[id]);return run(tx,sid,id);});runner.stop(id);res.json(v);});
 app.post(path+'/clear',async(req,res)=>{
 const cleared=await access(req,async(tx,sid)=>{
  if((await tx.query('select id from payments where session_id=$1',[sid])).rowCount)throw new AppError('CONFLICT',409);
  const active=(await tx.query("select id from runs where session_id=$1 and state in ('pending','running')",[sid])).rows;
  await tx.query('delete from trace_events where run_id in (select id from runs where session_id=$1)',[sid]);
  await tx.query('update runs set final_message_id=null where session_id=$1',[sid]);
  await tx.query('delete from native_entries where session_id=$1',[sid]);
  await tx.query('delete from messages where session_id=$1',[sid]);
  await tx.query('delete from runs where session_id=$1',[sid]);
  return {value:await sessionView(tx,sid),stopped:active.map(r=>r.id as string)};
 });
 for(const id of cleared.stopped)runner.stop(id);res.json(cleared.value);
 });
 app.get(path+'/documents',async(req,res)=>res.json(await access(req,(tx,sid)=>doc.list(tx,sid))));
 app.post(path+'/documents',async(req,res)=>res.json(await access(req,(tx,sid)=>doc.reserve(tx,sid,req.body))));
 app.put(path+'/documents/:id/content',async(req,res)=>{const id=Id.parse(req.params.id);if(!Buffer.isBuffer(req.body))throw new AppError('VALIDATION_FAILED',422);const value=await access(req,(tx,sid)=>doc.content(tx,sid,id,req.body));res.json(value);void doc.process(value.sessionId,id);});
 app.post(path+'/documents/:id/retry',async(req,res)=>{const id=Id.parse(req.params.id);const value=await access(req,async(tx,sid)=>{const row=await doc.row(tx,sid,id);if(!['failed','outcome_unknown'].includes(row.state)||!row.stored_bytes||doc.active.has(id))throw new AppError('CONFLICT',409);await tx.query("update documents set state='queued' where id=$1",[id]);return doc.view(tx,sid,id);});res.json(value);void doc.process(value.sessionId,id);});
 app.post(path+'/documents/:id/supplements',async(req,res)=>res.json(await access(req,(tx,sid)=>doc.supplement(tx,sid,Id.parse(req.params.id),req.body))));
 app.get(path+'/documents/:id/original',async(req,res)=>{const id=Id.parse(req.params.id);await access(req,async(tx,sid)=>{const r=await doc.row(tx,sid,id);if(!r.stored_bytes)throw new AppError('NOT_FOUND',404);});res.set({'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="original"'});res.send(await readFile(doc.path(id)));});
 app.get(path+'/documents/:id/markdown',async(req,res)=>{const id=Id.parse(req.params.id),source=Id.parse(req.query.sourceId);const text=await access(req,async(tx,sid)=>{const r=(await tx.query('select markdown from document_sources where session_id=$1 and document_id=$2 and id=$3',[sid,id,source])).rows[0];if(!r)throw new AppError('NOT_FOUND',404);return r.markdown;});res.set({'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="extracted.md"'});res.send(text);});
 app.get(path+'/documents/:id/outline',async(req,res)=>{const sid=await access(req,async(_tx,sid)=>sid);res.json(await doc.reader(sid).outline(Id.parse(req.params.id),undefined,z.coerce.number().int().min(0).max(100000).parse(req.query.offset??0)));});
 const paymentAccess=(req:Request)=><T>(fn:(tx:Transaction,sid:string)=>Promise<T>)=>access(req,fn);
 app.get(path+'/poc-payments/terms',async(req,res)=>res.json(await access(req,async()=>payments.terms())));
 app.post(path+'/poc-payments/prepare',async(req,res)=>res.json(await payments.prepare(paymentAccess(req),PrepareReceptionPayment.parse(req.body))));
 app.get(path+'/poc-payments/:id',async(req,res)=>res.json(await payments.read(paymentAccess(req),Id.parse(req.params.id))));
 app.post(path+'/poc-payments/:id/orders',async(req,res)=>res.json(await payments.create(paymentAccess(req),Id.parse(req.params.id),CreateReceptionPaymentOrder.parse(req.body))));
 app.post(path+'/poc-payments/:id/capture',async(req,res)=>res.json(await payments.capture(paymentAccess(req),Id.parse(req.params.id),CaptureReceptionPayment.parse(req.body).orderId)));
 app.post(path+'/poc-payments/:id/refund',async(req,res)=>res.json(await payments.refund(paymentAccess(req),Id.parse(req.params.id),RefundReceptionPayment.parse(req.body).confirmedFullRefund)));
 const ops='/api/v1/ops/consultations';app.use(ops,(req,_res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,'')??'';if(!cfg.traceToken||!equal(token,cfg.traceToken))return next(new AppError('UNAUTHENTICATED',401));if(req.method!=='GET'&&req.method!=='HEAD')return next(new AppError('NOT_FOUND',404));next();});
 const cursor=(raw:string|undefined)=>{if(!raw)return 0;const n=Number(Buffer.from(raw,'base64url').toString());if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new AppError('VALIDATION_FAILED',422);return n;};
 const page=<T>(rows:T[],limit:number,offset:number)=>({items:rows.slice(0,limit),nextCursor:rows.length>limit?Buffer.from(String(offset+limit)).toString('base64url'):null});
 app.get(ops+'/sessions',async(req,res)=>{const f=TraceViewerFilters.parse(req.query),off=cursor(f.cursor);const rows=(await db.pool.query(`select session_id as "sessionId",max(created_at) as "lastRunAt",count(*)::int as "runCount" from runs where ($1::timestamptz is null or created_at>=$1) and ($2::timestamptz is null or created_at<=$2) and ($3::text is null or state=$3) and ($4::uuid is null or session_id=$4) and ($5::uuid is null or id=$5) group by session_id order by max(created_at) desc,session_id limit $6 offset $7`,[f.from??null,f.to??null,f.state??null,f.sessionId??null,f.runId??null,f.limit+1,off])).rows;res.json(page(rows,f.limit,off));});
 app.get(ops+'/sessions/:id/runs',async(req,res)=>{const sid=Id.parse(req.params.id),f=TraceViewerFilters.parse(req.query),off=cursor(f.cursor);const rows=(await db.pool.query(`select r.id as "runId",r.session_id as "sessionId",r.input_id as "inputMessageId",r.created_at as "createdAt",r.state,coalesce((select max(sequence) from trace_events where run_id=r.id),0)::int as "lastSequence" from runs r where session_id=$1 and ($2::text is null or state=$2) and ($3::timestamptz is null or created_at>=$3) and ($4::timestamptz is null or created_at<=$4) and ($5::uuid is null or id=$5) order by created_at desc,id limit $6 offset $7`,[sid,f.state??null,f.from??null,f.to??null,f.runId??null,f.limit+1,off])).rows;res.json(page(rows,f.limit,off));});
 const eventColumns='id as "eventId",run_id as "runId",sequence::int,at,recorded_at as "recordedAt",type';
 app.get(ops+'/runs/:id/events',async(req,res)=>{const id=Id.parse(req.params.id),f=TraceViewerEventQuery.parse(req.query),off=cursor(f.cursor);const rows=(await db.pool.query(`select ${eventColumns} from trace_events where run_id=$1 order by sequence limit $2 offset $3`,[id,f.limit+1,off])).rows;res.json(page(rows,f.limit,off));});
 app.get(ops+'/runs/:id/events/:event',async(req,res)=>{const row=(await db.pool.query(`select ${eventColumns},data from trace_events where run_id=$1 and id=$2`,[Id.parse(req.params.id),Id.parse(req.params.event)])).rows[0];if(!row)throw new AppError('NOT_FOUND',404);res.json(row);});
 app.use('/api',(_req,_res,next)=>next(new AppError('NOT_FOUND',404)));
 const web=resolve('apps/web/dist');app.use(express.static(web,{index:false}));
 app.get(['/', '/start','/reception','/ops/consultations'],(_req,res)=>res.sendFile(resolve(web,'index.html')));
 app.use((_req,_res,next)=>next(new AppError('NOT_FOUND',404)));
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{bindings?.onError?.(error);if(res.headersSent){res.end();return;}const status=error instanceof AppError?error.status:error instanceof z.ZodError?422:typeof error==='object'&&error&&'status' in error&&error.status===413?413:500;res.status(status).json({error:{code:error instanceof AppError?error.code:status===422||status===413?'VALIDATION_FAILED':'INTERNAL_ERROR',message:'Request could not be completed',requestId:randomUUID()}});});
 return {app,db,runner,doc,close:async()=>{for(const c of runner.active.values())c.abort();await db.pool.end();}};
}

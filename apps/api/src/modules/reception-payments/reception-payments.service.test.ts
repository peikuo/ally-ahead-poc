import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ReceptionPaymentsService, PAYMENT_TERMS_VERSION } from './reception-payments.service.js';
import { SandboxPaymentError, type SandboxPaymentPort } from './paypal-sandbox.client.js';
import type { Transaction } from '../../infrastructure/database.js';
import type { ReceptionPaymentAccess, ReceptionPaymentRecord, ReceptionPaymentStore } from './reception-payments.ports.js';
function fixture(){
 const sid=randomUUID(),doc=randomUUID(),records=new Map<string,ReceptionPaymentRecord>();let inside=false,captured=false,refunded=false,approved=false,loseRefund=false,pending=false;
 const calls={create:0,capture:0,refund:0};const refundKeys:string[]=[];
 const tx={} as Transaction;
 const access:ReceptionPaymentAccess=async fn=>{assert.equal(inside,false);inside=true;try{return await fn(tx,sid);}finally{inside=false;}};
 const foreign:ReceptionPaymentAccess=async fn=>fn(tx,randomUUID());
 const store:ReceptionPaymentStore={
  async lockSession(){},async byPrepareKey(_tx,s,key){return structuredClone([...records.values()].find(r=>r.sessionId===s&&r.prepareRequestKey===key));},
  async active(_tx,s){return structuredClone([...records.values()].reverse().find(r=>r.sessionId===s));},
  async get(_tx,s,id){const r=records.get(id);return r?.sessionId===s?structuredClone(r):undefined;},
  async insert(_tx,r){records.set(r.id,structuredClone(r));},async save(_tx,r,rev){assert.equal(records.get(r.id)?.revision,rev);records.set(r.id,structuredClone(r));},
 };
 const amount={currency_code:'USD',value:'500.00'};
 const api:SandboxPaymentPort={
  async create(){assert.equal(inside,false);calls.create++;return{id:'ORDER1',status:'PAYER_ACTION_REQUIRED'};},
  async order(){assert.equal(inside,false);return{id:'ORDER1',status:captured?'COMPLETED':approved?'APPROVED':'PAYER_ACTION_REQUIRED',purchase_units:[{amount,...(captured?{payments:{captures:[{id:'CAP1',status:refunded?'REFUNDED':'COMPLETED',amount}]}}:{})}]};},
  async capture(){assert.equal(inside,false);calls.capture++;captured=true;return{id:'ORDER1',status:'COMPLETED'};},
  async refund(_id,key){assert.equal(inside,false);calls.refund++;refundKeys.push(key);refunded=true;if(loseRefund){loseRefund=false;throw new SandboxPaymentError('LOST','unknown');}return{id:'REF1',status:pending?'PENDING':'COMPLETED',amount};},
  async refundStatus(){assert.equal(inside,false);return{id:'REF1',status:pending?'PENDING':'COMPLETED',amount};},
 };
 const docs={async readConfirmableDocument(_tx:Transaction,s:string,id:string){if(s!==sid||id!==doc)throw Error('not this document');return{messageId:doc,markdown:'# Needs\nUser-approved edits',kind:'requirements_document' as const,complete:true as const,confirmedByMessageId:randomUUID(),hasPendingRevision:false as const};}};
 const service=new ReceptionPaymentsService(store,docs,{clientId:'controlled-id',secret:'controlled-secret'},api);
 const input={documentMessageId:doc,confirmedMarkdown:'# Needs\nUser-approved edits',confirmedDocument:true as const,consentToSimulatedPublication:true as const,termsVersion:PAYMENT_TERMS_VERSION,requestKey:randomUUID()};
 async function prepare(){return service.prepare(access,input);}
 async function create(){const p=await prepare();return service.create(access,p.paymentId,{termsVersion:PAYMENT_TERMS_VERSION,expectedRevision:p.revision,confirmedSandboxPayment:true,requestKey:randomUUID()});}
 return{service,access,foreign,records,input,prepare,create,calls,refundKeys,approve(){approved=true;},lose(){loseRefund=true;},pending(){pending=true;},complete(){pending=false;},api,store,docs};
}
test('document consent creates no provider transaction, binds exact snapshot and request replay',async()=>{
 const f=fixture(),p=await f.prepare();assert.equal(p.state,'awaiting_payment_consent');assert.equal(f.calls.create,0);
 assert.equal((await f.prepare()).paymentId,p.paymentId);
 await assert.rejects(f.service.prepare(f.access,{...f.input,confirmedMarkdown:'changed without renewed request'}));
 await assert.rejects(f.service.prepare(f.access,{...f.input,documentMessageId:randomUUID()}));
 await assert.rejects(f.service.prepare(f.access,{...f.input,consentToSimulatedPublication:false as unknown as true}));
});
test('create/capture uses same saved order, owns session, and NEVER auto-refunds',async()=>{
 const f=fixture(),p=await f.create();assert.equal(p.orderId,'ORDER1');assert.equal(p.simulationState,'not_published');
 await assert.rejects(f.service.capture(f.foreign,p.paymentId,'ORDER1'));
 await assert.rejects(f.service.capture(f.access,p.paymentId,'STALEORDER'));
 const notApproved=await f.service.capture(f.access,p.paymentId,'ORDER1');assert.equal(notApproved.state,'failed');assert.equal(f.calls.capture,0);
 f.approve();const paid=await f.service.capture(f.access,p.paymentId,'ORDER1');assert.equal(paid.state,'paid');assert.equal(paid.simulationState,'published_awaiting_connection');assert.equal(f.calls.refund,0);
 await f.service.capture(f.access,p.paymentId,'ORDER1');assert.equal(f.calls.capture,1);
});
test('explicit refund, pending status, same-key recovery and no duplicate refund',async()=>{
 const f=fixture(),p=await f.create();f.approve();await f.service.capture(f.access,p.paymentId,'ORDER1');
 await assert.rejects(f.service.refund(f.access,p.paymentId,false));
 f.lose();const unknown=await f.service.refund(f.access,p.paymentId,true);assert.equal(unknown.state,'unknown');assert.equal(unknown.refundId,null);
 f.pending();const pending=await f.service.refund(f.access,p.paymentId,true);assert.equal(pending.state,'refund_pending');assert.equal(f.refundKeys[0],f.refundKeys[1]);
 f.complete();const done=await f.service.read(f.access,p.paymentId);assert.equal(done.state,'refunded');assert.equal(done.simulationState,'withdrawn_refunded');
 await f.service.refund(f.access,p.paymentId,true);assert.equal(f.calls.refund,2);
});
test('unset credentials never start checkout; frozen terms and immutable doc cannot be bypassed',async()=>{
 const f=fixture();const off=new ReceptionPaymentsService(f.store,f.docs,undefined,undefined);assert.equal(off.terms().configured,false);
 const p=await off.prepare(f.access,f.input);await assert.rejects(off.create(f.access,p.paymentId,{termsVersion:PAYMENT_TERMS_VERSION,expectedRevision:p.revision,confirmedSandboxPayment:true,requestKey:randomUUID()}));
 const created=await f.create();await assert.rejects(f.service.prepare(f.access,{...f.input,requestKey:randomUUID(),confirmedMarkdown:'new document after order exists'}));assert.equal(created.terms.amount,'500.00');
});
test('persisted action reservation blocks concurrent calls and expired request windows fail closed',async()=>{
 const f=fixture(),p=await f.create();const saved=f.records.get(p.paymentId)!;
 saved.pending={action:'capture',leaseId:randomUUID(),expiresAt:Date.now()+60000};
 await assert.rejects(f.service.capture(f.access,p.paymentId,'ORDER1'));assert.equal(f.calls.capture,0);
 saved.pending=null;saved.attemptedAt.capture=Date.now()-7*3600000;
 await assert.rejects(f.service.capture(f.access,p.paymentId,'ORDER1'));assert.equal(f.calls.capture,0);
});
test('URL recovery uses owned GET; later document changes cannot hide payment or block explicit refund',async()=>{
 const f=fixture(),p=await f.create();f.approve();await f.service.capture(f.access,p.paymentId,'ORDER1');
 f.docs.readConfirmableDocument=async()=>{throw Error('document revised after payment');};
 await assert.rejects(f.service.capture(f.access,p.paymentId,'ORDER1'));
 await assert.rejects(f.service.read(f.foreign,p.paymentId));
 const recovered=await f.service.read(f.access,p.paymentId);assert.equal(recovered.state,'paid');assert.equal(f.calls.create,1);
 const refunded=await f.service.refund(f.access,p.paymentId,true);assert.equal(refunded.state,'refunded');assert.equal(f.calls.refund,1);
});
test('expired persisted create reservation becomes unknown on GET without creating replacement order',async()=>{
 const f=fixture(),p=await f.prepare(),saved=f.records.get(p.paymentId)!;
 saved.state='creating';saved.pending={action:'create',leaseId:randomUUID(),expiresAt:Date.now()-1};saved.attemptedAt.create=Date.now()-120000;
 const recovered=await f.service.read(f.access,p.paymentId);
 assert.equal(recovered.state,'unknown');assert.equal(recovered.outcome,'unknown');assert.equal(recovered.retryable,true);assert.equal(f.calls.create,0);
});

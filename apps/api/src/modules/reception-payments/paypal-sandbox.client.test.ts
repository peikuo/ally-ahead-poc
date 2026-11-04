import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exactCapture, PayPalSandboxClient, SandboxPaymentError } from './paypal-sandbox.client.js';
import { loadReceptionPaymentConfig } from './reception-payments.config.js';
test('typed Sandbox client pins host, coalesces token, checks amount and uses bounded request IDs',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const transport:typeof fetch=async(url,init={})=>{
  const target=String(url);assert.equal(new URL(target).origin,'https://api-m.sandbox.paypal.com');calls.push({url:target,init});
  if(target.endsWith('/token'))return Response.json({access_token:'controlled-unit-token',token_type:'Bearer',expires_in:3600});
  return Response.json({id:'ORDER1',status:'PAYER_ACTION_REQUIRED'});
 };
 const p=new PayPalSandboxClient({clientId:'controlled-id',secret:'controlled-secret'},transport),key=randomUUID();
 await Promise.all([p.create(key),p.create(key)]);
 assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1);
 for(const c of calls.filter(c=>!c.url.endsWith('/token'))){const b=JSON.parse(String(c.init.body));assert.deepEqual(b.purchase_units[0].amount,{currency_code:'USD',value:'500.00'});assert.equal((c.init.headers as Record<string,string>)['PayPal-Request-Id'],key);}
 assert.throws(()=>p.order('../production'));
 await assert.rejects(p.create('too-short'));
 const encoded=JSON.stringify(calls.filter(c=>!c.url.endsWith('/token')));assert.equal(encoded.includes('controlled-secret'),false);
});
test('uncertain upstream and malformed successful responses fail closed without raw error disclosure',async()=>{
 const p=new PayPalSandboxClient({clientId:'id',secret:'secret'},async()=>{throw Error('private secret');});
 await assert.rejects(p.order('ORDER1'),e=>e instanceof SandboxPaymentError&&e.outcome==='unknown'&&!e.message.includes('private'));
 const malformed=new PayPalSandboxClient({clientId:'id',secret:'secret'},async(url)=>String(url).endsWith('/token')?Response.json({access_token:'controlled-unit-token',token_type:'Bearer',expires_in:3600}):Response.json({id:'ORDER1',status:'COMPLETED',secret:'private secret'}));
 const order=await malformed.order('ORDER1');assert.throws(()=>exactCapture(order));
 assert.throws(()=>exactCapture({id:'ORDER1',status:'COMPLETED',purchase_units:[{amount:{currency_code:'EUR',value:'500.00'}}]}));
});
test('optional config is disabled when absent and incomplete config is rejected',()=>{
 assert.equal(loadReceptionPaymentConfig({}),undefined);
 assert.throws(()=>loadReceptionPaymentConfig({PAYPAL_CLIENT_ID:'id'}),/PAYPAL_CONFIG_INVALID/);
 assert.deepEqual(loadReceptionPaymentConfig({PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'controlled'}),{clientId:'id',secret:'controlled'});
});

// Explicit test injection only. Application config cannot select this provider.
import {AssistantMessageEventStream} from '../apps/api/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
const {initializeAgentModel}=await import('../apps/api/dist/src/modules/agent/model-factory.js');
export async function controlled(){
 const outputs=[],observations=[];let paid=false,refunded=false;const calls={create:0,capture:0,refund:0};
 const stream=(model,context)=>{observations.push(context);const next=outputs.shift();if(!next)throw Error('CONTROLLED_SCRIPT_EXHAUSTED');const content=typeof next==='string'?[{type:'text',text:next}]:next;
 const event=new AssistantMessageEventStream();const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:content.some(x=>x.type==='toolCall')?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
 setTimeout(()=>{event.push({type:'start',partial:message});if(typeof next==='string')event.push({type:'text_delta',contentIndex:0,delta:next,partial:message});},10);
 setTimeout(()=>{event.push({type:'done',reason:message.stopReason,message});event.end();},650);return event;
 };
 const model={provider:'poc-controlled',modelId:'synthetic-fixture',api:'openai-completions',baseUrl:'https://no-network.invalid/v1',contextWindow:128000,maxOutputTokens:8192,reasoning:false,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const agent=await initializeAgentModel({version:1,approvedModels:[model],selected:{provider:model.provider,modelId:model.modelId,api:model.api}},'synthetic-test-credential',{purpose:'controlled-test',streams:{stream,streamSimple:stream}});
 const documentProcessor={configured:()=>true,process:async input=>{await input.check();await input.saveBatch({key:'synthetic-summary',paragraphStart:1,paragraphEnd:input.paragraphs.length,title:'Synthetic invoice workflow',summary:'MOCK SUMMARY: clerk checks invoices against orders; humans review exceptions.',segments:[{paragraphStart:1,paragraphEnd:input.paragraphs.length,title:'Synthetic invoice workflow',summary:'MOCK SUMMARY: human invoice review.'}]});}};
 const amount={currency_code:'USD',value:'500.00'};
 const paypal={async create(){calls.create++;return{id:'TESTORDER1',status:'PAYER_ACTION_REQUIRED'};},async order(){return{id:'TESTORDER1',status:paid?'COMPLETED':'APPROVED',purchase_units:[{amount,...(paid?{payments:{captures:[{id:'TESTCAP1',status:refunded?'REFUNDED':'COMPLETED',amount}]}}:{})}]};},async capture(){calls.capture++;paid=true;return{id:'TESTORDER1',status:'COMPLETED'};},async refund(){calls.refund++;refunded=true;return{id:'TESTREFUND1',status:'COMPLETED',amount};},async refundStatus(){return{id:'TESTREFUND1',status:'COMPLETED',amount};}};
 return {agent:{runtime:agent.runtime,policy:agent.policy,documentProcessor},paypal,calls,outputs,observations};
}
export const say=(speech,interaction=null)=>JSON.stringify({speech,interaction});
export const document=(evidence=[])=>say('Synthetic document ready for review.',{type:'requirements_document',title:'Synthetic invoice review requirements',markdown:'# Synthetic invoice review\n\n## Goal\nHelp a clerk compare invoices with orders.\n\n## R1 — Human review\nGiven a mismatch, list the unmatched fields for a clerk. Never approve payment.\n\n## Acceptance\nGiven a sample invoice with a mismatched order number, the clerk sees the mismatch before deciding.\n\n## Unknowns\nVolumes and acceptance thresholds remain to be agreed.\n\nSynthetic fixture; no live model evaluation.',evidence});

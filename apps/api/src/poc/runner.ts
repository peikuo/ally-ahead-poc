import type {Database} from '../infrastructure/database.js';
import type {AgentRuntime} from '../modules/agent/agent.ports.js';
import type {EntryPolicy} from '../modules/agent/entry-codec.js';
import type {ReceptionDocumentReader} from '../modules/files/reception-documents.ports.js';
import {assertRunning,history,saveEntries} from './store.js';
import {sanitizeTraceData,traceFailure} from '../modules/agent/trace/agent-trace.js';
import {randomUUID} from 'node:crypto';
export interface Agent {runtime:AgentRuntime;policy:EntryPolicy;documentProcessor?:import('../modules/files/reception-documents.ports.js').ReceptionDocumentProcessor}
export class Runner {
 readonly active=new Map<string,AbortController>();
 constructor(readonly db:Database,readonly agent:Agent|undefined,readonly documentReader:(sid:string)=>ReceptionDocumentReader,readonly secrets:string[]=[]){}
 async execute(sid:string,rid:string){
 if(!this.agent)return;const c=new AbortController();this.active.set(rid,c);
 const timer=setTimeout(()=>c.abort(),125000);timer.unref();
 const trace=async(type:string,data:Record<string,unknown>)=>{const safe=sanitizeTraceData(data,this.secrets);await this.db.pool.query('insert into trace_events(id,run_id,at,type,data) values($1,$2,$3,$4,$5)',[randomUUID(),rid,new Date(),type,safe]);};
 try{
 const input=await this.db.transaction(async tx=>{await tx.query("update runs set state='running',revision=revision+1 where id=$1 and session_id=$2 and state='pending'",[rid,sid]);await assertRunning(tx,sid,rid);return(await tx.query('select * from runs where id=$1',[rid])).rows[0];});
 const check=async()=>{c.signal.throwIfAborted();await this.db.transaction(tx=>assertRunning(tx,sid,rid));};
 const h=await this.db.transaction(tx=>history(tx,sid));await trace('execution_started',{mode:'pi',inputText:input.input_text});
 await this.agent.runtime.run({demandId:sid,history:h,inputText:input.input_text,inputMessageId:input.input_id,inputCreatedAt:input.input_at.toISOString(),policy:this.agent.policy,signal:c.signal,check,trace,documents:this.documentReader(sid),
 save:entry=>this.db.transaction(async tx=>{await saveEntries(tx,sid,rid,[entry],this.agent!.policy);}),
 saveBatch:entries=>this.db.transaction(tx=>saveEntries(tx,sid,rid,entries,this.agent!.policy)),
 snapshot:async(messageKey,text)=>{if(Buffer.byteLength(text)>32000)throw Error('SNAPSHOT_LIMIT');await this.db.transaction(async tx=>{await assertRunning(tx,sid,rid);await tx.query('update runs set snapshot=$1,revision=revision+1 where id=$2',[{messageKey,text,progress:'responding'},rid]);});}});
 await this.db.transaction(async tx=>{await assertRunning(tx,sid,rid);const final=(await tx.query("select id from messages where run_id=$1 and author='assistant' and delivery='final' order by ordinal desc limit 1",[rid])).rows[0];if(!final)throw Error('RUN_INCOMPLETE');await tx.query("update runs set state='done',snapshot=null,final_message_id=$1,revision=revision+1 where id=$2",[final.id,rid]);});await trace('execution_completed',{});
 }catch(error){await this.db.pool.query("update runs set state='failed',failure='outcome_unknown',snapshot=null,revision=revision+1 where id=$1 and state in ('pending','running')",[rid]);try{await trace('execution_failed',{reason:traceFailure(error)});}catch{} }
 finally{clearTimeout(timer);this.active.delete(rid);}
 }
 stop(rid:string){this.active.get(rid)?.abort();}
}

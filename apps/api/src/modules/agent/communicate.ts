import { z } from 'zod';
import { ReceptionPresentation, ReceptionProgressNotice } from '@ally-ahead/contracts';
import type { SessionEntry, ToolDefinition } from '@earendil-works/pi-coding-agent';

// Arguments remain untrusted until the same output/evidence guards approve them.
// A rejected tool call must be storable as a hidden native call/result pair so
// Pi can correct it naturally, without manufacturing another user message.
const argumentsSchema=z.record(z.string(),z.unknown());
// Reuse the reception contract; only replace its read-only legacy/catch progress
// with the existing current-writer notice. No hand-maintained nested card schema.
export const CommunicateArguments=ReceptionPresentation.omit({progress:true}).extend({progress:ReceptionProgressNotice.optional()});
export function communicateArgumentIssue(value:unknown):string|null {
 const result=CommunicateArguments.safeParse(value);
 return result.success?null:'COMMUNICATE_ARGUMENTS_INVALID: '+result.error.issues.slice(0,6).map(issue=>`${issue.path.join('.')||'arguments'}: ${issue.message}`).join('; ');
}
// SDK argument validation can stop before execute(). Its real error result is
// retained privately as a paired error, never interpreted as a delivery receipt.
export const communicateNativeErrorPolicy=z.tuple([z.strictObject({type:z.literal('text'),text:z.string().max(240000)})]);
const delivered=z.strictObject({status:z.literal('delivered'),presentation:ReceptionPresentation});
const rejected=z.strictObject({status:z.literal('rejected'),reason:z.string().min(1).max(4000),remainingCorrections:z.number().int().min(0).max(3),expectedInteraction:z.string().max(80).nullable()});
export const CommunicationResult=z.discriminatedUnion('status',[delivered,rejected]);
export type CommunicationResult=z.infer<typeof CommunicationResult>;
export const communicatePolicy=Object.freeze({arguments:argumentsSchema,result:z.tuple([z.strictObject({type:z.literal('text'),text:z.string().max(240000)})]).superRefine((content,ctx)=>{
 try{CommunicationResult.parse(JSON.parse(content[0].text));}catch{ctx.addIssue({code:'custom',message:'Invalid communication receipt'});}
})});
export function communicatedPresentation(entry:SessionEntry):ReceptionPresentation|null {
 if(entry.type!=='message'||entry.message.role!=='toolResult'||entry.message.toolName!=='communicate'||entry.message.isError)return null;
 try{
  communicatePolicy.result.parse(entry.message.content);
  const result=CommunicationResult.parse(JSON.parse((entry.message.content[0] as {text:string}).text));
  return result.status==='delivered'?result.presentation:null;
 }catch{return null;}
}
export function createCommunicateTool(deliver:(toolCallId:string,draft:Record<string,unknown>)=>Promise<CommunicationResult>):ToolDefinition {
 return {name:'communicate',label:'阶段沟通',description:'Use only when meaningful work can continue now using information already available. Deliver one short, independently useful purpose, verified finding or result (usually 1–3 sentences), then do that work. Do not put a full answer here, repeat it in the final reply, or end by asking the user for more information. Uses the normal speech/interaction/progress format: speech is a string, interaction is an object or null, optional progress is an object and caseReferences is an array. Pass actual JSON values, never JSON-encoded strings. Not hidden reasoning, a plan or a mandatory report before each tool. A delivered receipt means the user has already seen this exact content. After delivery, reassess and continue new useful work; your final reply should only add a new result, ask the necessary user question, or briefly close by referencing the artifact, never paraphrase the delivered answer or repeat its card. Keep speech free of protocol delimiters accidentally copied into prose. Only approved receipts are published. If rejected, correct this delivery using its feedback; never release the rejected draft. When user information is needed, ask in the final reply and end the run instead. Ordinary questions may use a direct final reply without this tool.',
  parameters:z.toJSONSchema(CommunicateArguments) as ToolDefinition['parameters'],executionMode:'sequential',
  execute:async(id,raw,signal)=>{signal?.throwIfAborted();const result=await deliver(id,argumentsSchema.parse(raw));signal?.throwIfAborted();return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};},
 };
}

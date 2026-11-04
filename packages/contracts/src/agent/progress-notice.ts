import { z } from "zod";

// One actual accomplishment, created or revised in the same conversational reply.
// The id is stable when its conclusion changes. There are no predefined stages.
export const ReceptionProgressNotice = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1200),
  evidenceMessageIds: z.array(z.uuid()).min(1).max(6),
}).superRefine((value,ctx)=>{
  if(new Set(value.evidenceMessageIds).size!==value.evidenceMessageIds.length)
    ctx.addIssue({code:"custom",message:"Evidence must be unique"});
});
export type ReceptionProgressNotice = z.infer<typeof ReceptionProgressNotice>;

// Read old messages without rewriting stored conversations. No new writer uses
// these stage names or advancement events.
export const LegacyReceptionProgressNotice = z.strictObject({
  event:z.enum(["step_advanced","priority_confirmed","direction_confirmed","feasibility_reviewed","difficulty_identified","constraint_identified","next_step_confirmed","handoff_agreed","self_trial_agreed","pause_agreed","needs_recheck"]),
  evidenceMessageIds:z.array(z.uuid()).min(1).max(3),
  milestone:z.enum(["problem","direction","feasibility"]).optional(),
  change:z.enum(["advance","achieved","recheck"]).optional(),
}).superRefine((value,ctx)=>{
 if(["needs_recheck","step_advanced"].includes(value.event)!==(value.milestone!==undefined))
  ctx.addIssue({code:"custom",message:"Historical scoped notices require their milestone"});
 if(new Set(value.evidenceMessageIds).size!==value.evidenceMessageIds.length)
  ctx.addIssue({code:"custom",message:"Evidence must be unique"});
});

export function isRoutineReceptionAcknowledgement(text:string):boolean {
  return /^(?:(?:你好|您好|嗨|hello|hi|thanks|好(?:的|吧)?|嗯|行|可以|继续(?:吧)?|收到|确定|确认(?:一下)?(?:下一步|这份理解)?|我确认这份理解|下一步|知道了|明白(?:了)?|谢谢|ok(?:ay)?|yes|continue|next|confirmed|confirm(?: the)? next step|I confirm this understanding)[\s。.!！?？,，]*)+$/iu.test(text.trim());
}
export function validateReceptionProgressNotice(value:unknown,userMessageIds:ReadonlySet<string>,userTexts?:ReadonlyMap<string,string>):
 {notice:ReceptionProgressNotice|undefined;reason:string|null} {
  if(value===undefined)return {notice:undefined,reason:null};
  const parsed=ReceptionProgressNotice.safeParse(value);
  if(!parsed.success)return {notice:undefined,reason:"invalid_achievement"};
  if(!parsed.data.evidenceMessageIds.every(id=>userMessageIds.has(id)))
    return {notice:undefined,reason:"achievement_evidence_not_from_user"};
  if(userTexts&&!parsed.data.evidenceMessageIds.some(id=>{const text=userTexts.get(id);return text!==undefined&&text.trim().length>0&&!isRoutineReceptionAcknowledgement(text);}))
    return {notice:undefined,reason:"achievement_has_no_substantive_evidence"};
  return {notice:parsed.data,reason:null};
}

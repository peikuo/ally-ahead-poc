import { applicationSkillsPrompt } from "./native-skills.js";
import { decodeReceptionPresentation, parseReceptionSample, ReceptionSampleInput } from "@ally-ahead/contracts";
import type { StoredEntry } from "../entry-codec.js";
import { directionComparisonSkill } from "./direction-comparison.skill.js";
import { sampleRehearsalSkill } from "./sample-rehearsal.skill.js";
import { milestoneRecordingSkill } from "./milestone-recording.skill.js";
import { enterpriseDiagnosisSkill } from "./enterprise-diagnosis.skill.js";
import type { ReceptionSkillContext } from "./skill.types.js";
export const receptionSkills=Object.freeze([enterpriseDiagnosisSkill,directionComparisonSkill,sampleRehearsalSkill,milestoneRecordingSkill]);
const sampleAcknowledgement=(text:string)=>/^(?:继续|在吗|我们继续|好|好的|嗯|可以|行|继续吧|ok|okay|yes|continue)[。！!？?\s]*$/i.test(text.trim());
function sampleControl(text:string):boolean {
 return !text.includes("\n") && /(?:请先|先向我|先帮我|让我)(?:.*?)(?:明确|提供|收集)|^(?:我想)?做一次小样(?:演练)?[。！!\s]*$|^(?:取消|跳过|先不试)|(?:不方便|不想|不能).*?(?:提供|样例)/i.test(text);
}
export function prepareReceptionSkills(latestText:string,history:readonly StoredEntry[],referenceTexts:readonly string[]=[]){
 const userTexts:string[]=[];let lastPresentation=null;
 let previousSample:ReceptionSampleInput|null=null;
 for(const row of history){
  const e=row.entry as {type?:string;message?:{role?:string;content?:unknown}};
  if(e.type!=="message"||!e.message)continue;
  if(e.message.role==="user"&&typeof e.message.content==="string"){
   userTexts.push(e.message.content);
   const formatted=parseReceptionSample(e.message.content);
   if(formatted)previousSample=formatted;
   else if(sampleControl(e.message.content))previousSample=null;
   else if(!previousSample&&!sampleControl(e.message.content)&&!sampleAcknowledgement(e.message.content)&&lastPresentation?.interaction?.type==="sample_request"){
    const candidate=ReceptionSampleInput.safeParse({task:lastPresentation.interaction.task,sample:e.message.content,reference:""});
    if(candidate.success)previousSample=candidate.data;
   }
  }
  if(e.message.role==="assistant"&&Array.isArray(e.message.content)){
   const text=e.message.content.filter((c):c is {type:"text";text:string}=>typeof c==="object"&&c!==null&&c.type==="text"&&typeof c.text==="string").map(c=>c.text).join("");
   lastPresentation=decodeReceptionPresentation(text);
  }
 }
 userTexts.push(latestText);
 let sample=parseReceptionSample(latestText);
 const declined=/(?:不想|不便|不能|不方便|不愿).*?(?:提供|样例|样本|小样|演练)|(?:先不|暂不|取消|跳过|算了|不做)(?:了|吧|这个|演练|小样)?[。！!\s]*$|(?:don't|do not|can't|cannot).*?(?:provide|sample|rehears)|^(?:skip|cancel|not now)/i.test(latestText);
 const newSample=/换.*(?:样例|小样|例子)|(?:新的?|另一).*?(?:样例|小样|演练)|(?:new|another|different)\s+(?:sample|rehearsal)/i.test(latestText);
 if(!sample&&!declined&&!newSample&&!sampleControl(latestText))sample=previousSample;
 if(!sample&&!declined&&!sampleControl(latestText)&&!sampleAcknowledgement(latestText)&&lastPresentation?.interaction?.type==="sample_request"){
  const parsed=ReceptionSampleInput.safeParse({task:lastPresentation.interaction.task,sample:latestText,reference:""});
  if(parsed.success)sample=parsed.data;
 }
 const naturalSampleTexts=parseReceptionSample(latestText)||declined||newSample||sampleControl(latestText)||sampleAcknowledgement(latestText)?[]:userTexts.filter(text=>!sampleControl(text)&&!sampleAcknowledgement(text));
 const context:ReceptionSkillContext={latestText,userTexts,lastPresentation,sample,referenceTexts,naturalSampleTexts};
 // Selection belongs to the model's semantic judgment of the full conversation.
 // The regexes above only bound sample reuse, never gate capability availability.
 const instructions=applicationSkillsPrompt();
 const validate=(text:string)=>{
  const presentation=decodeReceptionPresentation(text);
  // Reject malformed skill cards rather than persist a JSON payload the UI cannot validate.
  if(!presentation){
   throw new Error("INVALID_RECEPTION_SKILL_RESULT");
  }
  directionComparisonSkill.validate(presentation,context);sampleRehearsalSkill.validate(presentation,context);
 };
 return {skills:receptionSkills,context,instructions,validate,finalize:(text:string)=>{
  try{validate(text);return {text,reason:null};}catch(error){
   // A rejected card is never released. Recover locally, without a model retry.
   const reasons:Record<string,string>={INVALID_RECEPTION_SKILL_RESULT:"invalid_skill_result",DIRECTION_BASIS_NOT_FROM_USER:"comparison_basis_rejected",REHEARSAL_INPUT_REQUIRED:"sample_input_missing",REHEARSAL_REFERENCE_REQUIRED:"sample_reference_missing",REHEARSAL_EVIDENCE_NOT_PROVIDED:"sample_evidence_rejected",ILLUSTRATIVE_REHEARSAL_CANNOT_CLAIM_EVIDENCE:"sample_evidence_rejected"};
   const reason=error instanceof Error&&Object.hasOwn(reasons,error.message)?reasons[error.message]:undefined;if(!reason)throw error;
   const comparison=reason==="comparison_basis_rejected";
   const english=!/[\u3400-\u9fff]/u.test(latestText);
   const speech=comparison?(english?"I need to check the basis for these options. Which part of the work would you most like to improve?":"这些方向的依据还需要核对。你最希望优先改善哪一段工作？"):
    context.sample?(english?"I couldn’t verify this draft against your example. Your input is preserved; we can clarify the rules or try it again.":"这份演练草稿的依据还没核对好。你提供的样例还在，我们可以先澄清处理规则，或再试一次。"):
    (english?"Please provide the example you’d like me to work on, with any relevant rules.":"请提供一条你希望处理的脱敏样例，也可以附上可用的处理规则。");
   const task=context.sample?.task??(context.lastPresentation?.interaction?.type==="sample_request"?context.lastPresentation.interaction.task:(english?"Try one text example based on our discussion":"根据当前讨论试做一条文字样例"));
   return {text:JSON.stringify({speech,interaction:comparison||context.sample?null:{type:"sample_request",title:english?"Try one example":"试做一条样例",task,prompt:english?"Provide one anonymized example and optional supporting material.":"请提供一条脱敏样例及可选参考资料。"}}),reason};
  }
 }};
}

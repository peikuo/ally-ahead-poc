import { z } from "zod";
import { RequirementsDocument, RequirementsDocumentOffer } from "./requirements-document.js";
import { DirectionComparison, SampleRequest, SampleResult } from "./reception-skills.js";
import { ReceptionProgressNotice, LegacyReceptionProgressNotice } from "./progress-notice.js";

const shortText=z.string().trim().min(1).max(600);
// Reply length is guided by the prompt; a longer answer must remain readable.
const speechText=z.string().trim().min(1);
const option=z.strictObject({id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),label:z.string().trim().min(1).max(100)});
const choices={question:shortText,options:z.array(option).min(2).max(5),allowSkip:z.boolean()};
export const ReceptionInteraction=z.discriminatedUnion("type",[
  DirectionComparison,SampleRequest,SampleResult,RequirementsDocumentOffer,RequirementsDocument,
  z.strictObject({type:z.literal("single_choice"),...choices}),
  z.strictObject({type:z.literal("multiple_choice"),...choices}),
  z.strictObject({type:z.literal("demand_review"),title:z.string().trim().min(1).max(200),
    business:shortText,problem:shortText,expectedOutcome:shortText,aiIntent:shortText,
    unknowns:z.array(shortText).max(8)}),
]).superRefine((value,ctx)=>{
 if("options" in value&&new Set(value.options.map(o=>o.id)).size!==value.options.length)
  ctx.addIssue({code:"custom",message:"Option ids must be unique"});
 if(value.type==="direction_comparison"&&(new Set(value.directions.map(d=>d.id)).size!==value.directions.length||!value.directions.some(d=>d.id===value.recommendedDirectionId)))
  ctx.addIssue({code:"custom",message:"Recommendation must identify a unique listed direction"});
 if(value.type==="sample_result"&&value.mode==="grounded"&&!value.evidence.length)
  ctx.addIssue({code:"custom",message:"Grounded rehearsal must cite provided reference text"});
});
// Transported in the existing native assistant text, preserving Pi history and message identity.
// UI treats these fields as plain text and supported components, never HTML, URLs, or actions.
export const ReceptionPresentation=z.strictObject({speech:speechText,interaction:ReceptionInteraction.nullable(),
  progress:z.union([ReceptionProgressNotice,LegacyReceptionProgressNotice]).optional().catch(undefined),
  caseReferences:z.array(z.string().regex(/^EAI-\d{3}$/)).max(2).refine(v=>new Set(v).size===v.length).optional()});
export type ReceptionPresentation=z.infer<typeof ReceptionPresentation>;
export type ReceptionInteraction=z.infer<typeof ReceptionInteraction>;
function source(text:string):string{
  const trimmed=text.trim();
  return trimmed.startsWith("```")?trimmed.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""):trimmed;
}
export function decodeReceptionPresentation(text:string):ReceptionPresentation|null{
  if(new TextEncoder().encode(text).byteLength>262144)return null;
  try{const result=ReceptionPresentation.safeParse(JSON.parse(source(text)));return result.success?result.data:null;}catch{return null;}
}
export function isReceptionPresentationText(text:string):boolean{
  const trimmed=text.trimStart();
  return trimmed.startsWith("{")||/^```(?:json)?\s*(?:\{|$)/i.test(trimmed);
}
// Old plain-text history remains readable. Malformed new replies never expose protocol JSON or read it aloud.
export function receptionReplyText(text:string):string{
  const parsed=decodeReceptionPresentation(text);
  if(parsed)return parsed.speech;
  return isReceptionPresentationText(text)?"这次回复未能完整显示，请继续告诉我你的想法。":text;
}
// Draft-only extraction; final history and speech still require the full decoder.
export { receptionStreamingText } from "./reception-streaming.js";

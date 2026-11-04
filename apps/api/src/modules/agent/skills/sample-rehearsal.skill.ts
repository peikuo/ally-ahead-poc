import type { ReceptionSkill } from "./skill.types.js";
export const sampleRehearsalSkill:ReceptionSkill={
 id:"sample-rehearsal",description:"用用户主动提供的非机密小样做文字演练，区分有资料依据和示意草稿，明确核对点。",
 validate:(presentation,context)=>{
  const result=presentation.interaction;if(result?.type!=="sample_result")return;
  const naturalSources=result.mode==="grounded"?context.naturalSampleTexts??[]:[];
  const suppliedNatural=naturalSources.some(source=>result.evidence.some(item=>source.includes(item.quote)));
  if(!context.sample&&!context.referenceTexts?.length&&!suppliedNatural)throw new Error("REHEARSAL_INPUT_REQUIRED");
  if(result.mode==="grounded"){
   if(!result.evidence.length)throw new Error("REHEARSAL_REFERENCE_REQUIRED");
   for(const item of result.evidence)if(![context.sample?.sample??"",context.sample?.reference??"",...(context.referenceTexts??[]),...(suppliedNatural?naturalSources:[])].some(source=>source.includes(item.quote)))throw new Error("REHEARSAL_EVIDENCE_NOT_PROVIDED");
  }else if(result.evidence.length)throw new Error("ILLUSTRATIVE_REHEARSAL_CANNOT_CLAIM_EVIDENCE");
 },
};

import { parseRequirementsDocumentConfirmation } from "./requirements-document.js";
import { decodeReceptionPresentation, type ReceptionInteraction } from "./presentation.js";
import { LegacyReceptionProgressNotice, validateReceptionProgressNotice, isRoutineReceptionAcknowledgement } from "./progress-notice.js";

export interface ReceptionJourneyMessage {messageId:string;messageKey:string;author:"user"|"assistant";text:string;delivery?:"intermediate"|"final"}
export interface JourneyAchievement {
  id:string; title:string; summary:string;
  sourceMessageId:string;
  // Latest and earlier output/decision messages. These are not user facts.
  sourceMessageIds?:string[];
  // Only actual user messages may be reused as evidence in a new notice.
  evidenceMessageIds:string[];
  artifact?:"comparison"|"sample"|"draft"|"selection";
}
export interface ReceptionJourney {achievements:JourneyAchievement[]}
type Direction=Extract<ReceptionInteraction,{type:"direction_comparison"}>["directions"][number];
export function formatReceptionDirectionChoice(direction:Direction,language:"zh"|"en"):string {
 return language==="zh"
  ? `我选择“${direction.title}”这个方向。先做一步：${direction.firstStep}。请按这个方向做一次小样演练，先向我收集需要的脱敏样例。`
  : `I choose “${direction.title}”. First step: ${direction.firstStep}. Let’s try a sample using this approach. Please ask for the anonymized example you need.`;
}
const unique=(ids:readonly string[])=>[...new Set(ids)];

// A projection of existing messages, shared verbatim by the model and UI. There
// is no separate plan, progress percentage, fixed phase or mutable record store.
export function deriveReceptionJourney(messages:readonly ReceptionJourneyMessage[]):ReceptionJourney {
 const achievements:JourneyAchievement[]=[],seen=new Set<string>(),userTexts=new Map<string,string>();
 const artifacts=new Map<string,string>(),artifactIdentities=new Map<string,string>(),latestArtifactSignatures=new Map<string,string>();
 let lastCard:{messageId:string;interaction:ReceptionInteraction;achievementId?:string}|undefined;
 const put=(record:JourneyAchievement,deduplicateContent=true):JourneyAchievement=>{
  let index=achievements.findIndex(a=>a.id===record.id);
  if(index<0&&deduplicateContent)index=achievements.findIndex(a=>a.title===record.title&&a.summary===record.summary);
  const previous=index<0?undefined:achievements[index];
  const artifact=record.artifact??previous?.artifact;
  const merged:JourneyAchievement={...record,id:previous?.id??record.id,
   ...(artifact?{artifact}:{}),
   evidenceMessageIds:unique([...(previous?.evidenceMessageIds??[]),...record.evidenceMessageIds]),
   sourceMessageIds:unique([...(previous?.sourceMessageIds??[]),...(previous?[previous.sourceMessageId]:[]),...(record.sourceMessageIds??[]),record.sourceMessageId])};
  if(index>=0)achievements[index]=merged;else achievements.push(merged);
  return merged;
 };
 for(const message of messages){
  if(seen.has(message.messageId))continue;seen.add(message.messageId);
  if(message.author==="user"){
   userTexts.set(message.messageId,message.text);
   if(lastCard?.interaction.type==="direction_comparison"){
    const direction=lastCard.interaction.directions.find(d=>["zh","en"].some(lang=>message.text===formatReceptionDirectionChoice(d,lang as "zh"|"en")));
    if(direction)put({id:`selection-${lastCard.achievementId??lastCard.messageId}`,title:direction.title,
     summary:message.text===formatReceptionDirectionChoice(direction,"en")?`Selected “${direction.title}” as the focus of this discussion.`:`已选择“${direction.title}”作为当前讨论的切入方向。`,artifact:"selection",sourceMessageId:message.messageId,
     sourceMessageIds:[lastCard.messageId,message.messageId],evidenceMessageIds:[message.messageId]},false);
   }
   if(lastCard?.interaction.type==="requirements_document"&&lastCard.achievementId&&parseRequirementsDocumentConfirmation(message.text)===lastCard.messageId){
    const previous=achievements.find(a=>a.id===lastCard!.achievementId);
    if(previous)put({...previous,summary:message.text.startsWith("Confirm ")?`Confirmed the requirements understanding for “${lastCard.interaction.title}” (not publication or payment).`:`已认可“${lastCard.interaction.title}”的需求理解（不代表发布或付款）。`,sourceMessageId:message.messageId,evidenceMessageIds:[message.messageId],sourceMessageIds:[lastCard.messageId,message.messageId]});
   }
   if(lastCard?.interaction.type==="demand_review"&&lastCard.achievementId&&["确认这份理解","I confirm this understanding."].includes(message.text)){
    const previous=achievements.find(a=>a.id===lastCard!.achievementId);
    if(previous)put({...previous,summary:message.text==="I confirm this understanding."?`Reviewed and confirmed the requirements understanding for “${lastCard.interaction.title}” (not submitted or published).`:`已核对并确认“${lastCard.interaction.title}”的需求理解（未提交或发布）。`,sourceMessageId:message.messageId,
     evidenceMessageIds:[message.messageId],sourceMessageIds:[lastCard.messageId,message.messageId]});
   }
   continue;
  }
  const presentation=decodeReceptionPresentation(message.text);if(!presentation)continue;
  const card=presentation.interaction;
  let achievementId:string|undefined;
  if(card?.type==="requirements_document"&&message.delivery!=="intermediate"){
   const previous=card.replacesMessageId?achievements.find(a=>a.sourceMessageIds?.includes(card.replacesMessageId!)&&a.artifact==="draft"):undefined;
   achievementId=previous?.id??`artifact-${message.messageId}`;
   put({id:achievementId,title:card.title,summary:/[\u3400-\u9fff]/u.test(presentation.speech)?`已整理“${card.title}”的完整需求文档草稿，待用户核对。`:`Prepared the complete “${card.title}” requirements document for user review.`,artifact:"draft",sourceMessageId:message.messageId,evidenceMessageIds:unique(card.evidence.map(e=>e.messageId).filter(id=>userTexts.has(id)))},false);
  }
  // Actual outputs remain recorded even if the same reply also records a
  // separate clarified business fact. Suggested approaches are not decisions.
  if(card?.type==="direction_comparison"||card?.type==="sample_result"||card?.type==="demand_review"){
   const artifact=card.type==="direction_comparison"?"comparison":card.type==="sample_result"?"sample":"draft";
   const signature=JSON.stringify({...card,title:undefined});
   const identity=card.type==="direction_comparison"?JSON.stringify([artifact,[...card.basis].sort(),card.directions.map(d=>d.id).sort()]):
    card.type==="sample_result"&&card.mode==="grounded"?JSON.stringify([artifact,card.task,card.evidence.map(e=>e.quote).sort()]):
     card.type==="demand_review"?JSON.stringify([artifact,card.business,card.problem]):signature;
   achievementId=artifacts.get(signature)??artifactIdentities.get(identity)??`artifact-${message.messageId}`;
   if(latestArtifactSignatures.get(achievementId)!==signature){
    // Language only affects display text, never which work or skill is chosen.
    const english=!/[\u3400-\u9fff]/u.test(presentation.speech);
    const summary=card.type==="direction_comparison"?(english
     ?`Compared “${card.directions.map(d=>d.title).join(" / ")}” approaches, tradeoffs and human responsibilities (proposals).`
     :`已比较“${card.directions.map(d=>d.title).join(" / ")}”的做法、取舍和人工职责（方案建议）。`):
     card.type==="sample_result"?(english
      ?`Completed a text rehearsal of “${card.task}” (${card.mode==="grounded"?"with source quotations":"illustrative draft"}; not business validation).`
      :`已完成“${card.task}”的文字演练（${card.mode==="grounded"?"有原文引用":"示意草稿"}，不代表业务验证）。`):
      english?`Prepared the “${card.title}” requirements-analysis draft.`:`已整理“${card.title}”的需求分析草稿。`;
    const quotes=card.type==="direction_comparison"?card.basis:card.type==="sample_result"?card.evidence.map(e=>e.quote):[];
    const evidenceMessageIds=[...userTexts].filter(([,text])=>quotes.some(quote=>text.includes(quote))).map(([id])=>id);
    put({id:achievementId,title:card.title,summary,artifact,sourceMessageId:message.messageId,evidenceMessageIds},false);
    artifacts.set(signature,achievementId);artifactIdentities.set(identity,achievementId);latestArtifactSignatures.set(achievementId,signature);
   }
  }
  const {notice}=validateReceptionProgressNotice(presentation.progress,new Set(userTexts.keys()),userTexts);
  if(notice)put({...notice,sourceMessageId:message.messageId});
  else {
   const old=LegacyReceptionProgressNotice.safeParse(presentation.progress);
   if(old.success&&old.data.change==="achieved"&&["priority_confirmed","direction_confirmed","feasibility_reviewed"].includes(old.data.event)&&old.data.evidenceMessageIds.every(id=>userTexts.has(id))&&old.data.evidenceMessageIds.some(id=>{const text=userTexts.get(id)!;return text.trim().length>0&&!isRoutineReceptionAcknowledgement(text);})){
    // Only explicit historical accomplishments are projected. Old pending,
    // recheck and closing states never recreate phases or outstanding work.
    const summary=old.data.evidenceMessageIds.map(id=>userTexts.get(id)!).join("\n");
    put({id:`legacy-${message.messageId}`,title:summary.slice(0,100),summary,sourceMessageId:message.messageId,evidenceMessageIds:old.data.evidenceMessageIds});
   }
  }
  lastCard=card?{messageId:message.messageId,interaction:card,achievementId}:undefined;
 }
 return {achievements};
}

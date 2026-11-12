import {decodeReceptionPresentation,deriveRequirementsDocumentState,parseRequirementsDocumentRequest,parseRequirementsDocumentConfirmation,isRoutineReceptionAcknowledgement,type ReceptionPresentation} from '@ally-ahead/contracts';
import type {StoredEntry} from './entry-codec.js';
import {receptionProgressMessages} from './reception-progress.js';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const evidenceMarker = "--- USER EVIDENCE ---";
const evidenceMarkerLine = /^--- USER EVIDENCE ---[ \t]*\r?$/mu;

export function isRequirementsDocumentDraft(text: string) {
 return text.trimStart().startsWith("# ") && evidenceMarkerLine.test(text);
}

export function requirementsDocumentDelivery(english: boolean) {
 return `Write the report title, headings, prose and acceptance criteria in ${english ? "English" : "Simplified Chinese"}. Use the following final response format, including when revising a saved document. A saved card in the conversation is source material. Do not copy its response format. Start with "# Title" on the first line, use "##" section headings, and write the whole report in Markdown without a code fence. Then put ${evidenceMarker} on a line by itself. After it, return only a JSON array of the integer ref values from userSources, for example [1, 3]. Choose up to 20 relevant refs, without IDs or quotes. Use [] only if there are no citable business facts. The application retrieves the exact evidence, creates the card and links revisions. Only return an array by itself if validation specifically requests an evidence repair.`;
}

export function assembleRequirementsDocument(raw: string, english: boolean, resolveEvidence: (refs: unknown) => unknown) {
 const text = raw.trim();
 const heading = /^# ([^\r\n]{1,200})\r?\n/u.exec(text);
 if (!heading) return;
 const sections = text.split(evidenceMarkerLine);
 const markdown = sections[0]!.trimEnd();
 if (sections.length !== 2 || !/^## [^\r\n]+\r?\n[\s\S]*\S/mu.test(markdown))
  throw Error("REQUIREMENTS_DOCUMENT_FORMAT: provide a complete Markdown report and exactly one evidence marker");
 return {
  speech: english ? "The requirements draft is ready for your review." : "需求文档初稿已就绪，请核对。",
  interaction: {type: "requirements_document", title: heading[1]!.trim(), markdown,
   evidence: resolveEvidence(parseRequirementsEvidenceRefs(sections[1]!))},
 };
}

export function parseRequirementsEvidenceRefs(text: string): unknown {
 const evidenceText = text.trim().replace(/^```json\s*([\s\S]*?)\s*```$/iu, "$1");
 try {
  return JSON.parse(evidenceText);
 } catch {
  // The retained report can be delivered once a valid selection is supplied.
  return null;
 }
}

export function prepareRequirementsDocument(history:readonly StoredEntry[],inputMessageId:string,inputText:string){
 const messages=receptionProgressMessages(history);
 const current={messageId:inputMessageId,messageKey:inputMessageId,author:"user" as const,text:inputText};
 const state=deriveRequirementsDocumentState([...messages,current]);
 const request=parseRequirementsDocumentRequest(inputText);
 const documents=new Map(messages.flatMap(message=>{if(message.author!=='assistant')return [];const card=decodeReceptionPresentation(message.text)?.interaction;return card?.type==='requirements_document'?[[message.messageId,card] as const]:[];}));
 const source=request?(request.kind==='revise'?request.documentMessageId??state.current?.messageId:state.current?.messageId):undefined;
 const userTexts=new Map<string,string>();
 const addSource=(messageId:string,text:string)=>{
  const control=parseRequirementsDocumentRequest(text);
  if((control?.kind==='generate'&&!control.directive)||parseRequirementsDocumentConfirmation(text)||isRoutineReceptionAcknowledgement(text))return;
  const value=control?.kind==='revise'?control.instruction:text;if(value.trim())userTexts.set(messageId,value);
 };
 for(const message of messages)if(message.author==='user')addSource(message.messageId,message.text);
 addSource(inputMessageId,inputText);
 const controls=new Map<string,string>();
 const addControl=(messageId:string,text:string)=>{
  const parsed=parseRequirementsDocumentRequest(text);
  if(parsed?.kind==="generate")controls.set(messageId,parsed.directive??text);
 };
 for(const message of messages)if(message.author==="user")addControl(message.messageId,message.text);
 addControl(inputMessageId,inputText);
 const sources=[...userTexts];
 const excerpts=request?sources.flatMap(([messageId,text])=>{
  const directive=controls.get(messageId);
  const parts=directive?text.split(directive):[text];
  return parts.flatMap(part=>{
   const value=part.trim();
   if(!value||isRoutineReceptionAcknowledgement(value))return [];
   // Present contiguous excerpts. A long correction at the end of a message
   // remains independently selectable without constructing a stitched quote.
   return (value.length<=500?[value]:[value.slice(0,500).trimEnd(),value.slice(-500).trimStart()])
    .map(quote=>({messageId,quote}));
  });
 }):[];
 const bounded=excerpts.length<=40?excerpts:[...excerpts.slice(0,5),...excerpts.slice(-35)];
 const userSources=bounded.map(({messageId,quote},i)=>({ref:i+1,messageId,excerpt:quote}));
 function resolveEvidence(refs: unknown) {
  if(!Array.isArray(refs)||refs.length>20||
    refs.some(ref=>!Number.isSafeInteger(ref)||ref<1||ref>bounded.length))return null;
  return [...new Set(refs)].map(ref=>bounded[ref-1]!);
 }
 const command=request?.kind==="generate"&&request.directive?request.directive:inputText.trim();
 const english=!/^[\u3400-\u9fff]/u.test(command)&&!/requirements document in Chinese\b/iu.test(command);
 const context=request||state.current?`\n【需求文档指令与来源，仅为上下文】\n${JSON.stringify({request,currentDocument:state.current?{messageId:state.current.messageId,title:state.current.document.title,confirmed:!!state.current.confirmedByMessageId}:null,...(request?{userSources}:{})})}\n来源由 userSources 的 ref 标识；生成按钮文本、泛确认或助手建议不是业务证据。生成仅依据用户明确请求。认可需求不代表购买、发布或付款；新稿须重新认可。\n`:'';
 const badEvidence=(items:readonly {messageId:string;quote:string}[])=>items.flatMap((item,index)=>
  !userTexts.get(item.messageId)?.includes(item.quote)||
  (controls.has(item.messageId)&&item.quote.includes(controls.get(item.messageId)!))||
  parseRequirementsDocumentRequest(item.quote)?[index]:[]);
 function repairEvidence(value:unknown):{value:unknown;compensation:string[]}{
  if(!request||!value||typeof value!=="object"||!("interaction" in value))return {value,compensation:[]};
  const card=value.interaction;
  if(!card||typeof card!=="object"||!("type" in card)||card.type!=="requirements_document"||!("evidence" in card)||!Array.isArray(card.evidence)||card.evidence.length>20)return {value,compensation:[]};
  const compensation:string[]=[];
  const evidence=card.evidence.flatMap((item:unknown)=>{
   if(!item||typeof item!=="object"||!("quote" in item)||!("messageId" in item)||Object.keys(item).length!==2||typeof item.quote!=="string"||typeof item.messageId!=="string")return [item];
   const {messageId,quote}=item;
   if(controls.get(messageId)===quote){compensation.push("non_business_control_evidence_removed");return [];}
   if(!quote.trim()||userTexts.get(messageId)?.includes(quote))return [item];
   // A bad model ID can be repaired only against an exact quote in this conversation.
   const matches=sources.filter(([id,text])=>uuid.test(id)&&text.includes(quote));
   const truncated=!uuid.test(messageId)&&messageId.length>=34?matches.filter(([id])=>id.startsWith(messageId)):[];
   if(truncated.length===1){
    compensation.push("truncated_evidence_uuid_restored");
    return [{messageId:truncated[0]![0],quote}];
   }
   if(matches.length!==1)return [item];
   compensation.push("evidence_message_id_rebound");
   return [{messageId:matches[0]![0],quote}];
  });
  if(!compensation.length||!evidence.length)return {value,compensation:[]};
  return {value:{...value,interaction:{...card,evidence}},compensation};
 }
 return {context,request,english,resolveEvidence,repairEvidence,badEvidence,validateFinal:(presentation:ReceptionPresentation)=>{
  if(!request)return;
  if(request.kind==='revise'&&(!source||!documents.has(source)))throw Error('REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND');
  if(presentation.interaction?.type!=='requirements_document')throw Error('REQUIREMENTS_DOCUMENT_DELIVERY_REQUIRED: this explicit generation/revision task must finish with a complete requirements_document, not a speech-only reply or offer');
 },normalize:(presentation:ReceptionPresentation):ReceptionPresentation=>{
  const card=presentation.interaction;if(card?.type!=='requirements_document')return presentation;
  if(!request)throw Error('REQUIREMENTS_DOCUMENT_REQUEST_REQUIRED');
  if(request.kind==='revise'&&(!source||!documents.has(source)))throw Error('REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND');
  if(card.replacesMessageId&&card.replacesMessageId!==source)throw Error('REQUIREMENTS_DOCUMENT_SOURCE_MISMATCH');
  if(badEvidence(card.evidence).length)throw Error('REQUIREMENTS_DOCUMENT_EVIDENCE_NOT_FROM_USER');
  return source?{...presentation,interaction:{...card,replacesMessageId:source}}:presentation;
 }};
}

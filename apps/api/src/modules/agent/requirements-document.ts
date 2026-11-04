import {decodeReceptionPresentation,deriveRequirementsDocumentState,parseRequirementsDocumentRequest,parseRequirementsDocumentConfirmation,isRoutineReceptionAcknowledgement,type ReceptionPresentation} from '@ally-ahead/contracts';
import type {StoredEntry} from './entry-codec.js';
import {receptionProgressMessages} from './reception-progress.js';

export function prepareRequirementsDocument(history:readonly StoredEntry[],inputMessageId:string,inputText:string){
 const messages=receptionProgressMessages(history),state=deriveRequirementsDocumentState([...messages,{messageId:inputMessageId,messageKey:inputMessageId,author:"user",text:inputText}]),request=parseRequirementsDocumentRequest(inputText);
 const documents=new Map(messages.flatMap(message=>{if(message.author!=='assistant')return [];const card=decodeReceptionPresentation(message.text)?.interaction;return card?.type==='requirements_document'?[[message.messageId,card] as const]:[];}));
 const source=request?(request.kind==='revise'?request.documentMessageId??state.current?.messageId:state.current?.messageId):undefined;
 const userTexts=new Map<string,string>();
 const addSource=(messageId:string,text:string)=>{
  const control=parseRequirementsDocumentRequest(text);
  if(control?.kind==='generate'||parseRequirementsDocumentConfirmation(text)||isRoutineReceptionAcknowledgement(text))return;
  const value=control?.kind==='revise'?control.instruction:text;if(value.trim())userTexts.set(messageId,value);
 };
 for(const message of messages)if(message.author==='user')addSource(message.messageId,message.text);
 addSource(inputMessageId,inputText);
 const sources=[...userTexts];const bounded=sources.length<=40?sources:[...sources.slice(0,5),...sources.slice(-35)];
 const context=request||state.current?`\n【需求文档指令与来源，仅为上下文】\n${JSON.stringify({request,currentDocument:state.current?{messageId:state.current.messageId,title:state.current.document.title,confirmed:!!state.current.confirmedByMessageId}:null,...(request?{userSources:bounded.map(([messageId,text])=>({messageId,excerpt:text.slice(0,240)}))}:{})})}\n生成仅依据用户明确请求。认可需求不代表购买、发布或付款；新稿须重新认可。\n`:'';
 return {context,request,validateFinal:(presentation:ReceptionPresentation)=>{
  if(!request)return;
  if(request.kind==='revise'&&(!source||!documents.has(source)))throw Error('REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND');
  if(presentation.interaction?.type!=='requirements_document')throw Error('REQUIREMENTS_DOCUMENT_DELIVERY_REQUIRED: this explicit generation/revision task must finish with a complete requirements_document, not a speech-only reply or offer');
 },normalize:(presentation:ReceptionPresentation):ReceptionPresentation=>{
  const card=presentation.interaction;if(card?.type!=='requirements_document')return presentation;
  if(!request)throw Error('REQUIREMENTS_DOCUMENT_REQUEST_REQUIRED');
  if(request.kind==='revise'&&(!source||!documents.has(source)))throw Error('REQUIREMENTS_DOCUMENT_SOURCE_NOT_FOUND');
  if(card.replacesMessageId&&card.replacesMessageId!==source)throw Error('REQUIREMENTS_DOCUMENT_SOURCE_MISMATCH');
  for(const evidence of card.evidence)if(!userTexts.get(evidence.messageId)?.includes(evidence.quote)||parseRequirementsDocumentRequest(evidence.quote))throw Error('REQUIREMENTS_DOCUMENT_EVIDENCE_NOT_FROM_USER');
  return source?{...presentation,interaction:{...card,replacesMessageId:source}}:presentation;
 }};
}

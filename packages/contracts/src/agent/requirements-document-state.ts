import {decodeReceptionPresentation} from './presentation.js';
import {parseRequirementsDocumentRequest,parseRequirementsDocumentConfirmation,type RequirementsDocument} from './requirements-document.js';
import type {ReceptionJourneyMessage} from './journey.js';
export interface RequirementsDocumentState {current:null|{messageId:string;document:RequirementsDocument;confirmedByMessageId:string|null;hasPendingRevision:boolean}}
// Existing saved messages are the only source. No local generation, draft table
// or model claim may supply the document's identity or the user's acceptance.
export function deriveRequirementsDocumentState(messages:readonly ReceptionJourneyMessage[]):RequirementsDocumentState {
 const state:RequirementsDocumentState={current:null};const seen=new Set<string>();
 for(const message of messages){
  if(seen.has(message.messageId))continue;seen.add(message.messageId);
  if(message.author==='assistant'){
   if(message.delivery==='intermediate')continue;
   const card=decodeReceptionPresentation(message.text)?.interaction;
   if(card?.type==='requirements_document')state.current={messageId:message.messageId,document:card,confirmedByMessageId:null,hasPendingRevision:false};
  }else if(state.current){
   const request=parseRequirementsDocumentRequest(message.text);
   if(request){state.current.confirmedByMessageId=null;state.current.hasPendingRevision=true;}
   if(parseRequirementsDocumentConfirmation(message.text)===state.current.messageId){state.current.confirmedByMessageId=message.messageId;state.current.hasPendingRevision=false;}
  }
 }
 return state;
}

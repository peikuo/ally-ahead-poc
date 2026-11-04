import type { Transaction } from '../../infrastructure/database.js';
export type PaymentState = 'awaiting_payment_consent'|'creating'|'awaiting_buyer'|'capturing'|'paid'|'refunding'|'refund_pending'|'refunded'|'unknown'|'failed';
export type PaymentAction = 'create'|'capture'|'refund'|'status';
export interface ReceptionPaymentRecord {
  id:string; sessionId:string; documentMessageId:string; documentHash:string; confirmedMarkdown:string;
  termsVersion:string; prepareRequestKey:string; revision:number; state:PaymentState;
  documentConfirmedAt:string; publicationConsentAt:string; paymentConsentAt:string|null;
  orderId:string|null; orderStatus:string|null; captureId:string|null; captureStatus:string|null;
  refundId:string|null; refundStatus:string|null;
  createKey:string; captureKey:string; refundKey:string;
  attemptedAt:Partial<Record<Exclude<PaymentAction,'status'>,number>>;
  pending:{action:PaymentAction;leaseId:string;expiresAt:number}|null;
  outcome:'known'|'unknown'|'failed'; failureCode:string|null;
  createdAt:string; updatedAt:string;
}
// Must use the existing reception transaction/capability on each short DB operation.
export type ReceptionPaymentAccess = <T>(fn:(tx:Transaction,sessionId:string)=>Promise<T>)=>Promise<T>;
export interface ReceptionPaymentStore {
  // Serializes prepare before active()/insert(), across processes, by session row.
  lockSession(tx:Transaction,sessionId:string):Promise<void>;
  byPrepareKey(tx:Transaction,sessionId:string,requestKey:string):Promise<ReceptionPaymentRecord|undefined>;
  active(tx:Transaction,sessionId:string):Promise<ReceptionPaymentRecord|undefined>;
  get(tx:Transaction,sessionId:string,paymentId:string,lock:boolean):Promise<ReceptionPaymentRecord|undefined>;
  insert(tx:Transaction,record:ReceptionPaymentRecord):Promise<void>;
  // Must compare expectedRevision and enforce same guest session even under RLS.
  save(tx:Transaction,record:ReceptionPaymentRecord,expectedRevision:number):Promise<void>;
}
export interface ReceptionPaymentDocumentReader {
  readConfirmableDocument(tx:Transaction,sessionId:string,messageId:string):Promise<{
    messageId:string;markdown:string;kind:'requirements_document';complete:true;confirmedByMessageId:string;hasPendingRevision:false;
  }>;
}

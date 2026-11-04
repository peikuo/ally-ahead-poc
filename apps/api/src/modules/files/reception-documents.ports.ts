import type{DocumentParagraph,ParsedReceptionDocument}from'./reception-document-parser.js';
import type{ReceptionDocumentCoverage,ReceptionDocumentLocation}from'@ally-ahead/contracts';
export interface ReceptionSummarySegment{paragraphStart:number;paragraphEnd:number;title:string;summary:string}
export interface ReceptionSummaryBatch{key:string;paragraphStart:number;paragraphEnd:number;title:string;summary:string;segments:ReceptionSummarySegment[]}
export interface ReceptionDocumentProcessor{
 configured():boolean;
 process(input:{sourceId:string;documentId:string;markdown:string;paragraphs:DocumentParagraph[];coverage:ReceptionDocumentCoverage;maxBatchTokens:number;
  completedBatches:Pick<ReceptionSummaryBatch,'key'|'paragraphStart'|'paragraphEnd'>[];trace?:import('../agent/trace/agent-trace.js').AgentTraceCallback;signal:AbortSignal;check:()=>Promise<void>;saveBatch:(batch:ReceptionSummaryBatch)=>Promise<void>}):Promise<void>;
}
export const RECEPTION_DOCUMENT_PROCESSOR=Symbol('RECEPTION_DOCUMENT_PROCESSOR');
export const unavailableReceptionDocumentProcessor:ReceptionDocumentProcessor={configured:()=>false,process:async()=>{throw new Error('DOCUMENT_PROCESSOR_NOT_READY');}};
export interface ReceptionDocumentTextRead{documentId:string;sourceId:string;segmentId:string;fileName:string;sourceKind:'original'|'supplement';sourceLabel:string;location:ReceptionDocumentLocation;text:string;coverage:ReceptionDocumentCoverage;sha256:string}
export interface ReceptionDocumentReader{
 catalog():Promise<import('@ally-ahead/contracts').ReceptionDocumentView[]>;
 outline(documentId:string,parentId?:string,offset?:number):Promise<import('zod').z.infer<typeof import('@ally-ahead/contracts').ReceptionDocumentOutline>>;
 read(documentId:string,segmentId:string):Promise<ReceptionDocumentTextRead>;
 search(documentId:string,keyword:string):Promise<{documentId:string;hits:{sourceId:string;segmentId:string;location:ReceptionDocumentLocation;excerpt:string}[];truncated:boolean;searchedSourceIds:string[];unavailableSourceIds:string[];unindexedSourceIds:string[];note:string}>;
}
export interface ReceptionDocumentParseAdapter{parse(format:import('./reception-document-parser.js').ReceptionDocumentFormat,bytes:Buffer,maxCharacters:number,signal:AbortSignal):Promise<ParsedReceptionDocument>}

import { z } from 'zod';
export const TraceViewerState = z.enum(['pending','running','retry_wait','done','failed','cancelled']);
const id=z.uuid(), date=z.iso.datetime({offset:true});
export const TraceViewerFilters=z.strictObject({
  from:date.optional(),to:date.optional(),state:TraceViewerState.optional(),sessionId:id.optional(),runId:id.optional(),
  limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(1024).optional(),
}).refine(q=>!q.from||!q.to||Date.parse(q.from)<=Date.parse(q.to));
export const TraceViewerEventQuery=z.strictObject({limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().regex(/^[A-Za-z0-9_-]+$/).max(1024).optional()});
export const TraceViewerSession=z.strictObject({sessionId:id,lastRunAt:date,runCount:z.number().int().positive()});
export const TraceViewerRun=z.strictObject({runId:id,sessionId:id,inputMessageId:id,createdAt:date,state:TraceViewerState,lastSequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export const TraceViewerEvent=z.strictObject({eventId:id,runId:id,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),at:date,recordedAt:date,type:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/)});
// Stored data, including traceRedactions/coverage/diagnostics, is preserved. No inferred spans or reasoning.
export const TraceViewerEventDetail=TraceViewerEvent.extend({data:z.record(z.string(),z.unknown())});
export const TraceViewerSessionPage=z.strictObject({items:z.array(TraceViewerSession),nextCursor:z.string().nullable()});
export const TraceViewerRunPage=z.strictObject({items:z.array(TraceViewerRun),nextCursor:z.string().nullable()});
export const TraceViewerEventPage=z.strictObject({items:z.array(TraceViewerEvent),nextCursor:z.string().nullable()});
export type TraceViewerFilterInput=z.infer<typeof TraceViewerFilters>;
export type TraceViewerSessionView=z.infer<typeof TraceViewerSession>;
export type TraceViewerRunView=z.infer<typeof TraceViewerRun>;
export type TraceViewerEventView=z.infer<typeof TraceViewerEvent>;
export type TraceViewerEventDetailView=z.infer<typeof TraceViewerEventDetail>;

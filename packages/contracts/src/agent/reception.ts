import { z } from "zod";
import { Id } from "../common/index.js";
import { AgentRunState, AgentVisibleMessage, AgentSnapshot, StartAgentRun } from "./index.js";
export const StartReceptionRun = z.lazy(()=>StartAgentRun);
export const ReceptionRunView = z.strictObject({
  runId:Id, sessionId:Id, inputMessageId:Id, state:z.lazy(()=>AgentRunState),
  finalMessageId:Id.nullable().optional(),
  revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  messages:z.array(z.lazy(()=>AgentVisibleMessage)).max(1000), snapshot:z.lazy(()=>AgentSnapshot).nullable(),
  failure:z.enum(["unavailable","interrupted","outcome_unknown","failed"]).nullable(),
}).refine(v=>!["done","failed","cancelled"].includes(v.state)||v.snapshot===null).refine(v=>v.finalMessageId==null||v.state==="done"&&v.messages.some(m=>m.messageId===v.finalMessageId&&m.author==="assistant"&&m.delivery!=="intermediate"));
export const ReceptionSession = z.strictObject({sessionId:Id,expiresAt:z.iso.datetime(),
  csrfToken:z.string().min(1).max(512),configured:z.boolean(),run:ReceptionRunView.nullable()});

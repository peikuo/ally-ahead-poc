import { z } from "zod";
import { Id } from "../common/index.js";
const SendAgentInput=z.strictObject({body:z.string().trim().min(1).max(20000),clientMessageKey:Id,confirmedNonConfidential:z.literal(true)});
export const StartAgentRun = SendAgentInput;
export const StopAgentRun = z.strictObject({});
export const AgentRunState = z.enum(["pending", "running", "done", "failed", "cancelled"]);
export const AgentVisibleMessage = z.strictObject({
  messageId: Id, messageKey: z.string().min(1).max(120),
  author: z.enum(["user", "assistant"]), text: z.string().max(262144),
  delivery:z.enum(["intermediate","final"]).optional(),
}).refine(message=>message.author==="assistant"||message.delivery===undefined);
export const AgentSnapshot = z.strictObject({
  messageKey: z.string().min(1).max(120), text: z.string().max(32768),
  progress: z.enum(["preparing", "responding"]),
}).refine(v => new TextEncoder().encode(JSON.stringify(v)).byteLength <= 32768);
// Full replacement view. revision belongs to the run, including final-message commits.
export const AgentRunReceipt = z.strictObject({ runId: Id, inputMessageId: Id, state: AgentRunState });
// SSE event: snapshot; id: revision; data: JSON of AgentRunView. Never raw SDK events.
export * from "./reception.js";

export * from "./presentation.js";

export * from "./external-cases.generated.js";

export * from "./reception-skills.js";
export * from "./progress-notice.js";
export * from "./journey.js";

export * from "./requirements-document.js";
export * from "./requirements-document-state.js";

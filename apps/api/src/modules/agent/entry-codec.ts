import { communicatedPresentation, communicateNativeErrorPolicy } from "./communicate.js";
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { PREVIOUS_SYSTEM_PROMPT, PRE_PROGRESSIVE_SYSTEM_PROMPT, PRE_SKILL_HISTORY_SYSTEM_PROMPT, PRE_DYNAMIC_ACHIEVEMENTS_SYSTEM_PROMPT, PRE_DELIVERY_REPAIR_SYSTEM_PROMPT, PRE_PROACTIVE_ACHIEVEMENTS_SYSTEM_PROMPT, PRE_ACHIEVEMENT_CHECK_SYSTEM_PROMPT, PRE_COMMUNICATE_SYSTEM_PROMPT, PRE_TYPED_COMMUNICATE_SYSTEM_PROMPT, PRE_EMPTY_REFERENCE_COMPENSATION_SYSTEM_PROMPT, PRE_REQUIREMENTS_DOCUMENT_SYSTEM_PROMPT, PRE_PLATFORM_FLOW_SYSTEM_PROMPT, PRE_PLATFORM_CONTEXT_SYSTEM_PROMPT, PRE_DELIVERY_QUALITY_SYSTEM_PROMPT } from "./agent-policy-history.js";
import { SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT, VIRTUAL_CWD } from "./agent-policy.js";

export const PI_SDK_VERSION = "1.4.0";
export const MAX_ENTRY_BYTES = 256 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const text = z.strictObject({ type: z.literal("text"), text: z.string().max(MAX_ENTRY_BYTES) });
const counter = z.number().finite().nonnegative();
const usage = z.strictObject({ input: counter, output: counter, cacheRead: counter, cacheWrite: counter,
  totalTokens: counter, cacheWrite1h: counter.optional(), reasoning: counter.optional(),
  cost: z.strictObject({ input: counter, output: counter, cacheRead: counter, cacheWrite: counter, total: counter }) });
const toolCall = z.strictObject({ type: z.literal("toolCall"), id, name: id, arguments: z.record(z.string(), z.unknown()) });
const user = z.strictObject({ role: z.literal("user"), content: z.union([z.string().max(MAX_ENTRY_BYTES), z.array(text).max(1000)]), timestamp: counter });
const assistant = z.strictObject({ role: z.literal("assistant"), content: z.array(z.union([text, toolCall])).max(1000),
  api: id, provider: id, model: z.string().min(1).max(160), usage,
  stopReason: z.enum(["stop", "length", "toolUse"]), timestamp: counter, durationMs: counter.optional() });
const toolResult = z.strictObject({ role: z.literal("toolResult"), toolCallId: id, toolName: id,
  content: z.array(text).max(1000), isError: z.boolean(), timestamp: counter, durationMs: counter.optional() });
const systemSnapshot = z.union([
  z.strictObject({role:z.literal("system"),content:z.union([z.literal(SYSTEM_PROMPT),z.literal(LEGACY_SYSTEM_PROMPT),z.literal(PREVIOUS_SYSTEM_PROMPT),z.literal(PRE_PROGRESSIVE_SYSTEM_PROMPT),z.literal(PRE_SKILL_HISTORY_SYSTEM_PROMPT),z.literal(PRE_DYNAMIC_ACHIEVEMENTS_SYSTEM_PROMPT),z.literal(PRE_DELIVERY_REPAIR_SYSTEM_PROMPT),z.literal(PRE_PROACTIVE_ACHIEVEMENTS_SYSTEM_PROMPT),z.literal(PRE_ACHIEVEMENT_CHECK_SYSTEM_PROMPT),z.literal(PRE_COMMUNICATE_SYSTEM_PROMPT),z.literal(PRE_TYPED_COMMUNICATE_SYSTEM_PROMPT),z.literal(PRE_EMPTY_REFERENCE_COMPENSATION_SYSTEM_PROMPT),z.literal(PRE_REQUIREMENTS_DOCUMENT_SYSTEM_PROMPT),z.literal(PRE_PLATFORM_FLOW_SYSTEM_PROMPT),z.literal(PRE_PLATFORM_CONTEXT_SYSTEM_PROMPT),z.literal(PRE_DELIVERY_QUALITY_SYSTEM_PROMPT)]),timestamp:counter}),
  z.strictObject({role:z.literal("system"),content:z.literal(""),timestamp:counter,
    sections:z.strictObject({preamble:z.union([z.literal(SYSTEM_PROMPT),z.literal(LEGACY_SYSTEM_PROMPT),z.literal(PREVIOUS_SYSTEM_PROMPT),z.literal(PRE_PROGRESSIVE_SYSTEM_PROMPT),z.literal(PRE_SKILL_HISTORY_SYSTEM_PROMPT),z.literal(PRE_DYNAMIC_ACHIEVEMENTS_SYSTEM_PROMPT),z.literal(PRE_DELIVERY_REPAIR_SYSTEM_PROMPT),z.literal(PRE_PROACTIVE_ACHIEVEMENTS_SYSTEM_PROMPT),z.literal(PRE_ACHIEVEMENT_CHECK_SYSTEM_PROMPT),z.literal(PRE_COMMUNICATE_SYSTEM_PROMPT),z.literal(PRE_TYPED_COMMUNICATE_SYSTEM_PROMPT),z.literal(PRE_EMPTY_REFERENCE_COMPENSATION_SYSTEM_PROMPT),z.literal(PRE_REQUIREMENTS_DOCUMENT_SYSTEM_PROMPT),z.literal(PRE_PLATFORM_FLOW_SYSTEM_PROMPT),z.literal(PRE_PLATFORM_CONTEXT_SYSTEM_PROMPT),z.literal(PRE_DELIVERY_QUALITY_SYSTEM_PROMPT)]),cwd:z.literal(`<cwd>\n${VIRTUAL_CWD}\n</cwd>`)}),
    toolsAdded:z.tuple([]).optional(),toolsRemoved:z.tuple([]).optional()}),
]);
const base = { id, parentId: id.nullable(), timestamp: z.iso.datetime() };
const entrySchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("message"), message: z.discriminatedUnion("role", [user, assistant, toolResult]) }),
  z.strictObject({ ...base, type: z.literal("model_change"), provider: id, modelId: z.string().min(1).max(160) }),
  z.strictObject({ ...base, type: z.literal("thinking_level_change"), thinkingLevel: z.literal("off") }),
  z.strictObject({ ...base, type: z.literal("compaction"), summary: z.string().max(MAX_ENTRY_BYTES), firstKeptEntryId: id, tokensBefore: counter, usage:usage.optional(), fromHook:z.literal(false).optional(), systemMessage:systemSnapshot.optional() }),
]);
export interface EntryPolicy {
  models: ReadonlyArray<{ provider: string; modelId: string; api: string }>;
  // Each enabled tool must have an explicit argument and native result schema.
  tools: ReadonlyMap<string, { arguments: z.ZodType; result: z.ZodType }>;
}
export class UnsafeAgentEntry extends Error { constructor() { super("UNSAFE_AGENT_ENTRY"); } }
const secret = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.-]{12,}|(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*\S+|\b(?:postgres(?:ql)?|mysql):\/\/|[?&](?:token|signature|credential)=)/i;
// Structural/lexical defense. Semantic privacy requires authorized sources from the message owner.
export function assertSafeText(value: string): void { if (secret.test(value)) throw new UnsafeAgentEntry(); }
function finiteJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new UnsafeAgentEntry();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { assertSafeText(value); return; }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { if(value.length > 10000) throw new UnsafeAgentEntry(); value.forEach(v => finiteJson(v, depth+1)); return; }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new UnsafeAgentEntry();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || /^(?:__proto__|constructor|prototype|apiKey|password|secret|token|privateContent|bilateral|thinking|thinkingSignature|thoughtSignature)$/i.test(key)) throw new UnsafeAgentEntry();
    finiteJson(descriptor.value, depth+1);
  }
}
export function validateEntry(value: unknown, policy: EntryPolicy): SessionEntry {
  try {
    finiteJson(value);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_ENTRY_BYTES) throw new UnsafeAgentEntry();
    const entry = entrySchema.parse(value);
    if (entry.type === "model_change" && !policy.models.some(m => m.provider === entry.provider && m.modelId === entry.modelId)) throw new UnsafeAgentEntry();
    if (entry.type === "message") {
      const m = entry.message;
      if (m.role === "assistant") {
        if (!policy.models.some(p => p.provider === m.provider && p.modelId === m.model && p.api === m.api)) throw new UnsafeAgentEntry();
        for (const c of m.content) if (c.type === "toolCall") {
          const t = policy.tools.get(c.name); if (!t) throw new UnsafeAgentEntry(); t.arguments.parse(c.arguments);
        }
      } else if (m.role === "toolResult") {
        const t = policy.tools.get(m.toolName); if (!t) throw new UnsafeAgentEntry();
        if(m.toolName==="communicate"&&m.isError)communicateNativeErrorPolicy.parse(m.content);
        else t.result.parse(m.content);
      }
    }
    return entry as SessionEntry;
  } catch { throw new UnsafeAgentEntry(); }
}
export interface StoredEntry { messageId: string; entryId: string; parentEntryId: string | null; sequence: number; entry: unknown }
export function validateHistory(rows: ReadonlyArray<StoredEntry>, policy: EntryPolicy): SessionEntry[] {
  const seen = new Map<string, SessionEntry>(); const entries: SessionEntry[] = [];
  const messageIds = new Set<string>(); const pendingTools = new Map<string,string>(); let previous: string | null = null; let sequence = 0;
  for (const row of rows) {
    const entry = validateEntry(row.entry, policy);
    if (!Number.isSafeInteger(row.sequence) || row.sequence <= sequence || seen.has(entry.id) || messageIds.has(row.messageId)
      || row.entryId !== entry.id || row.parentEntryId !== entry.parentId || entry.parentId !== previous) throw new UnsafeAgentEntry();
    if (entry.type === "compaction" && entry.firstKeptEntryId !== entry.id && seen.get(entry.firstKeptEntryId)?.type !== "message") throw new UnsafeAgentEntry();
    if (entry.type === "message") {
      const m=entry.message;
      if(m.role === "toolResult") {
        if(pendingTools.get(m.toolCallId)!==m.toolName) throw new UnsafeAgentEntry();
        pendingTools.delete(m.toolCallId);
      } else {
        if(pendingTools.size) throw new UnsafeAgentEntry();
        if(m.role==="assistant") for(const block of m.content) if(block.type==="toolCall") {
          if(pendingTools.has(block.id)) throw new UnsafeAgentEntry();
          pendingTools.set(block.id,block.name);
        }
      }
    } else if(entry.type === "compaction" && pendingTools.size) throw new UnsafeAgentEntry();
    seen.set(entry.id, entry); messageIds.add(row.messageId); entries.push(entry); previous = entry.id; sequence = row.sequence;
  }
  if(pendingTools.size) throw new UnsafeAgentEntry();
  return entries;
}
export function visibleText(entry: SessionEntry): { author: "user" | "assistant"; text: string; delivery?:"intermediate"|"final" } | null {
  const delivered=communicatedPresentation(entry);
  if(delivered)return {author:"assistant",text:JSON.stringify(delivered),delivery:"intermediate"};
  if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return null;
  const m = entry.message;
  if(m.role==="assistant"&&m.content.some(c=>c.type==="toolCall"))return null;
  return { author: m.role, ...(m.role==="assistant"?{delivery:"final" as const}:{}), text: typeof m.content === "string" ? m.content : m.content.filter(c => c.type === "text").map(c => c.text).join("") };
}
// Capture only approved native fields. No provider reasoning/signatures or raw errors survive.
export function captureEntry(native: SessionEntry, policy: EntryPolicy): SessionEntry {
  if(native.type === "compaction") {
    // SDK uses present-but-undefined optional properties; persisted JSON must be canonical finite JSON.
    if(native.details !== undefined || native.fromHook === true) throw new UnsafeAgentEntry();
    return validateEntry({type:native.type,id:native.id,parentId:native.parentId,timestamp:native.timestamp,
      summary:native.summary,firstKeptEntryId:native.firstKeptEntryId,tokensBefore:native.tokensBefore,
      ...(native.usage===undefined?{}:{usage:native.usage}),...(native.fromHook===undefined?{}:{fromHook:native.fromHook}),
      ...(native.systemMessage===undefined?{}:{systemMessage:native.systemMessage})},policy);
  }
  if(native.type==="message"&&native.message.role==="toolResult"){
    const m=native.message;
    return validateEntry({type:native.type,id:native.id,parentId:native.parentId,timestamp:native.timestamp,
      message:{role:m.role,toolCallId:m.toolCallId,toolName:m.toolName,content:m.content,isError:m.isError,timestamp:m.timestamp,...(m.durationMs===undefined?{}:{durationMs:m.durationMs})}},policy);
  }
  if (native.type !== "message" || native.message.role !== "assistant") return validateEntry(native, policy);
  const m = native.message;
  const content = m.content.filter(c => c.type !== "thinking").map(c => c.type === "text" ? { type: c.type, text: c.text } : { type: c.type, id: c.id, name: c.name, arguments: c.arguments });
  return validateEntry({type:native.type,id:native.id,parentId:native.parentId,timestamp:native.timestamp,
    message:{role:m.role,content,api:m.api,provider:m.provider,model:m.model,usage:m.usage,stopReason:m.stopReason,timestamp:m.timestamp,...(m.durationMs===undefined?{}:{durationMs:m.durationMs})}}, policy);
}

// No user entry JSON is persisted. These functions are the communication owner's mapping adapter.
export interface UserSource { messageId: string; body: string; createdAt: string; parentEntryId: string | null }
export function canonicalUserEntry(source: UserSource): SessionEntry {
  if(!z.uuid().safeParse(source.messageId).success || !z.iso.datetime().safeParse(source.createdAt).success
    || new Date(source.createdAt).toISOString() !== source.createdAt || typeof source.body !== "string" || !source.body) throw new UnsafeAgentEntry();
  assertSafeText(source.body);
  const entry = {type:"message" as const,id:source.messageId,parentId:source.parentEntryId,timestamp:source.createdAt,
    message:{role:"user" as const,content:source.body,timestamp:Date.parse(source.createdAt)}};
  return validateEntry(entry,{models:[],tools:new Map()});
}
export function assertCanonicalUser(entry: unknown, source: UserSource): void {
  const expected = canonicalUserEntry(source);
  const actual = validateEntry(entry,{models:[],tools:new Map()});
  if(JSON.stringify(actual) !== JSON.stringify(expected)) throw new UnsafeAgentEntry();
}

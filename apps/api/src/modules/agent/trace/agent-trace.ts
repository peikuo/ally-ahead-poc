import { randomUUID } from "node:crypto";

export interface AgentTraceEvent {
  eventId: string;
  runId: string;
  scopeType: "reception" | "demand" | "document";
  scopeId: string;
  inputMessageId: string;
  at: string;
  type: string;
  data: Record<string, unknown>;
}
export interface AgentTraceSink { record(event: AgentTraceEvent): Promise<void> }
export type AgentTraceCallback = (type: string, data: Record<string, unknown>) => Promise<void>;
export type AgentTraceIdentity = Pick<AgentTraceEvent, "runId" | "scopeType" | "scopeId" | "inputMessageId">;

// Only visible text is passed to this module. SDK thinking, auth, HTTP headers and
// opaque provider objects must never be passed as trace payloads.
export function sanitizeTraceData(data: Record<string, unknown>, secrets: readonly string[] = []): Record<string, unknown> {
  const redactions: string[] = [];
  const scrub = (value: unknown, path: string, depth = 0): unknown => {
    if (depth > 32) throw new Error("TRACE_DATA_INVALID");
    if (typeof value === "string") {
      let text = value;
      for (const secret of secrets.filter(Boolean)) {
        for (const representation of new Set([secret, JSON.stringify(secret).slice(1, -1)]))
          text = text.split(representation).join("[REDACTED]");
      }
      text = text.replace(/\u0000/g, "[NUL]")
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED]")
        .replace(/\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
        .replace(/\bBearer\s+[A-Za-z0-9_.-]{12,}/gi, "Bearer [REDACTED]")
        .replace(/(["']?(?:api[_-]?key|password|secret|access[_-]?token)["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[REDACTED]");
      if (text !== value) redactions.push(path);
      return text;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((item, i) => scrub(item, `${path}[${i}]`, depth + 1));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        if (/^(?:__proto__|constructor|prototype|thinking|thinkingSignature|thoughtSignature|api[_-]?key|access[_-]?token|password|secret|authorization|cookie)$/i.test(key)) {
          redactions.push(`${path}.${key}`); continue;
        }
        result[key] = scrub(item, `${path}.${key}`, depth + 1);
      }
      return result;
    }
    throw new Error("TRACE_DATA_INVALID");
  };
  const result = scrub(data, "data") as Record<string, unknown>;
  if (redactions.length) result.traceRedactions = redactions;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 4 * 1024 * 1024) throw new Error("TRACE_DATA_LIMIT");
  return result;
}

export function createRunTrace(sink: AgentTraceSink | undefined, identity: AgentTraceIdentity): AgentTraceCallback {
  // Optional only for old explicit unit fixtures. Production binds a durable sink.
  if (!sink) return async () => {};
  let queue = Promise.resolve();
  return (type, data) => {
    const event: AgentTraceEvent = { ...identity, eventId: randomUUID(), at: new Date().toISOString(), type, data: sanitizeTraceData(data) };
    queue = queue.then(() => sink.record(event)).catch(() => { throw new Error("TRACE_WRITE_FAILED"); });
    return queue;
  };
}

export function protectedTraceSink(sink: AgentTraceSink, secrets: readonly string[]): AgentTraceSink {
  return { record: event => sink.record({ ...event, data: sanitizeTraceData(event.data, secrets) }) };
}

export function traceFailure(error: unknown): string {
  const known = new Set(["MODEL_DATA_REJECTED", "MODEL_REQUEST_FAILED", "TRACE_WRITE_FAILED", "TRACE_DATA_INVALID", "TRACE_DATA_LIMIT",
    "RUN_CANCELLED", "RUN_INCOMPLETE", "OUTPUT_VALIDATION_FAILED", "RUN_DEADLINE_EXCEEDED", "SNAPSHOT_LIMIT", "UNAPPROVED_CASE_REFERENCE", "FORBIDDEN", "CONFLICT", "NOT_READY", "RATE_LIMITED", "VALIDATION_FAILED"]);
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && known.has(error.code)) return error.code;
  if (error instanceof Error && known.has(error.message)) return error.message;
  return "EXECUTION_FAILED";
}

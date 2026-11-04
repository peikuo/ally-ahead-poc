import { createProvider, type ProviderStreams } from "@earendil-works/pi-ai";
import { getApiProvider, type Model } from "@earendil-works/pi-ai/compat";
import type { AgentRuntime } from "./agent.ports.js";
import type { EntryPolicy } from "./entry-codec.js";
import { createIsolatedModelRuntime, PiRuntime } from "./pi-runtime.js";
import { ModelConfigurationError, parseAgentModelConfig, type AgentModelConfig } from "./model-config.js";
import { receptionToolPolicy, isReceptionToolPolicy } from "./reception-tools.js";
import { PiDocumentProcessor } from "./document-processor.js";
import { sanitizeTraceData } from "./trace/agent-trace.js";

export type ConfiguredAgentModel = {
  status: "configured"; runtime: AgentRuntime; policy: EntryPolicy; documentProcessor: import("../files/reception-documents.ports.js").ReceptionDocumentProcessor;
  selected: Readonly<AgentModelConfig["selected"]>;
};
const executionReasons = {
  TRACE_WRITE_FAILED: "trace_write_failed",
  TRACE_DATA_INVALID: "trace_data_invalid",
  TRACE_DATA_LIMIT: "trace_data_limit",
  INVALID_RECEPTION_SKILL_RESULT: "invalid_skill_result",
  DIRECTION_BASIS_NOT_FROM_USER: "comparison_basis_rejected",
  REHEARSAL_INPUT_REQUIRED: "sample_input_missing",
  REHEARSAL_REFERENCE_REQUIRED: "sample_reference_missing",
  REHEARSAL_EVIDENCE_NOT_PROVIDED: "sample_evidence_rejected",
  ILLUSTRATIVE_REHEARSAL_CANNOT_CLAIM_EVIDENCE: "sample_evidence_rejected",
  UNAPPROVED_CASE_REFERENCE: "case_reference_rejected",
  RUN_INCOMPLETE: "incomplete_model_response",
  OUTPUT_VALIDATION_FAILED: "output_validation_failed",
  RUN_DEADLINE_EXCEEDED: "run_deadline_exceeded",
  SNAPSHOT_LIMIT: "response_size_limit",
  RUN_CANCELLED: "cancelled",
} as const;
type ExecutionReason = typeof executionReasons[keyof typeof executionReasons] | "model_request_failed" | "model_data_rejected";
export class ModelExecutionError extends Error {
  constructor(readonly code: "MODEL_DATA_REJECTED" | "MODEL_REQUEST_FAILED",
    readonly reason: ExecutionReason = code === "MODEL_DATA_REJECTED" ? "model_data_rejected" : "model_request_failed") { super(code); }
}
export type AgentModelInitialization = ConfiguredAgentModel | { status: "not_ready" };
// Only explicit in-process tests may supply this third argument. No config/env/browser field selects it.
export interface ControlledModelTransport { purpose: "controlled-test"; streams: ProviderStreams }

export async function initializeAgentModel(
  rawConfig: unknown, literalApiKey: unknown, controlled?: ControlledModelTransport,
): Promise<AgentModelInitialization> {
  if (rawConfig === undefined && literalApiKey === undefined) return { status: "not_ready" };
  if (rawConfig === undefined || typeof literalApiKey !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(literalApiKey))
    throw new ModelConfigurationError("MODEL_CONFIG_INCOMPLETE");
  const config = parseAgentModelConfig(rawConfig);
  const encodedKey = JSON.stringify(literalApiKey).slice(1,-1);
  if(JSON.stringify(config).includes(encodedKey)) throw new ModelConfigurationError("MODEL_CONFIG_INVALID");
  if (controlled && controlled.purpose !== "controlled-test") throw new ModelConfigurationError("MODEL_CONFIG_INVALID");
  const approved = config.approvedModels.find(m => m.provider === config.selected.provider && m.modelId === config.selected.modelId && m.api === config.selected.api)!;
  const sdkDriver = controlled?.streams ?? getApiProvider(approved.api);
  if (!sdkDriver || typeof sdkDriver.stream !== "function" || typeof sdkDriver.streamSimple !== "function")
    throw new ModelConfigurationError("MODEL_TRANSPORT_UNAVAILABLE");
  try {
    const model: Model<typeof approved.api> = {
      id: approved.modelId, provider: approved.provider, api: approved.api, baseUrl: approved.baseUrl,
      name: approved.modelId, input: ["text"], reasoning: approved.reasoning, contextWindow: approved.contextWindow,
      maxTokens: approved.maxOutputTokens, cost: { ...approved.cost },
    };
    const runtime = await createIsolatedModelRuntime();
    // SDK 1.4.0 registration invokes refresh() implicitly. Delegate the public refresh API with a
    // mandatory finite provider list; never scan other providers' ambient auth/catalogs.
    const refresh = runtime.refresh.bind(runtime);
    runtime.refresh = options => refresh({ ...options, providers: [approved.provider], allowNetwork: false });
    const provider = createProvider({
      id: approved.provider, name: approved.provider, baseUrl: approved.baseUrl, models: [model],
      auth: { apiKey: {
        name: "Explicit deployment key",
        check: async () => ({ type: "api_key", source: "explicit deployment" }),
        // Literal closure: no models.json interpolation, shell command, env lookup, OAuth or fallback.
        resolve: async () => ({ auth: { apiKey: literalApiKey }, source: "explicit deployment" }),
      } },
      api: {
        stream: (selected, context, options) => sdkDriver.stream(selected, context, { ...options, apiKey: literalApiKey, maxRetries: 0 }),
        streamSimple: (selected, context, options) => sdkDriver.streamSimple(selected, context, { ...options, apiKey: literalApiKey, maxRetries: 0 }),
      },
    });
    runtime.registerNativeProvider(provider);
    const checked = await runtime.refresh({ allowNetwork: false, providers: [approved.provider] });
    if (checked.aborted || checked.errors.size || !runtime.hasConfiguredAuth(approved.provider)) throw new ModelConfigurationError("MODEL_INITIALIZATION_FAILED");
    const pi = new PiRuntime(runtime, model);
    const models = Object.freeze(config.approvedModels.map(m => Object.freeze({provider:m.provider,modelId:m.modelId,api:m.api})));
    const policy: EntryPolicy = Object.freeze({ models, tools: receptionToolPolicy });
    const allowed = new Set(models.map(m => `${m.provider}\0${m.modelId}\0${m.api}`));
    // Do not return the raw ModelRuntime, provider/auth objects, configuration or secret-bearing model.
    const assertNoKey = (value: unknown) => {
      // Inspect actual strings as well as serialized JSON. A normalized reply
      // may contain JSON inside a text block, adding another escaping layer.
      const containsKey = (item: unknown): boolean => {
        if(typeof item === "string")return item.includes(literalApiKey)||item.includes(encodedKey);
        if(Array.isArray(item))return item.some(containsKey);
        if(item && typeof item === "object")return Object.entries(item).some(([key,value])=>containsKey(key)||containsKey(value));
        return false;
      };
      if (containsKey(value)) throw new ModelExecutionError("MODEL_DATA_REJECTED");
    };
    const facade: AgentRuntime = Object.freeze({ run: async (input: Parameters<AgentRuntime["run"]>[0]) => {
      const provided = new Set(input.policy.models.map(m => `${m.provider}\0${m.modelId}\0${m.api}`));
      if (!isReceptionToolPolicy(input.policy.tools) || provided.size !== allowed.size || input.policy.models.length !== allowed.size
        || [...provided].some(identity => !allowed.has(identity))) throw new ModelConfigurationError("MODEL_NOT_APPROVED");
      try {
        assertNoKey(input.inputText);assertNoKey(input.history);
        await pi.run({...input,
          trace: input.trace ? (type,data) => input.trace!(type,sanitizeTraceData(data,[literalApiKey])) : undefined,
          saveBatch:input.saveBatch?async entries=>{assertNoKey(entries);const mapped=await input.saveBatch!(entries);assertNoKey(mapped);return mapped;}:undefined,
          save: async entry => {assertNoKey(entry);await input.save(entry);},
          snapshot: async (key,text) => {assertNoKey({key,text});await input.snapshot(key,text);},
        });
      } catch (error) {
        if(error instanceof ModelExecutionError) throw error;
        // No raw SDK/provider error (including credentials) escapes this configured boundary.
        const reason = error instanceof Error && Object.hasOwn(executionReasons, error.message)
          ? executionReasons[error.message as keyof typeof executionReasons] : "model_request_failed";
        throw new ModelExecutionError("MODEL_REQUEST_FAILED", reason);
      }
    } });
    return Object.freeze({ status: "configured", runtime: facade, policy, documentProcessor:new PiDocumentProcessor(runtime,model,literalApiKey), selected: Object.freeze({...config.selected}) });
  } catch (error) {
    if (error instanceof ModelConfigurationError) throw error;
    // SDK initialization errors may include request/config/auth data. Keep only this finite code.
    throw new ModelConfigurationError("MODEL_INITIALIZATION_FAILED");
  }
}

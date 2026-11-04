import { z } from "zod";
import { assertSafeText } from "./entry-codec.js";

// Supported SDK wire protocols, never vendor/model defaults. Ambient cloud/OAuth auth is excluded.
export const AgentModelApi = z.enum([
  "openai-completions", "openai-responses", "anthropic-messages",
  "google-generative-ai", "mistral-conversations", "pi-messages",
]);
const provider = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);
const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/);
const endpoint = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
});
const count = z.number().int().positive().max(2147483647);
const rate = z.number().finite().nonnegative();
export const ApprovedAgentModel = z.strictObject({
  provider, modelId, api: AgentModelApi, baseUrl: endpoint,
  contextWindow: count, maxOutputTokens: count, reasoning: z.boolean(),
  cost: z.strictObject({ input: rate, output: rate, cacheRead: rate, cacheWrite: rate }),
}).refine(model => model.maxOutputTokens <= model.contextWindow);
export const AgentModelConfig = z.strictObject({
  version: z.literal(1), approvedModels: z.array(ApprovedAgentModel).min(1).max(16),
  selected: z.strictObject({ provider, modelId, api: AgentModelApi }),
});
export type AgentModelConfig = z.infer<typeof AgentModelConfig>;
export type ApprovedAgentModel = z.infer<typeof ApprovedAgentModel>;
export type ModelConfigurationCode = "MODEL_CONFIG_INVALID" | "MODEL_CONFIG_INCOMPLETE" | "MODEL_NOT_APPROVED" | "MODEL_TRANSPORT_UNAVAILABLE" | "MODEL_INITIALIZATION_FAILED";
export class ModelConfigurationError extends Error {
  constructor(readonly code: ModelConfigurationCode) { super(code); }
}
export function parseAgentModelConfig(value: unknown): AgentModelConfig {
  try {
    const parsed = AgentModelConfig.parse(value);
    const seen = new Set<string>();
    for (const model of parsed.approvedModels) {
      assertSafeText(model.provider); assertSafeText(model.modelId); assertSafeText(model.baseUrl);
      const identity = `${model.provider}\0${model.modelId}`;
      if (seen.has(identity)) throw new ModelConfigurationError("MODEL_CONFIG_INVALID");
      seen.add(identity);
    }
    const selected = parsed.selected;
    if (!parsed.approvedModels.some(m => m.provider === selected.provider && m.modelId === selected.modelId && m.api === selected.api))
      throw new ModelConfigurationError("MODEL_NOT_APPROVED");
    return parsed;
  } catch (error) {
    if (error instanceof ModelConfigurationError) throw error;
    // Never surface Zod issues, raw configuration, endpoint credentials or an input key.
    throw new ModelConfigurationError("MODEL_CONFIG_INVALID");
  }
}

/**
 * AI Router — task-class → model mapping.
 *
 * A thin, PURE resolver layer over the existing sovereign gateway. It does NOT open connections,
 * pick providers, or change the fail-closed guard (that stays in ai-gateway.ts / gatewayEnv). It
 * only answers: "for this task class, which model spec should the gateway request?"
 *
 * Every class maps to an OPTIONAL env override; when unset it falls back through the existing
 * chain (AI_AGENT_MODEL → AI_PROVIDER_MODEL → DEFAULT_MODEL_SPEC). All specs are "openai-compat/…",
 * so routing NEVER selects a proprietary provider — sovereignty is unaffected. The gateway still
 * fails closed on missing AI_GATEWAY_BASE_URL / AI_GATEWAY_API_KEY.
 *
 * Sizing GPU/vLLM later: point each AI_MODEL_<CLASS> env at whatever your gateway hosts (a big
 * reasoning model for `reasoning`, a small fast model for `fast`/`extraction`) with zero agent code
 * changes.
 */

import { DEFAULT_MODEL_SPEC } from "./ai-gateway";

export type TaskClass =
  | "fast"           // instant conversational turns, cheap classification
  | "reasoning"      // deep multi-step reasoning, adjudication, agent loops
  | "extraction"     // structured tool-use extraction (discovery, enrichment)
  | "summarization"  // condensing text (digests, transcript summaries)
  | "support"        // help-center diagnostic assistant
  | "meeting"        // meeting prep / transcript reasoning
  | "discovery";     // prospect/lead extraction + enrichment

/** The env var that overrides each class's model (all optional). */
const ENV_BY_CLASS: Record<TaskClass, string> = {
  fast: "AI_MODEL_FAST",
  reasoning: "AI_MODEL_REASONING",
  extraction: "AI_MODEL_EXTRACTION",
  summarization: "AI_MODEL_SUMMARIZATION",
  support: "AI_MODEL_SUPPORT",
  meeting: "AI_MODEL_MEETING",
  discovery: "AI_MODEL_DISCOVERY",
};

export const TASK_CLASSES = Object.keys(ENV_BY_CLASS) as TaskClass[];

function baseModelSpec(): string {
  return (
    process.env.AI_AGENT_MODEL ||
    process.env.AI_PROVIDER_MODEL ||
    DEFAULT_MODEL_SPEC
  );
}

/**
 * Resolve a task class to a model SPEC (e.g. "openai-compat/gpt-oss-120b").
 * Priority: class-specific env → base model chain → DEFAULT_MODEL_SPEC.
 * `fast` additionally honours the legacy AI_FAST_MODEL if its own class env is unset.
 * Returns undefined ONLY when no class is given (caller then uses gateway default resolution).
 */
export function modelForClass(taskClass?: TaskClass): string | undefined {
  if (!taskClass) return undefined;
  const specific = process.env[ENV_BY_CLASS[taskClass]];
  if (specific && specific.trim()) return specific.trim();
  if (taskClass === "fast" && process.env.AI_FAST_MODEL?.trim()) return process.env.AI_FAST_MODEL.trim();
  return baseModelSpec();
}

/** A non-secret backend label for observability (never leaks the URL or key). */
export function backendLabel(): string {
  return process.env.AI_BACKEND_LABEL?.trim() || "openai-compat";
}

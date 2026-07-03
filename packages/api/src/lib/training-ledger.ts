/**
 * AI Training Ledger — best-effort capture of human-in-the-loop validation.
 *
 * Every time a human approves / rejects / edits an agent recommendation in the
 * Decision Queue, we snapshot the recommendation + the human's verdict into the
 * `ai_training_logs` table so it can later be exported for instruction tuning.
 *
 * Hard guarantee: this NEVER throws and is awaited only for a single fast insert
 * that swallows its own errors — a glitch in the ledger must never block or
 * delay a real user's workspace action.
 *
 * Privacy: prompts are run through `redactPII()` so API keys / tokens / cards /
 * SSNs AND ordinary PII (emails, phone numbers) never enter the training corpus —
 * a fine-tuning dataset is the wrong place for customer contact data.
 */
import { supabase } from "@mondaily/db/client";
import { redactPII } from "./ai-gateway";

export type TrainingAction = "APPROVED" | "REJECTED" | "EDITED";

/** Max characters allowed per prompt/output field in an EXPORTED training example. Oversized
 *  fields are truncated (not dropped) so one giant paste can't bloat/poison the corpus. */
export const MAX_EXAMPLE_CHARS = 20_000;

// Common prompt-injection lead-ins. Matches are neutralized (prefixed) on export so an example
// captured from user-influenced text can't act as an instruction when the corpus is reused.
const INJECTION_RE = /(ignore (?:all |the |your )?(?:previous|above|prior) (?:instructions|prompts?)|disregard (?:the |all )?(?:above|previous)|you are now\b|system prompt\s*:|<\/?(?:system|assistant|user)>|reveal (?:your )?(?:system )?prompt|override (?:your )?(?:instructions|rules))/gi;

/** Neutralize prompt-injection phrasing in a captured field without deleting content (so the
 *  example is still legible for review). Returns the defanged string. */
export function neutralizeInjection(text: string): string {
  if (!text) return text;
  return text.replace(INJECTION_RE, (m) => `[NEUTRALIZED_INSTRUCTION:${m.slice(0, 24)}…]`);
}

export interface ExportRow {
  agent_name?: string | null;
  system_prompt?: string | null;
  user_prompt?: string | null;
  model_output?: unknown;
  user_action?: string | null;
  edited_output?: unknown;
  created_at?: string | null;
}

/** Redact + injection-neutralize one string, with the export size cap. */
function cleanString(v: string): string {
  const red = neutralizeInjection(redactPII(v));
  return red.length > MAX_EXAMPLE_CHARS ? `${red.slice(0, MAX_EXAMPLE_CHARS)}…[TRUNCATED]` : red;
}

/**
 * Recursively redact every STRING inside a JSON value while PRESERVING structure (keys, arrays,
 * nesting, numbers, booleans, null). This is what scrubs sensitive values buried in model_output /
 * edited_output — nested `evidence[].title`, `recommended_action`, `candidate.email`,
 * `contact.email`, etc. — which are exactly where contact emails/phones hide. Depth-guarded so a
 * pathologically nested payload can't blow the stack.
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[REDACTED_DEPTH_LIMIT]";
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, depth + 1);
    return out;
  }
  return value; // numbers / booleans / null pass through unchanged
}

/**
 * Sanitize ONE row for export. Returns null for empty examples (dropped), truncates oversized
 * fields, neutralizes prompt-injection, and — critically — DEEP-redacts the JSON payloads
 * (model_output, edited_output) so PII/secrets nested in evidence/candidate/contact fields never
 * leave the workspace. Redaction already runs at capture time; this is the last line of defense on
 * every export (covers legacy / pre-opt-in / pre-sanitizer rows).
 */
export function sanitizeExportRow(row: ExportRow): ExportRow | null {
  const clean = (v: string | null | undefined): string | null => {
    if (!v || !v.trim()) return null;
    return cleanString(v);
  };
  const system_prompt = clean(row.system_prompt);
  const user_prompt = clean(row.user_prompt);
  // Empty example: no usable prompt content on either side → drop it.
  if (!system_prompt && !user_prompt) return null;
  return {
    agent_name: row.agent_name ?? null,
    system_prompt,
    user_prompt,
    model_output: row.model_output != null ? redactDeep(row.model_output) : null,
    user_action: row.user_action ?? null,
    edited_output: row.edited_output != null ? redactDeep(row.edited_output) : null,
    created_at: row.created_at ?? null,
  };
}

export interface TrainingPolicy { enabled: boolean; retention_days: number }
const DEFAULT_POLICY: TrainingPolicy = { enabled: false, retention_days: 365 }; // opt-in by default

/** The workspace's training-data policy (defaults to disabled = opt-in). */
export async function getTrainingPolicy(workspaceId: string): Promise<TrainingPolicy> {
  try {
    const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
    const p = (data?.settings as { training_policy?: Partial<TrainingPolicy> } | null)?.training_policy;
    return { enabled: !!p?.enabled, retention_days: Number(p?.retention_days ?? DEFAULT_POLICY.retention_days) };
  } catch { return DEFAULT_POLICY; }
}
async function trainingEnabled(workspaceId: string): Promise<boolean> {
  return (await getTrainingPolicy(workspaceId)).enabled;
}

/**
 * Flush one decision_queue row (the agent's "model output" that a human just
 * judged) into the training ledger. The literal system prompt lives in the
 * generation layer, not here, so it is left null rather than fabricated.
 */
export async function logDecisionTrainingExample(
  workspaceId: string,
  decision: Record<string, unknown> | null | undefined,
  action: TrainingAction,
  editedOutput?: Record<string, unknown> | null,
): Promise<void> {
  try {
    if (!decision) return;

    // OPT-IN gate: capture only when the workspace has explicitly enabled training-data collection.
    // Default is OFF — a workspace's data never enters the training corpus unless the owner opts in.
    if (!(await trainingEnabled(workspaceId))) return;

    // Prefer the REAL generating prompt/output: LLM-generated decisions (prospecting,
    // vertical agents, chat) store {system_prompt, user_prompt, model_output} in
    // generation_context. Rule-based decisions (e.g. invoice_chaser) have none, so we
    // fall back to reconstructing from the decision fields (system_prompt stays null).
    const gen = decision.generation_context as { system_prompt?: string; user_prompt?: string; model_output?: unknown } | null | undefined;

    const systemPrompt = gen?.system_prompt ? redactPII(gen.system_prompt) : null;
    const userPrompt = redactPII(
      gen?.user_prompt ??
        [decision.title, decision.summary, decision.recommended_action]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join("\n\n"),
    );
    const modelOutput = gen?.model_output ?? {
      title: decision.title ?? null,
      summary: decision.summary ?? null,
      recommended_action: decision.recommended_action ?? null,
      risk_level: decision.risk_level ?? null,
      confidence: decision.confidence ?? null,
      evidence: decision.evidence ?? [],
    };

    await supabase.from("ai_training_logs").insert({
      workspace_id: workspaceId,
      agent_name: (decision.agent_name as string | undefined) ?? null,
      system_prompt: systemPrompt,
      user_prompt: userPrompt || null,
      model_output: modelOutput,
      user_action: action,
      edited_output: editedOutput ?? null,
    });
  } catch (err) {
    // Swallow — the ledger is observability, never a gate on the user's action.
    console.error("[training-ledger] capture failed (non-fatal):", err);
  }
}

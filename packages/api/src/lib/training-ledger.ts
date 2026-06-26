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

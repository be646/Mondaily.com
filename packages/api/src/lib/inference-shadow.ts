import { supabase } from "@mondaily/db/client";
import { sovereignVllmConfigured, sovereignBackendConfig, inferenceMode } from "./inference-backend";

/**
 * Shadow evaluation — mirrors a sampled slice of REAL gateway traffic to the sovereign vLLM
 * engine and logs a metadata-only comparison, with ZERO user exposure. This is how the local
 * engine EARNS live traffic per task class, instead of being flipped on and hoped about.
 *
 * CONTRACT (guarded):
 *   • runs only when the primary backend is the cloud gateway AND vLLM is configured AND
 *     SOVEREIGN_VLLM_SHADOW_PCT > 0 — three explicit switches, all off by default
 *   • fire-and-forget: a shadow failure can NEVER affect the user's response
 *   • METADATA ONLY: latencies, token counts, char lengths, word-set similarity — the shadow
 *     response text is compared in memory and DISCARDED; prompts are never persisted here
 *   • never meters credits (evaluation is not product usage)
 *   • fail-soft: table missing (migration unapplied) → silently no-op
 */

export interface ShadowInput {
  workspaceId?: string;
  taskClass?: string;
  feature?: string;
  messages: { role: string; content: string }[];
  /** When mirroring a structured tool-use call, the same tools/tool_choice body is forwarded so
   *  the shadow engine attempts the SAME structured extraction; its tool-call arguments (or plain
   *  content as a fallback) become the compared text. */
  toolsBody?: { tools: unknown[]; tool_choice: unknown };
  primary: { model: string; latencyMs: number; text: string; tokens: number };
}

function shadowPct(): number {
  const n = Number(process.env.SOVEREIGN_VLLM_SHADOW_PCT ?? 0);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

export function shadowEnabled(): boolean {
  return inferenceMode() === "gateway" && sovereignVllmConfigured() && shadowPct() > 0;
}

/** Word-set Jaccard similarity, 0-100. Crude but honest — and computable without storing text. */
export function jaccardPct(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const A = words(a), B = words(b);
  if (A.size === 0 && B.size === 0) return 100;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 100);
}

/** Fire-and-forget mirror. Await-safe (never throws), but callers should void it. */
export async function maybeShadowMirror(input: ShadowInput): Promise<void> {
  try {
    if (!shadowEnabled()) return;
    if (!input.primary.text.trim()) return;   // nothing to compare against — skip, don't skew stats
    if (Math.random() * 100 >= shadowPct()) return;
    const cfg = sovereignBackendConfig();
    const base = cfg.baseURL.replace(/\/$/, "");
    const t0 = Date.now();
    let shadow: { ok: boolean; latency: number; tokens: number | null; text: string; error: string | null };
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.modelOverride, max_tokens: 1024, messages: input.messages, ...(input.toolsBody ?? {}) }),
        signal: AbortSignal.timeout(25000),
      });
      const latency = Date.now() - t0;
      if (!r.ok) shadow = { ok: false, latency, tokens: null, text: "", error: `HTTP ${r.status}` };
      else {
        const j = await r.json() as { choices?: { message?: { content?: string; tool_calls?: { function?: { arguments?: string } }[] } }[]; usage?: { total_tokens?: number } };
        const msg = j.choices?.[0]?.message;
        const text = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content ?? "";
        shadow = { ok: true, latency, tokens: j.usage?.total_tokens ?? null, text, error: null };
      }
    } catch (e) {
      shadow = { ok: false, latency: Date.now() - t0, tokens: null, text: "", error: e instanceof Error ? e.message.slice(0, 200) : "unreachable" };
    }

    const row = {
      workspace_id: input.workspaceId ?? "unscoped",
      task_class: input.taskClass ?? null,
      feature: input.feature ?? null,
      primary_model: input.primary.model,
      primary_latency_ms: Math.round(input.primary.latencyMs),
      primary_tokens: input.primary.tokens,
      primary_chars: input.primary.text.length,
      shadow_model: cfg.modelOverride,
      shadow_ok: shadow.ok,
      shadow_latency_ms: Math.round(shadow.latency),
      shadow_tokens: shadow.tokens,
      shadow_chars: shadow.text.length,
      similarity_pct: shadow.ok ? jaccardPct(input.primary.text, shadow.text) : null,
      error: shadow.error,
    };
    // texts end here — only the metadata row persists (fail-soft on missing table)
    await supabase.from("inference_shadow_runs").insert(row).then(() => {}, () => {});
  } catch { /* shadow must never surface */ }
}

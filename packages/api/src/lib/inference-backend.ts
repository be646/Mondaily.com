/**
 * Inference backend registry — the ONE place that decides which engine serves the gateway.
 *
 * Two real modes (no fictional ones — modes exist only when the infrastructure does):
 *   • "gateway"        — the existing sovereign openai-compatible cloud gateway (default)
 *   • "sovereign_vllm" — a self-hosted vLLM/OpenAI-compatible engine (PagedAttention host)
 *
 * SOVEREIGNTY CONTRACT (guarded):
 *   • FAIL CLOSED PER MODE: sovereign mode with missing/unreachable engine is an honest error —
 *     NEVER a silent fallback to a cloud endpoint. Crossing that boundary is a breach, not a retry.
 *   • The probe MEASURES: served model ids from /v1/models and a real 1-token TTFT. It never
 *     invents engine internals (no fake "PagedAttention: active" lights — vLLM doesn't report it).
 *   • Nothing here logs or returns the API key; the URL is reported host-only.
 *
 * Env: SOVEREIGN_INFERENCE_MODE=sovereign_vllm · SOVEREIGN_VLLM_URL=http://host:8000/v1
 *      SOVEREIGN_VLLM_MODEL=<served model id> · SOVEREIGN_VLLM_KEY (optional; vLLM often keyless)
 */

export type InferenceMode = "gateway" | "sovereign_vllm";

export function inferenceMode(): InferenceMode {
  return (process.env.SOVEREIGN_INFERENCE_MODE ?? "").trim() === "sovereign_vllm" ? "sovereign_vllm" : "gateway";
}

export interface BackendConfig { kind: InferenceMode; baseURL: string; apiKey: string; modelOverride: string | null }

/** Resolve the active backend. Throws (fail-closed) when sovereign mode is selected but unconfigured. */
export function sovereignBackendConfig(): BackendConfig {
  const baseURL = (process.env.SOVEREIGN_VLLM_URL ?? "").trim();
  const model = (process.env.SOVEREIGN_VLLM_MODEL ?? "").trim();
  if (!baseURL) throw new Error("[inference] SOVEREIGN_INFERENCE_MODE=sovereign_vllm but SOVEREIGN_VLLM_URL is not set — refusing to route anywhere else. Sovereign mode fails closed.");
  if (!model) throw new Error("[inference] SOVEREIGN_VLLM_MODEL is not set — the served model id is required in sovereign mode.");
  return { kind: "sovereign_vllm", baseURL, apiKey: (process.env.SOVEREIGN_VLLM_KEY ?? "").trim() || "sovereign-local", modelOverride: model };
}

export function sovereignVllmConfigured(): boolean {
  return !!(process.env.SOVEREIGN_VLLM_URL ?? "").trim() && !!(process.env.SOVEREIGN_VLLM_MODEL ?? "").trim();
}

/**
 * Honest handshake — everything reported is MEASURED against the real engine:
 *   models_ms      round-trip of GET /v1/models
 *   served_models  what the engine says it serves (first 10 ids)
 *   ttft_ms        wall time of a real 1-token completion (streaming first-token proxy)
 * Never throws; never returns the key; URL reported host-only.
 */
export async function sovereignVllmProbe(): Promise<{
  configured: boolean; ok: boolean; host: string | null;
  models_ms: number | null; served_models: string[]; model_served: boolean | null;
  ttft_ms: number | null; error: string | null;
}> {
  const none = { configured: false, ok: false, host: null, models_ms: null, served_models: [], model_served: null, ttft_ms: null, error: null as string | null };
  if (!sovereignVllmConfigured()) return { ...none, error: "SOVEREIGN_VLLM_URL / SOVEREIGN_VLLM_MODEL not set" };
  let cfg: BackendConfig;
  try { cfg = sovereignBackendConfig(); } catch (e) { return { ...none, error: String(e instanceof Error ? e.message : e) }; }
  let host: string | null = null;
  try { host = new URL(cfg.baseURL).host; } catch { return { ...none, configured: true, error: "SOVEREIGN_VLLM_URL is not a valid URL" }; }

  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  const base = cfg.baseURL.replace(/\/$/, "");
  try {
    const t0 = Date.now();
    const mr = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(6000) });
    const models_ms = Date.now() - t0;
    if (!mr.ok) return { ...none, configured: true, host, models_ms, error: `GET /models → ${mr.status}` };
    const mj = await mr.json().catch(() => null) as { data?: { id?: string }[] } | null;
    const served_models = (mj?.data ?? []).map(m => String(m.id ?? "")).filter(Boolean).slice(0, 10);
    const model_served = served_models.length > 0 ? served_models.includes(cfg.modelOverride!) : null;

    const t1 = Date.now();
    const cr = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.modelOverride, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      signal: AbortSignal.timeout(15000),
    });
    const ttft_ms = Date.now() - t1;
    if (!cr.ok) return { configured: true, ok: false, host, models_ms, served_models, model_served, ttft_ms, error: `POST /chat/completions → ${cr.status}` };
    return { configured: true, ok: true, host, models_ms, served_models, model_served, ttft_ms, error: null };
  } catch (e) {
    return { ...none, configured: true, host, error: e instanceof Error ? e.message : "unreachable" };
  }
}

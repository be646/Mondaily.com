/**
 * AI Gateway — Cerebras-only generation utility.
 *
 * Mondaily runs ALL primary inference through its own openai-compatible
 * streaming gateway (Cerebras). There is no Anthropic/OpenAI provider branch at
 * the source layer, and no silent fallback to api.openai.com / api.anthropic.com.
 *
 * Routing is controlled by environment variables:
 *
 *   AI_PROVIDER_MODEL = "openai-compat/<model-id>"   (default: gpt-oss-120b)
 *   AI_AGENT_MODEL    = same format — overrides AI_PROVIDER_MODEL for the
 *                       multi-round agentic loop (aiGatewayAgent) only.
 *
 *   AI_GATEWAY_BASE_URL  the Cerebras openai-compatible endpoint (REQUIRED —
 *                        the gateway throws if it is unset, rather than leaking
 *                        traffic to a default OpenAI endpoint)
 *   AI_GATEWAY_API_KEY   the Cerebras gateway key (REQUIRED)
 *
 * Three exported functions:
 *   aiGateway        — plain text generation (no tools)
 *   aiGatewayToolUse — single-tool structured extraction
 *   aiGatewayAgent   — multi-round agentic loop (Cerebras only)
 *
 * On failure: on 404 try the configured fallback model IDs → if all fail, a
 * graceful reply string is returned (never throws to caller). No proprietary
 * third-party provider is ever used as a fallback.
 */

import OpenAI from "openai";
import { recordAiUsage } from "./ai-usage";
import { assertCreditsOk, CreditsExhaustedError } from "./credits";
import { modelForClass, backendLabel as routerBackendLabel, type TaskClass } from "./ai-router";
import { inferenceMode, sovereignBackendConfig, classIsSovereign } from "./inference-backend";
import { maybeShadowMirror } from "./inference-shadow";

/** Observability label for the ACTIVE backend — "sovereign-vllm" when the local engine serves. */
function backendLabel(): string {
  return inferenceMode() === "sovereign_vllm" ? "sovereign-vllm" : routerBackendLabel();
}

/**
 * Derive a cache status from the completion's usage, when the backend exposes prompt caching.
 * OpenAI-compat + vLLM prefix caching report `prompt_tokens_details.cached_tokens`. Returns
 * "hit"/"miss" when the field is present, else null (no signal → honest null, never guessed).
 */
function cacheStatusFrom(usage: unknown): "hit" | "miss" | null {
  const cached = (usage as { prompt_tokens_details?: { cached_tokens?: number } } | null | undefined)?.prompt_tokens_details?.cached_tokens;
  if (typeof cached !== "number") return null;
  return cached > 0 ? "hit" : "miss";
}

// ── Shared types ────────────────────────────────────────────────────────────────

export type GatewayRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** When set, the call is credit-gated (fail closed) and its real token usage is metered to the
   *  workspace wallet + ai_usage. Omit ONLY for genuinely workspace-less calls (e.g. anonymous
   *  marketing chat), which still route through the sovereign gateway and fail closed on missing env. */
  workspaceId?: string;
  userId?: string;
  feature?: string;
  /** Phase-1 routing/observability (all optional, additive). taskClass picks the model via the
   *  AI router; sourceCount/refusalReason are recorded to ai_usage for the Control Room. */
  taskClass?: TaskClass;
  sourceCount?: number;
  refusalReason?: string;
  onUsage?: (u: { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens: number }) => void;
};

export type GatewayResponse = {
  text: string;
  provider: string;
  model: string;
};

export type GatewayToolRequest = {
  prompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  maxTokens?: number;
  system?: string;
  /** Optional model spec override (e.g. the fast model for cheap batch scoring). */
  model?: string;
  /** Optional task class — resolves the model via the AI router when `model` isn't given. */
  taskClass?: TaskClass;
  /** Optional: receive the real provider token usage for this call (for per-job telemetry). */
  onUsage?: (u: { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens: number }) => void;
  /** When set, token usage is metered to ai_usage + the credit wallet automatically (default
   *  metering for every background/agent tool call — no per-caller onUsage wiring needed). */
  workspaceId?: string;
  userId?: string;
  /** Tags the metered usage row with the product surface (e.g. "discovery", "chat") for the
   *  per-feature usage dashboard. */
  feature?: string;
  /** Phase-1 observability — grounding source count recorded to ai_usage (optional). */
  sourceCount?: number;
};

// ── Internal routing ────────────────────────────────────────────────────────────

type ResolvedModel = { type: "openai-compat"; modelId: string };

// Cerebras-powered default. Mondaily runs primary inference exclusively on its
// own openai-compatible streaming gateway (AI_GATEWAY_BASE_URL → Cerebras).
// No proprietary Anthropic/OpenAI endpoint is referenced at the default layer.
export const DEFAULT_MODEL_SPEC = "openai-compat/gpt-oss-120b";

function resolveModel(spec?: string, taskClass?: string): ResolvedModel {
  // Sovereign-routed classes serve ONE declared model — the engine's served id overrides every
  // spec so a task-class alias can never request a model the local engine doesn't host. In hybrid
  // mode this applies ONLY to the classes evidence has cleared (see inference-backend).
  if (classIsSovereign(taskClass)) {
    return { type: "openai-compat", modelId: sovereignBackendConfig().modelOverride! };
  }
  const s = spec ?? process.env.AI_PROVIDER_MODEL ?? DEFAULT_MODEL_SPEC;
  const modelId = s.startsWith("openai-compat/") ? s.slice("openai-compat/".length) : s;
  return { type: "openai-compat", modelId: modelId || "gpt-oss-120b" };
}

// ── Fast-model routing ──────────────────────────────────────────────────────────
//
// Two-tier model strategy, decided natively in the gateway chokepoint:
//   • Deep / data / tool-use turns  → the heavy reasoning model (AI_AGENT_MODEL,
//     e.g. gpt-oss-120b) with the full tool set.
//   • Clearly conversational turns  → a small fast model (AI_FAST_MODEL, e.g.
//     zai-glm-4.7) with NO tools — instant time-to-first-token for "hi",
//     "thanks", "what can you do", etc.
//
// The classifier is deliberately CONSERVATIVE: a turn only takes the fast/no-tool
// path when it clearly looks conversational AND shows no data intent, so we never
// strip tools from a real workspace question.

// Conversational turns route here. Default MUST be a model the Cerebras gateway
// actually hosts — the old "zai-glm-4.7" default isn't on Cerebras, so every
// non-data chat ("hi") 404'd and fell through to the "trouble connecting" reply.
// Fall back to the proven main model; set AI_FAST_MODEL to a real faster Cerebras
// model (e.g. llama3.1-8b) if you want a lighter conversational tier.
const FAST_MODEL_SPEC = process.env.AI_FAST_MODEL ?? DEFAULT_MODEL_SPEC;

/**
 * BOUND WHAT A TOOL CAN PUT INTO THE PROMPT.
 *
 * Every tool result is appended to the conversation and RE-SENT on every subsequent round, so an
 * oversized one is not paid once — it is paid again for each remaining round, and it stays in the
 * prompt for the rest of the turn.
 *
 * MEASURED against production on 2026-08-13, which is what prompted this:
 *
 *   fixed floor (system prompt + tool schemas)   ~4,400 tokens
 *   observed chat prompts                        median 8,514, MAX 30,783
 *   largest prompts                              60-122 SECONDS to answer
 *
 * The floor is small, so essentially all of that 30k is tool output. It is also why Ask hits a
 * tokens-per-minute ceiling at only 7 requests/minute: a couple of large questions spend the
 * whole budget. Slow and rate-limited are the same bug wearing two hats.
 *
 * Individual tools already cap their ROW counts, but rows vary hugely in width and nothing bounded
 * the total — a per-tool cap cannot, because the cost is the SUM across tools and rounds. So the
 * limit lives here, at the one place every result passes through, and it is a character budget
 * rather than a row count because characters are what actually cost.
 *
 * Truncation is ANNOUNCED to the model, never silent: a quietly cut list reads as a complete answer
 * and the model will confidently report "3 invoices" when there were 40. Telling it the result was
 * cut lets it say so, or narrow the query and ask again.
 */
const TOOL_RESULT_CHAR_CAP = 6_000;      // ≈1,600 tokens — comfortably fits a 20-row list
const TOOL_BUDGET_CHAR_CAP = 24_000;     // ≈6,500 tokens for ALL tool output in one turn

export function boundToolResult(raw: string, spent: number, toolName: string): { text: string; used: number } {
  const text = String(raw ?? "");
  const remaining = Math.max(0, TOOL_BUDGET_CHAR_CAP - spent);

  if (remaining === 0) {
    return {
      text: `[${toolName}: omitted — this turn has already gathered its maximum amount of data. ` +
            `Answer from what you have, and say plainly that the results were incomplete.]`,
      used: 0,
    };
  }

  const limit = Math.min(TOOL_RESULT_CHAR_CAP, remaining);
  if (text.length <= limit) return { text, used: text.length };

  // Cut on a line boundary so a row is never left half-written, which reads as corrupt data.
  const clipped = text.slice(0, limit);
  const lastNewline = clipped.lastIndexOf("\n");
  const body = lastNewline > limit * 0.5 ? clipped.slice(0, lastNewline) : clipped;

  console.log(`[gateway] tool result truncated: ${toolName} ${text.length} → ${body.length} chars`);
  return {
    text: `${body}\n[truncated: ${toolName} returned ${text.length.toLocaleString()} characters and was cut to fit. ` +
          `This list is INCOMPLETE — say so, or narrow the query with a filter and call it again.]`,
    used: body.length,
  };
}

/**
 * How long to wait before retrying a rate-limited call — the provider's own `Retry-After` when it
 * sends one, capped hard.
 *
 * The cap is the point. Obeying a 60-second Retry-After literally is what made chat "load forever"
 * once already, so this waits only long enough to clear a short burst window and otherwise gives up
 * and tells the user. Without any wait at all the retry lands inside the same spent quota and fails
 * in milliseconds, which is the bug this exists to fix.
 */
/**
 * The system prompt for a TOOL-LESS retry of a tool-expecting request.
 *
 * The rate-limit recovery strips tools (tool rounds multiply the very token spend that caused the
 * limit) but kept the original system prompt — which spends paragraphs telling the model it HAS
 * tools and must never deny them. Faced with that contradiction, the model improvised: it emitted
 * pseudo-XML tool syntax AS PROSE (<search_records><object_type>deals</object_type>…), and that
 * markup rendered to the user as the answer. Seen live 2026-08-15; the token ledger proved the
 * path (input = prompt with no tool schemas).
 *
 * The retry must be TOLD the truth about its own situation, and told to say it.
 */
const TOOLLESS_RETRY_NOTE =
  "\n\nRECOVERY MODE — tools are NOT available for this attempt. Do not emit tool-call syntax of any " +
  "kind (no XML tags, no function-call markup — it would render to the user as garbage text). Answer " +
  "from the conversation so far, and say plainly which parts you could not verify without tools.";

function retryAfterMs(err: unknown): number {
  const MAX_WAIT_MS = 3500;
  const e = err as { headers?: Record<string, string>; response?: { headers?: { get?: (k: string) => string | null } } };
  const raw = e?.headers?.["retry-after"] ?? e?.response?.headers?.get?.("retry-after") ?? null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
  // No header: a brief pause still beats an instant retry into the quota that just rejected us.
  return 1200;
}

// Captures the most recent REAL gateway failure (normally swallowed by the graceful
// "trouble connecting" fallback) so GET /api/v1/ask/health can surface it. Purely
// diagnostic — does not alter any chat behavior.
let lastGatewayError: { at: string; message: string; status?: number; when: string } | null = null;
/** Read the last captured gateway error (same-invocation reads are reliable;
 *  cross-invocation reads on serverless are not). */
export function getLastGatewayError() { return lastGatewayError; }

const CONVERSATIONAL_RE = /^\s*(hi|hey|hello|yo|sup|thanks|thank you|thx|ty|good (morning|afternoon|evening)|how are you|who are you|what(?:'s| is| are| can) you|what can you do|tell me about yourself|help|capabilities|ok(ay)?|cool|nice|great|awesome|got it|sounds good)\b/i;
const DATA_INTENT_RE = /\b(task|deal|contact|lead|invoice|report|list|note|record|company|companies|people|person|pipeline|finance|overdue|create|update|delete|add|remove|find|search|show|who|whose|how many|summar|enrich|prospect|decision|workflow|email|call|due|assign|revenue|stage|status|score|relationship)\b/i;

function routeAgentModel(req: AgentRequest): { spec: string; useTools: boolean; tier: "fast" | "deep" } {
  const requested = req.model ?? process.env.AI_AGENT_MODEL ?? process.env.AI_PROVIDER_MODEL ?? DEFAULT_MODEL_SPEC;
  const lastUser = [...req.messages].reverse().find(m => m.role === "user");
  const msg = (typeof lastUser?.content === "string" ? lastUser.content : "").trim();
  if (msg.length > 0 && msg.length < 80 && CONVERSATIONAL_RE.test(msg) && !DATA_INTENT_RE.test(msg)) {
    return { spec: FAST_MODEL_SPEC, useTools: false, tier: "fast" };
  }
  return { spec: requested, useTools: true, tier: "deep" };
}

/**
 * Outbound data sanitizer — masks raw secrets and financial identifiers in any
 * text before it leaves our infrastructure for an external model API.
 *
 * Scope is deliberate: it redacts things that must NEVER reach a third-party
 * LLM (API keys/tokens, JWTs, AWS keys, credit-card numbers, SSNs) but leaves
 * ordinary business data — names, and contact emails — intact, because that's
 * the legitimate payload the workspace assistant exists to reason over. Masking
 * every email would break contact lookups, enrichment, and chasing. Use
 * `redactPII` when you explicitly need email/phone masking too.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    // Provider API keys / tokens. Body allows hyphens/underscores so
    // hyphenated keys (e.g. sk-ant-api03-…, sk_live_…) don't slip through.
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:fw_|csk-|gsk_|xai-|ghp_|glpat-|cskk?-)[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    // JWTs / bearer tokens
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, "Bearer [REDACTED_TOKEN]")
    // Credit-card-like 13–16 digit runs (allow space/dash separators)
    .replace(/\b(?:\d[ -]?){13,16}\b/g, (m) => (/^\d{13,16}$/.test(m.replace(/[ -]/g, "")) ? "[REDACTED_CARD]" : m))
    // US SSN
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
}

/** Stricter variant that ALSO masks emails and phone numbers — opt-in only. */
export function redactPII(text: string): string {
  if (!text) return text;
  return redactSecrets(text)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b\+?\d[\d ()-]{8,}\d\b/g, "[REDACTED_PHONE]");
}

// 404 fallback models. Was a list of Fireworks IDs — but this gateway is Cerebras-ONLY, so those
// would themselves 404 and just burn the retry budget before the graceful reply. Populate via
// AI_FALLBACK_MODELS (comma-separated, real Cerebras model IDs) if you want a real fallback chain;
// empty by default so a 404 degrades straight to the friendly message.
const PROVIDER_FALLBACK_MODELS = (process.env.AI_FALLBACK_MODELS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

/** Resolve the sovereign gateway credentials. AI_GATEWAY_* is the SOLE, provider-
 *  neutral inference endpoint — no provider-specific env aliases, no default public
 *  endpoint. Point it at any openai-compatible server you control (self-hosted vLLM/
 *  Ollama/TGI for true sovereignty, or a sovereign-compatible hosted gateway). */
export function gatewayEnv(): { baseURL?: string; apiKey?: string } {
  return {
    baseURL: process.env.AI_GATEWAY_BASE_URL,
    apiKey: process.env.AI_GATEWAY_API_KEY,
  };
}

function openAIClient(taskClass?: string): OpenAI {
  // Backend registry: sovereign-routed classes go to the self-hosted engine and FAIL CLOSED when
  // it's unconfigured/unreachable — never a silent fallback across the sovereignty boundary.
  // CPU engines are slow by nature (measured 1-token TTFT ≈ 4.7s), so the sovereign client gets a
  // patient timeout; the fast-fail philosophy stays for the external gateway.
  if (classIsSovereign(taskClass)) {
    const cfg = sovereignBackendConfig();   // throws honestly when unconfigured
    return new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, timeout: 60000, maxRetries: 1 });
  }
  const { baseURL, apiKey } = gatewayEnv();

  // Sovereignty guard: never silently fall back to api.openai.com. If the
  // Cerebras gateway isn't configured, fail loudly rather than leak traffic to
  // a proprietary third-party endpoint.
  if (!baseURL) {
    throw new Error("[gateway] AI_GATEWAY_BASE_URL is not set — refusing to route inference to a default OpenAI endpoint. Configure your sovereign openai-compatible gateway base URL.");
  }
  if (!apiKey) {
    throw new Error("[gateway] AI_GATEWAY_API_KEY is not set — sovereign gateway credentials missing.");
  }

  return new OpenAI({
    baseURL,
    apiKey,
    // Fail FAST + clean on a provider stall (was 45s×2 ≈ 135s worst case, which
    // froze the chat). Short timeout, one quick retry for transient 5xx/429.
    timeout: 22000,
    maxRetries: 1,
  });
}

/**
 * Live gateway diagnostic — sends a 1-token "ping" to the resolved Cerebras model
 * and reports the REAL outcome (status + error message), never throwing. Used by
 * GET /api/v1/ask/health so a misconfigured gateway can be diagnosed in one click
 * instead of guessing at Sensitive env values. Leaks nothing secret: only the host
 * of the base URL and the model name.
 */
type ProbeResult = { ok: boolean; model: string; status?: number; error?: string };

export async function gatewayHealthCheck(opts?: { probe?: boolean }): Promise<{
  ok: boolean;
  baseURLHost: string | null;
  env: { AI_PROVIDER_MODEL: string | null; AI_AGENT_MODEL: string | null; AI_FAST_MODEL: string | null };
  tests?: { provider_plain: ProbeResult; agent_plain: ProbeResult; agent_with_tools: ProbeResult; fast_plain: ProbeResult };
  lastChatError?: typeof lastGatewayError;
  note?: string;
  error?: string;
}> {
  const { baseURL, apiKey } = gatewayEnv();
  const env = {
    AI_PROVIDER_MODEL: process.env.AI_PROVIDER_MODEL ?? null,
    AI_AGENT_MODEL: process.env.AI_AGENT_MODEL ?? null,
    AI_FAST_MODEL: process.env.AI_FAST_MODEL ?? null,
  };
  let baseURLHost: string | null = null;
  try { baseURLHost = baseURL ? new URL(baseURL).host : null; } catch { baseURLHost = baseURL ?? null; }

  if (!baseURL || !apiKey) {
    const missing = [!baseURL && "AI_GATEWAY_BASE_URL", !apiKey && "AI_GATEWAY_API_KEY"].filter(Boolean).join(" + ");
    return { ok: false, baseURLHost, env, error: `Missing env: ${missing}` };
  }

  // Default: a CHEAP check — env presence + the last real chat error. Makes NO
  // Cerebras calls, so reloading /health never eats your 5-req/min quota (that
  // was masking the real chat errors with 429s). Pass ?probe=1 to run live model
  // tests (costs 4 requests).
  if (!opts?.probe) {
    return {
      ok: true,
      baseURLHost,
      env,
      lastChatError: lastGatewayError,
      note: "env configured; no live probe run (add ?probe=1 to test models — costs 4 requests). lastChatError shows the most recent real chat failure.",
    };
  }

  const strip = (m: string) => m.replace(/^openai-compat\//, "");
  const providerModel = strip(env.AI_PROVIDER_MODEL ?? DEFAULT_MODEL_SPEC);
  const agentModel = strip(env.AI_AGENT_MODEL ?? env.AI_PROVIDER_MODEL ?? DEFAULT_MODEL_SPEC);
  // Conversational turns ("hi") route to the fast model — the surface that was 404ing.
  const fastModel = strip(FAST_MODEL_SPEC);
  const client = new OpenAI({ baseURL, apiKey, timeout: 12000, maxRetries: 0 });

  async function probe(model: string, withTools: boolean): Promise<ProbeResult> {
    try {
      await client.chat.completions.create({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
        ...(withTools
          ? {
              tools: [{ type: "function" as const, function: { name: "noop", description: "noop", parameters: { type: "object", properties: {} } } }],
              tool_choice: "auto" as const,
            }
          : {}),
      });
      return { ok: true, model };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      return { ok: false, model, status: err?.status, error: err?.message ?? String(e) };
    }
  }

  // Mirror what the chat path actually does: it resolves AI_AGENT_MODEL first and
  // sends tools. Test each axis so we see WHICH one breaks.
  // Space the probes ~600ms apart so the diagnostic itself doesn't trip Cerebras's
  // burst rate-limit and false-report a 429 (which made the 4th call look broken).
  const gap = () => new Promise<void>((r) => setTimeout(r, 600));
  const provider_plain = await probe(providerModel, false); await gap();
  const agent_plain = await probe(agentModel, false); await gap();
  const agent_with_tools = await probe(agentModel, true); await gap();
  const fast_plain = await probe(fastModel, false);
  const tests = { provider_plain, agent_plain, agent_with_tools, fast_plain };
  const ok = tests.provider_plain.ok && tests.agent_plain.ok && tests.agent_with_tools.ok && tests.fast_plain.ok;
  return { ok, baseURLHost, env, tests, lastChatError: lastGatewayError };
}

// ── Plain text generation ───────────────────────────────────────────────────────

export async function aiGateway(req: GatewayRequest): Promise<GatewayResponse> {
  // Credit gate — fail closed BEFORE inference when tied to a workspace. On exhaustion, return the
  // clear message as text (callers surface it) rather than throwing into their fallback paths.
  try { await assertCreditsOk(req.workspaceId); }
  catch (e) { if (e instanceof CreditsExhaustedError) return { text: e.message, provider: "none", model: "none" }; throw e; }

  // Task-class routing (additive): when a taskClass is given, resolve its model via the router;
  // otherwise resolveModel() keeps the exact prior default. Never selects a proprietary provider.
  const resolved = resolveModel(modelForClass(req.taskClass), req.taskClass);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: redactSecrets(req.system) });
  messages.push({ role: "user", content: redactSecrets(req.prompt) });

  const t0 = Date.now();
  const completion = await openAIClient(req.taskClass).chat.completions.create({
    model: resolved.modelId,
    // Reasoning models (e.g. gpt-oss) spend tokens "thinking" before emitting
    // the answer in `content`; a small budget gets fully consumed by reasoning
    // and leaves content empty. Keep a generous floor so content is produced.
    max_tokens: Math.max(req.maxTokens ?? 512, 2048),
    messages,
  });
  const latencyMs = Date.now() - t0;
  // Meter real token usage + observability to the workspace wallet + ai_usage.
  if (completion.usage) {
    const u = completion.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    const usage = { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? 0, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0 };
    if (req.onUsage) req.onUsage(usage);
    if (req.workspaceId && usage.total_tokens > 0) recordAiUsage(req.workspaceId, resolved.modelId, usage, {
      userId: req.userId, feature: req.feature, taskClass: req.taskClass, provider: backendLabel(),
      latencyMs, sourceCount: req.sourceCount, refusalReason: req.refusalReason, cacheStatus: cacheStatusFrom(completion.usage) ?? undefined,
    });
  }
  const msg = completion.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
  const text = (msg?.content && msg.content.trim()) ? msg.content : (msg?.reasoning ?? "");
  // Shadow evaluation — fire-and-forget mirror of this REAL request to the sovereign vLLM engine
  // (three explicit off-by-default switches inside; metadata-only logging; never affects the
  // response, never meters credits). This is how the local engine earns live traffic.
  void maybeShadowMirror({
    workspaceId: req.workspaceId, taskClass: req.taskClass, feature: req.feature,
    messages: messages.map(m => ({ role: String(m.role), content: typeof m.content === "string" ? m.content : "" })),
    primary: { model: resolved.modelId, latencyMs, text, tokens: (completion.usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0 },
  });
  return { text, provider: "openai-compat", model: resolved.modelId };
}

// ── Structured tool-use extraction ─────────────────────────────────────────────

export async function aiGatewayToolUse(req: GatewayToolRequest): Promise<Record<string, unknown>> {
  // Credit gate — fail closed BEFORE any inference (Discovery extraction, enrichment, report
  // generation, decision reasoning all flow through here). Throws CreditsExhaustedError if the
  // workspace is out of credits or over its burst cap. Callers degrade gracefully.
  await assertCreditsOk(req.workspaceId);
  // Explicit model wins; else task-class routing; else gateway default. Additive — unchanged when
  // neither is provided.
  const resolved = resolveModel(req.model ?? modelForClass(req.taskClass), req.taskClass ?? "extraction");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: redactSecrets(req.system) });
  messages.push({ role: "user", content: redactSecrets(req.prompt) });

  const t0 = Date.now();
  const completion = await openAIClient(req.taskClass ?? "extraction").chat.completions.create({
    model: resolved.modelId,
    max_tokens: req.maxTokens ?? 1024,
    messages,
    tools: [{
      type: "function",
      function: { name: req.toolName, description: req.toolDescription, parameters: req.toolSchema },
    }],
    tool_choice: { type: "function", function: { name: req.toolName } },
  });
  const latencyMs = Date.now() - t0;

  if (completion.usage) {
    const u = completion.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    const usage = {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
      reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    if (req.onUsage) req.onUsage(usage);
    // Default metering: every tool call with a workspaceId records to ai_usage + the credit wallet,
    // so background/agent inference (scoring, enrichment, generation) is no longer free/untracked.
    if (req.workspaceId && usage.total_tokens > 0) recordAiUsage(req.workspaceId, resolved.modelId, usage, {
      userId: req.userId, feature: req.feature, taskClass: req.taskClass ?? "extraction", provider: backendLabel(),
      latencyMs, sourceCount: req.sourceCount, cacheStatus: cacheStatusFrom(completion.usage) ?? undefined,
    });
  }

  const toolCall = completion.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return {};
  // Shadow evaluation for the STRUCTURED path — extraction is exactly the class a local model
  // would earn first, so its comparisons matter most. Same switches, fire-and-forget, metadata-only.
  void maybeShadowMirror({
    workspaceId: req.workspaceId, taskClass: req.taskClass ?? "extraction", feature: req.feature,
    messages: messages.map(m => ({ role: String(m.role), content: typeof m.content === "string" ? m.content : "" })),
    toolsBody: {
      tools: [{ type: "function", function: { name: req.toolName, description: req.toolDescription, parameters: req.toolSchema } }],
      tool_choice: { type: "function", function: { name: req.toolName } },
    },
    primary: { model: resolved.modelId, latencyMs, text: toolCall.function.arguments, tokens: (completion.usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0 },
  });
  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Plain completion (NO tools) on the openai-compat provider — for cheap, fast
 * batch tasks (e.g. per-deal lead scoring) where the fast model can answer but
 * does NOT support forced function-calling. Returns raw text (content, or
 * `reasoning` for reasoning models). Empty string on non-openai / error.
 */
export async function aiGatewayComplete(req: { prompt: string; system?: string; model?: string; maxTokens?: number; workspaceId?: string; userId?: string; feature?: string }): Promise<string> {
  // Credit gate — fail closed BEFORE inference when tied to a workspace (returns "" = no work done).
  try { await assertCreditsOk(req.workspaceId); }
  catch (e) { if (e instanceof CreditsExhaustedError) return ""; throw e; }

  const resolved = resolveModel(req.model);
  if (resolved.type !== "openai-compat") return "";
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: redactSecrets(req.system) });
  messages.push({ role: "user", content: redactSecrets(req.prompt) });
  try {
    const completion = await openAIClient().chat.completions.create({
      model: resolved.modelId,
      max_tokens: req.maxTokens ?? 512,
      messages,
    });
    // Meter usage to the wallet + ai_usage when tied to a workspace.
    if (completion.usage && req.workspaceId) {
      const u = completion.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
      const total = u.total_tokens ?? 0;
      if (total > 0) recordAiUsage(req.workspaceId, resolved.modelId, { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, total_tokens: total }, { userId: req.userId, feature: req.feature });
    }
    const m = completion.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
    // NEVER fall back to `reasoning`: on a reasoning model (gpt-oss-120b), empty content means the
    // token budget ran out mid-THOUGHT, and `reasoning` is raw chain-of-thought — the first live
    // Owner Memo returned "We need to produce 3 short paragraphs…" verbatim to the owner. An empty
    // string is honest; callers have deterministic fallbacks for exactly this.
    return m?.content?.trim() ? m.content : "";
  } catch {
    return "";
  }
}

// ── Multi-round agentic loop ────────────────────────────────────────────────────

export type AgentTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AgentRequest = {
  system: string;
  tools: AgentTool[];
  messages: Array<{ role: string; content: unknown }>;
  maxRounds?: number;
  maxTokens?: number;
  /** Full model spec, e.g. "openai-compat/gpt-oss-120b".
   *  Overrides AI_AGENT_MODEL env var when provided. */
  model?: string;
  /** Cost telemetry: when set, token usage is logged to ai_usage for this tenant. */
  workspaceId?: string;
  userId?: string;
  /** Internal: set by the router from the resolved tier (fast|reasoning) for observability. */
  taskClass?: TaskClass;
  /** Product surface tag for the usage ledger (e.g. "chat"). */
  feature?: string;
  /** Grounding source count recorded to ai_usage.source_count (e.g. injected memory facts). */
  sourceCount?: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
};

export type TokenUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens?: number };
export type AgentResponse = {
  reply: string;
  provider: string;
  model: string;
  rounds: number;
  /** Real provider token usage, summed across tool rounds when available. */
  usage?: TokenUsage;
};


// ── Internal: OpenAI-compat multi-round loop ────────────────────────────────────

async function runOpenAICompatAgent(
  modelId: string,
  req: AgentRequest,
  maxRounds: number,
): Promise<AgentResponse> {
  const { baseURL, apiKey } = gatewayEnv();

  if (!baseURL || !apiKey) {
    throw new Error(
      `openai-compat provider requires AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY — ` +
      `baseURL=${baseURL ?? "MISSING"} apiKey=${apiKey ? "set" : "MISSING"}`,
    );
  }

  // Non-streaming agent: short timeout + 1 retry so a stall fails fast and
  // bubbles up to the graceful reply instead of hanging the request.
  // maxRetries:1 — fail fast on 429 rather than hang on a long Retry-After backoff;
  // the friendly rate-limit message tells the user to wait.
  const client = new OpenAI({ baseURL, apiKey, timeout: 45000, maxRetries: 1 });

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: redactSecrets(req.system) },
    ...req.messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: redactSecrets(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
    })),
  ];

  let reply = "";
  let rounds = 0;
  const t0 = Date.now();

  // Resolve active model — may be swapped to a fallback on 404
  let activeModel = modelId;
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  // Cache evidence across the WHOLE multi-round turn. The measurement gap this closes: every
  // single-shot path recorded cacheStatus, but chat — 1.2M of the 1.3M tokens — never did, so the
  // console showed cache rates for everything except the one feature where caching matters.
  let cacheReported = false; let cachedTokens = 0;
  const addUsage = (u?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } | null) => {
    if (!u) return;
    usage.prompt_tokens += u.prompt_tokens ?? 0;
    usage.completion_tokens += u.completion_tokens ?? 0;
    usage.total_tokens += u.total_tokens ?? 0;
    if (u.completion_tokens_details?.reasoning_tokens) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + u.completion_tokens_details.reasoning_tokens;
    const ct = u.prompt_tokens_details?.cached_tokens;
    if (typeof ct === "number") { cacheReported = true; cachedTokens += ct; }
  };

  // Tool output is re-sent on every later round, so it is budgeted across the WHOLE turn, not
  // per call. See boundToolResult.
  let toolCharsSpent = 0;
  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    console.log(`[gateway:openai-compat] round=${round + 1} model=${activeModel} baseURL=${baseURL}`);

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: activeModel,
        max_tokens: req.maxTokens ?? 2048,
        messages,
        // Only send tools when there ARE tools — Cerebras 400s on an empty
        // `tools: []` + tool_choice (this is what broke every conversational turn).
        ...(openaiTools.length ? { tools: openaiTools, tool_choice: "auto" as const } : {}),
      });
    } catch (e: any) {
      const status = e?.status ?? e?.code ?? "unknown";
      const msg = e?.message ?? String(e);
      console.error(`[gateway:openai-compat] request failed status=${status} model=${activeModel} baseURL=${baseURL} error="${msg}"`);

      // On 404 try the next known-good serverless model before giving up
      if (status === 404 || (typeof msg === "string" && msg.includes("not found"))) {
        const tried = [modelId, ...PROVIDER_FALLBACK_MODELS.slice(0, PROVIDER_FALLBACK_MODELS.indexOf(activeModel))];
        const next = PROVIDER_FALLBACK_MODELS.find(m => !tried.includes(m));
        if (next) {
          console.warn(`[gateway:openai-compat] 404 on "${activeModel}" — retrying with fallback "${next}"`);
          activeModel = next;
          continue;
        }
      }

      throw new Error(`openai-compat HTTP ${status}: ${msg}`);
    }

    addUsage(completion.usage);
    const choice = completion.choices[0];
    if (!choice) break;

    // Reasoning models put the answer in `content` and their thinking in
    // `reasoning`; read content first, fall back to reasoning if content is empty.
    const rmsg = choice.message as typeof choice.message & { reasoning?: string };
    const textContent = (rmsg.content && rmsg.content.trim()) ? rmsg.content : (rmsg.reasoning ?? "");
    if (textContent) reply = textContent;

    if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) break;

    messages.push(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {}
      console.log(`[gateway:openai-compat] tool_call name=${toolCall.function.name}`);
      const result = await req.onToolCall(toolCall.function.name, args);
      const bounded = boundToolResult(result, toolCharsSpent, toolCall.function.name);
      toolCharsSpent += bounded.used;
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: redactSecrets(bounded.text) });
    }
  }

  // Llama models often finish tool rounds without producing a text reply.
  // Make one clean conversational call — no tool definitions, no tool history —
  // so the model can at least answer the question directly.
  if (!reply) {
    const originalUserMsg = [...req.messages].reverse().find(m => m.role === "user")
      ?? req.messages[req.messages.length - 1];
    const originalText = typeof originalUserMsg?.content === "string"
      ? originalUserMsg.content : "";
    console.log(`[gateway:openai-compat] no text reply after ${rounds} round(s) — clean fallback call`);
    try {
      const summary = await client.chat.completions.create({
        model: activeModel,
        // Generous budget so reasoning models can think AND still emit content.
        max_tokens: 2048,
        messages: [
          { role: "system", content: "You are Mondaily AI, a helpful business workspace assistant. Be concise and direct. If workspace data is unavailable or empty, say so and suggest what the user can do next." },
          { role: "user", content: originalText || "Hello" },
        ],
      });
      addUsage(summary.usage);
      const smsg = summary.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
      reply = (smsg?.content && smsg.content.trim()) ? smsg.content : (smsg?.reasoning ?? "");
      console.log(`[gateway:openai-compat] clean fallback reply: ${reply.length} chars`);
    } catch (e: any) {
      console.error(`[gateway:openai-compat] clean fallback call failed: ${e?.message}`);
    }
  }

  const finalUsage = usage.total_tokens > 0 ? usage : undefined;
  recordAiUsage(req.workspaceId, activeModel, finalUsage, { userId: req.userId, feature: req.feature, taskClass: req.taskClass, provider: backendLabel(), latencyMs: Date.now() - t0, sourceCount: req.sourceCount,
    cacheStatus: cacheReported ? (cachedTokens > 0 ? "hit" : "miss") : undefined });
  return { reply, provider: "openai-compat", model: activeModel, rounds, usage: finalUsage };
}

// ── Public: aiGatewayAgent ──────────────────────────────────────────────────────

/**
 * Multi-round agentic loop (Cerebras openai-compat only).
 *
 * Priority: req.model → AI_AGENT_MODEL → AI_PROVIDER_MODEL → DEFAULT_MODEL_SPEC
 *
 * SOVEREIGN: the only provider is the openai-compatible gateway (Cerebras). There is NO fallback to
 * api.anthropic.com or api.openai.com — if the primary attempt fails, we return a graceful reply
 * (never throw, never route to a proprietary provider).
 */
export async function aiGatewayAgent(req: AgentRequest): Promise<AgentResponse> {
  // Credit gate — fail closed with a clear message when out of credits / over burst.
  try { await assertCreditsOk(req.workspaceId); }
  catch (e) { if (e instanceof CreditsExhaustedError) return { reply: e.message, provider: "none", model: "none", rounds: 0 }; throw e; }
  // Fast-model routing applies here too (conversational → fast model, no tools).
  const route = routeAgentModel(req);
  req = { ...req, model: route.spec, tools: route.useTools ? req.tools : [], taskClass: route.tier === "fast" ? "fast" : "reasoning" };
  const spec = route.spec;

  const resolved = resolveModel(spec);
  const MAX_ROUNDS = route.useTools ? (req.maxRounds ?? 5) : 1;

  console.log(`[gateway:agent] tier=${route.tier} spec="${spec}" provider=${resolved.type} model=${resolved.modelId} tools=${req.tools.length}`);

  // ── Primary attempt (Cerebras openai-compat only) ───────────────────────────────
  try {
    return await runOpenAICompatAgent(resolved.modelId, req, MAX_ROUNDS);
  } catch (primaryErr: any) {
    lastGatewayError = { at: `agent-primary/${resolved.modelId}`, message: primaryErr?.message ?? String(primaryErr), status: primaryErr?.status, when: new Date().toISOString() };
    console.error(`[gateway:agent] primary failed (${resolved.type}/${resolved.modelId}): ${primaryErr?.message}`);

    /**
     * THE SAME RATE-LIMIT RECOVERY AS THE STREAMING PATH.
     *
     * This is the non-streaming agent, and it is what HOME calls (`POST /ask`), while /ask/new goes
     * through the streaming one. It had no retry at all: one 429 and the user was told "trouble
     * connecting to the AI service" — which is not what happened. The quota was spent; the service
     * was fine. Two entry points to the same feature, two different behaviours, and the one on the
     * landing screen gave the least accurate answer.
     *
     * A rule at one call site is not a rule — so the recovery lives in both, and says the same
     * thing.
     */
    const rateLimited = primaryErr?.status === 429 || /\b429\b|rate limit/i.test(String(primaryErr?.message ?? ""));
    const paymentBlocked = (primaryErr as { status?: number } | null)?.status === 402;
    if (rateLimited) {
      await new Promise(res => setTimeout(res, retryAfterMs(primaryErr)));
      const fb = resolveModel(FAST_MODEL_SPEC);
      // Tools dropped: the retry exists to get a reply out, and tool rounds multiply the token
      // spend that caused the limit in the first place.
      const recovered = await runOpenAICompatAgent(fb.modelId, { ...req, tools: [], system: (req.system ?? "") + TOOLLESS_RETRY_NOTE }, 1).catch(() => null);
      if (recovered?.reply?.trim()) return recovered;
    }

    // No proprietary-provider fallback — the gateway is Cerebras-only. A failure
    // here returns a graceful reply rather than routing to Anthropic/OpenAI.
    console.error(`[gateway:agent] gateway exhausted — returning graceful reply (rateLimited=${rateLimited})`);
    return {
      reply: rateLimited
        ? "⏳ Mondaily AI is at its current throughput limit — give it about a minute and try again. High-volume plans get higher limits."
        : paymentBlocked
          ? "Mondaily's AI capacity is exhausted right now — the team has been alerted and it will be restored shortly. Everything else keeps working, and nothing you asked for was lost."
          : "I'm having trouble connecting to the AI service right now. Please try again in a moment.",
      provider: "none",
      model: "none",
      rounds: 0,
    };
  }
}

// ── Public: streaming agentic loop ──────────────────────────────────────────────

export type AgentStreamEvent =
  | { type: "status"; text: string }   // tool activity, e.g. "Searching records…"
  | { type: "token"; text: string };   // a chunk of the final answer

/**
 * Streaming variant of aiGatewayAgent. Emits `token` events as the model
 * produces the final answer (live, like Claude.ai) and `status` events while
 * tools run, then returns the full AgentResponse. Streams only for the
 * openai-compat provider (Cerebras); any non-streamable case or failure falls
 * back to the non-streaming loop, emitting the whole reply as one token so the
 * caller's rendering path is identical. Never throws, never routes to a proprietary provider.
 */
export async function aiGatewayAgentStream(
  req: AgentRequest,
  onEvent: (e: AgentStreamEvent) => void | Promise<void>,
): Promise<AgentResponse> {
  // Credit gate — fail closed; surface the message as a single token so the UI renders it.
  try { await assertCreditsOk(req.workspaceId); }
  catch (e) { if (e instanceof CreditsExhaustedError) { await onEvent({ type: "token", text: e.message }); return { reply: e.message, provider: "none", model: "none", rounds: 0 }; } throw e; }
  // Fast-model routing: conversational turns → small model, no tools.
  const route = routeAgentModel(req);
  const effectiveReq: AgentRequest = { ...req, model: route.spec, tools: route.useTools ? req.tools : [], taskClass: route.tier === "fast" ? "fast" : "reasoning" };
  const resolved = resolveModel(route.spec);
  const MAX_ROUNDS = route.useTools ? (req.maxRounds ?? 5) : 1;
  console.log(`[gateway:agent-stream] tier=${route.tier} spec="${route.spec}" tools=${effectiveReq.tools.length}`);

  if (resolved.type !== "openai-compat") {
    const r = await aiGatewayAgent(effectiveReq);
    if (r.reply) await onEvent({ type: "token", text: r.reply });
    return r;
  }

  try {
    const r = await runOpenAICompatAgentStream(resolved.modelId, effectiveReq, MAX_ROUNDS, onEvent);
    // If the stream finished but produced NO user-facing text (a tool-only or
    // reasoning-only round), recover with a clean non-streaming call so the user
    // never sees an empty "No response." — mirrors the non-streaming fallback.
    if (!r.reply || !r.reply.trim()) {
      console.warn(`[gateway:agent-stream] empty streamed reply — recovering on default model`);
      const fbModel = resolveModel(DEFAULT_MODEL_SPEC);
      const fb = await runOpenAICompatAgent(fbModel.modelId, { ...effectiveReq, tools: [] }, 1).catch(() => null);
      if (fb?.reply?.trim()) {
        await onEvent({ type: "token", text: fb.reply });
        return { ...fb, usage: r.usage ?? fb.usage };
      }
      // Last-resort guard: the model ran tools but produced no prose AND the recovery also came
      // back blank. Something still has to render, but it must not CLAIM the work succeeded —
      // "Done — I've processed that above" asserts a completed action when we have no idea whether
      // anything happened, and the user has no way to tell it apart from a real confirmation.
      const FRIENDLY = "I ran the lookups but couldn't put an answer together — nothing was changed. Ask again and I'll retry.";
      await onEvent({ type: "token", text: FRIENDLY });
      return { ...r, reply: FRIENDLY };
    }
    return r;
  } catch (err: any) {
    lastGatewayError = { at: "agent-stream", message: err?.message ?? String(err), status: err?.status, when: new Date().toISOString() };
    console.error(`[gateway:agent-stream] streaming failed: ${err?.message} — recovering on default model`);
    // Recover on the PROVEN default model directly (bypass routeAgentModel, which
    // would re-pick the same failing fast model). This makes a broken/Preview
    // AI_FAST_MODEL — e.g. one that 400s — non-fatal instead of breaking chat.
    const rateLimited = err?.status === 429 || /\b429\b|rate limit/i.test(String(err?.message ?? ""));

    /**
     * A RATE LIMIT NEEDS A DIFFERENT RECOVERY THAN A BROKEN MODEL.
     *
     * The recovery below used to fire immediately against the same account, which cannot work for
     * the failure it most often meets: if the per-minute quota is spent, the retry is spent too, so
     * it 429s in milliseconds and the user gets an apology instead of an answer. MEASURED
     * 2026-08-13 — this is what produced "⏳ throughput limit" on a real question that had already
     * run its tools successfully; the work was done and then thrown away.
     *
     * So for a rate limit specifically: wait out the window the provider names (bounded, because a
     * long Retry-After hanging the request was a previous bug), and retry on the FAST model, which
     * is a different model and usually a different bucket. A broken-model failure keeps the old
     * immediate path — waiting there would just be latency for nothing.
     */
    if (rateLimited) {
      const waitMs = retryAfterMs(err);
      if (waitMs > 0) await new Promise(res => setTimeout(res, waitMs));
    }
    const fb = resolveModel(rateLimited ? FAST_MODEL_SPEC : DEFAULT_MODEL_SPEC);
    const r = await runOpenAICompatAgent(fb.modelId, { ...effectiveReq, tools: [], system: (effectiveReq.system ?? "") + TOOLLESS_RETRY_NOTE }, 1).catch(() => null);
    // Rate-limit message: a 429 means the per-minute AI quota is spent, not that the service is
    // down. Tell the user plainly so they wait, not retry-spam. NEVER name the AI provider — the
    // system is our own; infrastructure suppliers are not surfaced to users.
    const reply = r?.reply || (rateLimited
      ? "⏳ Mondaily AI is at its current throughput limit — give it about a minute and try again. High-volume plans get higher limits."
      : "I'm having trouble reaching Mondaily AI right now. Please try again in a moment.");
    await onEvent({ type: "token", text: reply });
    return r ?? { reply, provider: "none", model: "none", rounds: 0 };
  }
}

async function runOpenAICompatAgentStream(
  modelId: string,
  req: AgentRequest,
  maxRounds: number,
  onEvent: (e: AgentStreamEvent) => void | Promise<void>,
): Promise<AgentResponse> {
  const { baseURL, apiKey } = gatewayEnv();
  if (!baseURL || !apiKey) throw new Error(`openai-compat requires AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY`);
  // Streaming agent: FAIL-FAST. 15s timeout + 1 retry so an upstream spike
  // surfaces instantly rather than hanging. A cut is safe here — mid-stream
  // drops preserve partial text below, and an empty result drops to the
  // non-streaming recovery + friendly fallback in aiGatewayAgentStream.
  // maxRetries:1 — fail fast on 429 (a hung Retry-After backoff was the "loads forever" bug).
  // BUDGETED against the client's hard abort (120s in use-ask-engine). 5 rounds x 55s x 2 attempts
  // is ~550s of server work for a request the browser gave up on after two minutes — and every one
  // of those inferences is metered. Track the wall clock and stop offering rounds we cannot finish
  // before the caller is gone.
  const ROUND_BUDGET_MS = 110_000;
  const startedAt = Date.now();
  const budgetLeft = () => ROUND_BUDGET_MS - (Date.now() - startedAt);
  const client = new OpenAI({ baseURL, apiKey, timeout: 55000, maxRetries: 1 });

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: redactSecrets(req.system) },
    ...req.messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: redactSecrets(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
    })),
  ];

  let reply = "";
  let rounds = 0;
  const t0 = Date.now();
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let streamCacheReported = false; let streamCachedTokens = 0;   // cache evidence across all rounds

  // Tool output is re-sent on every later round, so it is budgeted across the WHOLE turn, not
  // per call. See boundToolResult.
  let toolCharsSpent = 0;
  for (let round = 0; round < maxRounds; round++) {
    // Another round needs a realistic chance of completing within what the caller will still wait.
    if (round > 0 && budgetLeft() < 12_000) {
      console.warn(`[gateway] stopping after round ${round}: ${Math.round(budgetLeft() / 1000)}s left of the client's window`);
      break;
    }
    rounds = round + 1;
    let content = "";
    let reasoningChunks = 0;
    const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
    let finishReason: string | null = null;

    // Mid-stream resiliency: if Cerebras times out, rate-limits, or the socket
    // drops part-way through, we must never leave a frozen spinner. Keep any
    // partial answer + a clear note; if nothing was produced yet, bubble up so
    // the caller does its non-streaming fallback.
    try {
      const stream = await client.chat.completions.create({
        model: modelId,
        max_tokens: req.maxTokens ?? 2048,
        messages,
        // Only send tools when there ARE tools — Cerebras 400s on an empty
        // `tools: []` + tool_choice, which is exactly what conversational ("hi")
        // turns sent (useTools:false strips tools to []). This was THE bug.
        ...(openaiTools.length ? { tools: openaiTools, tool_choice: "auto" as const } : {}),
        stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of stream) {
        // The final chunk (with include_usage) carries real token usage and an
        // empty choices array — accumulate it across all tool rounds.
        if (chunk.usage) {
          {
            const ct = (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens;
            if (typeof ct === "number") { streamCacheReported = true; streamCachedTokens += ct; }
          }
          usage.prompt_tokens += chunk.usage.prompt_tokens ?? 0;
          usage.completion_tokens += chunk.usage.completion_tokens ?? 0;
          usage.total_tokens += chunk.usage.total_tokens ?? 0;
          const reasoning = (chunk.usage as { completion_tokens_details?: { reasoning_tokens?: number } }).completion_tokens_details?.reasoning_tokens;
          if (reasoning) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + reasoning;
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as { content?: string; reasoning?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
        // REASONING FILTER: gpt-oss-120b emits its chain-of-thought in `delta.reasoning`,
        // separate from the user-facing answer in `delta.content`. We NEVER stream
        // reasoning to the client — only `content`. While the model is still
        // reasoning (reasoning flowing, no content yet), surface a single
        // "Thinking…" status so the UI shows progress instead of a blank wait.
        if (delta.reasoning && !content) {
          reasoningChunks++;
          // Heartbeat: re-emit "Thinking…" periodically so a long reasoning pass
          // keeps the client's inactivity timer alive (and shows live progress)
          // instead of looking stalled and getting aborted mid-think.
          if (reasoningChunks === 1 || reasoningChunks % 25 === 0) {
            await onEvent({ type: "status", text: "Thinking…" });
          }
        }
        if (delta.content) { content += delta.content; await onEvent({ type: "token", text: delta.content }); }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            if (!toolAcc[i]) toolAcc[i] = { id: "", name: "", args: "" };
            if (tc.id) toolAcc[i].id = tc.id;
            if (tc.function?.name) toolAcc[i].name += tc.function.name;
            if (tc.function?.arguments) toolAcc[i].args += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (streamErr: any) {
      console.error(`[gateway:openai-compat-stream] round ${rounds} interrupted: ${streamErr?.message}`);
      if (content.trim()) reply = content;
      if (reply.trim()) {
        // A partial answer already reached the user — flag it, don't hang.
        await onEvent({ type: "token", text: "\n\n_(Connection interrupted — this reply may be incomplete. Please ask again.)_" });
        const partialUsage = usage.total_tokens > 0 ? usage : undefined;
        recordAiUsage(req.workspaceId, modelId, partialUsage, { userId: req.userId, feature: req.feature, taskClass: req.taskClass, provider: backendLabel(), latencyMs: Date.now() - t0, sourceCount: req.sourceCount, refusalReason: "stream_interrupted" });
        return { reply, provider: "openai-compat", model: modelId, rounds, usage: partialUsage };
      }
      // Nothing delivered yet — let aiGatewayAgentStream fall back to non-streaming.
      throw streamErr;
    }

    if (content.trim()) reply = content;

    const calls = Object.values(toolAcc).filter(t => t.name);
    if (finishReason !== "tool_calls" || calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: calls.map(t => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: t.args || "{}" } })),
    });

    // Surface what's running, then execute ALL tools in this round CONCURRENTLY
    // (Promise.all) instead of one-at-a-time — the biggest latency win when the
    // model requests several lookups at once. onToolCall streams each tool's
    // sources to the client the instant it finishes (see ask.ts), so cards
    // appear while the model is still generating text.
    for (const t of calls) {
      await onEvent({ type: "status", text: `Running ${t.name.replace(/_/g, " ")}…` });
    }
    const settled = await Promise.all(calls.map(async (t) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(t.args || "{}") as Record<string, unknown>; } catch {}
      const result = await req.onToolCall(t.name, args);
      // name carried through so a truncation log names the tool that overflowed, not "tool".
      return { id: t.id, result, name: t.name };
    }));
    // Map results back into the message array in the SAME order the model
    // requested them, so the next reasoning turn stays coherent. Promise.all
    // preserves input order, so settled[i] aligns with calls[i].
    for (const r of settled) {
      const bounded = boundToolResult(r.result, toolCharsSpent, r.name ?? "tool");
      toolCharsSpent += bounded.used;
      messages.push({ role: "tool", tool_call_id: r.id, content: redactSecrets(bounded.text) });
    }
  }

  // Reasoning models sometimes end tool rounds with no final text (or hit the
  // round cap mid-gather). Force ONE synthesis call using the FULL accumulated
  // context — system + question + the assistant tool_calls + every tool RESULT —
  // with NO tools, so the model MUST answer from the data it already gathered.
  // (The old recovery re-asked with only system+question, discarding the tool
  //  results, which made the model wrongly reply "I can't see your data / grant
  //  me access" even though it had just fetched real records.)
  if (!reply.trim()) {
    const hasGatheredData = messages.some(m => m.role === "tool");
    const synthMessages: OpenAI.Chat.ChatCompletionMessageParam[] = hasGatheredData
      ? [...messages, { role: "user", content: "Now answer my original question using the data you gathered above. You already have the results — never ask for access or which workspace; just give the concise, well-formatted answer." }]
      : messages;
    const stream = await client.chat.completions.create({
      model: modelId, max_tokens: 2048, stream: true, messages: synthMessages,
    });
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta as { content?: string } | undefined;
      if (d?.content) { reply += d.content; await onEvent({ type: "token", text: d.content }); }
    }
  }

  const streamUsage = usage.total_tokens > 0 ? usage : undefined;
  recordAiUsage(req.workspaceId, modelId, streamUsage, { userId: req.userId, feature: req.feature, taskClass: req.taskClass, provider: backendLabel(), latencyMs: Date.now() - t0, sourceCount: req.sourceCount,
    cacheStatus: streamCacheReported ? (streamCachedTokens > 0 ? "hit" : "miss") : undefined });
  return { reply, provider: "openai-compat", model: modelId, rounds, usage: streamUsage };
}

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

// ── Shared types ────────────────────────────────────────────────────────────────

export type GatewayRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
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
  /** Optional: receive the real provider token usage for this call (for per-job telemetry). */
  onUsage?: (u: { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens: number }) => void;
  /** When set, token usage is metered to ai_usage + the credit wallet automatically (default
   *  metering for every background/agent tool call — no per-caller onUsage wiring needed). */
  workspaceId?: string;
  userId?: string;
};

// ── Internal routing ────────────────────────────────────────────────────────────

type ResolvedModel = { type: "openai-compat"; modelId: string };

// Cerebras-powered default. Mondaily runs primary inference exclusively on its
// own openai-compatible streaming gateway (AI_GATEWAY_BASE_URL → Cerebras).
// No proprietary Anthropic/OpenAI endpoint is referenced at the default layer.
export const CEREBRAS_DEFAULT_SPEC = "openai-compat/gpt-oss-120b";

function resolveModel(spec?: string): ResolvedModel {
  const s = spec ?? process.env.AI_PROVIDER_MODEL ?? CEREBRAS_DEFAULT_SPEC;
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
const FAST_MODEL_SPEC = process.env.AI_FAST_MODEL ?? CEREBRAS_DEFAULT_SPEC;

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
  const requested = req.model ?? process.env.AI_AGENT_MODEL ?? process.env.AI_PROVIDER_MODEL ?? CEREBRAS_DEFAULT_SPEC;
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

/** Fireworks serverless models tried in order when the primary model 404s. */
// Fallback model IDs tried in order on 404. Works for any OpenAI-compat provider
// (Groq model IDs shown; Fireworks IDs also accepted if AI_AGENT_MODEL overrides).
const PROVIDER_FALLBACK_MODELS = [
  "accounts/fireworks/models/llama-v3p3-70b-instruct",
  "accounts/fireworks/models/llama-v3p1-70b-instruct",
  "accounts/fireworks/models/qwen2p5-72b-instruct",
  "accounts/fireworks/models/mixtral-8x22b-instruct",
];

/** Resolve the sovereign gateway credentials. Reads the canonical AI_GATEWAY_*
 *  names first, then CEREBRAS_* as a fallback so a naming mismatch can't silently
 *  break inference. Still 100% Cerebras — never api.openai.com. */
export function gatewayEnv(): { baseURL?: string; apiKey?: string } {
  return {
    baseURL: process.env.AI_GATEWAY_BASE_URL || process.env.CEREBRAS_BASE_URL || process.env.CEREBRAS_API_BASE_URL,
    apiKey: process.env.AI_GATEWAY_API_KEY || process.env.CEREBRAS_API_KEY,
  };
}

function openAIClient(): OpenAI {
  const { baseURL, apiKey } = gatewayEnv();

  // Sovereignty guard: never silently fall back to api.openai.com. If the
  // Cerebras gateway isn't configured, fail loudly rather than leak traffic to
  // a proprietary third-party endpoint.
  if (!baseURL) {
    throw new Error("[gateway] AI_GATEWAY_BASE_URL is not set — refusing to route inference to a default OpenAI endpoint. Configure the Cerebras gateway base URL.");
  }
  if (!apiKey) {
    throw new Error("[gateway] AI_GATEWAY_API_KEY is not set — Cerebras gateway credentials missing.");
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
  const providerModel = strip(env.AI_PROVIDER_MODEL ?? CEREBRAS_DEFAULT_SPEC);
  const agentModel = strip(env.AI_AGENT_MODEL ?? env.AI_PROVIDER_MODEL ?? CEREBRAS_DEFAULT_SPEC);
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
  const resolved = resolveModel();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: redactSecrets(req.system) });
  messages.push({ role: "user", content: redactSecrets(req.prompt) });

  const completion = await openAIClient().chat.completions.create({
    model: resolved.modelId,
    // Reasoning models (e.g. gpt-oss) spend tokens "thinking" before emitting
    // the answer in `content`; a small budget gets fully consumed by reasoning
    // and leaves content empty. Keep a generous floor so content is produced.
    max_tokens: Math.max(req.maxTokens ?? 512, 2048),
    messages,
  });
  const msg = completion.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
  const text = (msg?.content && msg.content.trim()) ? msg.content : (msg?.reasoning ?? "");
  return { text, provider: "openai-compat", model: resolved.modelId };
}

// ── Structured tool-use extraction ─────────────────────────────────────────────

export async function aiGatewayToolUse(req: GatewayToolRequest): Promise<Record<string, unknown>> {
  const resolved = resolveModel(req.model);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: redactSecrets(req.system) });
  messages.push({ role: "user", content: redactSecrets(req.prompt) });

  const completion = await openAIClient().chat.completions.create({
    model: resolved.modelId,
    max_tokens: req.maxTokens ?? 1024,
    messages,
    tools: [{
      type: "function",
      function: { name: req.toolName, description: req.toolDescription, parameters: req.toolSchema },
    }],
    tool_choice: { type: "function", function: { name: req.toolName } },
  });

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
    if (req.workspaceId && usage.total_tokens > 0) recordAiUsage(req.workspaceId, resolved.modelId, usage, { userId: req.userId });
  }

  const toolCall = completion.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return {};
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
export async function aiGatewayComplete(req: { prompt: string; system?: string; model?: string; maxTokens?: number }): Promise<string> {
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
    const m = completion.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
    return (m?.content && m.content.trim()) ? m.content : (m?.reasoning ?? "");
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

  // Resolve active model — may be swapped to a fallback on 404
  let activeModel = modelId;
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | null) => {
    if (!u) return;
    usage.prompt_tokens += u.prompt_tokens ?? 0;
    usage.completion_tokens += u.completion_tokens ?? 0;
    usage.total_tokens += u.total_tokens ?? 0;
    if (u.completion_tokens_details?.reasoning_tokens) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + u.completion_tokens_details.reasoning_tokens;
  };

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
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: redactSecrets(result) });
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
  recordAiUsage(req.workspaceId, activeModel, finalUsage, { userId: req.userId });
  return { reply, provider: "openai-compat", model: activeModel, rounds, usage: finalUsage };
}

// ── Public: aiGatewayAgent ──────────────────────────────────────────────────────

/**
 * Multi-round agentic loop (Cerebras openai-compat only).
 *
 * Priority: req.model → AI_AGENT_MODEL → AI_PROVIDER_MODEL → CEREBRAS_DEFAULT_SPEC
 *
 * Fallback chain:
 *   1. Primary provider (resolved from spec above)
 *   2. If primary is openai-compat and fails → Anthropic haiku (if ANTHROPIC_API_KEY set)
 *   3. If all fail → returns graceful reply, never throws
 */
export async function aiGatewayAgent(req: AgentRequest): Promise<AgentResponse> {
  // Fast-model routing applies here too (conversational → fast model, no tools).
  const route = routeAgentModel(req);
  req = { ...req, model: route.spec, tools: route.useTools ? req.tools : [] };
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

    // No proprietary-provider fallback — the gateway is Cerebras-only. A failure
    // here returns a graceful reply rather than routing to Anthropic/OpenAI.
    console.error(`[gateway:agent] Cerebras gateway exhausted — returning graceful reply`);
    return {
      reply: "I'm having trouble connecting to the AI service right now. Please try again in a moment.",
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
 * openai-compat provider (Cerebras); the Anthropic path and any failure fall
 * back to the non-streaming loop, emitting the whole reply as one token so the
 * caller's rendering path is identical. Never throws.
 */
export async function aiGatewayAgentStream(
  req: AgentRequest,
  onEvent: (e: AgentStreamEvent) => void | Promise<void>,
): Promise<AgentResponse> {
  // Fast-model routing: conversational turns → small model, no tools.
  const route = routeAgentModel(req);
  const effectiveReq: AgentRequest = { ...req, model: route.spec, tools: route.useTools ? req.tools : [] };
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
      const fbModel = resolveModel(CEREBRAS_DEFAULT_SPEC);
      const fb = await runOpenAICompatAgent(fbModel.modelId, { ...effectiveReq, tools: [] }, 1).catch(() => null);
      if (fb?.reply?.trim()) {
        await onEvent({ type: "token", text: fb.reply });
        return { ...fb, usage: r.usage ?? fb.usage };
      }
      // Last-resort guard: the model ran tools but produced no prose AND the
      // recovery also came back blank. Inject a friendly message so the frontend
      // never renders an empty bubble.
      const FRIENDLY = "Done — I've processed that above. Let me know if you'd like any adjustments.";
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
    const fb = resolveModel(CEREBRAS_DEFAULT_SPEC);
    const r = await runOpenAICompatAgent(fb.modelId, { ...effectiveReq, tools: [] }, 1).catch(() => null);
    // Rate-limit-aware message: a 429 means the Cerebras per-minute quota is spent,
    // not that the service is down. Tell the user plainly so they wait, not retry-spam.
    const rateLimited = err?.status === 429 || /\b429\b|rate limit/i.test(String(err?.message ?? ""));
    const reply = r?.reply || (rateLimited
      ? "⏳ The AI hit its per-minute request limit (current plan: 5 requests/min). Give it ~60 seconds, then try again — or upgrade the Cerebras plan for higher throughput."
      : "I'm having trouble connecting to the AI service right now. Please try again in a moment.");
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
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (let round = 0; round < maxRounds; round++) {
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
        recordAiUsage(req.workspaceId, modelId, partialUsage, { userId: req.userId });
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
      return { id: t.id, result };
    }));
    // Map results back into the message array in the SAME order the model
    // requested them, so the next reasoning turn stays coherent. Promise.all
    // preserves input order, so settled[i] aligns with calls[i].
    for (const r of settled) {
      messages.push({ role: "tool", tool_call_id: r.id, content: redactSecrets(r.result) });
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
  recordAiUsage(req.workspaceId, modelId, streamUsage, { userId: req.userId });
  return { reply, provider: "openai-compat", model: modelId, rounds, usage: streamUsage };
}

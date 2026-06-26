/**
 * AI Gateway — model-agnostic generation utility.
 *
 * Routing is controlled by environment variables:
 *
 *   AI_PROVIDER_MODEL = "anthropic/claude-haiku-4-5-20251001"  (default)
 *                     | "openai-compat/<model-id>"
 *
 *   AI_AGENT_MODEL    = same format — overrides AI_PROVIDER_MODEL for the
 *                       multi-round agentic loop (aiGatewayAgent) only.
 *                       Falls back to AI_PROVIDER_MODEL → Anthropic default.
 *
 * For the "openai-compat" route:
 *   AI_GATEWAY_BASE_URL  e.g. "https://api.fireworks.ai/inference/v1"
 *   AI_GATEWAY_API_KEY   your key for that provider
 *
 * Three exported functions:
 *   aiGateway        — plain text generation (no tools)
 *   aiGatewayToolUse — single-tool structured extraction
 *   aiGatewayAgent   — multi-round agentic loop with automatic provider fallback
 *
 * Fallback chain for aiGatewayAgent:
 *   primary spec → on 404 try Fireworks fallback models → if ANTHROPIC_API_KEY/CLAUDE_API_KEY → Anthropic haiku
 *   → if all fail → graceful reply string (never throws to caller)
 *
 * Anthropic API key: reads ANTHROPIC_API_KEY or CLAUDE_API_KEY (whichever is set)
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import OpenAI from "openai";

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
};

// ── Internal routing ────────────────────────────────────────────────────────────

type ResolvedModel =
  | { type: "anthropic"; modelId: string }
  | { type: "openai-compat"; modelId: string };

function resolveModel(spec?: string): ResolvedModel {
  const s = spec ?? process.env.AI_PROVIDER_MODEL ?? "anthropic/claude-haiku-4-5-20251001";

  if (s.startsWith("openai-compat/")) {
    return { type: "openai-compat", modelId: s.slice("openai-compat/".length) };
  }

  const modelId = s.startsWith("anthropic/") ? s.slice("anthropic/".length) : s;
  return { type: "anthropic", modelId: modelId || "claude-haiku-4-5-20251001" };
}

/** Reads ANTHROPIC_API_KEY or CLAUDE_API_KEY — whichever is set. */
function getAnthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined;
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

const FAST_MODEL_SPEC = process.env.AI_FAST_MODEL ?? "openai-compat/zai-glm-4.7";

const CONVERSATIONAL_RE = /^\s*(hi|hey|hello|yo|sup|thanks|thank you|thx|ty|good (morning|afternoon|evening)|how are you|who are you|what(?:'s| is| are| can) you|what can you do|tell me about yourself|help|capabilities|ok(ay)?|cool|nice|great|awesome|got it|sounds good)\b/i;
const DATA_INTENT_RE = /\b(task|deal|contact|lead|invoice|report|list|note|record|company|companies|people|person|pipeline|finance|overdue|create|update|delete|add|remove|find|search|show|who|whose|how many|summar|enrich|prospect|decision|workflow|email|call|due|assign|revenue|stage|status|score|relationship)\b/i;

function routeAgentModel(req: AgentRequest): { spec: string; useTools: boolean; tier: "fast" | "deep" } {
  const requested = req.model ?? process.env.AI_AGENT_MODEL ?? process.env.AI_PROVIDER_MODEL ?? "anthropic/claude-haiku-4-5-20251001";
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

function openAIClient(): OpenAI {
  const baseURL = process.env.AI_GATEWAY_BASE_URL;
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!baseURL) {
    console.error("[gateway] AI_GATEWAY_BASE_URL is not set — openai-compat calls will fail");
  }
  if (!apiKey) {
    console.error("[gateway] AI_GATEWAY_API_KEY is not set — openai-compat calls will fail");
  }

  return new OpenAI({
    baseURL: baseURL ?? "https://api.openai.com/v1",
    apiKey: apiKey ?? "missing-key",
    // Never hang forever on a provider stall; retry transient network/5xx/429.
    timeout: 45000,
    maxRetries: 2,
  });
}

// ── Plain text generation ───────────────────────────────────────────────────────

export async function aiGateway(req: GatewayRequest): Promise<GatewayResponse> {
  const resolved = resolveModel();

  if (resolved.type === "anthropic") {
    const anthropic = createAnthropic({ apiKey: getAnthropicKey() });
    const { text } = await generateText({
      model: anthropic(resolved.modelId),
      ...(req.system ? { system: req.system } : {}),
      prompt: req.prompt,
      maxTokens: req.maxTokens ?? 512,
    });
    return { text, provider: "anthropic", model: resolved.modelId };
  }

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
  const resolved = resolveModel();

  if (resolved.type === "anthropic") {
    const apiKey = getAnthropicKey();
    if (!apiKey) return {};

    const body: Record<string, unknown> = {
      model: resolved.modelId,
      max_tokens: req.maxTokens ?? 1024,
      tools: [{ name: req.toolName, description: req.toolDescription, input_schema: req.toolSchema }],
      tool_choice: { type: "tool", name: req.toolName },
      messages: [{ role: "user", content: req.prompt }],
    };
    if (req.system) body.system = req.system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return {};
    const data = await res.json() as { content?: { type: string; input?: Record<string, unknown> }[] };
    return data.content?.find(b => b.type === "tool_use")?.input ?? {};
  }

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

  const toolCall = completion.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return {};
  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return {};
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
  /** Full model spec: "anthropic/claude-sonnet-4-6" or "openai-compat/llama-3.3-70b-versatile".
   *  Overrides AI_AGENT_MODEL env var when provided. */
  model?: string;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
};

export type AgentResponse = {
  reply: string;
  provider: string;
  model: string;
  rounds: number;
};

// ── Internal: Anthropic multi-round loop ────────────────────────────────────────

async function runAnthropicAgent(
  modelId: string,
  req: AgentRequest,
  maxRounds: number,
): Promise<AgentResponse> {
  const apiKey = getAnthropicKey();
  if (!apiKey) throw new Error("No Anthropic key found (checked ANTHROPIC_API_KEY and CLAUDE_API_KEY)");

  const messages: unknown[] = [...req.messages];
  let reply = "";
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    console.log(`[gateway:anthropic] round=${round + 1} model=${modelId}`);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: req.maxTokens ?? 2048,
        system: req.system,
        tools: req.tools,
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[gateway:anthropic] HTTP ${res.status}:`, body);
      throw new Error(`Anthropic HTTP ${res.status}: ${body}`);
    }

    const data = await res.json() as {
      stop_reason: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    };

    const textBlocks = data.content.filter(b => b.type === "text").map(b => b.text ?? "");
    if (textBlocks.length) reply = textBlocks.join("\n");

    if (data.stop_reason !== "tool_use") break;

    const toolBlocks = data.content.filter(b => b.type === "tool_use");
    if (!toolBlocks.length) break;

    messages.push({ role: "assistant", content: data.content });

    const toolResults: unknown[] = [];
    for (const tb of toolBlocks) {
      console.log(`[gateway:anthropic] tool_call name=${tb.name}`);
      const result = await req.onToolCall(tb.name!, tb.input ?? {});
      toolResults.push({ type: "tool_result", tool_use_id: tb.id!, content: result });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { reply, provider: "anthropic", model: modelId, rounds };
}

// ── Internal: OpenAI-compat multi-round loop ────────────────────────────────────

async function runOpenAICompatAgent(
  modelId: string,
  req: AgentRequest,
  maxRounds: number,
): Promise<AgentResponse> {
  const baseURL = process.env.AI_GATEWAY_BASE_URL;
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error(
      `openai-compat provider requires AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY — ` +
      `baseURL=${baseURL ?? "MISSING"} apiKey=${apiKey ? "set" : "MISSING"}`,
    );
  }

  const client = new OpenAI({ baseURL, apiKey, timeout: 45000, maxRetries: 2 });

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

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    console.log(`[gateway:openai-compat] round=${round + 1} model=${activeModel} baseURL=${baseURL}`);

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: activeModel,
        max_tokens: req.maxTokens ?? 2048,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
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
      const smsg = summary.choices[0]?.message as { content?: string; reasoning?: string } | undefined;
      reply = (smsg?.content && smsg.content.trim()) ? smsg.content : (smsg?.reasoning ?? "");
      console.log(`[gateway:openai-compat] clean fallback reply: ${reply.length} chars`);
    } catch (e: any) {
      console.error(`[gateway:openai-compat] clean fallback call failed: ${e?.message}`);
    }
  }

  return { reply, provider: "openai-compat", model: activeModel, rounds };
}

// ── Public: aiGatewayAgent ──────────────────────────────────────────────────────

/**
 * Multi-round agentic loop with automatic provider fallback.
 *
 * Priority: req.model → AI_AGENT_MODEL → AI_PROVIDER_MODEL → anthropic default
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

  // ── Primary attempt ───────────────────────────────────────────────────────────
  try {
    if (resolved.type === "anthropic") {
      return await runAnthropicAgent(resolved.modelId, req, MAX_ROUNDS);
    }
    return await runOpenAICompatAgent(resolved.modelId, req, MAX_ROUNDS);
  } catch (primaryErr: any) {
    console.error(`[gateway:agent] primary failed (${resolved.type}/${resolved.modelId}): ${primaryErr?.message}`);

    // ── Fallback: openai-compat exhausted → try Anthropic if key is available ────
    if (resolved.type === "openai-compat" && getAnthropicKey()) {
      const fallbackModel = "claude-haiku-4-5-20251001";
      console.log(`[gateway:agent] falling back to Anthropic ${fallbackModel} (key=${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "CLAUDE_API_KEY"})`);
      try {
        return await runAnthropicAgent(fallbackModel, req, MAX_ROUNDS);
      } catch (fallbackErr: any) {
        console.error(`[gateway:agent] Anthropic fallback also failed: ${fallbackErr?.message}`);
      }
    }

    // ── All providers failed — return graceful reply (never throw to caller) ─────
    console.error(`[gateway:agent] all providers exhausted — returning graceful reply`);
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
    return await runOpenAICompatAgentStream(resolved.modelId, effectiveReq, MAX_ROUNDS, onEvent);
  } catch (err: any) {
    console.error(`[gateway:agent-stream] streaming failed: ${err?.message} — falling back to non-streaming`);
    const r = await aiGatewayAgent(effectiveReq).catch(() => null);
    const reply = r?.reply || "I'm having trouble connecting to the AI service right now. Please try again in a moment.";
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
  const baseURL = process.env.AI_GATEWAY_BASE_URL;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!baseURL || !apiKey) throw new Error(`openai-compat requires AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY`);
  const client = new OpenAI({ baseURL, apiKey, timeout: 45000, maxRetries: 2 });

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

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    let content = "";
    let thinkingSignalled = false;
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
        tools: openaiTools,
        tool_choice: "auto",
        stream: true,
      });
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as { content?: string; reasoning?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
        // REASONING FILTER: gpt-oss-120b emits its chain-of-thought in `delta.reasoning`,
        // separate from the user-facing answer in `delta.content`. We NEVER stream
        // reasoning to the client — only `content`. While the model is still
        // reasoning (reasoning flowing, no content yet), surface a single
        // "Thinking…" status so the UI shows progress instead of a blank wait.
        if (delta.reasoning && !content && !thinkingSignalled) {
          thinkingSignalled = true;
          await onEvent({ type: "status", text: "Thinking…" });
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
        return { reply, provider: "openai-compat", model: modelId, rounds };
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

  // Reasoning models sometimes end tool rounds with no text — one clean
  // streamed conversational call so the user still gets an answer.
  if (!reply.trim()) {
    const original = [...req.messages].reverse().find(m => m.role === "user");
    const originalText = typeof original?.content === "string" ? original.content : "Hello";
    const stream = await client.chat.completions.create({
      model: modelId, max_tokens: 2048, stream: true,
      messages: [
        { role: "system", content: "You are Mondaily AI, a helpful business workspace assistant. Be concise and direct." },
        { role: "user", content: redactSecrets(originalText) },
      ],
    });
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta as { content?: string } | undefined;
      if (d?.content) { reply += d.content; await onEvent({ type: "token", text: d.content }); }
    }
  }

  return { reply, provider: "openai-compat", model: modelId, rounds };
}

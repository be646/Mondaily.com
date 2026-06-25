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

/** Fireworks serverless models tried in order when the primary model 404s. */
const FIREWORKS_FALLBACK_MODELS = [
  "accounts/fireworks/models/llama-v3p1-70b-instruct",
  "accounts/fireworks/models/llama-v3-70b-instruct",
  "accounts/fireworks/models/mixtral-8x7b-instruct",
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
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });

  const completion = await openAIClient().chat.completions.create({
    model: resolved.modelId,
    max_tokens: req.maxTokens ?? 512,
    messages,
  });
  const text = completion.choices[0]?.message.content ?? "";
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
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });

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

  const client = new OpenAI({ baseURL, apiKey });

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: req.system },
    ...req.messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
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
        const tried = [modelId, ...FIREWORKS_FALLBACK_MODELS.slice(0, FIREWORKS_FALLBACK_MODELS.indexOf(activeModel))];
        const next = FIREWORKS_FALLBACK_MODELS.find(m => !tried.includes(m));
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

    const textContent = choice.message.content ?? "";
    if (textContent) reply = textContent;

    if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) break;

    messages.push(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {}
      console.log(`[gateway:openai-compat] tool_call name=${toolCall.function.name}`);
      const result = await req.onToolCall(toolCall.function.name, args);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
    }
  }

  // Llama models often finish tool rounds without producing a text reply.
  // Make one final no-tools call to get a plain-language summary.
  if (!reply && rounds > 0) {
    console.log(`[gateway:openai-compat] no text reply after ${rounds} round(s) — requesting summary`);
    messages.push({ role: "user", content: "Please briefly summarize what you just did or found." });
    try {
      const summary = await client.chat.completions.create({
        model: activeModel,
        max_tokens: 512,
        messages,
      });
      reply = summary.choices[0]?.message.content ?? "";
    } catch {
      // summary call failed — leave reply empty, caller handles fallback text
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
  const spec = req.model
    ?? process.env.AI_AGENT_MODEL
    ?? process.env.AI_PROVIDER_MODEL
    ?? "anthropic/claude-haiku-4-5-20251001";

  const resolved = resolveModel(spec);
  const MAX_ROUNDS = req.maxRounds ?? 5;

  console.log(`[gateway:agent] spec="${spec}" provider=${resolved.type} model=${resolved.modelId}`);

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

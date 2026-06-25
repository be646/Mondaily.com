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
 *                       Falls back to AI_PROVIDER_MODEL if not set.
 *
 * For the "openai-compat" route, set:
 *   AI_GATEWAY_BASE_URL  e.g. "https://api.fireworks.ai/inference/v1"
 *   AI_GATEWAY_API_KEY   your key for that provider
 *
 * Three exported functions:
 *   aiGateway        — plain text generation (no tools)
 *   aiGatewayToolUse — single-tool structured extraction
 *   aiGatewayAgent   — multi-round agentic loop with tool callbacks
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

  const modelId = s.startsWith("anthropic/")
    ? s.slice("anthropic/".length)
    : s;

  return { type: "anthropic", modelId: modelId || "claude-haiku-4-5-20251001" };
}

function openAIClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_GATEWAY_BASE_URL,
    apiKey: process.env.AI_GATEWAY_API_KEY ?? "none",
  });
}

// ── Plain text generation ───────────────────────────────────────────────────────

export async function aiGateway(req: GatewayRequest): Promise<GatewayResponse> {
  const resolved = resolveModel();

  if (resolved.type === "anthropic") {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { text } = await generateText({
      model: anthropic(resolved.modelId),
      ...(req.system ? { system: req.system } : {}),
      prompt: req.prompt,
      maxTokens: req.maxTokens ?? 512,
    });
    return { text, provider: "anthropic", model: resolved.modelId };
  }

  // OpenAI-compatible route — Groq (Llama 3.3), Together, Ollama, etc.
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

/**
 * Single-tool structured extraction. Equivalent to calling Claude with
 * `tool_choice: { type: "tool", name }` or OpenAI with `function_call`.
 *
 * Returns the raw tool input object (no null-filtering — callers handle that).
 */
export async function aiGatewayToolUse(req: GatewayToolRequest): Promise<Record<string, unknown>> {
  const resolved = resolveModel();

  if (resolved.type === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
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

  // OpenAI-compatible route — function calling
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

/**
 * Multi-round agentic loop. Handles tool execution via the onToolCall callback
 * and feeds results back until the model stops calling tools or maxRounds is reached.
 *
 * Model priority: req.model → AI_AGENT_MODEL → AI_PROVIDER_MODEL → default
 */
export async function aiGatewayAgent(req: AgentRequest): Promise<AgentResponse> {
  const spec = req.model
    ?? process.env.AI_AGENT_MODEL
    ?? process.env.AI_PROVIDER_MODEL
    ?? "anthropic/claude-haiku-4-5-20251001";

  const resolved = resolveModel(spec);
  console.log(`[aiGatewayAgent] provider=${resolved.type} model=${resolved.modelId} baseURL=${process.env.AI_GATEWAY_BASE_URL ?? "n/a"}`);
  const MAX_ROUNDS = req.maxRounds ?? 5;
  let reply = "";
  let rounds = 0;

  // ── Anthropic path ────────────────────────────────────────────────────────────
  if (resolved.type === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const messages: unknown[] = [...req.messages];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      rounds = round + 1;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: resolved.modelId,
          max_tokens: req.maxTokens ?? 2048,
          system: req.system,
          tools: req.tools,
          messages,
        }),
      });

      if (!res.ok) throw new Error(`Anthropic agent error: ${await res.text()}`);

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
        const result = await req.onToolCall(tb.name!, tb.input ?? {});
        toolResults.push({ type: "tool_result", tool_use_id: tb.id!, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    }

    return { reply, provider: "anthropic", model: resolved.modelId, rounds };
  }

  // ── OpenAI-compatible path ────────────────────────────────────────────────────
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

  for (let round = 0; round < MAX_ROUNDS; round++) {
    rounds = round + 1;
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await openAIClient().chat.completions.create({
        model: resolved.modelId,
        max_tokens: req.maxTokens ?? 2048,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      });
    } catch (e: any) {
      console.error(`[aiGatewayAgent] openai-compat error:`, e?.status, e?.message, e?.error);
      throw new Error(`Fireworks error ${e?.status ?? ""}: ${e?.message ?? e}`);
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
      const result = await req.onToolCall(toolCall.function.name, args);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
    }
  }

  return { reply, provider: "openai-compat", model: resolved.modelId, rounds };
}

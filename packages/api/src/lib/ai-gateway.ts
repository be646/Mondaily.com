/**
 * AI Gateway — model-agnostic generation utility.
 *
 * Routing is controlled by environment variables:
 *
 *   AI_PROVIDER_MODEL = "anthropic/claude-haiku-4-5-20251001"  (default)
 *                     | "openai-compat/<model-id>"
 *
 * For the "openai-compat" route, set:
 *   AI_GATEWAY_BASE_URL  e.g. "https://api.groq.com/openai/v1"  (Llama 3.3)
 *   AI_GATEWAY_API_KEY   your key for that provider
 *
 * Two exported functions:
 *   aiGateway        — plain text generation (no tools)
 *   aiGatewayToolUse — single-tool structured extraction (replaces tool_use / function-calling)
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

function resolveModel(): ResolvedModel {
  const spec = process.env.AI_PROVIDER_MODEL ?? "anthropic/claude-haiku-4-5-20251001";

  if (spec.startsWith("openai-compat/")) {
    return { type: "openai-compat", modelId: spec.slice("openai-compat/".length) };
  }

  const modelId = spec.startsWith("anthropic/")
    ? spec.slice("anthropic/".length)
    : spec;

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

/**
 * AI Gateway — model-agnostic text generation.
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
 * The Anthropic path uses the Vercel AI SDK (generateText).
 * The openai-compat path uses the openai package with a custom baseURL,
 * which covers Groq, Together, Ollama, and any OpenAI-compatible provider.
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import OpenAI from "openai";

export type GatewayRequest = {
  system: string;
  prompt: string;
  maxTokens?: number;
};

export type GatewayResponse = {
  text: string;
  provider: string;
  model: string;
};

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

export async function aiGateway(req: GatewayRequest): Promise<GatewayResponse> {
  const resolved = resolveModel();

  if (resolved.type === "anthropic") {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { text } = await generateText({
      model: anthropic(resolved.modelId),
      system: req.system,
      prompt: req.prompt,
      maxTokens: req.maxTokens ?? 512,
    });
    return { text, provider: "anthropic", model: resolved.modelId };
  }

  // OpenAI-compatible route: Groq (Llama 3.3 70B), Together, Ollama, etc.
  const client = new OpenAI({
    baseURL: process.env.AI_GATEWAY_BASE_URL,
    apiKey: process.env.AI_GATEWAY_API_KEY ?? "none",
  });
  const completion = await client.chat.completions.create({
    model: resolved.modelId,
    max_tokens: req.maxTokens ?? 512,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ],
  });
  const text = completion.choices[0]?.message.content ?? "";
  return { text, provider: "openai-compat", model: resolved.modelId };
}

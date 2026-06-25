import { NextResponse } from "next/server";

const SYSTEM = `You are Mondaily AI — the assistant on Mondaily's marketing site. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 3 sentences.

Mondaily is an AI-native autonomous workspace and asset-graph engine: every record — people, companies, assets, documents, tasks, invoices, conversations — lives on one connected workspace graph. A team of AI agents (Graph, Operations, Relationship, Finance, Insights, Workflow) continuously monitors that graph, enriches records, and raises source-backed signals and recommendations. Agents prepare and recommend; sensitive actions (sending, billing, deleting) wait for human approval in the Decision Queue. Sales pipelines, finance, and tasks are examples of what you can run on the graph — not the whole identity of the product. Avoid pitching Mondaily as a replacement for "CRM and pipelines" — lead with the workspace graph and agents instead.`;

/**
 * Inline AI gateway — mirrors packages/api/src/lib/ai-gateway.ts routing logic.
 * apps/web has no AI SDK deps so we use native fetch directly.
 * Model is controlled by AI_PROVIDER_MODEL env var.
 */
async function callAI(
  system: string,
  conversationMessages: { role: string; content: string }[],
): Promise<string> {
  const spec = process.env.AI_PROVIDER_MODEL ?? "anthropic/claude-haiku-4-5-20251001";

  if (spec.startsWith("openai-compat/")) {
    const modelId = spec.slice("openai-compat/".length);
    const res = await fetch(`${process.env.AI_GATEWAY_BASE_URL ?? ""}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 300,
        messages: [{ role: "system", content: system }, ...conversationMessages],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }

  // Anthropic path (default)
  const modelId = spec.startsWith("anthropic/")
    ? spec.slice("anthropic/".length)
    : "claude-haiku-4-5-20251001";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system,
      messages: conversationMessages,
    }),
  });
  if (!res.ok) return "";
  const data = await res.json() as { content?: { type: string; text: string }[] };
  return data.content?.find(b => b.type === "text")?.text ?? "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({ messages: [] })) as {
    messages: { role: string; content: string }[];
  };
  const { messages } = body;

  try {
    const trimmed = (messages ?? []).slice(-4);
    if (!trimmed.length) {
      return NextResponse.json({ reply: "Ask me anything about Mondaily." });
    }
    const reply = await callAI(SYSTEM, trimmed);
    return NextResponse.json({
      reply: reply || "Ask me about the workspace graph, AI agents, decisions, or finance.",
    });
  } catch {
    return NextResponse.json({
      reply: "Ask me about enrichment, pipelines, sequences, or automations.",
    });
  }
}

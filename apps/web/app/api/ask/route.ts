import { NextResponse } from "next/server";

const SYSTEM = `You are Mondaily AI — the assistant on Mondaily's marketing site. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 3 sentences.

Mondaily is an AI-native autonomous workspace and asset-graph engine: every record — people, companies, assets, documents, tasks, invoices, conversations — lives on one connected workspace graph. A team of AI agents (Graph, Operations, Relationship, Finance, Insights, Workflow) continuously monitors that graph, enriches records, and raises source-backed signals and recommendations. Agents prepare and recommend; sensitive actions (sending, billing, deleting) wait for human approval in the Decision Queue. Sales pipelines, finance, and tasks are examples of what you can run on the graph — not the whole identity of the product. Avoid pitching Mondaily as a replacement for "CRM and pipelines" — lead with the workspace graph and agents instead.`;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({ messages: [] })) as { messages: { role: string; content: string }[] };
  const { messages } = body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ reply: "Mondaily AI is initialising — try again in a moment." });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM,
        messages: (messages ?? []).slice(-4),
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ reply: "Ask me about the workspace graph, AI agents, decisions, or finance." });
    }

    const data = await res.json() as { content?: { type: string; text: string }[] };
    const reply = data.content?.find(b => b.type === "text")?.text ?? "Ask me anything about Mondaily.";
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ reply: "Ask me about enrichment, pipelines, sequences, or automations." });
  }
}

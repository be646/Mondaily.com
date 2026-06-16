import { NextResponse } from "next/server";

const SYSTEM = `You are Mondaily AI — an autonomous AI workspace platform. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 3 sentences.

Mondaily is: an AI workspace that replaces CRM, email sequences, pipelines, automations, and finance tools. It enriches company records automatically (ARR, headcount, tech stack, signals), moves deals based on AI activity rules, runs multi-step email sequences, and handles invoicing and approvals — all without manual input.`;

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
      return NextResponse.json({ reply: "Ask me about enrichment, pipelines, sequences, or automations." });
    }

    const data = await res.json() as { content?: { type: string; text: string }[] };
    const reply = data.content?.find(b => b.type === "text")?.text ?? "Ask me anything about Mondaily.";
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ reply: "Ask me about enrichment, pipelines, sequences, or automations." });
  }
}

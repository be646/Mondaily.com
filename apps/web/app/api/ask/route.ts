import { NextResponse } from "next/server";

/**
 * Marketing chat — thin proxy to the backend PUBLIC ASK route. The marketing site holds NO AI
 * secrets: it forwards the conversation to `${NEXT_PUBLIC_API_URL}/api/v1/public/ask`, which runs on
 * the sovereign AI gateway (the SYSTEM prompt + provider live there). There is no inline AI gateway,
 * no Anthropic/OpenAI/Tavily/Clerk dependency — the only env this route needs is NEXT_PUBLIC_API_URL.
 * On any failure it returns a canned reply; it never calls a third-party AI provider directly.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({ messages: [] })) as {
    messages: { role: string; content: string }[];
  };
  const messages = (body.messages ?? []).slice(-4);
  if (!messages.length) {
    return NextResponse.json({ reply: "Ask me anything about Mondaily." });
  }
  if (!API_BASE) {
    // No backend configured — never fall back to a third-party provider.
    return NextResponse.json({ reply: "Ask me about the workspace graph, AI agents, decisions, or finance." });
  }

  try {
    // The backend public-ask route expects roles limited to user/assistant.
    const clean = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch(`${API_BASE}/api/v1/public/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: clean.length ? clean : messages }),
    });
    if (!res.ok) throw new Error(`public-ask ${res.status}`);
    const data = (await res.json()) as { reply?: string };
    return NextResponse.json({
      reply: data.reply || "Ask me about the workspace graph, AI agents, decisions, or finance.",
    });
  } catch {
    return NextResponse.json({
      reply: "Ask me about enrichment, pipelines, sequences, or automations.",
    });
  }
}

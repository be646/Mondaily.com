import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const router = new Hono();

const SYSTEM = `You are Mondaily AI — an autonomous AI workspace platform. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 3 sentences.

Mondaily is: an AI workspace that replaces CRM, email sequences, pipelines, automations, and finance tools. It enriches company records automatically (ARR, headcount, tech stack, signals), moves deals based on AI activity rules, runs multi-step email sequences, and handles invoicing and approvals — all without manual input.`;

router.post(
  "/",
  zValidator("json", z.object({
    messages: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })).min(1),
  })),
  async (c) => {
    const { messages } = c.req.valid("json");
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return c.json({ reply: "Mondaily AI is initialising — try again in a moment." });

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
          messages: messages.slice(-4), // last 4 turns only
        }),
      });
      if (!res.ok) return c.json({ reply: "Mondaily AI is here — ask me about enrichment, pipelines, sequences, or automations." });
      const data = await res.json() as { content?: { type: string; text: string }[] };
      const reply = data.content?.find(b => b.type === "text")?.text ?? "Ask me anything about Mondaily.";
      return c.json({ reply });
    } catch {
      return c.json({ reply: "Mondaily AI connects your data, enriches your records, and runs your workflows — ask me anything." });
    }
  }
);

export { router as publicAskRouter };

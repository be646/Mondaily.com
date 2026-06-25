import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiGateway } from "../lib/ai-gateway";

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

    try {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg) return c.json({ reply: "Ask me anything about Mondaily." });

      const prior = messages.slice(-4, -1);
      const prompt = prior.length > 0
        ? prior.map((m) => `${m.role === "user" ? "User" : "Mondaily AI"}: ${m.content}`).join("\n") + `\nUser: ${lastMsg.content}`
        : lastMsg.content;

      const { text: reply } = await aiGateway({ system: SYSTEM, prompt, maxTokens: 300 });
      return c.json({ reply: reply || "Ask me anything about Mondaily." });
    } catch {
      return c.json({ reply: "Mondaily AI connects your data, enriches your records, and runs your workflows — ask me anything." });
    }
  }
);

export { router as publicAskRouter };

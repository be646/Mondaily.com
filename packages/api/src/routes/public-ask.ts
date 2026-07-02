import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiGateway } from "../lib/ai-gateway";

const router = new Hono();

const SYSTEM = `You are Mondaily AI — the assistant on Mondaily's marketing site. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 3 sentences.

Mondaily is an AI-native autonomous workspace and asset-graph engine: every record — people, companies, assets, documents, tasks, invoices, conversations — lives on one connected workspace graph. A team of AI agents (Graph, Operations, Relationship, Finance, Prospecting, Signal, Graph Enrichment, Workflow) continuously watches that graph, enriches records, and raises source-backed signals and recommendations. Agents prepare and recommend; sensitive actions (sending, billing, deleting) always wait for human approval in the Decision Queue — agents prepare, you approve. Sales pipelines, finance, and tasks are examples of what you can run on the graph, not the whole identity of the product. Lead with the workspace graph and the AI agents; do not position Mondaily primarily as a CRM or "CRM replacement." Only describe capabilities that exist — never promise unbuilt features.`;

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

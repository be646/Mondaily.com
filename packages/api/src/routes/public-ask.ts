import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiGateway } from "../lib/ai-gateway";
import { PLAN_TIERS, CREDIT_PACKS, CREDIT_PACK_ORDER, ANNUAL_BONUS_PCT, pricingFacts } from "@mondaily/shared/pricing";
import { rateLimit } from "../middleware/rate-limit";

const router = new Hono();

// Pricing FACTS from the shared catalog — the hero chat must answer from these, never guess.
const fmt = (n: number | null) => n === null ? "custom" : n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1_000)}k`;
// The one description of plans and payments — shared with the in-app support agent, so a price
// change updates both. See pricingFacts().
const PRICING_FACTS = pricingFacts();

const SYSTEM = `You are Mondaily AI — the assistant on Mondaily's marketing site. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 4 sentences.

Mondaily is an AI-native autonomous workspace and asset-graph engine: every record — people, companies, assets, documents, tasks, invoices, conversations — lives on one connected workspace graph. A team of AI agents (Graph, Operations, Relationship, Finance, Prospecting, Signal, Graph Enrichment, Workflow) continuously watches that graph, enriches records, and raises source-backed signals and recommendations. Agents prepare and recommend; sensitive actions (sending, billing, deleting) always wait for human approval in the Decision Queue — agents prepare, you approve. Sales pipelines, finance, and tasks are examples of what you can run on the graph, not the whole identity of the product. Lead with the workspace graph and the AI agents; do not position Mondaily primarily as a CRM. Only describe capabilities that exist — never promise unbuilt features.

For any pricing / plan / credits / packs / discount question, answer ONLY from these facts (never invent prices, credits, or features):
${PRICING_FACTS}
If asked which plan fits: solo/trying it → Scout; a growing team running on AI → Operator; a larger team needing oversight & more credits → Command; private/self-hosted or compliance needs → Sovereign. If they'll exceed included credits, mention pay-as-you-go packs.`;

/**
 * The landing page's chat. UNAUTHENTICATED by design — a visitor asking about pricing has no
 * account yet — which makes it the one endpoint anyone on the internet can bill us through.
 *
 * So it is bounded on three axes, all of which were missing:
 *   - RATE: 12 requests per IP per minute. Enough for a real conversation, useless for a loop.
 *   - LENGTH: 1,000 chars per message. The prompt is what we pay for, and `z.string()` with no max
 *     let a caller paste a novel into it.
 *   - DEPTH: at most 12 messages, of which only the last 4 are sent on. Without a cap the array
 *     itself was an unbounded prompt.
 *
 * maxTokens was already capped at 300, which bounded the ANSWER but not the question.
 */
router.post(
  "/",
  rateLimit({ max: 12, windowMs: 60_000 }),
  zValidator("json", z.object({
    messages: z.array(z.object({
      role: z.enum(["user","assistant"]),
      content: z.string().max(1_000),
    })).min(1).max(12),
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

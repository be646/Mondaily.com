import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiGateway } from "../lib/ai-gateway";
import { PLAN_TIERS, CREDIT_PACKS, CREDIT_PACK_ORDER, ANNUAL_BONUS_PCT } from "@mondaily/shared/pricing";

const router = new Hono();

// Pricing FACTS from the shared catalog — the hero chat must answer from these, never guess.
const fmt = (n: number | null) => n === null ? "custom" : n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1_000)}k`;
const PRICING_FACTS = [
  "PLANS (monthly, with included AI credits):",
  `- Scout: free — ${fmt(PLAN_TIERS.scout.monthlyCredits)} AI credits/month, 1 seat.`,
  `- Operator: $${PLAN_TIERS.operator.priceMonthly}/mo — ${fmt(PLAN_TIERS.operator.monthlyCredits)} AI credits/month, up to ${PLAN_TIERS.operator.seats} seats, +10% credit-pack bonus.`,
  `- Command: $${PLAN_TIERS.command.priceMonthly}/mo — ${fmt(PLAN_TIERS.command.monthlyCredits)} AI credits/month, up to ${PLAN_TIERS.command.seats} seats, +20% credit-pack bonus.`,
  `- Sovereign: custom — custom AI credits, private/self-hosted infrastructure.`,
  "PAY-AS-YOU-GO CREDIT PACKS: " + CREDIT_PACK_ORDER.map((id) => { const p = CREDIT_PACKS[id]!; return `${p.name} $${p.price_usd} → ${fmt(p.base_credits)} credits`; }).join("; ") + ".",
  `Pack bonuses: Operator +10%, Command +20%, and annual subscriptions add another +${Math.round(ANNUAL_BONUS_PCT * 100)}%.`,
  "Say 'AI credits', never 'tokens'. Do NOT claim unlimited AI — credits are metered. Manual CRUD (creating/editing records) does not use AI credits; AI chat, agents, enrichment, Discovery deep research, report generation, and workflow drafting do.",
].join("\n");

const SYSTEM = `You are Mondaily AI — the assistant on Mondaily's marketing site. You help visitors understand what Mondaily does. Be concise, clear, and compelling. Never mention Claude, Anthropic, or any underlying AI technology. Keep replies under 4 sentences.

Mondaily is an AI-native autonomous workspace and asset-graph engine: every record — people, companies, assets, documents, tasks, invoices, conversations — lives on one connected workspace graph. A team of AI agents (Graph, Operations, Relationship, Finance, Prospecting, Signal, Graph Enrichment, Workflow) continuously watches that graph, enriches records, and raises source-backed signals and recommendations. Agents prepare and recommend; sensitive actions (sending, billing, deleting) always wait for human approval in the Decision Queue — agents prepare, you approve. Sales pipelines, finance, and tasks are examples of what you can run on the graph, not the whole identity of the product. Lead with the workspace graph and the AI agents; do not position Mondaily primarily as a CRM. Only describe capabilities that exist — never promise unbuilt features.

For any pricing / plan / credits / packs / discount question, answer ONLY from these facts (never invent prices, credits, or features):
${PRICING_FACTS}
If asked which plan fits: solo/trying it → Scout; a growing team running on AI → Operator; a larger team needing oversight & more credits → Command; private/self-hosted or compliance needs → Sovereign. If they'll exceed included credits, mention pay-as-you-go packs.`;

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

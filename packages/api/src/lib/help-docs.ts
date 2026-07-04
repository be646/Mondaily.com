/**
 * HELP KNOWLEDGE CORPUS — a small, curated set of source snippets the Support agent can cite.
 *
 * This is the ground truth for "how does X work" answers. Each doc has a stable `id` the agent cites
 * (e.g. [discovery]) so users can be pointed at a canonical explanation. Keep entries short, factual,
 * and consistent with the product (never invent features). When no doc covers the question, the agent
 * is told to say so and offer a support ticket rather than guess.
 *
 * NOTE: these describe product behavior only — they never quote prices/credits (those come live from
 * the pricing catalog + the workspace's own wallet, injected separately and read-only).
 */
export interface HelpDoc {
  id: string;
  topics: string[];        // keywords used to select relevant docs for a question
  title: string;
  content: string;
}

export const HELP_DOCS: HelpDoc[] = [
  {
    id: "discovery",
    topics: ["discovery", "search", "leads", "prospect", "scrape", "reviews", "enrich", "web"],
    title: "Discovery — find leads & reviews on the open web",
    content:
      "Discovery searches the open web in plain language, reads the pages it finds, and returns source-backed prospects or reviews. Type a query (e.g. 'clinics in <region> with poor reviews'); results are grounded in the pages actually read. Save a result to add it to your workspace graph. Deep research runs a longer multi-step pass. Discovery needs the sovereign search + scraper appliances configured; if they're not reachable, results will be empty and the Status page shows the appliance as degraded.",
  },
  {
    id: "credits",
    topics: ["credit", "credits", "wallet", "token", "usage", "run out", "low", "exhausted", "refill"],
    title: "AI credits — how the wallet works",
    content:
      "Every AI action (chat, agents, enrichment, Discovery) spends AI credits from your workspace wallet. Each plan includes a monthly credit allotment; you can also buy pay-as-you-go credit packs, which never expire and stack on top of the monthly amount. Remaining = included + purchased − used, floored at zero. When credits hit zero, AI actions pause until you add a pack or upgrade — the rest of the workspace keeps working. Usage is metered from real provider usage. The wallet is shown on Settings → Billing.",
  },
  {
    id: "plans",
    topics: ["plan", "plans", "upgrade", "downgrade", "billing", "invoice", "subscription", "seats", "operator", "command", "sovereign", "scout", "trial"],
    title: "Plans & billing",
    content:
      "Plans are Scout (free), Operator, Command, and Sovereign (custom). Higher tiers include more monthly AI credits, more seats, and more capabilities. Operator offers a 14-day trial. Upgrade or manage your plan on Settings → Billing (card entry is embedded and secure). Seat limits come from your plan. Billing changes, refunds, and credit adjustments are handled by a human — the Help agent can explain plans and guide you, but cannot change billing or issue refunds/credits itself.",
  },
  {
    id: "onboarding",
    topics: ["onboarding", "profile", "industry", "region", "language", "setup", "get started", "workspace profile"],
    title: "Workspace profile & onboarding",
    content:
      "Onboarding captures your industry, region, goals, team size, and preferred language, and recommends modules and a plan. Your workspace profile (Settings → Workspace → Workspace profile) tunes examples, terminology, and AI context across Discovery, Ask, and Home — it personalizes wording and defaults but never changes the product or your data. You can edit the profile any time; a live preview shows how suggestions will adapt.",
  },
  {
    id: "sovereign",
    topics: ["sovereign", "self-host", "private", "search appliance", "scraper", "sovereignty", "provider", "infrastructure"],
    title: "Sovereign AI & Search",
    content:
      "Mondaily is built to run on its own sovereign infrastructure — inference goes through a self-hosted, OpenAI-compatible gateway, and web search/scraping go through self-hosted search + scraper appliances (Sovereign Search). Nothing is routed to a default third-party AI provider; if the sovereign gateway or appliances aren't configured, those features fail closed rather than falling back to an outside service. The Sovereign plan adds private/self-hosted infrastructure, encryption/KMS, audit logs, and SLAs.",
  },
  {
    id: "training_data",
    topics: ["training", "training data", "export", "delete", "purge", "privacy", "data", "retention", "gdpr"],
    title: "Training data — export & delete",
    content:
      "AI training capture is OFF by default and opt-in per workspace. When enabled, captured prompts are redacted for PII and kept for the configured retention window. Settings → Training data lets admins view the policy, export the captured data (JSONL), and purge it. Turning the policy off stops new capture. For a full data-privacy request beyond these controls, open a support ticket.",
  },
  {
    id: "integrations",
    topics: ["integration", "integrations", "email", "gmail", "outlook", "calendar", "connect", "sync", "invite", "members", "seats"],
    title: "Integrations & members",
    content:
      "Connect email (Gmail/Outlook) and calendar under Settings → Email & calendar so messages and events log against the right records. Inviting teammates happens under Settings → Members and is limited by your plan's seat count — if you can't invite, you may be at your seat limit or lack owner/admin rights, so upgrade the plan or ask an owner. Integration availability depends on the connectors configured for your workspace.",
  },
  {
    id: "decisions_agents",
    topics: ["agent", "agents", "decision", "decisions", "approve", "automation", "workflow", "queue", "oversight"],
    title: "Agents & decisions",
    content:
      "Agents prepare work; you approve it. Every consequential action an agent proposes is queued in the Decisions cockpit for your sign-off — nothing runs against your data without approval. The Agents/Activity page shows what each agent did and links to the related surface. Automations run rule-based workflows on record events. This 'agents recommend, humans approve' model is core to how Mondaily stays safe.",
  },
];

/** Pick the docs most relevant to a question (simple keyword overlap). Returns up to `limit`. */
export function selectHelpDocs(question: string, limit = 3): HelpDoc[] {
  const q = question.toLowerCase();
  const scored = HELP_DOCS.map((d) => ({
    d,
    score: d.topics.reduce((s, kw) => s + (q.includes(kw) ? 1 : 0), 0),
  })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.d);
}

/** Render selected docs as a citeable block for the system prompt. */
export function helpDocsBlock(docs: HelpDoc[]): string {
  if (!docs.length) return "";
  return `HELP DOCS (cite the [id] when you use one; if none of these answer the question, say the docs don't cover it and offer a support ticket):\n${docs
    .map((d) => `[${d.id}] ${d.title}: ${d.content}`)
    .join("\n")}`;
}

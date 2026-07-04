import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { getEntitlement } from "../lib/entitlements";
import { resolveProfile, profileContextBlock } from "@mondaily/shared/profile";
import { monthlyCreditsFor } from "@mondaily/shared/pricing";
import { languageInstruction, normalizeLang } from "@mondaily/shared/i18n";

/**
 * SMART HELP / SUPPORT AGENT — a native, source-backed help assistant.
 *
 * Design guardrails (why this is its own route, separate from /ask):
 *  • READ-ONLY. It reads entitlement, the credit wallet, workspace readiness and the profile, but it
 *    NEVER writes to any of them — no credit grants, no plan changes, no refunds, no account actions.
 *  • It CANNOT perform account actions. For anything sensitive it flags `needs_ticket` and the user
 *    explicitly creates a support ticket (POST /support/tickets) — the agent never pretends it acted.
 *  • UNMETERED. The AI call is NOT charged to the workspace wallet (no workspaceId passed to the
 *    gateway), so a user with zero credits can still get help *about* their credits. It still routes
 *    through the sovereign gateway and fails closed if the gateway env is missing.
 *  • LANGUAGE-AWARE. Answers in the user's language (per-user override → workspace profile → English).
 *  • Tickets are stored in the existing `nodes` table (object_type='support_ticket') — no new table /
 *    migration — so they inherit workspace isolation automatically.
 */

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

export const SUPPORT_CATEGORIES = [
  "billing", "credits", "onboarding", "discovery", "integrations", "data_privacy", "bug_report", "feature_request",
] as const;
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Read-only snapshot of everything the agent may ground its answer in. NO writes happen here. */
async function buildSupportContext(workspaceId: string, userId: string) {
  const [wsRow, ledgerRes, contactsRes, membersRes] = await Promise.all([
    supabase.from("workspaces").select("plan, settings, onboarded").eq("id", workspaceId).maybeSingle(),
    supabase.from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", workspaceId),
    supabase.from("nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("object_type", ["person", "company"]),
    supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  const settings = (wsRow.data?.settings ?? {}) as Record<string, unknown>;
  const ent = await getEntitlement(workspaceId);
  const profile = resolveProfile(settings);

  // Wallet — READ-ONLY aggregation of the ledger (identical math to /credits/balance display).
  const rows = ledgerRes.data ?? [];
  const granted = rows.filter(r => r.transaction_type === "grant").reduce((s, r) => s + Number(r.amount), 0);
  const purchased = rows.filter(r => r.transaction_type === "purchase").reduce((s, r) => s + Number(r.amount), 0);
  const usedNeg = rows.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0);
  const included = ent.includedMonthlyCredits;
  const remaining = Math.max(0, granted + purchased + usedNeg);

  const integrations = (settings.integrations ?? {}) as Record<string, boolean>;
  const modules = (settings.modules as string[] | undefined) ?? [];
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[userId]?.language;
  const language = normalizeLang(userLang || profile.language);

  return {
    language,
    entitlement: { tier: ent.tier, source: ent.source, trial_ends_at: ent.trialEndsAt, seats: ent.seats },
    wallet: { included_monthly_credits: included ?? monthlyCreditsFor(ent.tier), remaining, purchased, used: Math.abs(usedNeg), enrolled: rows.length > 0 },
    readiness: {
      onboarded: Boolean(wsRow.data?.onboarded),
      contacts: contactsRes.count ?? 0,
      members: membersRes.count ?? 0,
      email_connected: Boolean(integrations.gmail || integrations.outlook),
      calendar_connected: Boolean(integrations["google-calendar"]),
      enabled_modules: modules,
    },
    profile,
  };
}

/** A compact, source-only context block for the system prompt. Only facts we actually read. */
function contextBlock(ctx: Awaited<ReturnType<typeof buildSupportContext>>): string {
  const w = ctx.wallet;
  const r = ctx.readiness;
  const lines = [
    `Plan/tier: ${ctx.entitlement.tier} (source: ${ctx.entitlement.source}${ctx.entitlement.trial_ends_at ? `, trial ends ${ctx.entitlement.trial_ends_at}` : ""}); seats: ${ctx.entitlement.seats}.`,
    w.enrolled
      ? `AI credit wallet: ${w.remaining.toLocaleString()} remaining of ${(w.included_monthly_credits ?? 0).toLocaleString()} included/mo${w.purchased ? ` + ${w.purchased.toLocaleString()} purchased` : ""}; ${w.used.toLocaleString()} used.`
      : "AI credit wallet: not enrolled yet.",
    `Workspace readiness: onboarded=${r.onboarded}, contacts=${r.contacts}, members=${r.members}, email_connected=${r.email_connected}, calendar_connected=${r.calendar_connected}, modules=[${r.enabled_modules.join(", ") || "none"}].`,
  ];
  const prof = profileContextBlock(ctx.profile);
  return `WORKSPACE FACTS (read-only — the ONLY data you may state as fact about this account):\n${lines.map(l => `- ${l}`).join("\n")}${prof ? `\n${prof}` : ""}`;
}

const SUPPORT_SYSTEM = `You are Mondaily's built-in Help & Support agent. You help users understand and use Mondaily — Discovery, the workspace graph, agents, decisions, finance, plans, AI credits, integrations, and data/privacy.

STRICT RULES:
- Be accurate and source-backed. State account facts ONLY from the provided WORKSPACE FACTS. If a fact isn't there, say you don't have it — never invent numbers, statuses, or history.
- You are READ-ONLY. You CANNOT change plans, grant/refund credits, modify billing, invite members, connect integrations, or take any account action. NEVER claim you did, and NEVER promise refunds, discounts, credit top-ups, or that "it's been fixed/applied".
- For anything requiring an account change, human review, or a bug fix: explain the situation, tell the user you'll open a support request, and set needs_ticket=true with a concise suggested_subject. Do not pretend the action is done.
- Classify the user's issue into exactly one category.
- Keep answers concise, friendly and actionable (a few short paragraphs or a short list). Never mention the underlying AI provider.`;

// POST /support/ask — the source-backed help answer. Never performs actions; may flag needs_ticket.
router.post("/ask", zValidator("json", z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
})), async (c) => {
  const { message, history } = c.req.valid("json");

  // Fail closed if the sovereign gateway isn't configured — never route to a default provider.
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) {
    return c.json({
      answer: "Help AI isn't available right now. You can still create a support request and our team will follow up.",
      category: "bug_report" as SupportCategory, needs_ticket: true, suggested_subject: "Help AI unavailable", language: "en", degraded: true,
    });
  }

  const ctx = await buildSupportContext(c.get("workspaceId"), c.get("userId"));
  const priorTurns = (history ?? []).slice(-6).map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n");
  const system = `${SUPPORT_SYSTEM}\n\n${contextBlock(ctx)}${languageInstruction(ctx.language)}\n\nRespond as JSON only: {"answer": string, "category": one of [${SUPPORT_CATEGORIES.join(", ")}], "needs_ticket": boolean, "suggested_subject": string}. The "answer" must be in the user's language; the other fields stay in English.`;
  const prompt = `${priorTurns ? priorTurns + "\n" : ""}User: ${message}`;

  // UNMETERED on purpose (no workspaceId) so users with 0 credits can still get help about credits.
  let raw = "";
  try {
    const res = await aiGateway({ system, prompt, maxTokens: 700, feature: "support" });
    raw = res.text ?? "";
  } catch {
    return c.json({ answer: "I couldn't reach the help service just now. Please try again, or create a support request.", category: "bug_report" as SupportCategory, needs_ticket: true, suggested_subject: "Help service error", language: ctx.language, degraded: true });
  }

  // Parse the model's JSON; fall back to a plain answer if it didn't comply.
  let parsed: { answer?: string; category?: string; needs_ticket?: boolean; suggested_subject?: string } = {};
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { parsed = { answer: raw }; }
  const category: SupportCategory = (SUPPORT_CATEGORIES as readonly string[]).includes(parsed.category ?? "")
    ? (parsed.category as SupportCategory) : "bug_report";

  return c.json({
    answer: (parsed.answer && parsed.answer.trim()) || "I'm not sure — want me to open a support request so a human can help?",
    category,
    needs_ticket: Boolean(parsed.needs_ticket),
    suggested_subject: (parsed.suggested_subject ?? "").toString().slice(0, 120),
    language: ctx.language,
  });
});

// POST /support/tickets — create a support ticket/escalation. This is the ONLY way a sensitive
// request is recorded — the agent never performs the action itself. Stored as a workspace node.
router.post("/tickets", zValidator("json", z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).optional(),
})), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"),
    vertical: "shared",
    object_type: "support_ticket",
    created_by: c.get("userId"),
    data: {
      category: body.category,
      subject: body.subject,
      message: body.message,
      status: "open",
      metadata: body.metadata ?? {},
      created_by_user: c.get("userId"),
    },
  }).select("id, created_at").single();
  if (error) return c.json({ error: "Could not create the support request." }, 500);
  return c.json({ id: data.id, status: "open", created_at: data.created_at }, 201);
});

// GET /support/tickets — admin-visible support queue for THIS workspace (small + safe: capped, own
// workspace only via the workspace_id filter, admin-gated).
router.get("/tickets", requireAdminRole, async (c) => {
  const { data } = await supabase
    .from("nodes")
    .select("id, data, created_by, created_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "support_ticket")
    .order("created_at", { ascending: false })
    .limit(50);
  const tickets = (data ?? []).map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    return {
      id: n.id,
      category: d.category ?? "bug_report",
      subject: d.subject ?? "",
      status: d.status ?? "open",
      created_by: n.created_by,
      created_at: n.created_at,
    };
  });
  return c.json({ tickets });
});

export { router as supportRouter };

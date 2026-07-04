import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole, isWorkspaceAdmin } from "../middleware/rbac";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";
import { getEntitlement } from "../lib/entitlements";
import { createNotification } from "../lib/notify";
import { selectHelpDocs, helpDocsBlock } from "../lib/help-docs";
import { resolveProfile, profileContextBlock } from "@mondaily/shared/profile";
import { monthlyCreditsFor } from "@mondaily/shared/pricing";
import { languageInstruction, normalizeLang } from "@mondaily/shared/i18n";

/**
 * SMART HELP / SUPPORT AGENT (phase 2) — source-backed help + an operational ticket lifecycle.
 *
 * Guardrails (unchanged from phase 1):
 *  • READ-ONLY over the account. It reads entitlement, wallet, readiness, diagnostics, profile and
 *    recent tickets, but NEVER writes any of them — no credit grants, plan changes, refunds, or
 *    account actions. Sensitive requests become a ticket; the agent never pretends it acted.
 *  • The /ask AI call is UNMETERED (no workspaceId to the gateway) so a user at zero credits can still
 *    get help, and it fails closed if the sovereign gateway env is missing.
 *  • Answers cite the internal HELP DOCS where relevant, and say "the docs don't cover this" + offer a
 *    ticket when they don't. Language follows user override → workspace profile → English.
 *  • Everything is workspace-scoped; the admin queue is owner/admin-gated, ticket detail is visible to
 *    the requester or an admin. Tickets + comments live in the existing `nodes` table (no migration).
 */

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

export const SUPPORT_CATEGORIES = [
  "billing", "credits", "onboarding", "discovery", "integrations", "data_privacy", "bug_report", "feature_request",
] as const;
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ["open", "in_review", "waiting_on_user", "resolved", "closed"] as const;
type SupportStatus = (typeof SUPPORT_STATUSES)[number];

interface TicketComment { author_id: string; author_role: "admin" | "requester"; body: string; at: string }
interface TicketData {
  category: SupportCategory; subject: string; message: string; status: SupportStatus;
  metadata?: Record<string, unknown>; created_by_user?: string; updated_at?: string;
  comments?: TicketComment[]; status_history?: { status: SupportStatus; at: string; by: string }[];
}

// ── Read-only diagnostics context ───────────────────────────────────────────────────────────────
/** Read-only snapshot of everything the agent may ground its answer in. NO writes happen here. */
async function buildSupportContext(workspaceId: string, userId: string) {
  const env = gatewayEnv();
  const [wsRow, ledgerRes, contactsRes, membersRes, ticketRes] = await Promise.all([
    supabase.from("workspaces").select("plan, settings, onboarded").eq("id", workspaceId).maybeSingle(),
    supabase.from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", workspaceId),
    supabase.from("nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("object_type", ["person", "company"]),
    supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("nodes").select("data, created_at").eq("workspace_id", workspaceId).eq("object_type", "support_ticket").order("created_at", { ascending: false }).limit(5),
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
  const training = (settings.training_policy ?? {}) as { enabled?: boolean; retention_days?: number };
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[userId]?.language;
  const language = normalizeLang(userLang || profile.language);
  const recentTickets = (ticketRes.data ?? []).map((n) => {
    const d = (n.data ?? {}) as TicketData;
    return { subject: d.subject ?? "", status: d.status ?? "open", category: d.category ?? "bug_report" };
  });

  return {
    language, profile,
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
    // Diagnostics mirror the /status readiness rows (env-presence probes — never invented).
    diagnostics: {
      database: !wsRow.error,
      ai_gateway: Boolean(env.baseURL && env.apiKey),
      sovereign_search: Boolean(process.env.SOVEREIGN_SEARCH_URL),
      sovereign_scrape: Boolean(process.env.SOVEREIGN_SCRAPE_URL),
    },
    training_policy: { enabled: Boolean(training.enabled), retention_days: training.retention_days ?? null },
    recent_tickets: recentTickets,
  };
}

/** A compact, source-only context block for the system prompt. Only facts we actually read. */
function contextBlock(ctx: Awaited<ReturnType<typeof buildSupportContext>>): string {
  const w = ctx.wallet, r = ctx.readiness, d = ctx.diagnostics;
  const lines = [
    `Plan/tier: ${ctx.entitlement.tier} (source: ${ctx.entitlement.source}${ctx.entitlement.trial_ends_at ? `, trial ends ${ctx.entitlement.trial_ends_at}` : ""}); seats: ${ctx.entitlement.seats}.`,
    w.enrolled
      ? `AI credit wallet: ${w.remaining.toLocaleString()} remaining of ${(w.included_monthly_credits ?? 0).toLocaleString()} included/mo${w.purchased ? ` + ${w.purchased.toLocaleString()} purchased` : ""}; ${w.used.toLocaleString()} used.`
      : "AI credit wallet: not enrolled yet.",
    `Workspace readiness: onboarded=${r.onboarded}, contacts=${r.contacts}, members=${r.members}, email_connected=${r.email_connected}, calendar_connected=${r.calendar_connected}, modules=[${r.enabled_modules.join(", ") || "none"}].`,
    `System diagnostics: database=${d.database ? "ok" : "unreachable"}, ai_gateway=${d.ai_gateway ? "configured" : "not configured"}, sovereign_search=${d.sovereign_search ? "configured" : "not configured"}, sovereign_scrape=${d.sovereign_scrape ? "configured" : "not configured"}.`,
    `Training data policy: ${ctx.training_policy.enabled ? `on (retention ${ctx.training_policy.retention_days ?? "?"} days)` : "off (no capture)"}.`,
    ctx.recent_tickets.length ? `Recent support tickets: ${ctx.recent_tickets.map(t => `"${t.subject}" (${t.status})`).join("; ")}.` : "Recent support tickets: none.",
  ];
  const prof = profileContextBlock(ctx.profile);
  return `WORKSPACE FACTS (read-only — the ONLY data you may state as fact about this account):\n${lines.map(l => `- ${l}`).join("\n")}${prof ? `\n${prof}` : ""}`;
}

const SUPPORT_SYSTEM = `You are Mondaily's built-in Help & Support agent. You help users understand and use Mondaily — Discovery, the workspace graph, agents, decisions, finance, plans, AI credits, integrations, and data/privacy.

STRICT RULES:
- Be accurate and source-backed. Explain features using the provided HELP DOCS and cite the [id] you used. If the docs don't cover the question, say so plainly and offer to open a support ticket — do not guess.
- State account facts ONLY from the provided WORKSPACE FACTS / diagnostics. If a fact isn't there, say you don't have it — never invent numbers, statuses, outages, or history.
- You are READ-ONLY. You CANNOT change plans, grant/refund credits, modify billing, invite members, connect integrations, or take any account action. NEVER claim you did, and NEVER promise refunds, discounts, credit top-ups, or that "it's been fixed/applied". You may explain plans/credits and point users to Settings → Billing to buy credits or upgrade.
- For anything requiring an account change, human review, refund/credit adjustment, or a bug fix: explain the situation, tell the user you'll open a support request, and set needs_ticket=true with a concise suggested_subject. Do not pretend the action is done.
- Classify the user's issue into exactly one category. Keep answers concise, friendly and actionable. Never mention the underlying AI provider.`;

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
      category: "bug_report" as SupportCategory, needs_ticket: true, suggested_subject: "Help AI unavailable", language: "en", cited_docs: [], degraded: true,
    });
  }

  const ctx = await buildSupportContext(c.get("workspaceId"), c.get("userId"));
  const docs = selectHelpDocs(message);
  const priorTurns = (history ?? []).slice(-6).map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n");
  const system = `${SUPPORT_SYSTEM}\n\n${contextBlock(ctx)}\n\n${helpDocsBlock(docs)}${languageInstruction(ctx.language)}\n\nRespond as JSON only: {"answer": string, "category": one of [${SUPPORT_CATEGORIES.join(", ")}], "needs_ticket": boolean, "suggested_subject": string}. The "answer" must be in the user's language; the other fields stay in English.`;
  const prompt = `${priorTurns ? priorTurns + "\n" : ""}User: ${message}`;

  // UNMETERED on purpose (no workspaceId) so users with 0 credits can still get help about credits.
  let raw = "";
  try {
    const res = await aiGateway({ system, prompt, maxTokens: 700, feature: "support" });
    raw = res.text ?? "";
  } catch {
    return c.json({ answer: "I couldn't reach the help service just now. Please try again, or create a support request.", category: "bug_report" as SupportCategory, needs_ticket: true, suggested_subject: "Help service error", language: ctx.language, cited_docs: [], degraded: true });
  }

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
    cited_docs: docs.map(d => d.id),
  });
});

// ── Ticket helpers ──────────────────────────────────────────────────────────────────────────────
/** owner/admin user ids for a workspace (for new-ticket notifications). */
async function workspaceAdminIds(workspaceId: string, exclude?: string): Promise<string[]> {
  const { data } = await supabase.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"]);
  return (data ?? []).map(m => m.user_id as string).filter(id => id && id !== exclude);
}

/** Fetch a support-ticket node, scoped to the workspace. Returns null if not found / not a ticket. */
async function getTicket(workspaceId: string, id: string) {
  const { data } = await supabase.from("nodes").select("id, data, created_by, created_at, updated_at")
    .eq("workspace_id", workspaceId).eq("object_type", "support_ticket").eq("id", id).maybeSingle();
  return data ? { ...data, data: (data.data ?? {}) as TicketData } : null;
}

// POST /support/tickets — create a ticket. Notifies workspace admins/owners.
router.post("/tickets", zValidator("json", z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).optional(),
})), async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId");
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  const ticketData: TicketData = {
    category: body.category, subject: body.subject, message: body.message, status: "open",
    metadata: body.metadata ?? {}, created_by_user: userId, updated_at: now, comments: [],
    status_history: [{ status: "open", at: now, by: userId }],
  };
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: ws, vertical: "shared", object_type: "support_ticket", created_by: userId, data: ticketData,
  }).select("id, created_at").single();
  if (error) return c.json({ error: "Could not create the support request." }, 500);

  // Notify admins/owners (in-app; email only if the notification system already supports it safely).
  const admins = await workspaceAdminIds(ws, userId);
  await Promise.all(admins.map(uid => createNotification({
    workspace_id: ws, user_id: uid, type: "support",
    title: `New support request: ${body.subject}`,
    body: `A ${body.category.replace(/_/g, " ")} request was opened.`,
    metadata: { support_ticket_id: data.id, category: body.category },
  }).catch(() => false)));

  return c.json({ id: data.id, status: "open", created_at: data.created_at }, 201);
});

// GET /support/tickets — admin/owner queue for THIS workspace (capped, workspace-scoped).
router.get("/tickets", requireAdminRole, async (c) => {
  const { data } = await supabase.from("nodes")
    .select("id, data, created_by, created_at, updated_at")
    .eq("workspace_id", c.get("workspaceId")).eq("object_type", "support_ticket")
    .order("created_at", { ascending: false }).limit(100);
  const tickets = (data ?? []).map((n) => {
    const d = (n.data ?? {}) as TicketData;
    return {
      id: n.id, category: d.category ?? "bug_report", subject: d.subject ?? "", status: d.status ?? "open",
      created_by: n.created_by, created_at: n.created_at, last_updated: d.updated_at ?? n.updated_at ?? n.created_at,
      comment_count: (d.comments ?? []).length,
    };
  });
  return c.json({ tickets });
});

// GET /support/my-tickets — the requester's OWN tickets (any member can see their own).
router.get("/my-tickets", async (c) => {
  const { data } = await supabase.from("nodes")
    .select("id, data, created_at, updated_at")
    .eq("workspace_id", c.get("workspaceId")).eq("object_type", "support_ticket").eq("created_by", c.get("userId"))
    .order("created_at", { ascending: false }).limit(50);
  const tickets = (data ?? []).map((n) => {
    const d = (n.data ?? {}) as TicketData;
    return { id: n.id, category: d.category ?? "bug_report", subject: d.subject ?? "", status: d.status ?? "open", created_at: n.created_at, last_updated: d.updated_at ?? n.updated_at ?? n.created_at };
  });
  return c.json({ tickets });
});

// GET /support/tickets/:id — detail, visible to the requester OR an admin/owner. Workspace-scoped.
router.get("/tickets/:id", async (c) => {
  const ws = c.get("workspaceId");
  const t = await getTicket(ws, c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  if (t.created_by !== c.get("userId") && !isWorkspaceAdmin(c.get("role"))) return c.json({ error: "Not allowed." }, 403);
  return c.json({
    id: t.id, ...t.data, created_by: t.created_by, created_at: t.created_at,
    comments: t.data.comments ?? [], status_history: t.data.status_history ?? [],
  });
});

// PATCH /support/tickets/:id — update status (admin/owner only). Notifies the requester.
router.patch("/tickets/:id", requireAdminRole, zValidator("json", z.object({
  status: z.enum(SUPPORT_STATUSES),
})), async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId");
  const t = await getTicket(ws, c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  const now = new Date().toISOString();
  const nextStatus = c.req.valid("json").status;
  const updated: TicketData = {
    ...t.data, status: nextStatus, updated_at: now,
    status_history: [...(t.data.status_history ?? []), { status: nextStatus, at: now, by: userId }],
  };
  const { error } = await supabase.from("nodes").update({ data: updated }).eq("workspace_id", ws).eq("id", t.id).eq("object_type", "support_ticket");
  if (error) return c.json({ error: "Could not update the ticket." }, 500);

  if (t.created_by && t.created_by !== userId) {
    await createNotification({
      workspace_id: ws, user_id: t.created_by, type: "support",
      title: `Support request ${nextStatus.replace(/_/g, " ")}: ${t.data.subject}`,
      body: `Your support request is now ${nextStatus.replace(/_/g, " ")}.`,
      metadata: { support_ticket_id: t.id, status: nextStatus },
    }).catch(() => false);
  }
  return c.json({ id: t.id, status: nextStatus, last_updated: now });
});

// POST /support/tickets/:id/comments — reply. Allowed for the requester OR an admin/owner. Notifies
// the other party. Comments live in the ticket node's data (no separate table/migration).
router.post("/tickets/:id/comments", zValidator("json", z.object({
  body: z.string().min(1).max(8000),
})), async (c) => {
  const ws = c.get("workspaceId"); const userId = c.get("userId"); const role = c.get("role");
  const t = await getTicket(ws, c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  const isAdmin = isWorkspaceAdmin(role);
  const isRequester = t.created_by === userId;
  if (!isAdmin && !isRequester) return c.json({ error: "Not allowed." }, 403);

  const now = new Date().toISOString();
  const comment: TicketComment = { author_id: userId, author_role: isAdmin && !isRequester ? "admin" : "requester", body: c.req.valid("json").body, at: now };
  const updated: TicketData = { ...t.data, updated_at: now, comments: [...(t.data.comments ?? []), comment] };
  const { error } = await supabase.from("nodes").update({ data: updated }).eq("workspace_id", ws).eq("id", t.id).eq("object_type", "support_ticket");
  if (error) return c.json({ error: "Could not add the comment." }, 500);

  // Notify the OTHER party: admin reply → notify requester; requester reply → notify admins.
  if (comment.author_role === "admin") {
    if (t.created_by && t.created_by !== userId) await createNotification({
      workspace_id: ws, user_id: t.created_by, type: "support",
      title: `New reply on: ${t.data.subject}`, body: "Support replied to your request.",
      metadata: { support_ticket_id: t.id },
    }).catch(() => false);
  } else {
    const admins = await workspaceAdminIds(ws, userId);
    await Promise.all(admins.map(uid => createNotification({
      workspace_id: ws, user_id: uid, type: "support",
      title: `Requester replied on: ${t.data.subject}`, body: "The requester added a comment.",
      metadata: { support_ticket_id: t.id },
    }).catch(() => false)));
  }
  return c.json({ ok: true, comment });
});

export { router as supportRouter };

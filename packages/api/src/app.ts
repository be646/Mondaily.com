import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "inngest/hono";
import { inngest } from "./lib/inngest";
import { enrichRecord, invoiceChaser, relationshipHealth, leadScoring, dealAlerts, creditNoteDisputeHandler, recurringInvoices, overdueTaskDecisions, workflowTrigger, trainingExport, socialDiscoveryWorker, dailyBrief } from "./jobs/index";
import { runAllDaily, runLeadScoring, runDealAlerts } from "./jobs/runners";
import { runAllWorkflows } from "./jobs/workflow-engine";
import { runAllVertical } from "./jobs/vertical-agents";
import { nodesRouter } from "./routes/nodes";
import { searchRouter } from "./routes/search";
import { askRouter } from "./routes/ask";
import { publicAskRouter } from "./routes/public-ask";
import { agentsRouter } from "./routes/agents";
import { decisionsRouter } from "./routes/decisions";
import { activitiesRouter } from "./routes/activities";
import { messagesRouter } from "./routes/messages";
import { trainingRouter } from "./routes/training";
import { liveCallsRouter } from "./routes/live-calls";
import { realtimeRouter } from "./routes/realtime";
import { authRouter } from "./routes/auth";
import { creditsRouter } from "./routes/credits";
import { supportRouter } from "./routes/support";
import { webhooksRouter } from "./routes/webhooks";
import { billingRouter } from "./routes/billing";
import { appDataRouter } from "./routes/app-data";
import { invitesRouter } from "./routes/invites";
import { notesRouter } from "./routes/notes";
import { emailsRouter } from "./routes/emails";
import { callsRouter } from "./routes/calls";
import { reportsRouter } from "./routes/reports";
import { dashboardsRouter } from "./routes/dashboards";
import { sequencesRouter } from "./routes/sequences";
import { listsRouter } from "./routes/lists";
import tasksRouter from "./routes/tasks";
import { chatsRouter } from "./routes/chats";
import { feedbackRouter } from "./routes/feedback";
import { membersRouter } from "./routes/members";
import { notificationsRouter } from "./routes/notifications";
import { taskReviewsRouter } from "./routes/task-reviews";
import { taskDetailsRouter } from "./routes/task-details";
import { importRouter } from "./routes/import";
import { generateRouter } from "./routes/generate";
import { digestsRouter } from "./routes/digests";
import { annotationsRouter } from "./routes/annotations";
import { workflowsRouter } from "./routes/workflows";
import { invoicesRouter } from "./routes/invoices";
import { creditNotesRouter } from "./routes/credit-notes";
import { quotesRouter } from "./routes/quotes";
import { expensesRouter } from "./routes/expenses";
import { tagsRouter } from "./routes/tags";
import { onboardingRouter } from "./routes/onboarding";
import { prospectingRouter } from "./routes/prospecting";
import { statusRouter } from "./routes/status";
import { usageRouter } from "./routes/usage";
import { discoveryRouter } from "./routes/discovery";
import { workspacesRouter } from "./routes/workspaces";
import { integrationsRouter } from "./routes/integrations";
import { mcpRouter } from "./routes/mcp";

const app = new Hono();

app.use("*", cors({
  origin: ["https://mondaily.com", "https://app.mondaily.com", "http://localhost:3000", "http://localhost:5173"],
  credentials: true
}));
app.use("*", logger());

// SECURITY (multi-tenant): every API response carries per-workspace data, so it
// must NEVER be cached by a shared CDN/proxy — a public cache keyed on URL would
// serve one tenant's response to another. Default all responses to private,
// no-store. A genuinely public, cacheable route (e.g. public templates) can
// override this header in its own handler with `public, max-age=…, stale-while-revalidate=…`.
app.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

app.route("/api/v1/import", importRouter);
app.route("/api/v1/generate", generateRouter);
app.route("/api/v1/nodes", nodesRouter);
app.route("/api/v1/search", searchRouter);
app.route("/api/v1/ask", askRouter);
app.route("/api/v1/public/ask", publicAskRouter);
app.route("/api/v1/agents", agentsRouter);
app.route("/api/v1/decisions", decisionsRouter);
app.route("/api/v1/prospecting", prospectingRouter);
app.route("/api/v1/status", statusRouter);
app.route("/api/v1/usage", usageRouter);
app.route("/api/v1/discovery", discoveryRouter);
app.route("/api/v1/workspaces", workspacesRouter);
app.route("/api/v1/activities", activitiesRouter);
app.route("/api/v1/realtime", realtimeRouter);
app.route("/api/v1/auth", authRouter);   // Sovereign Auth — the sole auth runtime (Clerk fully removed)
app.route("/api/v1/credits", creditsRouter);
app.route("/api/v1/webhooks", webhooksRouter);
app.route("/api/v1/billing", billingRouter);
app.route("/api/v1/invites", invitesRouter);
app.route("/api/v1/notes", notesRouter);
app.route("/api/v1/emails", emailsRouter);
app.route("/api/v1/calls", callsRouter);
app.route("/api/v1/reports", reportsRouter);
app.route("/api/v1/dashboards", dashboardsRouter);
app.route("/api/v1/sequences", sequencesRouter);
app.route("/api/v1/lists", listsRouter);
app.route("/api/v1/chats", chatsRouter);
app.route("/api/v1/feedback", feedbackRouter);
app.route("/api/v1/members", membersRouter);
app.route("/api/v1/notifications", notificationsRouter);
app.route("/api/v1/messages", messagesRouter);
app.route("/api/v1/training", trainingRouter);
app.route("/api/v1/live-calls", liveCallsRouter);
app.route("/api/v1/tasks", taskReviewsRouter);
app.route("/api/v1/tasks", taskDetailsRouter);
app.route("/api/v1/tasks", tasksRouter);
app.route("/api/v1/digests", digestsRouter);
app.route("/api/v1/annotations", annotationsRouter);
app.route("/api/v1/workflows", workflowsRouter);
app.route("/api/v1/invoices", invoicesRouter);
app.route("/api/v1/credit-notes", creditNotesRouter);
app.route("/api/v1/quotes", quotesRouter);
app.route("/api/v1/expenses", expensesRouter);
app.route("/api/v1/tags", tagsRouter);
app.route("/api/v1/onboarding", onboardingRouter);
app.route("/api/v1/support", supportRouter);
app.route("/api/v1/integrations", integrationsRouter);
app.route("/api/mcp", mcpRouter); // external AI clients (MCP), own key-based auth
app.route("/api/v1", appDataRouter);

const inngestHandler = serve({ client: inngest, functions: [enrichRecord, invoiceChaser, relationshipHealth, leadScoring, dealAlerts, creditNoteDisputeHandler, recurringInvoices, overdueTaskDecisions, workflowTrigger, trainingExport, socialDiscoveryWorker, dailyBrief] });
app.all("/api/inngest", inngestHandler);

/**
 * Vercel Cron entry point — runs the daily agent jobs without depending on
 * Inngest. Configured in packages/api/vercel.json (`crons`). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on scheduled invocations; we reject
 * anything else so the endpoint can't be triggered by the public.
 */
app.get("/api/cron/daily", async (c) => {
  const secret = process.env.CRON_SECRET;
  // FAIL CLOSED: if no secret is configured the endpoint is DISABLED, not open.
  // Previously an unset CRON_SECRET let anyone trigger the daily batch (and burn
  // Cerebras compute / fire agent side effects). Now it's 503 until configured.
  if (!secret) {
    return c.json({ error: "Cron disabled — CRON_SECRET is not configured." }, 503);
  }
  // Accept the secret via the Authorization header (Vercel Cron) OR a ?secret=
  // query token (manual/uptime triggers). Anything that doesn't match → 401.
  const provided = c.req.header("Authorization") ?? `Bearer ${c.req.query("secret") ?? ""}`;
  if (provided !== `Bearer ${secret}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // ?only=<runner> runs a single side-effect-free runner (e.g. lead_scoring,
  // relationship_health) instead of the whole daily batch — used to backfill
  // or verify one job without firing invoice/deal-alert side effects.
  const only = c.req.query("only");
  if (only === "lead_scoring") {
    const r = await runLeadScoring();
    return c.json({ ran: true, only, at: new Date().toISOString(), result: r });
  }
  if (only === "deal_alerts") {
    const r = await runDealAlerts();
    return c.json({ ran: true, only, at: new Date().toISOString(), result: r });
  }
  if (only === "workflows") {
    const r = await runAllWorkflows().catch((e) => ({ error: String(e) }));
    return c.json({ ran: true, only, at: new Date().toISOString(), result: r });
  }
  const results = await runAllDaily();
  const workflows = await runAllWorkflows().catch((e) => ({ error: String(e) }));
  const vertical = await runAllVertical().catch((e) => ({ error: String(e) }));
  return c.json({ ran: true, at: new Date().toISOString(), results, workflows, vertical });
});

/**
 * Dedicated Discovery-monitors cron — runs ONLY the "Watch this search" saved searches, so we can
 * refresh them several times a day WITHOUT re-running the heavy daily batch (invoices, scoring…).
 * Same CRON_SECRET auth as /api/cron/daily. Configured in vercel.json.
 */
app.get("/api/cron/monitors", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return c.json({ error: "Cron disabled — CRON_SECRET is not configured." }, 503);
  const provided = c.req.header("Authorization") ?? `Bearer ${c.req.query("secret") ?? ""}`;
  if (provided !== `Bearer ${secret}`) return c.json({ error: "Unauthorized" }, 401);
  const { runDiscoveryMonitors } = await import("./jobs/social-discovery");
  const result = await runDiscoveryMonitors().catch((e) => ({ error: String(e) }));
  // Purge expired Discovery cache rows so the table stays bounded.
  const { supabase } = await import("@mondaily/db/client");
  await supabase.from("discovery_cache").delete().lt("expires_at", new Date().toISOString()).then(() => {}, () => {});
  // Training-data RETENTION — for each workspace that set a retention window, drop training rows
  // older than it (workspace-isolated deletes).
  try {
    const { data: wsList } = await supabase.from("workspaces").select("id, settings");
    for (const w of wsList ?? []) {
      const rd = Number((w.settings as { training_policy?: { retention_days?: number } } | null)?.training_policy?.retention_days ?? 0);
      if (rd >= 7) {
        const cutoff = new Date(Date.now() - rd * 86_400_000).toISOString();
        await supabase.from("ai_training_logs").delete().eq("workspace_id", w.id as string).lt("created_at", cutoff).then(() => {}, () => {});
      }
    }
  } catch { /* best-effort retention */ }
  return c.json({ ran: true, at: new Date().toISOString(), result });
});

// `commit` surfaces the actually-deployed git SHA (Vercel injects VERCEL_GIT_COMMIT_SHA at build
// time) so a deploy can be VERIFIED from outside — if this doesn't match the pushed HEAD, the build
// didn't ship. `null` locally / where the env isn't set.
app.get("/api/health", (c) => c.json({ ok: true, version: "1.8.0-objreg", commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null }));

// Auth diagnostics — DEV/DEBUG ONLY. Gated behind an explicit flag so it never exposes session
// state in production. Set DEBUG_AUTH=1 (only in a non-prod environment) to enable it; otherwise
// it 404s like any unknown route.
app.get("/api/debug-auth", async (c) => {
  const enabled = process.env.DEBUG_AUTH === "1" && process.env.NODE_ENV !== "production";
  if (!enabled) return c.json({ error: "Not found" }, 404);
  const { getCookie } = await import("hono/cookie");
  const { verifyAccessToken, ACCESS_COOKIE } = await import("./lib/auth-tokens");
  const at = getCookie(c, ACCESS_COOKIE);
  const info: Record<string, string> = {
    auth_secret_set: process.env.AUTH_JWT_SECRET ? "yes" : "no",
    access_cookie: at ? "present" : "absent",
  };
  if (at) {
    const claims = await verifyAccessToken(at);
    info.verify_result = claims ? "ok" : "invalid";
    if (claims) info.sub = claims.sub;
  }
  return c.json(info);
});

export default app;

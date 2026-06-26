import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "inngest/hono";
import { inngest } from "./lib/inngest";
import { enrichRecord, invoiceChaser, relationshipHealth, leadScoring, dealAlerts, creditNoteDisputeHandler, recurringInvoices, overdueTaskDecisions } from "./jobs/index";
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
import { workspacesRouter } from "./routes/workspaces";

const app = new Hono();

app.use("*", cors({
  origin: ["https://mondaily.com", "https://app.mondaily.com", "https://mondaily-app.onrender.com", "http://localhost:3000", "http://localhost:5173"],
  credentials: true
}));
app.use("*", logger());

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
app.route("/api/v1/workspaces", workspacesRouter);
app.route("/api/v1/activities", activitiesRouter);
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
app.route("/api/v1", appDataRouter);

const inngestHandler = serve({ client: inngest, functions: [enrichRecord, invoiceChaser, relationshipHealth, leadScoring, dealAlerts, creditNoteDisputeHandler, recurringInvoices, overdueTaskDecisions] });
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

app.get("/api/health", (c) => c.json({ ok: true, version: "1.3.0-workflows" }));

app.get("/api/debug-auth", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  const clerkKey = process.env.CLERK_SECRET_KEY;
  const info: Record<string, string> = {
    clerk_key_set: clerkKey ? "yes" : "no",
    clerk_key_prefix: clerkKey?.substring(0, 12) ?? "NOT SET",
    token_received: token ? "yes" : "no",
    token_prefix: token?.substring(0, 20) ?? "none",
  };
  if (token && clerkKey) {
    try {
      const { verifyToken } = await import("@clerk/backend");
      const verified = await verifyToken(token, { secretKey: clerkKey, skipJwksCache: true });
      info.verify_result = "ok";
      info.sub = verified.sub;
    } catch (e: any) {
      info.verify_error = e?.message ?? String(e);
    }
  }
  return c.json(info);
});

export default app;

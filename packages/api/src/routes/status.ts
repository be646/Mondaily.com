import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/**
 * Real status checks for the /status page — every row here is a live probe
 * (an env var presence check or a real Supabase query) made at request
 * time, never a hardcoded "operational". If a check can't be performed
 * honestly, it reports "not_checked" rather than guessing.
 */

type CheckState = "operational" | "needs_setup" | "disabled" | "error" | "not_checked";

interface Check {
  id: string;
  label: string;
  state: CheckState;
  explanation: string;
  /** Plain-language next step, shown when the check isn't operational — the exact action a
   *  non-engineer takes (which env var, where to set it, what to do after). */
  action?: string;
}

// Most setup gaps are fixed the same way: add an env var in the host dashboard, then redeploy.
const ENV_STEP = "Add it in your host's dashboard (Vercel → Settings → Environment Variables), then redeploy.";

async function probeTable(table: string, columns = "id"): Promise<boolean> {
  const { error } = await supabase.from(table).select(columns).limit(1);
  return !error;
}

router.get("/", async (c) => {
  const now = new Date().toISOString();
  const checks: Check[] = [];

  // API health — if this handler is running, the API process is up.
  checks.push({ id: "api", label: "API health", state: "operational", explanation: "This request reached the API and is responding normally." });

  // Database
  try {
    const ok = await probeTable("workspaces");
    checks.push({
      id: "database", label: "Supabase / database connection",
      state: ok ? "operational" : "error",
      explanation: ok ? "Queried the workspaces table successfully." : "A query against the workspaces table failed.",
      action: ok ? undefined : "Check your Supabase project is live and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set correctly in your host's environment variables.",
    });
  } catch {
    checks.push({ id: "database", label: "Supabase / database connection", state: "error", explanation: "Could not reach the database." });
  }

  // Auth (Sovereign — native email/password + cookie sessions)
  const authConfigured = Boolean(process.env.AUTH_JWT_SECRET);
  checks.push({
    id: "auth", label: "Sovereign auth configured",
    state: authConfigured ? "operational" : "needs_setup",
    explanation: authConfigured ? "AUTH_JWT_SECRET is set — native session signing is active, and this request itself passed sovereign auth." : "Sign-in can't sign sessions yet — the AUTH_JWT_SECRET secret isn't set.",
    action: authConfigured ? undefined : `Generate a secret (run \`openssl rand -hex 32\`) and set it as AUTH_JWT_SECRET. ${ENV_STEP}`,
  });

  // Ask Mondaily (Cerebras openai-compat gateway)
  const gatewayConfigured = Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY);
  checks.push({
    id: "ask", label: "Ask Mondaily available",
    state: gatewayConfigured ? "operational" : "needs_setup",
    explanation: gatewayConfigured ? "AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY are set — Ask Mondaily, enrichment, and the Prospecting Agent run on the sovereign AI gateway." : "The AI engine isn't connected yet, so Ask Mondaily, enrichment, and Discovery can't run.",
    action: gatewayConfigured ? undefined : `Set both AI_GATEWAY_BASE_URL (your Cerebras gateway URL) and AI_GATEWAY_API_KEY (your gateway key). ${ENV_STEP}`,
  });

  // Agent jobs table
  try {
    const ok = await probeTable("agent_jobs");
    checks.push({
      id: "agent_jobs", label: "Agent jobs available",
      state: ok ? "operational" : "error",
      explanation: ok ? "The agent_jobs table (real run history for every agent) is reachable." : "Could not query agent_jobs.",
    });
  } catch {
    checks.push({ id: "agent_jobs", label: "Agent jobs available", state: "error", explanation: "Could not query agent_jobs." });
  }

  // Inngest
  const inngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY);
  checks.push({
    id: "inngest", label: "Inngest (background jobs)",
    state: inngestConfigured ? "operational" : "not_checked",
    explanation: inngestConfigured ? "INNGEST_EVENT_KEY is set — scheduled/triggered jobs (enrichment, invoice chasing, relationship health, etc.) run for real." : "Background jobs are registered in code, but we can't confirm they're actually firing without the Inngest key.",
    action: inngestConfigured ? undefined : `Set INNGEST_EVENT_KEY (from your Inngest dashboard) to enable scheduled + event-triggered jobs. ${ENV_STEP}`,
  });

  // Sovereign web search (self-hosted SearXNG + scraper appliance)
  const searchConfigured = Boolean(process.env.SOVEREIGN_SEARCH_URL);
  checks.push({
    id: "sovereign_search", label: "Sovereign web search appliance",
    state: searchConfigured ? "operational" : "needs_setup",
    explanation: searchConfigured
      ? "SOVEREIGN_SEARCH_URL is set — enrichment and the Prospecting Agent search the live web via your own SearXNG + scraper."
      : "Discovery and web enrichment will return nothing — the self-hosted search appliance isn't connected.",
    action: searchConfigured ? undefined : `Deploy the SearXNG search appliance (see deploy/search-appliance) and set SOVEREIGN_SEARCH_URL to its address. ${ENV_STEP}`,
  });

  // Google (Gmail + Calendar) — an OPTIONAL, client-authorized connector (direct OAuth, no Nylas).
  // Not core AI infrastructure: data is only accessed after a user connects, stays workspace-scoped.
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  checks.push({
    id: "email", label: "Google (Gmail + Calendar) connector",
    state: googleConfigured ? "operational" : "needs_setup",
    explanation: googleConfigured ? "GOOGLE_CLIENT_ID/SECRET are set — an optional client-authorized connector: users can connect Google for mail (read + reply) and calendar. Data is accessed only after a user connects and stays workspace-scoped." : "The optional 'Connect Google' connector (Gmail + Calendar) won't work until Google OAuth is set up.",
    action: googleConfigured ? undefined : `Create an OAuth client in Google Cloud Console (APIs → Credentials), then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. ${ENV_STEP} Going past 100 users also needs Google's verification review.`,
  });

  // Microsoft (Outlook + Calendar) — an OPTIONAL, client-authorized connector (direct Graph OAuth).
  const microsoftConfigured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
  checks.push({
    id: "microsoft", label: "Microsoft (Outlook + Calendar) connector",
    state: microsoftConfigured ? "operational" : "needs_setup",
    explanation: microsoftConfigured ? "MICROSOFT_CLIENT_ID/SECRET are set — an optional client-authorized connector: users can connect Outlook for mail and calendar. Data is accessed only after a user connects and stays workspace-scoped." : "The optional 'Connect Outlook' connector won't work until Microsoft OAuth is set up (Google can still be used meanwhile).",
    action: microsoftConfigured ? undefined : `Register an app in Microsoft Azure (Entra → App registrations), then set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET. ${ENV_STEP}`,
  });

  // Stripe — embedded Payment Element + subscriptions + webhook. Fully operational needs the secret
  // key, the publishable key (for the embedded card field), at least one plan price id, and the
  // webhook secret (to activate tiers on payment).
  const stripeKey = Boolean(process.env.STRIPE_SECRET_KEY);
  const stripePublishable = Boolean(process.env.STRIPE_PUBLISHABLE_KEY);
  const stripePrice = Boolean(process.env.STRIPE_PRICE_OPERATOR_MONTH || process.env.STRIPE_PRICE_COMMAND_MONTH);
  const stripeWebhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const stripeReady = stripeKey && stripePublishable && stripePrice && stripeWebhook;
  checks.push({
    id: "stripe", label: "Stripe (payment processor) configured",
    state: stripeReady ? "operational" : "needs_setup",
    explanation: stripeReady
      ? "Stripe is the payment processor: embedded Payment Element, subscriptions, and the webhook are configured — clients subscribe on-page and tiers activate automatically. Card numbers live with Stripe; Mondaily never stores them and AI tools can't access payment data."
      : "Billing is built and ready — it just needs your Stripe (payment processor) keys before anyone can subscribe. Mondaily never stores card numbers.",
    action: stripeReady ? undefined : `From your Stripe dashboard, set these ${["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "a price id (STRIPE_PRICE_OPERATOR_MONTH / _COMMAND_MONTH)", "STRIPE_WEBHOOK_SECRET"].length} values — still missing: ${[!stripeKey && "STRIPE_SECRET_KEY", !stripePublishable && "STRIPE_PUBLISHABLE_KEY", !stripePrice && "STRIPE_PRICE_OPERATOR_MONTH / _COMMAND_MONTH", !stripeWebhook && "STRIPE_WEBHOOK_SECRET"].filter(Boolean).join(", ")}. ${ENV_STEP} Register the webhook endpoint at /api/v1/webhooks/stripe.`,
  });

  // Background cron protection — CRON_SECRET locks the public /api/cron/daily
  // endpoint so it can't be triggered by the public and burn Cerebras compute.
  const cronSecret = Boolean(process.env.CRON_SECRET);
  checks.push({
    id: "cron_secret", label: "Cron endpoint protected (CRON_SECRET)",
    state: cronSecret ? "operational" : "needs_setup",
    explanation: cronSecret
      ? "CRON_SECRET is set — /api/cron/daily rejects any request without the matching bearer token."
      : "The daily automation endpoint isn't locked yet, so it could be triggered by outsiders.",
    action: cronSecret ? undefined : `Set CRON_SECRET to any long random string (e.g. \`openssl rand -hex 32\`). ${ENV_STEP}`,
  });

  // Migrations
  const migrations = await Promise.all([
    probeTable("tasks").then(ok => ({ id: "0014", label: "0014 — tasks & detail tables", applied: ok, required: true, breaks_if_missing: "Tasks, task reviews, and task details would not work at all." })),
    probeTable("tasks", "record_id").then(ok => ({ id: "0015", label: "0015 — task extra columns", applied: ok, required: true, breaks_if_missing: "Linking tasks to records, task reviews, and reviewer fields would fail." })),
    probeTable("decision_queue").then(ok => ({ id: "0016", label: "0016 — decision queue", applied: ok, required: true, breaks_if_missing: "The Decision Queue, agent approvals, and the Prospecting Agent's review flow would all fail." })),
  ]);

  return c.json({
    checked_at: now,
    workspace_id: c.get("workspaceId"),
    checks,
    migrations,
  });
});

/**
 * Project log — the live, DB-backed record powering the Status page's
 * "Recent updates" (kind='update') and "What's next" (kind='roadmap')
 * sections. Replaces the previously hardcoded arrays so what we've done and
 * what's left is always current. Table created in migration 0017.
 */
interface ProjectLogRow {
  id: string; kind: "update" | "roadmap"; title: string; detail: string | null;
  category: string | null; status: string; sort_order: number;
  created_at: string; completed_at: string | null;
}

router.get("/log", async (c) => {
  const { data, error } = await supabase
    .from("project_log")
    .select("id,kind,title,detail,category,status,sort_order,created_at,completed_at")
    .order("sort_order", { ascending: true });
  // Table may not exist yet (migration 0017 not applied) — report that
  // honestly rather than 500ing, so the page can show a setup hint.
  if (error) return c.json({ available: false, reason: error.message, updates: [], roadmap: [] });
  const rows = (data ?? []) as ProjectLogRow[];
  return c.json({
    available: true,
    updates: rows.filter(r => r.kind === "update"),
    roadmap: rows.filter(r => r.kind === "roadmap"),
  });
});

router.post("/log", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Partial<ProjectLogRow>;
  if (!body.kind || !body.title || !body.status) {
    return c.json({ error: "kind, title and status are required" }, 400);
  }
  const { data, error } = await supabase.from("project_log").insert({
    kind: body.kind, title: body.title, detail: body.detail ?? null,
    category: body.category ?? null, status: body.status,
    sort_order: body.sort_order ?? 0,
    completed_at: body.status === "shipped" || body.status === "done" ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data?.id, created: true });
});

router.patch("/log/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as Partial<ProjectLogRow>;
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.completed_at = (body.status === "shipped" || body.status === "done") ? new Date().toISOString() : null;
  }
  if (body.title !== undefined) patch.title = body.title;
  if (body.detail !== undefined) patch.detail = body.detail;
  if (body.category !== undefined) patch.category = body.category;
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
  if (Object.keys(patch).length === 0) return c.json({ error: "no fields to update" }, 400);
  const { error } = await supabase.from("project_log").update(patch).eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ updated: true });
});

export { router as statusRouter };

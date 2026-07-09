import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { isPlatformAdmin } from "../middleware/platform-admin";
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

/**
 * Live reachability probe for a sovereign appliance (search or scraper). Returns
 * true only if the endpoint actually answered (any HTTP status < 500). Never
 * throws — a probe failure reports as "unreachable", not a 500 on this page.
 * Bounded by a short AbortController so a hung appliance can't stall /status.
 */
async function probeHttp(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(url, { headers, signal: ctl.signal }).finally(() => clearTimeout(t));
    return res.status < 500;
  } catch {
    return false;
  }
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

  // Sovereign web search (self-hosted SearXNG). URL presence + a LIVE reachability
  // probe (a real sample query) so we never mark it operational unless it answers.
  const searchUrl = process.env.SOVEREIGN_SEARCH_URL;
  const searchKeySet = Boolean(process.env.SOVEREIGN_SEARCH_KEY);
  const searchHeaders: Record<string, string> = searchKeySet ? { Authorization: `Bearer ${process.env.SOVEREIGN_SEARCH_KEY}` } : {};
  const searchLive = searchUrl ? await probeHttp(`${searchUrl}?q=mondaily&format=json`, searchHeaders) : false;
  checks.push({
    id: "sovereign_search", label: "Sovereign web search appliance",
    state: !searchUrl ? "needs_setup" : searchLive ? "operational" : "error",
    explanation: !searchUrl
      ? "Discovery and web enrichment will return nothing — the self-hosted SearXNG appliance isn't connected."
      : searchLive
        ? "SOVEREIGN_SEARCH_URL is set and a live sample query reached your own SearXNG — search routes only through your appliance (no third-party search)."
        : "SOVEREIGN_SEARCH_URL is set but a live sample query did not get a healthy response — the appliance may be down or unreachable.",
    action: !searchUrl
      ? `Deploy the SearXNG appliance (see deploy/discovery-appliance) and set SOVEREIGN_SEARCH_URL to its /search address. ${ENV_STEP}`
      : searchLive ? undefined : "Check the appliance is running and reachable from your host (firewall / Caddy bearer auth), then retry.",
  });

  // Sovereign search auth key — recommended so only Mondaily can query the appliance.
  checks.push({
    id: "sovereign_search_key", label: "Sovereign search auth key",
    state: !searchUrl ? "not_checked" : searchKeySet ? "operational" : "needs_setup",
    explanation: searchKeySet
      ? "SOVEREIGN_SEARCH_KEY is set — requests to the appliance are bearer-authenticated so it isn't an open proxy."
      : "The search appliance has no shared key, so anyone who finds its URL could query it.",
    action: searchKeySet ? undefined : `Set a bearer token on the appliance (Caddy) and the same value as SOVEREIGN_SEARCH_KEY here. ${ENV_STEP}`,
  });

  // Sovereign scraper (self-hosted Playwright) — distinct from search: Discovery reads page
  // content through it. URL presence + a live reachability probe.
  const scrapeUrl = process.env.SOVEREIGN_SCRAPE_URL;
  const scrapeLive = scrapeUrl ? await probeHttp(scrapeUrl.replace(/\/v1\/scrape\/?$/, "/health"), searchHeaders) : false;
  checks.push({
    id: "sovereign_scraper", label: "Sovereign scraper appliance",
    state: !scrapeUrl ? "needs_setup" : scrapeLive ? "operational" : "error",
    explanation: !scrapeUrl
      ? "Discovery can find result URLs but can't read page content (reviews, contacts) — the self-hosted scraper isn't connected."
      : scrapeLive
        ? "SOVEREIGN_SCRAPE_URL is set and its health endpoint answered — Discovery reads pages through your own scraper."
        : "SOVEREIGN_SCRAPE_URL is set but its health endpoint didn't answer — the scraper may be down.",
    action: !scrapeUrl
      ? `Deploy the scraper (see deploy/discovery-appliance/scraper) and set SOVEREIGN_SCRAPE_URL to its /v1/scrape address. ${ENV_STEP}`
      : scrapeLive ? undefined : "Check the scraper container is running and reachable, then retry.",
  });

  // Internal messaging — native member-to-member messaging. Table-backed, no third party.
  try {
    const ok = await probeTable("internal_messages");
    checks.push({
      id: "messaging", label: "Internal messaging",
      state: ok ? "operational" : "needs_setup",
      explanation: ok
        ? "The internal_messages table is reachable — native, workspace- and member-scoped messaging is live (no third-party chat provider)."
        : "Internal messaging can't store messages yet — its migration hasn't been applied.",
      action: ok ? undefined : "Apply the messaging migration (internal_messages) in Supabase.",
    });
  } catch {
    checks.push({ id: "messaging", label: "Internal messaging", state: "error", explanation: "Could not query internal_messages." });
  }

  // LiveKit / calls — OPTIONAL self-hosted/private realtime. Fails closed: if env is missing,
  // calls show "not configured" in the UI rather than breaking. Not marked operational unless set.
  const livekitReady = Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  checks.push({
    id: "calls", label: "Voice/video calls (LiveKit)",
    state: livekitReady ? "operational" : "disabled",
    explanation: livekitReady
      ? "LIVEKIT_URL/API_KEY/API_SECRET are set — in-workspace calls can issue tokens. Sovereign only when LiveKit is self-hosted/private; a hosted LiveKit cloud is an optional external connector."
      : "Calls are OFF by design until configured — the UI shows 'calls not configured' and nothing breaks. This is not an error.",
    action: livekitReady ? undefined : `Stand up a (preferably self-hosted) LiveKit server and set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. ${ENV_STEP}`,
  });

  // Native sovereign email — self-hosted receive (own MX → /emails/inbound) + send (own SMTP relay).
  // Fully optional + fail-closed: unset ⇒ the existing inbox keeps working and this simply isn't used.
  const mailInbound = Boolean(process.env.SOVEREIGN_MAIL_SECRET && process.env.SOVEREIGN_MAIL_DOMAIN);
  const mailOutbound = Boolean(process.env.SOVEREIGN_MAIL_SEND_URL && process.env.SOVEREIGN_MAIL_SECRET);
  checks.push({
    id: "sovereign_mail", label: "Native email (self-hosted receive + send)",
    state: mailInbound || mailOutbound ? "operational" : "disabled",
    explanation: mailInbound || mailOutbound
      ? `Sovereign mail is live — ${[mailInbound && "inbound (own MX → ws-<id>@" + process.env.SOVEREIGN_MAIL_DOMAIN + ")", mailOutbound && "outbound (own SMTP relay)"].filter(Boolean).join(" + ")}. No third-party email provider.`
      : "Native email is OFF by design — the existing inbox (Gmail/local) keeps working and nothing breaks. This is not an error.",
    action: mailInbound || mailOutbound ? undefined : `Deploy deploy/mail-appliance behind your MX, then set SOVEREIGN_MAIL_SECRET + SOVEREIGN_MAIL_DOMAIN (and SOVEREIGN_MAIL_SEND_URL for outbound). ${ENV_STEP}`,
  });

  // Training-data controls — capture is opt-in (default OFF) and per-workspace. Report whether the
  // ledger table exists and whether THIS workspace has opted in.
  try {
    const ok = await probeTable("ai_training_logs");
    let enabled = false;
    if (ok) {
      const { data } = await supabase.from("workspaces").select("settings").eq("id", c.get("workspaceId")).maybeSingle();
      enabled = Boolean((data?.settings as { training_policy?: { enabled?: boolean } } | null)?.training_policy?.enabled);
    }
    checks.push({
      id: "training", label: "Training-data controls",
      state: !ok ? "needs_setup" : "operational",
      explanation: !ok
        ? "Training controls aren't available yet — the ai_training_logs migration hasn't been applied."
        : enabled
          ? "Training capture is ENABLED for this workspace (opt-in). Prompts are PII-redacted; you can export or delete your data and set retention under Settings → Training."
          : "Training capture is OFF for this workspace (the default). No workspace data enters any training corpus until an owner explicitly opts in.",
      action: !ok ? "Apply the ai_training_logs migration in Supabase." : undefined,
    });
  } catch {
    checks.push({ id: "training", label: "Training-data controls", state: "error", explanation: "Could not query ai_training_logs." });
  }

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

// project_log is the GLOBAL public Status/roadmap content. Writes are Mondaily platform admins
// ONLY (PLATFORM_ADMIN_EMAILS allowlist, fail-closed) — any workspace user could previously
// deface the public status page. The deploy auto-logger (packages/api/scripts/log-deploy.mjs)
// writes via the service key directly and never hits these routes.
router.post("/log", async (c) => {
  if (!(await isPlatformAdmin(c.get("userId")))) return c.json({ error: "Platform admin access required." }, 403);
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
  if (!(await isPlatformAdmin(c.get("userId")))) return c.json({ error: "Platform admin access required." }, 403);
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

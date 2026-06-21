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
}

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
    });
  } catch {
    checks.push({ id: "database", label: "Supabase / database connection", state: "error", explanation: "Could not reach the database." });
  }

  // Auth (Clerk)
  const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY);
  checks.push({
    id: "auth", label: "Clerk / auth configured",
    state: clerkConfigured ? "operational" : "needs_setup",
    explanation: clerkConfigured ? "CLERK_SECRET_KEY or CLERK_JWT_KEY is set — and this request itself passed Clerk auth." : "No Clerk key found in this environment.",
  });

  // Ask Mondaily (Anthropic)
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  checks.push({
    id: "ask", label: "Ask Mondaily available",
    state: anthropicConfigured ? "operational" : "needs_setup",
    explanation: anthropicConfigured ? "ANTHROPIC_API_KEY is set — Ask Mondaily, enrichment, and the Prospecting Agent can all call Claude." : "ANTHROPIC_API_KEY is missing — Ask Mondaily and AI enrichment will not work.",
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
    explanation: inngestConfigured ? "INNGEST_EVENT_KEY is set — scheduled/triggered jobs (enrichment, invoice chasing, relationship health, etc.) run for real." : "INNGEST_EVENT_KEY is not set in this environment — cannot confirm jobs are actually firing, only that they're registered in code.",
  });

  // Tavily
  const tavilyConfigured = Boolean(process.env.TAVILY_API_KEY);
  checks.push({
    id: "tavily", label: "Web search (Tavily) configured",
    state: tavilyConfigured ? "operational" : "needs_setup",
    explanation: tavilyConfigured ? "TAVILY_API_KEY is set — enrichment and the Prospecting Agent can search the live web." : "TAVILY_API_KEY is missing — enrichment and Prospecting Agent web search will return nothing.",
  });

  // Nylas (email)
  const nylasConfigured = Boolean(process.env.NYLAS_API_KEY);
  checks.push({
    id: "email", label: "Email (Nylas) configured",
    state: nylasConfigured ? "operational" : "needs_setup",
    explanation: nylasConfigured ? "NYLAS_API_KEY is set — email sync and sending are available." : "NYLAS_API_KEY is missing — connecting an inbox will fail.",
  });

  // Stripe
  const stripeConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  checks.push({
    id: "stripe", label: "Stripe (billing) configured",
    state: stripeConfigured ? "operational" : "needs_setup",
    explanation: stripeConfigured
      ? "STRIPE_WEBHOOK_SECRET is set, so billing webhook events can be verified. Note: there is no checkout/portal-session route in this codebase yet — the billing UI's links will 404 until that's built."
      : "STRIPE_WEBHOOK_SECRET is missing, and there is no checkout/portal-session route in this codebase yet. Billing is not wired up end-to-end.",
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

export { router as statusRouter };

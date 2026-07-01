import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { ensureWorkspaceForUser } from "../lib/bootstrap";
import { grantCredits, creditStatus, BUSINESS_TRIAL_GRANT, SOLO_GRANT } from "../lib/credits";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { recordCreditUsage } from "../lib/credits";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

// POST /onboarding/analyze — the smart brain of onboarding. Takes the survey answers (purpose,
// team size, goals) plus any free text and returns an AI-inferred sector, a short tailored setup
// summary, and which optional product modules to switch on (finance / investments / hr — Mondaily
// vocabulary, NEVER "CRM"). Never blocks: a deterministic heuristic keeps onboarding flowing if the
// gateway is unconfigured or errors.
router.post("/analyze", requireAuth, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json<{ description?: string; purpose?: string; team_size?: string; goals?: string[] }>().catch(() => ({} as Record<string, never>));
  const purpose = (body.purpose ?? "").trim();
  const goals = Array.isArray(body.goals) ? body.goals : [];
  const teamSize = (body.team_size ?? "").trim();
  // Compose a single description from whatever the survey collected + optional free text.
  const text = [body.description, purpose && `Purpose: ${purpose}`, teamSize && `Team size: ${teamSize}`, goals.length && `Goals: ${goals.join(", ")}`]
    .filter(Boolean).join(". ").trim();
  if (!text) return c.json({ error: "Tell us a little about your operation to continue." }, 400);

  const heuristic = () => {
    const t = text.toLowerCase();
    const modules: string[] = [];
    if (/(invoice|billing|payment|quote|finance|revenue|account)/.test(t)) modules.push("finance");
    if (/(asset|portfolio|fund|invest|round|return|capital|equity)/.test(t)) modules.push("investments");
    if (/(headcount|hire|recruit|contract|hr|payroll|workforce|staff)/.test(t)) modules.push("hr");
    return { industry_vertical: purpose || "General Operations", recommended_modules: modules, summary: "" };
  };

  let result = heuristic();
  try {
    const extracted = await aiGatewayToolUse({
      system:
        "You are the Mondaily Workspace Architect onboarding a new operator. Mondaily is an autonomous AI workspace (operators + AI agents) — it is NOT a CRM; never use that word. " +
        "From the operator's answers, return: industry_vertical (a concise 1-4 word label, e.g. 'Quantitative Finance', 'Real Estate Ops'); " +
        "recommended_modules — a subset of ['finance','investments','hr'] to switch on, where finance='Finance & Billing' (invoicing/payments), investments='Quantitative Asset Systems' (portfolios/funds), hr='Autonomous Workforce' (headcount/contracts). Only include modules the operation clearly needs; empty is fine. " +
        "summary — ONE friendly sentence (<=22 words) telling the operator how their Mondaily workspace will be set up, referencing their sector and goals.",
      prompt: text,
      toolName: "configure_workspace",
      toolDescription: "Return the inferred workspace architecture profile.",
      toolSchema: {
        type: "object",
        properties: {
          industry_vertical: { type: "string" },
          recommended_modules: { type: "array", items: { type: "string", enum: ["finance", "investments", "hr"] } },
          summary: { type: "string" },
        },
        required: ["industry_vertical"],
      },
      maxTokens: 320,
      onUsage: (u) => recordCreditUsage(ws, u.total_tokens, "Onboarding semantic analysis"),
    });
    const vertical = typeof extracted.industry_vertical === "string" && extracted.industry_vertical.trim() ? extracted.industry_vertical.trim() : result.industry_vertical;
    const mods = Array.isArray(extracted.recommended_modules)
      ? (extracted.recommended_modules as unknown[]).filter((m): m is string => ["finance", "investments", "hr"].includes(m as string))
      : result.recommended_modules;
    const summary = typeof extracted.summary === "string" ? extracted.summary.trim() : "";
    result = { industry_vertical: vertical, recommended_modules: mods, summary };
  } catch { /* keep heuristic — onboarding must never hard-fail */ }

  return c.json(result);
});

// POST /onboarding/bootstrap — resolves (or creates) the Supabase workspace for a user.
// Native: finds the user's existing workspace, else creates a fresh one + owner membership.
// Uses requireJwt (no membership check) so it works before membership exists.
router.post("/bootstrap", requireJwt, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  try {
    const { workspaceId, isNew } = await ensureWorkspaceForUser(userId, body.name ?? "My Workspace");
    return c.json({ workspace_id: workspaceId, is_new: isNew });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to create workspace" }, 500);
  }
});

// GET /onboarding/status — returns which steps are complete based on real data.
// Only queries tables confirmed to exist in migrations (0001, 0010).
router.get("/status", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");

  const [
    { count: contactCount },
    { count: dealCount },
    { count: memberCount },
    { count: threadCount },
    { count: emailCount },
  ] = await Promise.all([
    // contacts/companies: nodes with object_type in ('person','company')
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("object_type", ["person", "company"]),
    // deals
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("object_type", "deal"),
    // team members (> 1 means at least one other member)
    supabase.from("workspace_members").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // ask AI threads (table: chat_threads from migration 0001)
    supabase.from("chat_threads").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // email connections (table: email_connections from migration 0010)
    supabase.from("email_connections").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  return c.json({
    workspace:  true,
    contact:    (contactCount ?? 0) > 0,
    deal:       (dealCount    ?? 0) > 0,
    member:     (memberCount  ?? 0) > 1,
    ai:         (threadCount  ?? 0) > 0,
    email:      (emailCount   ?? 0) > 0,
    // Not yet tracked server-side — default false
    import:    false,
    extension: false,
    report:    false,
    workflow:  false,
    sequence:  false,
    apps:      false,
  });
});

// POST /onboarding/complete — finalize the wizard: persist track + company details, stamp the
// 14-day trial on business workspaces (+ grant Pro trial credits), and seed starter tasks.
router.post("/complete", requireAuth, async (c) => {
  const ws = c.get("workspaceId");
  const userId = c.get("userId");
  const body = await c.req.json<{ plan?: string; track?: string; account_tier?: string; industry?: string; team_size?: string; concurrency?: number; goals?: string[]; modules?: string[] }>().catch(() => ({} as Record<string, never>));
  // Optional product modules to switch on (finance/investments/hr) — from the AI recommendation.
  const enabledMods = Array.isArray(body.modules) ? body.modules.filter((m) => ["finance", "investments", "hr"].includes(m)) : [];
  // Resolve the chosen tier. Prefer the explicit `plan`; fall back to legacy track/account_tier.
  const chosen = ["scout", "operator", "command", "sovereign"].includes(body.plan ?? "")
    ? (body.plan as string)
    : (body.track === "business" || body.account_tier === "business") ? "operator" : "scout";

  // BUSINESS RULES (payment not wired yet — Stripe is last):
  //  • Scout    — free forever, self-serve, 50k credits, NO trial.
  //  • Operator — 14-day trial, self-serve, 500k credits.
  //  • Command / Sovereign — PAID, NO trial. A user cannot self-provision these for free. Until
  //    they pay we provision the free Scout baseline and record `pending_plan` so billing can
  //    prompt them to activate. This is the fix for "I picked Command and got it free".
  const requiresPayment = chosen === "command" || chosen === "sovereign";
  const effectiveTier = requiresPayment ? "scout" : chosen;   // what they're actually entitled to now
  const isTrial = effectiveTier === "operator";                // trial ONLY for Operator
  const trialEndsAt = isTrial ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : null;
  // Monthly credit allotment — keyed on the ENTITLED tier, never the aspirational one.
  const GRANTS: Record<string, number> = { scout: SOLO_GRANT, operator: BUSINESS_TRIAL_GRANT, command: 2_000_000, sovereign: 2_000_000 };
  const target = GRANTS[effectiveTier] ?? SOLO_GRANT;

  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).single();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  // Clear any stale trial/pending flags first, then set the correct ones for this tier.
  const { trial_ends_at: _t, pending_plan: _p, ...baseSettings } = settings;
  await supabase.from("workspaces").update({
    onboarded: true,
    settings: {
      ...baseSettings,
      plan: effectiveTier,
      account_tier: effectiveTier,              // billing reads this — never "command" until paid
      track: effectiveTier === "scout" ? "solo" : "business",
      ...(requiresPayment ? { pending_plan: chosen } : {}),   // what they WANT, awaiting payment
      ...(body.industry ? { industry: body.industry } : {}),
      ...(body.team_size ? { team_size: body.team_size } : {}),
      ...(typeof body.concurrency === "number" ? { target_concurrency: body.concurrency } : {}),
      ...(Array.isArray(body.goals) ? { goals: body.goals } : {}),
      ...(enabledMods.length ? { modules: enabledMods } : {}),
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
    },
  }).eq("id", ws);

  // Bring credits up to EXACTLY the entitled tier's allotment — grant only the shortfall, so we
  // never stack on the register-time baseline and re-running onboarding is idempotent.
  const { balance } = await creditStatus(ws);
  const delta = target - balance;
  if (delta > 0) {
    await grantCredits(ws, delta, "grant", `${effectiveTier} plan credits`);
  }
  const plan = effectiveTier;

  // Seed a few starter tasks (only if the workspace has none yet).
  const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  if ((count ?? 0) === 0) {
    await supabase.from("tasks").insert([
      { workspace_id: ws, title: "Add your first contact or company", status: "todo", assignee_id: userId, created_by: userId },
      { workspace_id: ws, title: "Connect your inbox (Settings → Email)", status: "todo", assignee_id: userId, created_by: userId },
      { workspace_id: ws, title: "Ask Mondaily to find new leads for you", status: "todo", assignee_id: userId, created_by: userId },
    ]).then(() => {}, () => {});
  }

  return c.json({ ok: true, plan, trial_ends_at: trialEndsAt });
});

export { router as onboardingRouter };

import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { ensureWorkspaceForUser } from "../lib/bootstrap";
import { grantCredits, creditStatus, BUSINESS_TRIAL_GRANT, SOLO_GRANT } from "../lib/credits";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { recordCreditUsage } from "../lib/credits";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

// POST /onboarding/analyze — Cerebras semantic extraction of the operator's free-text description
// into a strict config object { account_tier, industry_vertical, target_concurrency }. Never blocks:
// if the gateway is unconfigured or errors, a deterministic heuristic keeps onboarding flowing.
router.post("/analyze", requireAuth, async (c) => {
  const ws = c.get("workspaceId");
  const { description } = await c.req.json<{ description?: string }>().catch(() => ({ description: "" }));
  const text = (description ?? "").trim();
  if (!text) return c.json({ error: "Describe your operation to continue." }, 400);

  const heuristic = () => {
    const biz = /\b(team|company|agency|enterprise|fund|firm|operations|staff|employees|scale|pipeline|department|org|startup|saas)\b/i.test(text);
    const num = text.match(/\b(\d{1,4})\b/)?.[1];
    const concurrency = num ? Math.min(512, Math.max(1, Number(num))) : biz ? 8 : 1;
    return { account_tier: biz ? "business" : "personal", industry_vertical: "General Operations", target_concurrency: concurrency };
  };

  let result = heuristic();
  try {
    const extracted = await aiGatewayToolUse({
      system: "You are the Mondaily Workspace Architect. Extract a strict configuration profile from the operator's description. account_tier is 'business' for any team/company/agency/multi-operator deployment, else 'personal'. industry_vertical is a concise 1-4 word label (e.g. 'Quantitative Finance', 'Real Estate Ops'). target_concurrency is an integer estimate of simultaneous automated agents/operators implied (1 for a solo developer).",
      prompt: text,
      toolName: "configure_workspace",
      toolDescription: "Return the inferred workspace architecture profile.",
      toolSchema: {
        type: "object",
        properties: {
          account_tier: { type: "string", enum: ["personal", "business"] },
          industry_vertical: { type: "string" },
          target_concurrency: { type: "integer", minimum: 1 },
        },
        required: ["account_tier", "industry_vertical", "target_concurrency"],
      },
      maxTokens: 256,
      onUsage: (u) => recordCreditUsage(ws, u.total_tokens, "Onboarding semantic analysis"),
    });
    const tier = extracted.account_tier === "business" ? "business" : extracted.account_tier === "personal" ? "personal" : result.account_tier;
    const vertical = typeof extracted.industry_vertical === "string" && extracted.industry_vertical.trim() ? extracted.industry_vertical.trim() : result.industry_vertical;
    const cNum = Number(extracted.target_concurrency);
    const concurrency = Number.isFinite(cNum) && cNum > 0 ? Math.min(512, Math.round(cNum)) : result.target_concurrency;
    result = { account_tier: tier, industry_vertical: vertical, target_concurrency: concurrency };
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
  const body = await c.req.json<{ plan?: string; track?: string; account_tier?: string; industry?: string; team_size?: string; concurrency?: number; goals?: string[] }>().catch(() => ({} as Record<string, never>));
  // Resolve the chosen tier. Prefer the explicit `plan`; fall back to legacy track/account_tier.
  const plan = ["scout", "operator", "command", "sovereign"].includes(body.plan ?? "")
    ? (body.plan as string)
    : (body.track === "business" || body.account_tier === "business") ? "operator" : "scout";
  const isPaid = plan !== "scout";
  const trialEndsAt = isPaid ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : null;
  // Monthly credit allotment per tier.
  const GRANTS: Record<string, number> = { scout: SOLO_GRANT, operator: BUSINESS_TRIAL_GRANT, command: 2_000_000, sovereign: 2_000_000 };
  const target = GRANTS[plan] ?? SOLO_GRANT;

  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).single();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  await supabase.from("workspaces").update({
    onboarded: true,
    settings: {
      ...settings,
      plan,
      account_tier: plan,                       // billing reads this
      track: isPaid ? "business" : "solo",      // legacy back-compat
      ...(body.industry ? { industry: body.industry } : {}),
      ...(body.team_size ? { team_size: body.team_size } : {}),
      ...(typeof body.concurrency === "number" ? { target_concurrency: body.concurrency } : {}),
      ...(Array.isArray(body.goals) ? { goals: body.goals } : {}),
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
    },
  }).eq("id", ws);

  // Bring credits up to EXACTLY the tier's allotment — grant only the shortfall (target − current),
  // so we never stack on the register-time baseline and re-running onboarding is idempotent.
  const { balance } = await creditStatus(ws);
  const delta = target - balance;
  if (delta > 0) {
    await grantCredits(ws, delta, "grant", `${plan} plan credits`);
  }

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

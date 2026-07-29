import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { ensureWorkspaceForUser } from "../lib/bootstrap";
import { reconcileIncludedCredits } from "../lib/credits";
import { PLAN_TIERS, PLAN_ORDER } from "@mondaily/shared/pricing";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { recordCreditUsage } from "../lib/credits";
import { resolveProfile, mergeProfile, type WorkspaceProfile } from "@mondaily/shared/profile";
import { normalizeLang, languageMeta } from "@mondaily/shared/i18n";
import { sendPendingPlanEmail } from "../lib/pending-plan-email";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

// POST /onboarding/analyze — the smart brain of onboarding. Takes the survey answers (purpose,
// team size, goals) plus any free text and returns an AI-inferred sector, a short tailored setup
// summary, and which optional product modules to switch on (finance / investments / hr — Mondaily
// vocabulary, NEVER "CRM"). Never blocks: a deterministic heuristic keeps onboarding flowing if the
// gateway is unconfigured or errors.
router.post("/analyze", requireAuth, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json<{ description?: string; purpose?: string; team_size?: string; goals?: string[]; language?: string }>().catch(() => ({} as Record<string, never>));
  const purpose = (body.purpose ?? "").trim();
  const goals = Array.isArray(body.goals) ? body.goals : [];
  const teamSize = (body.team_size ?? "").trim();
  // Compose a single description from whatever the survey collected + optional free text.
  const text = [body.description, purpose && `Purpose: ${purpose}`, teamSize && `Team size: ${teamSize}`, goals.length && `Goals: ${goals.join(", ")}`]
    .filter(Boolean).join(". ").trim();
  if (!text) return c.json({ error: "Tell us a little about your operation to continue." }, 400);

  // Catalog-grounded plan facts so the recommendation can never invent prices/credits.
  const planFacts = PLAN_ORDER.map((id) => {
    const p = PLAN_TIERS[id];
    return `${p.name}: ${p.priceMonthly === null ? "custom" : "$" + p.priceMonthly + "/mo"}, ${p.monthlyCredits === null ? "custom" : p.monthlyCredits.toLocaleString()} credits/mo, up to ${p.seats} seat(s).`;
  }).join(" ");

  const heuristic = () => {
    const t = text.toLowerCase();
    const modules: string[] = [];
    if (/(invoice|billing|payment|quote|finance|revenue|account)/.test(t)) modules.push("finance");
    if (/(asset|portfolio|fund|invest|round|return|capital|equity)/.test(t)) modules.push("investments");
    if (/(headcount|hire|recruit|contract|hr|payroll|workforce|staff)/.test(t)) modules.push("hr");
    // Plan heuristic from real signals (team size + intent).
    const size = parseInt(teamSize.replace(/[^0-9]/g, ""), 10) || (teamSize.includes("just me") || teamSize.includes("solo") ? 1 : 0);
    let plan = "scout";
    if (/(compliance|self-host|private infra|sovereign|on-?prem|regulated)/.test(t)) plan = "sovereign";
    else if (size > 5 || /(oversight|team|manage|approvals|decision queue)/.test(t)) plan = "command";
    else if (size >= 1 && /(discovery|enrich|research|prospect|finance|agents|deep)/.test(t)) plan = "operator";
    else if (size > 1) plan = "operator";
    return { industry_vertical: purpose || "General Operations", recommended_modules: modules, summary: "", recommended_plan: plan, recommend_pack: false, plan_reason: "", business_model: "", target_customers: "", discovery_focus: "", suggested_objects: [] as string[] };
  };

  let result = heuristic();
  try {
    const extracted = await aiGatewayToolUse({
      system:
        "You are the Mondaily Workspace Architect onboarding a new operator. Mondaily is an autonomous AI workspace (operators + AI agents) — it is NOT a CRM; never use that word. " +
        "From the operator's answers, return: industry_vertical (a concise 1-4 word label); " +
        "recommended_modules — a subset of ['finance','investments','hr']; only what the operation clearly needs; empty is fine. " +
        "recommended_plan — one of ['scout','operator','command','sovereign'] using ONLY these facts: " + planFacts + " " +
        "Recommend based on: team size, expected AI usage (chat/agents/enrichment/Discovery deep research/report generation), finance workflows, Decision-Queue approvals, Team Oversight need, and compliance/private-infrastructure needs. Solo/just trying → scout; a team running on AI (Discovery, finance, agents) → operator; a larger team (>5) or one needing oversight/approvals at scale → command; compliance/self-hosted/private → sovereign. " +
        "recommend_pack — true if their expected usage is likely to exceed the plan's included monthly credits (then suggest pay-as-you-go packs). " +
        "plan_reason — ONE short sentence (<=20 words) on why that plan fits. " +
        "summary — ONE friendly sentence (<=22 words) on how their workspace will be set up. " +
        // Localize the user-facing helper copy to the chosen onboarding language (labels/enums stay English).
        (normalizeLang(body.language) !== "en"
          ? `Write the "summary" and "plan_reason" fields in ${languageMeta(body.language).name} (${languageMeta(body.language).nativeName}); keep all other fields (enums, module names) in English. `
          : "") +
        // Industry-aware profile inference (tunes examples/terms only — Mondaily stays general).
        "business_model — a concise label like 'B2B services', 'B2C ecommerce', 'Marketplace', 'B2B SaaS'. " +
        "target_customers — a short phrase for who they sell to / serve. " +
        "discovery_focus — a short phrase for what web/Discovery searches should hunt for (e.g. 'clinics with poor reviews'). " +
        "suggested_objects — 2-4 short lowercase nouns for the records they track (e.g. ['clinics','patients','follow-ups']).",
      prompt: text + (teamSize ? `\n\nTeam size: ${teamSize}` : ""),
      toolName: "configure_workspace",
      toolDescription: "Return the inferred workspace architecture profile + plan recommendation.",
      toolSchema: {
        type: "object",
        properties: {
          industry_vertical: { type: "string" },
          recommended_modules: { type: "array", items: { type: "string", enum: ["finance", "investments", "hr"] } },
          recommended_plan: { type: "string", enum: ["scout", "operator", "command", "sovereign"] },
          recommend_pack: { type: "boolean" },
          plan_reason: { type: "string" },
          summary: { type: "string" },
          business_model: { type: "string" },
          target_customers: { type: "string" },
          discovery_focus: { type: "string" },
          suggested_objects: { type: "array", items: { type: "string" } },
        },
        required: ["industry_vertical", "recommended_plan"],
      },
      maxTokens: 420,
      onUsage: (u) => recordCreditUsage(ws, u.total_tokens, "Onboarding semantic analysis"),
    });
    const vertical = typeof extracted.industry_vertical === "string" && extracted.industry_vertical.trim() ? extracted.industry_vertical.trim() : result.industry_vertical;
    const mods = Array.isArray(extracted.recommended_modules)
      ? (extracted.recommended_modules as unknown[]).filter((m): m is string => ["finance", "investments", "hr"].includes(m as string))
      : result.recommended_modules;
    const plan = ["scout", "operator", "command", "sovereign"].includes(String(extracted.recommended_plan)) ? String(extracted.recommended_plan) : result.recommended_plan;
    const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    result = {
      industry_vertical: vertical,
      recommended_modules: mods,
      summary: typeof extracted.summary === "string" ? extracted.summary.trim() : "",
      recommended_plan: plan,
      recommend_pack: Boolean(extracted.recommend_pack),
      plan_reason: typeof extracted.plan_reason === "string" ? extracted.plan_reason.trim() : "",
      business_model: asText(extracted.business_model),
      target_customers: asText(extracted.target_customers),
      discovery_focus: asText(extracted.discovery_focus),
      suggested_objects: Array.isArray(extracted.suggested_objects)
        ? (extracted.suggested_objects as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 4)
        : [],
    };
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
  const body = await c.req.json<{ plan?: string; track?: string; account_tier?: string; industry?: string; team_size?: string; concurrency?: number; goals?: string[]; modules?: string[]; profile?: Partial<WorkspaceProfile>; description?: string }>().catch(() => ({} as Record<string, never>));
  // Optional product modules to switch on (finance/investments/hr) — from the AI recommendation.
  const enabledMods = Array.isArray(body.modules) ? body.modules.filter((m) => ["finance", "investments", "hr"].includes(m)) : [];
  // Resolve the chosen tier. Prefer the explicit `plan`; fall back to legacy track/account_tier.
  const chosen = ["scout", "operator", "command", "sovereign"].includes(body.plan ?? "")
    ? (body.plan as string)
    : (body.track === "business" || body.account_tier === "business") ? "operator" : "scout";

  // BUSINESS RULES (credit amounts come from @mondaily/shared/pricing — see grantAmountFor):
  //  • Scout    — free forever, self-serve, 100k credits/mo, NO trial.
  //  • Operator — 14-day trial, self-serve, 1M credits/mo.
  //  • Command / Sovereign — PAID, NO trial. A user cannot self-provision these for free. Until
  //    they pay we provision the free Scout baseline and record `pending_plan` so billing can
  //    prompt them to activate. This is the fix for "I picked Command and got it free".
  const requiresPayment = chosen === "command" || chosen === "sovereign";

  const { data: preRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const preSettings = (preRow?.settings ?? {}) as Record<string, unknown>;
  // A workspace already paying for a plan must not be re-tiered by someone re-running the wizard:
  // this route preserves billing_status/stripe_subscription_id but rewrites account_tier, so a
  // member POSTing an empty body would drop a paying Command workspace to Scout while billing
  // stayed "active" — the entitlement resolver would then honour the downgraded tier.
  if (preSettings.stripe_subscription_id && preSettings.billing_status === "active") {
    return c.json({ error: "This workspace has an active subscription. Change the plan from Billing settings." }, 409);
  }
  // The trial is once per workspace. `trial_used` was written here but never READ, so re-running
  // onboarding minted a fresh 14-day Operator trial every time — an unlimited free-trial loop.
  const trialAlreadyUsed = Boolean(preSettings.trial_used);

  // Operator is only free FOR THE DURATION OF THE TRIAL. Once the trial is spent it must fall back
  // to Scout + pending_plan — granting "operator" with no trial_ends_at would read as an explicit
  // paid tier to resolveEntitlement and hand out Operator free, permanently.
  const trialExhausted = chosen === "operator" && trialAlreadyUsed;
  const effectiveTier = requiresPayment || trialExhausted ? "scout" : chosen;
  const isTrial = effectiveTier === "operator";                // trial ONLY for Operator, ONCE
  const trialEndsAt = isTrial ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : null;

  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).single();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  // Clear any stale trial/pending flags first, then set the correct ones for this tier.
  const { trial_ends_at: _t, pending_plan: _p, ...baseSettings } = settings;
  // Build the industry-aware workspace profile from the onboarding answers + AI inference. Saved
  // explicitly so Discovery examples, Ask context and suggestions can adapt. Only tunes examples/
  // terms/defaults — Mondaily stays a general autonomous workspace.
  const nextProfile = mergeProfile(resolveProfile(settings), {
    ...(body.industry ? { industry: body.industry } : {}),
    ...(Array.isArray(body.goals) && body.goals.length ? { primary_goals: body.goals } : {}),
    ...(body.description?.trim() ? { target_customers: body.description.trim() } : {}),
    ...(body.profile && typeof body.profile === "object" ? body.profile : {}),
  });
  // Write `settings` + `onboarded` on their own (jsonb — the entitlement source of truth). The
  // top-level `plan` column is written SEPARATELY and best-effort: the workspaces_plan_check
  // constraint historically rejects non-legacy values, and a combined update would roll BACK the
  // settings write too (that's the class of bug that left trials granted-but-not-activated).
  await supabase.from("workspaces").update({
    onboarded: true,
    settings: {
      ...baseSettings,
      plan: effectiveTier,
      account_tier: effectiveTier,              // billing reads this — never "command" until paid
      track: effectiveTier === "scout" ? "solo" : "business",
      // what they WANT, awaiting payment — plus the clock the day-2/day-7 reminders count from.
      ...(requiresPayment ? { pending_plan: chosen, pending_plan_set_at: new Date().toISOString() } : {}),
      ...(body.industry ? { industry: body.industry } : {}),
      ...(body.team_size ? { team_size: body.team_size } : {}),
      ...(typeof body.concurrency === "number" ? { target_concurrency: body.concurrency } : {}),
      ...(Array.isArray(body.goals) ? { goals: body.goals } : {}),
      ...(enabledMods.length ? { modules: enabledMods } : {}),
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt, trial_used: true } : {}),
      profile: nextProfile,
    },
  }).eq("id", ws);
  await supabase.from("workspaces").update({ plan: effectiveTier }).eq("id", ws).then(() => {}, () => {});

  // Activation nudge — one best-effort email ONLY when a paid plan's pending_plan is NEWLY set
  // (`_p !== chosen` guards against a re-run of onboarding re-sending). Fire-and-forget: it never
  // blocks completion, never throws, and mutates no tier/credit/Stripe state. No email for
  // Scout/Operator (requiresPayment is false for them).
  if (requiresPayment && _p !== chosen) {
    void sendPendingPlanEmail(ws, userId, chosen as "command" | "sovereign").catch(() => {});
  }

  // Bring credits up to EXACTLY the entitled tier's allotment.
  //
  // This MUST compare against the sum of GRANT rows, not the wallet balance. Balance is
  // grants + purchases − usage, so it falls as credits are spent: comparing to it made the route a
  // replayable faucet (grant 1M → spend it → balance ≈ 0 → re-grant 1M, forever, with no payment).
  // reconcileIncludedCredits sums grant rows only, so it is genuinely idempotent, and it also
  // refuses to double-count purchased credits toward the included allotment.
  await reconcileIncludedCredits(ws, { enrollIfEmpty: true });
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

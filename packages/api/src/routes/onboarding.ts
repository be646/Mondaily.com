import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { ensureWorkspaceForUser } from "../lib/bootstrap";
import { grantCredits, BUSINESS_TRIAL_GRANT } from "../lib/credits";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

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
  const body = await c.req.json<{ track?: string; industry?: string; team_size?: string; goals?: string[] }>().catch(() => ({} as Record<string, never>));
  const track = body.track === "business" ? "business" : "solo";
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).single();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  await supabase.from("workspaces").update({
    onboarded: true,
    settings: {
      ...settings,
      track,
      ...(body.industry ? { industry: body.industry } : {}),
      ...(body.team_size ? { team_size: body.team_size } : {}),
      ...(Array.isArray(body.goals) ? { goals: body.goals } : {}),
      ...(track === "business" ? { trial_ends_at: trialEndsAt } : {}),
    },
  }).eq("id", ws);

  // Business track → 14-day Pro trial credit allowance.
  if (track === "business") await grantCredits(ws, BUSINESS_TRIAL_GRANT, "grant", "14-day Pro trial credits");

  // Seed a few starter tasks (only if the workspace has none yet).
  const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  if ((count ?? 0) === 0) {
    await supabase.from("tasks").insert([
      { workspace_id: ws, title: "Add your first contact or company", status: "todo", assignee_id: userId, created_by: userId },
      { workspace_id: ws, title: "Connect your inbox (Settings → Email)", status: "todo", assignee_id: userId, created_by: userId },
      { workspace_id: ws, title: "Ask Mondaily to find new leads for you", status: "todo", assignee_id: userId, created_by: userId },
    ]).then(() => {}, () => {});
  }

  return c.json({ ok: true, track, trial_ends_at: track === "business" ? trialEndsAt : null });
});

export { router as onboardingRouter };

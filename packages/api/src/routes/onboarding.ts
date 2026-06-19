import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

// POST /onboarding/bootstrap — resolves the Supabase workspace UUID for a user.
// Uses requireJwt (no workspace membership check) so it works before membership exists.
//
// Resolution order:
//   1. User's existing workspace_members row (handles all existing users)
//   2. workspaces.clerk_org_id match (handles multi-member orgs after migration 0012)
//   3. Create a new workspace (new user, no existing membership)
router.post("/bootstrap", requireJwt, async (c) => {
  const userId = c.get("userId");
  const { clerk_org_id, name } = await c.req.json<{ clerk_org_id: string; name?: string }>();

  if (!clerk_org_id) {
    return c.json({ error: "clerk_org_id required" }, 400);
  }

  // 1. Check if user already belongs to a workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (membership?.workspace_id) {
    // Opportunistically write clerk_org_id if the column exists (migration 0012)
    await supabase.from("workspaces").update({ clerk_org_id } as Record<string, unknown>)
      .eq("id", membership.workspace_id)
      .is("clerk_org_id", null)
      .then(() => {/* ignore errors — column may not exist yet */});
    return c.json({ workspace_id: membership.workspace_id });
  }

  // 2. Try to find workspace by clerk_org_id (available after migration 0012)
  let workspaceId: string | null = null;
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .eq("clerk_org_id", clerk_org_id)
      .maybeSingle();
    if (ws?.id) workspaceId = ws.id as string;
  } catch { /* column may not exist yet — ignore */ }

  // 3. Create a new workspace
  if (!workspaceId) {
    const workspaceName = name ?? "My Workspace";
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      + "-" + Math.random().toString(36).slice(2, 7);
    const insertPayload: Record<string, unknown> = { name: workspaceName, slug };
    // Include clerk_org_id — silently ignored if column doesn't exist yet
    try {
      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert({ ...insertPayload, clerk_org_id })
        .select("id")
        .single();
      if (!createError && created) {
        workspaceId = created.id as string;
      }
    } catch { /* fall through */ }
    // Retry without clerk_org_id if insert failed (column missing)
    if (!workspaceId) {
      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert(insertPayload)
        .select("id")
        .single();
      if (createError) return c.json({ error: createError.message }, 500);
      workspaceId = created!.id as string;
    }
  }

  // Ensure membership row exists
  await supabase.from("workspace_members").upsert(
    { workspace_id: workspaceId, user_id: userId, role: "owner" },
    { onConflict: "workspace_id,user_id" }
  );

  return c.json({ workspace_id: workspaceId });
});

// GET /onboarding/status — returns which steps are complete based on real data
router.get("/status", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");

  const [
    { count: contactCount },
    { count: dealCount },
    { count: memberCount },
    { count: sequenceCount },
    { count: workflowCount },
    { count: reportCount },
    { count: threadCount },
    { count: emailCount },
    { count: importCount },
    { count: integrationCount },
  ] = await Promise.all([
    // contacts: person or company nodes
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("type", ["person", "company"]),
    // deals
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "deal"),
    // team members (> 1 means someone else was invited)
    supabase.from("workspace_members").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // sequences
    supabase.from("sequences").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // workflows / automations
    supabase.from("workflows").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // reports
    supabase.from("reports").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // ask AI threads
    supabase.from("ask_threads").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // email connections (synced email accounts)
    supabase.from("email_accounts").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // imports completed
    supabase.from("import_jobs").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "done"),
    // integrations / apps connected
    supabase.from("integrations").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  return c.json({
    workspace:  true,                            // always done — they're logged in
    contact:    (contactCount   ?? 0) > 0,
    email:      (emailCount     ?? 0) > 0,
    import:     (importCount    ?? 0) > 0,
    deal:       (dealCount      ?? 0) > 0,
    member:     (memberCount    ?? 0) > 1,       // > 1 means at least one invite accepted
    extension:  false,                           // detected client-side via localStorage flag
    report:     (reportCount    ?? 0) > 0,
    workflow:   (workflowCount  ?? 0) > 0,
    sequence:   (sequenceCount  ?? 0) > 0,
    ai:         (threadCount    ?? 0) > 0,
    apps:       (integrationCount ?? 0) > 0,
  });
});

export { router as onboardingRouter };

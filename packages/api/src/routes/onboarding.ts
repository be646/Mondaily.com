import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();

// POST /onboarding/bootstrap — resolves the Supabase workspace UUID for a user.
// Uses requireJwt (no workspace membership check) so it works before membership exists.
// clerk_org_id is optional — personal accounts (no Clerk org) omit it.
//
// Resolution order:
//   1. workspaces.clerk_org_id match — ensures org members all land in the same workspace
//   2. User's existing workspace_members row scoped to that org's workspace (if org provided)
//   3. Any existing workspace_members row (personal accounts / single-workspace users)
//   4. Create a new workspace
router.post("/bootstrap", requireJwt, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ clerk_org_id?: string; name?: string }>();
  const clerk_org_id = body.clerk_org_id ?? null;
  const workspaceName = body.name ?? "My Workspace";

  let workspaceId: string | null = null;

  // 1. Prefer the workspace that matches the Clerk org ID (org members share a workspace)
  if (clerk_org_id) {
    try {
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("clerk_org_id", clerk_org_id)
        .maybeSingle();
      if (ws?.id) workspaceId = ws.id as string;
    } catch { /* clerk_org_id column may not exist yet — ignore */ }
  }

  // 2. Fall back to any existing membership for this user
  if (!workspaceId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membership?.workspace_id) workspaceId = membership.workspace_id as string;
  }

  // 3. Create a new workspace
  if (!workspaceId) {
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      + "-" + Math.random().toString(36).slice(2, 7);
    const insertPayload: Record<string, unknown> = { name: workspaceName, slug };
    if (clerk_org_id) insertPayload.clerk_org_id = clerk_org_id;
    try {
      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert(insertPayload)
        .select("id")
        .single();
      if (!createError && created) workspaceId = created.id as string;
    } catch { /* fall through */ }
    // Retry without clerk_org_id if column doesn't exist yet
    if (!workspaceId && clerk_org_id) {
      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert({ name: workspaceName, slug })
        .select("id")
        .single();
      if (createError) return c.json({ error: createError.message }, 500);
      workspaceId = created!.id as string;
    } else if (!workspaceId) {
      return c.json({ error: "Failed to create workspace" }, 500);
    }
  }

  // Ensure membership row exists; opportunistically write clerk_org_id back to workspace
  await Promise.all([
    supabase.from("workspace_members").upsert(
      { workspace_id: workspaceId, user_id: userId, role: "owner" },
      { onConflict: "workspace_id,user_id" }
    ),
    clerk_org_id
      ? supabase.from("workspaces").update({ clerk_org_id } as Record<string, unknown>)
          .eq("id", workspaceId).is("clerk_org_id", null).then(() => {})
      : Promise.resolve(),
  ]);

  return c.json({ workspace_id: workspaceId });
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

export { router as onboardingRouter };

import { Hono } from "hono";
import { requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { insertTrialWorkspace } from "../lib/trial";

type Variables = { userId: string };
const router = new Hono<{ Variables: Variables }>();

/**
 * Workspace recovery / diagnostic endpoint — uses requireJwt (no workspace
 * membership check) so it works even if the client's cached workspace_id
 * is wrong or missing. Lists every workspace this Clerk user actually has
 * a workspace_members row for, with real data counts per workspace, so a
 * user (or support) can tell at a glance which workspace has their data
 * and pick it explicitly rather than guessing. Never creates or deletes
 * anything — read-only.
 */
router.get("/mine", requireJwt, async (c) => {
  const userId = c.get("userId");

  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, joined_at, workspaces(id, name, created_at)")
    .eq("user_id", userId);
  if (error) return c.json({ error: error.message }, 500);

  const workspaces = await Promise.all(
    (memberships ?? []).map(async (m) => {
      const ws = (m.workspaces ?? {}) as { id?: string; name?: string; created_at?: string };
      const workspaceId = m.workspace_id as string;
      const [tasks, lists, nodes, deals] = await Promise.all([
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("lists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        supabase.from("nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("object_type", "deal"),
      ]);
      return {
        workspace_id: workspaceId,
        name: ws.name ?? "Untitled workspace",
        role: m.role,
        joined_at: m.joined_at,
        created_at: ws.created_at ?? null,
        counts: {
          tasks: tasks.count ?? 0,
          lists: lists.count ?? 0,
          nodes: nodes.count ?? 0,
          deals: deals.count ?? 0,
        },
      };
    })
  );

  // Most-data-first, so the workspace someone actually uses sorts to the top.
  workspaces.sort((a, b) => (b.counts.tasks + b.counts.lists + b.counts.nodes) - (a.counts.tasks + a.counts.lists + a.counts.nodes));

  return c.json({ workspaces });
});

/**
 * Create a new workspace and make the caller its owner. Starts a 14-day trial
 * from creation (plan="trial" + settings.trial_ends_at). requireJwt (not
 * requireAuth) so a user can create a workspace without already belonging to one.
 */
router.post("/", requireJwt, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "Workspace name is required." }, 400);

  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`;

  let workspaceId: string, trialEndsAt: string;
  try {
    ({ id: workspaceId, trialEndsAt } = await insertTrialWorkspace({ name, slug }));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Could not create workspace." }, 500);
  }

  // Atomic: roll the workspace back if the owner membership can't be created.
  const { error: memberErr } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
  if (memberErr) {
    await supabase.from("workspaces").delete().eq("id", workspaceId).then(() => {}, () => {});
    return c.json({ error: memberErr.message }, 500);
  }

  return c.json({ workspace_id: workspaceId, name, trial_ends_at: trialEndsAt }, 201);
});

export { router as workspacesRouter };

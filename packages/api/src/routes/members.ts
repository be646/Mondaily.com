import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import type { WorkspaceRole } from "../middleware/rbac";

/** The only roles RBAC understands — see middleware/rbac.ts WorkspaceRole. */
const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

// GET /members - list all members in workspace
router.get("/", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, user_id, email, name, role, position, avatar_url")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// PATCH /members/:userId - update role or position (admin/owner only)
router.patch("/:userId", requireAuth, async (c) => {
  const requesterRole = c.get("role");
  if (!["owner", "admin"].includes(requesterRole)) {
    return c.json({ error: "Only owners and admins can update member roles" }, 403);
  }
  const body = await c.req.json<{ role?: string; position?: string; name?: string }>();

  // WHITELIST the fields. The type annotation above is compile-time only — the update used to
  // take the raw request object, so any column on workspace_members was reachable, including
  // workspace_id (which would move a member's row into another workspace) and user_id.
  const patch: Record<string, unknown> = {};
  if (typeof body.position === "string") patch.position = body.position.slice(0, 120);
  if (typeof body.name === "string") patch.name = body.name.slice(0, 200);

  if (body.role !== undefined) {
    // The role VALUE was never checked either: any string could be stored, and a role the RBAC
    // middleware does not recognise fails open into the least-privileged branch on some checks and
    // an unknown state on others.
    if (!ROLES.includes(body.role as WorkspaceRole)) {
      return c.json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 422);
    }
    // Only an OWNER may grant or revoke ownership. Admins could otherwise promote themselves —
    // "admin can edit members" is not the same permission as "admin can become owner".
    const target = await supabase.from("workspace_members").select("role")
      .eq("workspace_id", c.get("workspaceId")).eq("user_id", c.req.param("userId")).maybeSingle();
    const grantingOwner = body.role === "owner";
    const revokingOwner = target.data?.role === "owner" && body.role !== "owner";
    if ((grantingOwner || revokingOwner) && requesterRole !== "owner") {
      return c.json({ error: "Only an owner can grant or revoke ownership." }, 403);
    }
    // A workspace with no owner cannot be administered back — refuse to remove the last one.
    if (revokingOwner) {
      const { count } = await supabase.from("workspace_members")
        .select("user_id", { count: "exact", head: true })
        .eq("workspace_id", c.get("workspaceId")).eq("role", "owner");
      if ((count ?? 0) <= 1) return c.json({ error: "A workspace must keep at least one owner." }, 422);
    }
    patch.role = body.role;
  }

  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);

  const { data, error } = await supabase
    .from("workspace_members")
    .update(patch)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("user_id", c.req.param("userId"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST /members/sync - JWT-only, bootstraps new users into the workspace
router.post("/sync", requireJwt, async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");

  let body: { email?: string; name?: string; avatar_url?: string } = {};
  try { body = await c.req.json(); } catch {}

  const email = body.email || "";
  const name = body.name || "";
  const avatar_url = body.avatar_url || null;

  const { error: wsError } = await supabase
    .from("workspaces")
    .upsert({ id: workspaceId, name: name || email || "My Workspace", slug: workspaceId }, { onConflict: "id", ignoreDuplicates: true });
  if (wsError) return c.json({ error: `workspace upsert: ${wsError.message}` }, 500);

  // Check if already a member — preserve existing role + profile so a sparse sync call
  // never overwrites real name/email/avatar (and never stamps the user_id as a fake email).
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("role, email, name, avatar_url")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("workspace_members")
    .upsert({
      workspace_id: workspaceId,
      user_id: userId,
      email: email || (existing?.email as string) || "",
      name: name || (existing?.name as string) || email || "",
      avatar_url: avatar_url ?? (existing?.avatar_url as string) ?? null,
      role: existing?.role ?? "owner",
    }, { onConflict: "workspace_id,user_id" })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export { router as membersRouter };

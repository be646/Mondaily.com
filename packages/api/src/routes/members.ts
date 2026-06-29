import { Hono } from "hono";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

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
  const { data, error } = await supabase
    .from("workspace_members")
    .update(body)
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

  // Check if already a member — preserve existing role
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("workspace_members")
    .upsert({
      workspace_id: workspaceId,
      user_id: userId,
      email: email || userId,
      name: name || email || userId,
      avatar_url,
      role: existing?.role ?? "owner",
    }, { onConflict: "workspace_id,user_id" })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export { router as membersRouter };

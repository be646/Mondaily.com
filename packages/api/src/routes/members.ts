import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono();
router.use("*", requireAuth);

// GET /members - list all members in workspace
router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, user_id, email, name, role, avatar_url")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// POST /members - add/upsert current user as member (called on login)
router.post("/sync", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const body = await c.req.json() as { email: string; name: string; avatar_url?: string };
  const { data, error } = await supabase
    .from("workspace_members")
    .upsert({
      workspace_id: workspaceId,
      user_id: userId,
      email: body.email,
      name: body.name,
      avatar_url: body.avatar_url || null
    }, { onConflict: "workspace_id,user_id" })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export { router as membersRouter };

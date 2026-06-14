import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
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

// POST /members/sync - upsert current user, fetch info from Clerk if missing
router.post("/sync", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");

  let body: { email?: string; name?: string; avatar_url?: string } = {};
  try { body = await c.req.json(); } catch {}

  let email = body.email || "";
  let name = body.name || "";
  let avatar_url = body.avatar_url || null;

  // If email missing, fetch from Clerk API
  if (!email && process.env.CLERK_SECRET_KEY) {
    try {
      const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` }
      });
      if (res.ok) {
        const clerkUser = await res.json() as any;
        email = clerkUser.email_addresses?.[0]?.email_address || "";
        name = `${clerkUser.first_name || ""} ${clerkUser.last_name || ""}`.trim() || email;
        avatar_url = clerkUser.image_url || null;
      }
    } catch {}
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .upsert({
      workspace_id: workspaceId,
      user_id: userId,
      email: email || userId,
      name: name || email || userId,
      avatar_url,
      role: "member"
    }, { onConflict: "workspace_id,user_id" })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export { router as membersRouter };

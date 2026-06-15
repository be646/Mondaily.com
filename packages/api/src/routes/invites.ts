import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin","member","viewer","guest"]).default("member"),
  finance_role: z.enum(["none","viewer","member","reviewer","approver"]).default("none"),
});

// LIST pending invites
router.get("/", async (c) => {
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("id,email,role,finance_role,invited_by,token,expires_at,created_at")
    .eq("workspace_id", c.get("workspaceId"))
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// CREATE invite
router.post("/", zValidator("json", inviteSchema), async (c) => {
  const callerRole = c.get("role");
  if (!["admin","owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const body = c.req.valid("json");
  // Upsert invite (unique on workspace+email where not accepted)
  const { data, error } = await supabase
    .from("workspace_invites")
    .upsert({
      workspace_id: c.get("workspaceId"),
      email: body.email,
      role: body.role,
      finance_role: body.finance_role,
      invited_by: c.get("userId"),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "workspace_id,email", ignoreDuplicates: false })
    .select("id,email,role,finance_role,token,expires_at,created_at")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  // In production you'd send an email here. Return the invite link for now.
  const inviteLink = `/accept-invite?token=${data.token}`;
  return c.json({ ...data, invite_link: inviteLink }, 201);
});

// CANCEL invite
router.delete("/:id", async (c) => {
  const callerRole = c.get("role");
  if (!["admin","owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const { error } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ACCEPT invite (public — no requireAuth since user may not be in workspace yet)
// This is called after auth, passes token + the authenticated user's id
router.post("/accept", async (c) => {
  const { token, user_id } = await c.req.json<{ token: string; user_id: string }>();
  const { data: invite, error: inviteErr } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (inviteErr || !invite) return c.json({ error: "Invalid or expired invite" }, 404);

  // Add to workspace_members
  const { error: memberErr } = await supabase.from("workspace_members").upsert({
    workspace_id: invite.workspace_id,
    user_id,
    role: invite.role,
    finance_role: invite.finance_role,
  }, { onConflict: "workspace_id,user_id" });
  if (memberErr) return c.json({ error: memberErr.message }, 500);

  // Mark accepted
  await supabase.from("workspace_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  return c.json({ workspace_id: invite.workspace_id, role: invite.role });
});

export { router as invitesRouter };

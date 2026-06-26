import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { sendWorkspaceEmail } from "../lib/mail";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
// Middleware is applied PER-ROUTE: the management routes need full workspace auth,
// but /accept must use requireJwt (verified token only, no membership check) —
// the invitee is not a member yet, and their identity comes from the token, not
// the request body.

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin","member","viewer","guest"]).default("member"),
  finance_role: z.enum(["none","viewer","member","reviewer","approver"]).default("none"),
});

// LIST pending invites
router.get("/", requireAuth, async (c) => {
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
router.post("/", requireAuth, zValidator("json", inviteSchema), async (c) => {
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
  // Deliver the invite to the incoming teammate from the workspace's connected
  // inbox. Best-effort: if no inbox is connected we still return the link so the
  // inviter can share it manually (email_sent flags which happened).
  const appBase = process.env.APP_BASE_URL ?? "https://app.mondaily.com";
  const inviteLink = `${appBase}/accept-invite?token=${data.token}`;
  const emailSent = await sendWorkspaceEmail(c.get("workspaceId"), {
    to: [{ email: data.email }],
    subject: "You've been invited to a Mondaily workspace",
    body:
      `<p>You've been invited to collaborate in a Mondaily workspace.</p>` +
      `<p><a href="${inviteLink}">Accept your invitation</a></p>` +
      `<p>If the button doesn't work, paste this link into your browser:<br/>${inviteLink}</p>` +
      `<p>This invitation expires in 7 days.</p>`,
  });
  return c.json({ ...data, invite_link: inviteLink, email_sent: emailSent }, 201);
});

// CANCEL invite
router.delete("/:id", requireAuth, async (c) => {
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

// ACCEPT invite — requireJwt (verified token, no membership check) since the
// invitee is not a member yet. SECURITY: the user id is taken from the VERIFIED
// Clerk token, never from the request body — otherwise anyone could redeem a
// token on behalf of an arbitrary user_id and inject themselves/others into a
// workspace.
router.post("/accept", requireJwt, async (c) => {
  const { token } = await c.req.json<{ token: string }>().catch(() => ({ token: "" }));
  const userId = c.get("userId"); // from the verified token — NOT the request body
  if (!token) return c.json({ error: "Missing invite token" }, 400);
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
    user_id: userId,
    role: invite.role,
    finance_role: invite.finance_role,
  }, { onConflict: "workspace_id,user_id" });
  if (memberErr) return c.json({ error: memberErr.message }, 500);

  // Mark accepted
  await supabase.from("workspace_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  return c.json({ workspace_id: invite.workspace_id, role: invite.role });
});

export { router as invitesRouter };

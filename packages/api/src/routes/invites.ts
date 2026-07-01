import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth, requireJwt } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { sendWorkspaceEmail } from "../lib/mail";

// The invite-accept SPA route is /invite/:token (path param) — build links to match.
const inviteUrl = (token: string) =>
  `${process.env.APP_URL ?? process.env.APP_BASE_URL ?? "https://app.mondaily.com"}/invite/${token}`;

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
  // Per-module access matrix { crm: "edit", finance: "view", ... }. Empty → role defaults apply.
  module_access: z.record(z.enum(["none","view","edit"])).default({}),
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
  const workspaceId = c.get("workspaceId");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const cols = "id,email,role,finance_role,token,expires_at,created_at";

  // Guard: if this email is ALREADY a member, there's nothing to invite.
  const { data: already } = await supabase
    .from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("email", body.email).maybeSingle();
  if (already) return c.json({ error: "That person is already a member of this workspace." }, 409);

  // NOTE: the unique index on (workspace_id, email) is PARTIAL (WHERE accepted_at IS NULL), which
  // Postgres can't use for ON CONFLICT — so we must NOT upsert. Look up an existing pending invite
  // and UPDATE it, otherwise INSERT a fresh one. (This was the "could not create invite" bug.)
  const { data: pending } = await supabase
    .from("workspace_invites").select("id")
    .eq("workspace_id", workspaceId).eq("email", body.email).is("accepted_at", null)
    .maybeSingle();

  // NOTE: we do NOT set invited_by — that column is `uuid REFERENCES auth.users(id)`, but sovereign
  // auth uses `usr_...` TEXT ids, so writing it throws "invalid input syntax for type uuid" and
  // killed every invite. Left null until the column is migrated to text.
  const fields = { role: body.role, finance_role: body.finance_role, module_access: body.module_access, expires_at: expiresAt };
  const bare = { role: body.role, finance_role: body.finance_role, expires_at: expiresAt };

  let data: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;
  if (pending?.id) {
    ({ data, error } = await supabase.from("workspace_invites").update(fields).eq("id", pending.id).select(cols).single());
    if (error && /module_access/i.test(error.message)) ({ data, error } = await supabase.from("workspace_invites").update(bare).eq("id", pending.id).select(cols).single());
  } else {
    const row = { workspace_id: workspaceId, email: body.email, ...fields };
    ({ data, error } = await supabase.from("workspace_invites").insert(row).select(cols).single());
    if (error && /module_access/i.test(error.message)) {
      const { module_access, ...noMod } = row;
      ({ data, error } = await supabase.from("workspace_invites").insert(noMod).select(cols).single());
    }
  }
  if (error || !data) return c.json({ error: error?.message ?? "Invite failed" }, 500);
  // Deliver the invite to the incoming teammate from the workspace's connected
  // inbox. Best-effort: if no inbox is connected we still return the link so the
  // inviter can share it manually (email_sent flags which happened).
  const inviteLink = inviteUrl(data.token as string);
  const emailSent = await sendWorkspaceEmail(c.get("workspaceId"), {
    to: [{ email: data.email as string }],
    subject: "You've been invited to a Mondaily workspace",
    body:
      `<p>You've been invited to collaborate in a Mondaily workspace.</p>` +
      `<p><a href="${inviteLink}">Accept your invitation</a></p>` +
      `<p>If the button doesn't work, paste this link into your browser:<br/>${inviteLink}</p>` +
      `<p>This invitation expires in 7 days.</p>`,
  });
  return c.json({ ...data, invite_link: inviteLink, email_sent: emailSent }, 201);
});

// CREATE a shareable invite link — a tokenized invite NOT tied to a specific email, so the
// "Copy invite link" button produces a real /invite/:token URL (accept() keys on the token).
router.post("/link", requireAuth, async (c) => {
  const callerRole = c.get("role");
  if (!["admin", "owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const { data, error } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: c.get("workspaceId"),
      email: `link-${randomUUID().slice(0, 8)}@invite.local`, // placeholder; the unique key is (workspace,email)
      role: "member",
      finance_role: "none",
      // invited_by omitted — uuid column vs sovereign usr_ text ids (see POST / above).
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ invite_link: inviteUrl(data.token as string) }, 201);
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
  const memberRow = {
    workspace_id: invite.workspace_id,
    user_id: userId,
    role: invite.role,
    finance_role: invite.finance_role,
    module_access: (invite as Record<string, unknown>).module_access ?? {},
  };
  let { error: memberErr } = await supabase.from("workspace_members").upsert(memberRow, { onConflict: "workspace_id,user_id" });
  if (memberErr && /module_access/i.test(memberErr.message)) {
    const { module_access, ...bare } = memberRow;
    ({ error: memberErr } = await supabase.from("workspace_members").upsert(bare, { onConflict: "workspace_id,user_id" }));
  }
  if (memberErr) return c.json({ error: memberErr.message }, 500);

  // Mark accepted
  await supabase.from("workspace_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  return c.json({ workspace_id: invite.workspace_id, role: invite.role });
});

export { router as invitesRouter };

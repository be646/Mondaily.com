import { verifyToken } from "@clerk/backend";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";

const router = new Hono();
router.post("/accept", zValidator("json", z.object({ token: z.string().min(1) })), async (c) => {
  const sessionToken = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!sessionToken) throw new HTTPException(401, { message: "Sign in before accepting an invitation." });
  const session = await verifyToken(sessionToken, { secretKey: process.env.CLERK_SECRET_KEY });
  const { token } = c.req.valid("json");
  const { data: invite } = await supabase
    .from("nodes")
    .select("id, workspace_id, data")
    .eq("object_type", "workspace_invitation")
    .eq("data->>token", token)
    .eq("data->>status", "pending")
    .single();
  if (!invite) return c.json({ error: "Invitation not found or already used." }, 404);
  if (new Date(invite.data.expires_at).getTime() < Date.now()) return c.json({ error: "Invitation expired." }, 410);
  const { error } = await supabase.from("workspace_members").upsert({
    workspace_id: invite.workspace_id,
    user_id: session.sub,
    role: invite.data.role === "admin" ? "admin" : "member"
  });
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("nodes").update({ data: { ...invite.data, status: "accepted", accepted_by: session.sub, accepted_at: new Date().toISOString() } }).eq("id", invite.id);
  return c.json({ ok: true, workspace_id: invite.workspace_id });
});

export { router as invitesRouter };

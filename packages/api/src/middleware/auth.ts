import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken } from "@clerk/backend";
import { supabase } from "@mondaily/db/client";

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  const workspaceId = c.req.header("X-Workspace-Id");

  if (!token) throw new HTTPException(401, { message: "Unauthorized" });
  if (!workspaceId) throw new HTTPException(400, { message: "X-Workspace-Id header required" });

  let userId: string;
  try {
    const verified = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
    userId = verified.sub;
    if (!userId) throw new HTTPException(401, { message: "Token has no subject" });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(401, { message: `JWT verification failed: ${msg}` });
  }

  const { data: membership, error: dbError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (dbError) throw new HTTPException(500, { message: `DB error: ${dbError.message}` });
  if (!membership) throw new HTTPException(403, { message: `User ${userId} not in workspace ${workspaceId}` });

  c.set("userId", userId);
  c.set("workspaceId", workspaceId);
  c.set("role", membership.role);
  await next();
});

// Use on routes where only admins/owners can act
export const requireAdmin = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const role = c.get("role");
  if (!["owner", "admin"].includes(role)) {
    throw new HTTPException(403, { message: "Admin access required" });
  }
  await next();
});

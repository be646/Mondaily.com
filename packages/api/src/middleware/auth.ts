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

  try {
    // Verify JWT signature cryptographically using Clerk's JWKS
    const verified = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    const userId = verified.sub;
    if (!userId) throw new HTTPException(401, { message: "Invalid token" });

    // Verify the user is actually a member of the claimed workspace and get their real role
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!membership) throw new HTTPException(403, { message: "Not a member of this workspace" });

    c.set("userId", userId);
    c.set("workspaceId", workspaceId);
    c.set("role", membership.role);
    await next();
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    throw new HTTPException(401, { message: "Invalid token" });
  }
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

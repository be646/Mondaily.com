import { verifyToken } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { supabase } from "@mondaily/db/client";

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) throw new HTTPException(401, { message: "Unauthorized" });
  let payload;
  try {
    payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  } catch {
    throw new HTTPException(401, { message: "Invalid token" });
  }
  const workspaceId = c.req.header("X-Workspace-Id") || c.req.param("workspaceId");
  if (!workspaceId) throw new HTTPException(400, { message: "workspace required" });
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", payload.sub).single();
  if (!membership) throw new HTTPException(403, { message: "Workspace access denied" });
  c.set("userId", payload.sub);
  c.set("workspaceId", workspaceId);
  c.set("role", membership.role);
  await next();
});

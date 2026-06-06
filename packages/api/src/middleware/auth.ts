import { createClerkClient } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || "" });

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string };
}>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) throw new HTTPException(401, { message: "Unauthorized" });
  try {
    const payload = await clerk.verifyToken(token);
    const workspaceId = c.req.header("X-Workspace-Id") || c.req.param("workspaceId");
    if (!workspaceId) throw new HTTPException(400, { message: "workspace required" });
    c.set("userId", payload.sub);
    c.set("workspaceId", workspaceId);
    await next();
  } catch {
    throw new HTTPException(401, { message: "Invalid token" });
  }
});


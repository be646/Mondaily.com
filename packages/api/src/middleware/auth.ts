import { createClerkClient } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  const workspaceId = c.req.header("X-Workspace-Id") || "8ccef088-6493-4cd9-a0cf-3214098f59a1";

  if (!token) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  try {
    const { sub } = await clerk.verifyToken(token);
    c.set("userId", sub);
    c.set("workspaceId", workspaceId);
    c.set("role", "owner");
    await next();
  } catch {
    throw new HTTPException(401, { message: "Invalid token" });
  }
});

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const CLERK_TO_WORKSPACE: Record<string, string> = {
  "org_3Eq2xXHigy4Fz7fhjWYoeyfrQT0": "8ccef088-6493-4cd9-a0cf-3214098f59a1"
};

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  const rawWorkspaceId = c.req.header("X-Workspace-Id") || "8ccef088-6493-4cd9-a0cf-3214098f59a1";
  const workspaceId = CLERK_TO_WORKSPACE[rawWorkspaceId] || rawWorkspaceId;

  if (!token) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) throw new Error("No user ID");
    c.set("userId", userId);
    c.set("workspaceId", workspaceId);
    c.set("role", "owner");
    await next();
  } catch {
    throw new HTTPException(401, { message: "Invalid token" });
  }
});

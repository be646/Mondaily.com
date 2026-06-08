import { createMiddleware } from "hono/factory";

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string };
}>(async (c, next) => {
  const workspaceId = c.req.header("X-Workspace-Id") || "8ccef088-6493-4cd9-a0cf-3214098f59a1";
  const userId = "user_3Eq4W23FajPKuKbFEEkiP1sybgV";
  c.set("userId", userId);
  c.set("workspaceId", workspaceId);
  c.set("role", "owner");
  await next();
});

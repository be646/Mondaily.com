import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { supabase } from "@mondaily/db/client";
import { verifyAccessToken, ACCESS_COOKIE } from "../lib/auth-tokens";

/**
 * Sovereign auth: read the native HS256 access token from the HttpOnly cookie and verify it
 * with AUTH_JWT_SECRET. Returns the canonical user id; workspace + role resolution below is
 * unchanged. (Clerk fully removed.)
 */
async function resolveUserId(c: Context): Promise<string> {
  const at = getCookie(c, ACCESS_COOKIE);
  if (!at) throw new HTTPException(401, { message: "Unauthorized" });
  const claims = await verifyAccessToken(at);
  if (!claims?.sub) throw new HTTPException(401, { message: "Invalid or expired session" });
  return claims.sub;
}

export const requireAuth = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string; financeRole: string; moduleAccess: Record<string, string> };
}>(async (c, next) => {
  const workspaceId = c.req.header("X-Workspace-Id");
  if (!workspaceId) throw new HTTPException(400, { message: "X-Workspace-Id header required" });

  let userId: string;
  try {
    userId = await resolveUserId(c);
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(401, { message: `JWT verification failed: ${msg}` });
  }

  let { data: membership, error: dbError } = await supabase
    .from("workspace_members")
    .select("role, finance_role, module_access")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  // Graceful degrade: if the module_access column isn't migrated yet, retry without it so auth
  // never breaks during the rollout window (the matrix just falls back to role defaults).
  if (dbError && /module_access/i.test(dbError.message)) {
    ({ data: membership, error: dbError } = await supabase
      .from("workspace_members")
      .select("role, finance_role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle());
  }

  if (dbError) throw new HTTPException(500, { message: `DB error: ${dbError.message}` });
  if (!membership) throw new HTTPException(403, { message: `User ${userId} not in workspace ${workspaceId}` });

  c.set("userId", userId);
  c.set("workspaceId", workspaceId);
  c.set("role", membership.role);
  c.set("financeRole", (membership as Record<string, unknown>).finance_role as string ?? "none");
  c.set("moduleAccess", ((membership as Record<string, unknown>).module_access as Record<string, string>) ?? {});
  await next();
});

// JWT-only auth — verifies token but does NOT check workspace membership.
// Use for onboarding endpoints where the user may not have a workspace yet.
export const requireJwt = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string; financeRole: string; moduleAccess: Record<string, string> };
}>(async (c, next) => {
  try {
    const userId = await resolveUserId(c);
    c.set("userId", userId);
    c.set("workspaceId", c.req.header("X-Workspace-Id") ?? "");
    c.set("role", "member");
    c.set("financeRole", "none");
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(401, { message: `JWT verification failed: ${msg}` });
  }
  await next();
});

// Use on routes where only admins/owners can act
export const requireAdmin = createMiddleware<{
  Variables: { userId: string; workspaceId: string; role: string; financeRole: string; moduleAccess: Record<string, string> };
}>(async (c, next) => {
  const role = c.get("role");
  if (!["owner", "admin"].includes(role)) {
    throw new HTTPException(403, { message: "Admin access required" });
  }
  await next();
});

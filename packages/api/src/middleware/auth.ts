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
  // The workspace travels in a header everywhere fetch() runs the request. The ONE exception is a
  // top-level browser NAVIGATION (report downloads: a plain <a> click cannot attach headers), so
  // those two GET paths may carry it as ?ws= instead. Membership is verified identically either
  // way — the query form only changes the transport, never the authorization.
  const navExport = c.req.method === "GET" && /\/reports\/export\.(xlsx|html|pdf)$/.test(c.req.path);
  const workspaceId = c.req.header("X-Workspace-Id") ?? (navExport ? c.req.query("ws") : undefined);
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

  // Soft-deleted workspace gate: a deleted workspace is INERT for everyone immediately (410, not
  // 403 — "gone, restorable" is different from "not yours"). Cached 60s so the common path costs
  // nothing; the restore endpoint uses requireJwt and is therefore not blocked by this gate.
  if (await workspaceIsDeleted(workspaceId)) {
    throw new HTTPException(410, { message: "This workspace has been deleted. The owner can restore it from the deletion email within 14 days." });
  }

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

// ── soft-delete cache ───────────────────────────────────────────────────────────
// 60s TTL; deletion/restore call clearDeletedCache() so the gate reacts immediately in-region.
const deletedCache = new Map<string, { deleted: boolean; at: number }>();
export function clearDeletedCache(workspaceId: string) { deletedCache.delete(workspaceId); }
async function workspaceIsDeleted(workspaceId: string): Promise<boolean> {
  const hit = deletedCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 60_000) return hit.deleted;
  try {
    const { data, error } = await supabase.from("workspaces").select("deleted_at").eq("id", workspaceId).maybeSingle();
    // Column not migrated yet → feature off, never a lockout.
    if (error) { deletedCache.set(workspaceId, { deleted: false, at: Date.now() }); return false; }
    const deleted = !!data?.deleted_at;
    deletedCache.set(workspaceId, { deleted, at: Date.now() });
    return deleted;
  } catch { return false; }
}

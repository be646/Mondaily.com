/**
 * Centralized Role-Based Access Control for the four workspace tiers.
 *
 *   owner  (4) — full control, billing, can delete the workspace
 *   admin  (3) — manage members, settings, schema, integrations
 *   member (2) — create/edit workspace data (the canvas)
 *   viewer (1) — READ ONLY across the workspace canvas
 *
 * Use AFTER `requireAuth` (which sets `c.get("role")` from workspace_members).
 */
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { moduleAllows, type AccessLevel } from "../lib/modules";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

/** True when the role can administer the workspace (owner or admin). */
export function isWorkspaceAdmin(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

type RbacVars = { Variables: { role: string } };

/** Require the caller's workspace role to be one of `allowed`. */
export function requireRole(...allowed: WorkspaceRole[]) {
  return createMiddleware<RbacVars>(async (c, next) => {
    if (!allowed.includes(c.get("role") as WorkspaceRole)) {
      throw new HTTPException(403, { message: `Forbidden — requires ${allowed.join(" or ")} role.` });
    }
    await next();
  });
}

/** Owner or admin only — workspace administration. */
export const requireAdminRole = requireRole("owner", "admin");

/** Block any write (non-GET/HEAD) for viewer accounts — read-only canvas. */
export const denyViewerWrites = createMiddleware<RbacVars>(async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && c.get("role") === "viewer") {
    throw new HTTPException(403, { message: "Viewer accounts are read-only." });
  }
  await next();
});

/**
 * Gate a route by per-module access. `need` defaults to "view"; pass "edit" for mutations.
 * Reads role + finance_role + module_access from the auth context (set by requireAuth).
 */
export function requireModule(moduleKey: string, need: AccessLevel = "view") {
  return createMiddleware<{ Variables: { role: string; financeRole: string; moduleAccess: Record<string, string> } }>(async (c, next) => {
    const ok = moduleAllows(c.get("role"), moduleKey, need, c.get("moduleAccess"), c.get("financeRole"));
    if (!ok) throw new HTTPException(403, { message: `No ${need} access to ${moduleKey}.` });
    await next();
  });
}

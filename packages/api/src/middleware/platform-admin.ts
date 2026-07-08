import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { supabase } from "@mondaily/db/client";
import { verifyAccessToken, ACCESS_COOKIE } from "../lib/auth-tokens";

/**
 * PLATFORM admin — Mondaily's own operators, NOT workspace admins. Identified by the
 * PLATFORM_ADMIN_EMAILS env allowlist (comma-separated, case-insensitive) checked against the
 * authenticated user's verified auth_credentials email. FAIL-CLOSED: when the env var is unset or
 * empty, nobody is a platform admin — exactly like the AI gateway / LiveKit probes.
 *
 * Deliberately does NOT use requireAuth: platform routes are cross-workspace (that is their whole
 * point — Mondaily support triages tickets from every workspace), so no X-Workspace-Id is required
 * and no workspace membership is implied. Every route behind this middleware must treat
 * workspace_id as DATA it reads per ticket, never as an access scope.
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const allow = platformAdminEmails();
  if (allow.length === 0) return false;   // fail-closed
  const { data } = await supabase.from("auth_credentials").select("email").eq("user_id", userId).maybeSingle();
  const email = String(data?.email ?? "").toLowerCase();
  return !!email && allow.includes(email);
}

export const requirePlatformAdmin = createMiddleware<{ Variables: { userId: string } }>(async (c, next) => {
  const at = getCookie(c, ACCESS_COOKIE);
  if (!at) throw new HTTPException(401, { message: "Unauthorized" });
  const claims = await verifyAccessToken(at);
  if (!claims?.sub) throw new HTTPException(401, { message: "Invalid or expired session" });
  if (!(await isPlatformAdmin(claims.sub))) {
    throw new HTTPException(403, { message: "Platform admin access required." });
  }
  c.set("userId", claims.sub);
  await next();
});

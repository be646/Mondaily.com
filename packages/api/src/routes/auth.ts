import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { hashPassword, verifyPassword } from "../lib/password";
import {
  signAccessToken, verifyAccessToken, newRefreshToken, refreshExpiry, sha256,
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, ACCESS_COOKIE, REFRESH_COOKIE,
} from "../lib/auth-tokens";

/**
 * Sovereign Auth — native email/password identity, mounted at /api/v1/auth/*. Runs ALONGSIDE
 * Clerk (shadow mode): nothing else in the app reads these yet, so it can be deployed and
 * verified in isolation. Email/password only (no social login by design).
 */
const router = new Hono();

const PW_MIN = 8;
const credSchema = z.object({ email: z.string().email(), password: z.string().min(PW_MIN).max(200) });

const cookieBase = { httpOnly: true, secure: true, sameSite: "Strict" as const };

function setSessionCookies(c: Parameters<typeof setCookie>[0], access: string, refreshRaw: string) {
  setCookie(c, ACCESS_COOKIE, access, { ...cookieBase, path: "/", maxAge: ACCESS_TTL_SECONDS });
  setCookie(c, REFRESH_COOKIE, refreshRaw, { ...cookieBase, path: "/api/v1/auth", maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 });
}
function clearSessionCookies(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/api/v1/auth" });
}

// Issue a fresh session: store the refresh hash, set both cookies. Never stores the raw token.
async function issueSession(c: Parameters<typeof setCookie>[0], userId: string, email: string, userAgent?: string) {
  const access = await signAccessToken(userId, email);
  const { raw, hash } = newRefreshToken();
  await supabase.from("auth_refresh_tokens").insert({
    user_id: userId, token_hash: hash, expires_at: refreshExpiry().toISOString(), user_agent: userAgent ?? null,
  });
  setSessionCookies(c, access, raw);
}

// Look up a workspace_members row by email (case-insensitive) → the canonical user_… id.
async function memberByEmail(email: string): Promise<{ user_id: string; name: string | null } | null> {
  const { data } = await supabase
    .from("workspace_members").select("user_id, name, email")
    .ilike("email", email).limit(1).maybeSingle();
  return data ? { user_id: data.user_id as string, name: (data.name as string) ?? null } : null;
}
async function credByEmail(email: string) {
  const { data } = await supabase.from("auth_credentials").select("*").ilike("email", email).maybeSingle();
  return data;
}

// POST /auth/register — brand-new sovereign account (not a Clerk migrant).
router.post("/register", zValidator("json", credSchema.extend({ name: z.string().max(120).optional() })), async (c) => {
  const { email, password } = c.req.valid("json");
  if (await credByEmail(email)) return c.json({ error: "An account with this email already exists." }, 409);
  const userId = `usr_${randomBytes(12).toString("hex")}`;
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").insert({ user_id: userId, email, password_hash });
  if (error) return c.json({ error: error.message }, 400);
  await issueSession(c, userId, email, c.req.header("user-agent"));
  return c.json({ userId, email }, 201);
});

// POST /auth/login — verify password, or flag legacy Clerk users for activation.
router.post("/login", zValidator("json", credSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const cred = await credByEmail(email);
  if (!cred) {
    // No native credential yet — is this a known (Clerk-era) user who needs to set a password?
    const member = await memberByEmail(email);
    if (member) return c.json({ requires_activation: true });
    return c.json({ error: "Invalid email or password." }, 401); // generic — no account enumeration
  }
  const ok = await verifyPassword(cred.password_hash as string, password);
  if (!ok) return c.json({ error: "Invalid email or password." }, 401);
  await issueSession(c, cred.user_id as string, cred.email as string, c.req.header("user-agent"));
  return c.json({ userId: cred.user_id, email: cred.email });
});

// POST /auth/activate — legacy bridge: bind a new password to an existing user_… id.
router.post("/activate", zValidator("json", credSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  if (await credByEmail(email)) return c.json({ error: "This account is already activated — please log in." }, 409);
  const member = await memberByEmail(email);
  if (!member) return c.json({ error: "No Mondaily account is associated with this email." }, 404);
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").insert({ user_id: member.user_id, email, password_hash });
  if (error) return c.json({ error: error.message }, 400);
  await issueSession(c, member.user_id, email, c.req.header("user-agent"));
  return c.json({ userId: member.user_id, email, activated: true }, 201);
});

// POST /auth/refresh — rotate the refresh token, mint a new access token.
router.post("/refresh", async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  if (!raw) return c.json({ error: "Not authenticated." }, 401);
  const { data: row } = await supabase.from("auth_refresh_tokens").select("*").eq("token_hash", sha256(raw)).maybeSingle();
  if (!row || row.revoked_at || new Date(row.expires_at as string).getTime() < Date.now()) {
    clearSessionCookies(c);
    return c.json({ error: "Session expired." }, 401);
  }
  const { data: cred } = await supabase.from("auth_credentials").select("email").eq("user_id", row.user_id as string).maybeSingle();
  // Rotate: mint new, revoke old (pointing replaced_by at the new row for audit).
  const access = await signAccessToken(row.user_id as string, (cred?.email as string) ?? "");
  const next = newRefreshToken();
  const { data: inserted } = await supabase.from("auth_refresh_tokens")
    .insert({ user_id: row.user_id, token_hash: next.hash, expires_at: refreshExpiry().toISOString(), user_agent: c.req.header("user-agent") ?? null })
    .select("id").single();
  await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString(), replaced_by: inserted?.id ?? null }).eq("id", row.id as string);
  setSessionCookies(c, access, next.raw);
  return c.json({ userId: row.user_id });
});

// POST /auth/logout — revoke the current refresh token + clear cookies.
router.post("/logout", async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  if (raw) await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", sha256(raw));
  clearSessionCookies(c);
  return c.json({ ok: true });
});

// GET /auth/me — resolve the current session from the access cookie.
router.get("/me", async (c) => {
  const at = getCookie(c, ACCESS_COOKIE);
  const claims = at ? await verifyAccessToken(at) : null;
  if (!claims) return c.json({ error: "Not authenticated." }, 401);
  return c.json({ userId: claims.sub, email: claims.email });
});

export { router as authRouter };

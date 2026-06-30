import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { hashPassword, verifyPassword } from "../lib/password";
import { ensureWorkspaceForUser } from "../lib/bootstrap";
import {
  signAccessToken, verifyAccessToken, newRefreshToken, refreshExpiry, sha256,
  signActivationToken, verifyActivationToken,
  signResetToken, verifyResetToken,
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, ACCESS_COOKIE, REFRESH_COOKIE,
} from "../lib/auth-tokens";
import { sendTransactionalEmail } from "../lib/mail";
import { rateLimit } from "../middleware/rate-limit";
import { grantCredits, SOLO_GRANT } from "../lib/credits";
import { issuePowChallenge, requirePow } from "../lib/pow";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";

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
async function memberByEmail(email: string): Promise<{ user_id: string; name: string | null; workspace_id: string | null } | null> {
  const { data } = await supabase
    .from("workspace_members").select("user_id, name, email, workspace_id")
    .ilike("email", email).limit(1).maybeSingle();
  return data ? { user_id: data.user_id as string, name: (data.name as string) ?? null, workspace_id: (data.workspace_id as string) ?? null } : null;
}
async function credByEmail(email: string) {
  const { data } = await supabase.from("auth_credentials").select("*").ilike("email", email).maybeSingle();
  return data;
}
// Session profile: a default workspace (so the SPA can set X-Workspace-Id) plus the cached
// display name + avatar (the /settings/members fields), so profile components render natively.
async function sessionProfile(userId: string): Promise<{ workspaceId: string | null; name: string | null; imageUrl: string | null }> {
  const { data } = await supabase
    .from("workspace_members").select("workspace_id, name, avatar_url")
    .eq("user_id", userId).limit(1).maybeSingle();
  return {
    workspaceId: (data?.workspace_id as string) ?? null,
    name: (data?.name as string) ?? null,
    imageUrl: (data?.avatar_url as string) ?? null,
  };
}

// GET /auth/challenge — issue a signed proof-of-work challenge for the anti-bot gate.
router.get("/challenge", async (c) => c.json(await issuePowChallenge()));

// POST /auth/register — brand-new sovereign account. Creates the credential, then natively
// bootstraps a fresh workspace with the user as owner (no Clerk org).
router.post("/register", rateLimit(), requirePow, zValidator("json", credSchema.extend({ name: z.string().max(120).optional() })), async (c) => {
  const { email, password, name } = c.req.valid("json");
  if (await credByEmail(email)) return c.json({ error: "An account with this email already exists." }, 409);
  const userId = `usr_${randomBytes(12).toString("hex")}`;
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").insert({ user_id: userId, email, password_hash });
  if (error) return c.json({ error: error.message }, 400);

  // Native workspace bootstrap: new workspace + owner membership + cached profile.
  // Atomic-ish: if the workspace bootstrap fails, roll back the credential so the email
  // isn't left permanently stuck (can't re-register, but has no workspace).
  const displayName = name?.trim() || email;
  let workspaceId: string | null = null;
  try {
    const ws = await ensureWorkspaceForUser(userId, name?.trim() ? `${name.trim()}'s Workspace` : "My Workspace");
    workspaceId = ws.workspaceId;
    await supabase.from("workspace_members").update({ name: displayName, email }).eq("workspace_id", workspaceId).eq("user_id", userId);
    if (ws.isNew) await grantCredits(workspaceId, SOLO_GRANT, "grant", "Free-tier welcome credits");
  } catch (e) {
    await supabase.from("auth_credentials").delete().eq("user_id", userId).then(() => {}, () => {});
    return c.json({ error: e instanceof Error ? e.message : "Failed to initialize workspace" }, 500);
  }

  await issueSession(c, userId, email, c.req.header("user-agent"));
  return c.json({ userId, email, name: displayName, imageUrl: null, workspaceId }, 201);
});

// POST /auth/login — verify password, or flag legacy Clerk users for activation.
router.post("/login", rateLimit(), zValidator("json", credSchema), async (c) => {
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
  return c.json({ userId: cred.user_id, email: cred.email, ...(await sessionProfile(cred.user_id as string)) });
});

// POST /auth/activate — legacy bridge: bind a new password to an existing user_… id.
// POST /auth/request-activation — legacy bridge step 1. Emails a one-time activation link to
// the address ON FILE (proving email ownership), so possessing an email alone can't set a
// password. Always returns a generic ok (no account enumeration).
router.post("/request-activation", rateLimit(), requirePow, zValidator("json", z.object({ email: z.string().email() })), async (c) => {
  const { email } = c.req.valid("json");
  const generic = { ok: true, message: "If that email has a Mondaily account awaiting activation, we've sent a link." };
  if (await credByEmail(email)) return c.json(generic);
  const member = await memberByEmail(email);
  if (!member) return c.json(generic);
  const token = await signActivationToken(member.user_id, email);
  const appUrl = process.env.APP_URL ?? "https://app.mondaily.com";
  const link = `${appUrl}/auth/shadow-activate?token=${encodeURIComponent(token)}`;
  {
    await sendTransactionalEmail({
      to: [{ email }],
      subject: "Activate your Mondaily account",
      body: `<p>Mondaily has upgraded to our own secure sign-in. Set your password to activate your account:</p>
             <p><a href="${link}">Activate my account</a></p>
             <p>This link expires in 30 minutes. If you didn't request this, you can ignore it.</p>`,
    }).catch(() => {});
  }
  return c.json(generic);
});

// POST /auth/activate — legacy bridge step 2. Requires the emailed token (proof of email
// ownership), then binds the password to the existing user_… id.
router.post("/activate", rateLimit(), zValidator("json", z.object({ token: z.string().min(1), password: z.string().min(PW_MIN).max(200) })), async (c) => {
  const { token, password } = c.req.valid("json");
  const claims = await verifyActivationToken(token);
  if (!claims) return c.json({ error: "This activation link is invalid or has expired. Request a new one." }, 400);
  if (await credByEmail(claims.email)) return c.json({ error: "This account is already activated — please log in." }, 409);
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").insert({ user_id: claims.sub, email: claims.email, password_hash });
  if (error) return c.json({ error: error.message }, 400);
  await issueSession(c, claims.sub, claims.email, c.req.header("user-agent"));
  return c.json({ userId: claims.sub, email: claims.email, activated: true, ...(await sessionProfile(claims.sub)) }, 201);
});

// POST /auth/request-password-reset — emails a short-lived reset link to the address on file.
// Generic response (no account enumeration), rate-limited.
router.post("/request-password-reset", rateLimit(), requirePow, zValidator("json", z.object({ email: z.string().email() })), async (c) => {
  const { email } = c.req.valid("json");
  const generic = { ok: true, message: "If an account exists for that email, a reset link is on its way." };
  const cred = await credByEmail(email);
  if (!cred) return c.json(generic);
  const token = await signResetToken(cred.user_id as string, cred.email as string);
  const appUrl = process.env.APP_URL ?? "https://app.mondaily.com";
  const link = `${appUrl}/auth/reset?token=${encodeURIComponent(token)}`;
  {
    await sendTransactionalEmail({
      to: [{ email: cred.email as string }],
      subject: "Reset your Mondaily password",
      body: `<p>We received a request to reset your Mondaily password.</p>
             <p><a href="${link}">Choose a new password</a></p>
             <p>This link expires in 30 minutes. If you didn't request it, you can safely ignore this email.</p>`,
    }).catch(() => {});
  }
  return c.json(generic);
});

// POST /auth/reset-password — verify the emailed token, set the new password, revoke all sessions.
router.post("/reset-password", rateLimit(), requirePow, zValidator("json", z.object({ token: z.string().min(1), password: z.string().min(PW_MIN).max(200) })), async (c) => {
  const { token, password } = c.req.valid("json");
  const claims = await verifyResetToken(token);
  if (!claims) return c.json({ error: "This reset link is invalid or has expired. Request a new one." }, 400);
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").update({ password_hash, updated_at: new Date().toISOString() }).eq("user_id", claims.sub);
  if (error) return c.json({ error: error.message }, 400);
  // Invalidate every existing session, then sign this device in fresh.
  await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", claims.sub).is("revoked_at", null);
  await issueSession(c, claims.sub, claims.email, c.req.header("user-agent"));
  return c.json({ ok: true, ...(await sessionProfile(claims.sub)) });
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
  return c.json({ userId: claims.sub, email: claims.email, ...(await sessionProfile(claims.sub)) });
});

// Resolve the signed-in user id from the access cookie (for the authed self-service routes below).
async function sessionUserId(c: Parameters<typeof getCookie>[0]): Promise<string | null> {
  const at = getCookie(c, ACCESS_COOKIE);
  const claims = at ? await verifyAccessToken(at) : null;
  return claims?.sub ?? null;
}

// POST /auth/change-password — verify the current password, set a new one, revoke other sessions.
router.post("/change-password", rateLimit(), zValidator("json", z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(PW_MIN).max(200) })), async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const { currentPassword, newPassword } = c.req.valid("json");
  const { data: cred } = await supabase.from("auth_credentials").select("password_hash").eq("user_id", userId).maybeSingle();
  if (!cred || !(await verifyPassword(cred.password_hash as string, currentPassword))) {
    return c.json({ error: "Current password is incorrect." }, 400);
  }
  const password_hash = await hashPassword(newPassword);
  await supabase.from("auth_credentials").update({ password_hash, updated_at: new Date().toISOString() }).eq("user_id", userId);
  // Revoke every existing refresh token (force re-auth elsewhere), then re-issue THIS session.
  await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
  const { data: emailRow } = await supabase.from("auth_credentials").select("email").eq("user_id", userId).maybeSingle();
  await issueSession(c, userId, (emailRow?.email as string) ?? "", c.req.header("user-agent"));
  return c.json({ ok: true });
});

// DELETE /auth/account — permanently delete the caller's account: purge workspaces they OWN
// (and their data), drop all their memberships, then remove credentials + refresh tokens.
router.delete("/account", async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  // Workspaces this user owns → purge their data + the workspace.
  const { data: owned } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner");
  const ownedIds = (owned ?? []).map((r) => r.workspace_id as string);
  const wsTables = ["activities", "agent_jobs", "decision_queue", "notifications", "ai_usage", "discovered_leads", "chat_threads", "email_connections", "workflows", "sequences", "lists", "notes", "invoices", "credit_notes", "quotes", "expenses", "reports", "dashboards", "edges", "nodes", "workspace_members"];
  for (const ws of ownedIds) {
    for (const t of wsTables) await supabase.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
    await supabase.from("workspaces").delete().eq("id", ws).then(() => {}, () => {});
  }
  // Drop any remaining memberships (workspaces they only belonged to), then the identity itself.
  await supabase.from("workspace_members").delete().eq("user_id", userId).then(() => {}, () => {});
  await supabase.from("auth_refresh_tokens").delete().eq("user_id", userId).then(() => {}, () => {});
  await supabase.from("auth_credentials").delete().eq("user_id", userId).then(() => {}, () => {});
  clearSessionCookies(c);
  return c.json({ ok: true });
});

/**
 * GET /auth/mail-health — admin-gated, non-invasive diagnostic for the outbound transactional
 * pipeline. Returns ONLY boolean readiness + the public sender identity — never the raw key value,
 * so it's safe to expose. Mirrors the same env resolution mail.ts uses to send.
 */
router.get("/mail-health", requireAuth, requireAdminRole, (c) => {
  const key = process.env.RESEND_API_KEY ?? process.env.TRANSACTIONAL_MAIL_API_KEY ?? "";
  const sender = process.env.RESEND_FROM ?? process.env.TRANSACTIONAL_MAIL_FROM ?? "Mondaily Networks <no-reply@mondaily.com>";
  const keyConfigured = typeof key === "string" && key.length > 0;
  const senderDefined = typeof sender === "string" && sender.length > 0;
  if (!keyConfigured || !senderDefined) {
    return c.json({ status: "error", code: "MISSING_ENV_VARS", message: "Outbound transactional pipeline unassigned" }, 503);
  }
  return c.json({ status: "ok", resend_api_key_configured: true, sender_identity: sender });
});

export { router as authRouter };

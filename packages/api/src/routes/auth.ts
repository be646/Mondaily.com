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
  signVerifyToken, verifyVerifyToken,
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, ACCESS_COOKIE, REFRESH_COOKIE,
  passwordFingerprint,
} from "../lib/auth-tokens";
import { sendTransactionalEmail } from "../lib/mail";
import { rateLimit } from "../middleware/rate-limit";
import { generateTotpSecret, verifyTotp, otpauthUrl, generateRecoveryCodes, hashRecoveryCode, signMfaToken, verifyMfaToken } from "../lib/totp";
import { TRUST_COOKIE, signTrustToken, verifyTrustToken } from "../lib/totp";
import { grantCredits } from "../lib/credits";
import { grantAmountFor } from "@mondaily/shared/pricing";
import { issuePowChallenge, requirePow, verifyPow } from "../lib/pow";
import { logPowClaim } from "../lib/pow-claims";
import { requireAuth, requireJwt } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import * as store from "../lib/rate-limit-store";

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

// First forwarded hop = the real client IP behind Vercel's proxy.
function clientIp(c: Parameters<typeof setCookie>[0]): string | null {
  const fwd = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "";
  return fwd.split(",")[0]?.trim() || null;
}

// Insert a refresh-token row WITH session telemetry (ip_address/last_active_at). Login-safe: if
// those columns don't exist yet (pre-migration), the insert is retried with the minimal column set
// so authentication never breaks. Returns the new row id (for rotation audit) when available.
async function insertRefreshRow(userId: string, hash: string, userAgent: string | null, ip: string | null): Promise<string | null> {
  const expires_at = refreshExpiry().toISOString();
  const full = { user_id: userId, token_hash: hash, expires_at, user_agent: userAgent, ip_address: ip, last_active_at: new Date().toISOString() };
  let res = await supabase.from("auth_refresh_tokens").insert(full).select("id").single();
  if (res.error) {
    res = await supabase.from("auth_refresh_tokens")
      .insert({ user_id: userId, token_hash: hash, expires_at, user_agent: userAgent })
      .select("id").single();
  }
  return (res.data?.id as string) ?? null;
}

// Issue a fresh session: store the refresh hash, set both cookies. Never stores the raw token.
async function issueSession(c: Parameters<typeof setCookie>[0], userId: string, email: string, userAgent?: string) {
  const access = await signAccessToken(userId, email);
  const { raw, hash } = newRefreshToken();
  await insertRefreshRow(userId, hash, userAgent ?? null, clientIp(c));
  setSessionCookies(c, access, raw);
}

// Look up a workspace_members row by email (case-insensitive) → the canonical user_… id.
async function memberByEmail(email: string): Promise<{ user_id: string; name: string | null; workspace_id: string | null } | null> {
  const { data } = await supabase
    .from("workspace_members").select("user_id, name, email, workspace_id")
    // eq on a normalized address, NOT ilike: `%` and `_` are ILIKE wildcards and are legal in an
    // email local-part, so `%@corp.com` matched as a PATTERN — an account-existence oracle and the
    // wrong comparison for an auth path.
    .eq("email", email.trim().toLowerCase()).limit(1).maybeSingle();
  return data ? { user_id: data.user_id as string, name: (data.name as string) ?? null, workspace_id: (data.workspace_id as string) ?? null } : null;
}
async function credByEmail(email: string) {
  const { data } = await supabase.from("auth_credentials").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return data;
}
// Session profile: a default workspace (so the SPA can set X-Workspace-Id) plus the cached
// display name + avatar (the /settings/members fields), so profile components render natively.
/**
 * `onboarded` is included because routing to onboarding used to depend on a localStorage flag set
 * once at signup. Close the tab before finishing — or sign in from another device — and the flag
 * was gone, so the user landed on an empty dashboard having never completed onboarding: no trial
 * stamped, no profile, no starter tasks, and `workspaces.onboarded` still false forever.
 *
 * The server already knew. It just was not asked.
 */
async function sessionProfile(userId: string): Promise<{ workspaceId: string | null; name: string | null; imageUrl: string | null; emailVerified: boolean; onboarded: boolean }> {
  const [{ data }, { data: cred }] = await Promise.all([
    // Deterministic: without an order, Postgres may return a different row per login, so a
    // multi-workspace user booted into an arbitrary workspace that changed between sessions.
    supabase.from("workspace_members").select("workspace_id, name, avatar_url").eq("user_id", userId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle(),
    // email_verified may not exist pre-migration → default to true so no banner shows (graceful).
    supabase.from("auth_credentials").select("email_verified").eq("user_id", userId).maybeSingle(),
  ]);
  const workspaceId = (data?.workspace_id as string) ?? null;
  // Defaults TRUE when unknown: a failed lookup must not trap an existing user in onboarding.
  let onboarded = true;
  if (workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("onboarded").eq("id", workspaceId).maybeSingle();
    onboarded = (ws as { onboarded?: boolean } | null)?.onboarded ?? true;
  }
  return {
    workspaceId,
    name: (data?.name as string) ?? null,
    imageUrl: (data?.avatar_url as string) ?? null,
    emailVerified: (cred as { email_verified?: boolean } | null)?.email_verified ?? true,
    onboarded,
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
    if (ws.isNew) await grantCredits(workspaceId, grantAmountFor("scout"), "grant", "Free-tier welcome credits");
  } catch (e) {
    await supabase.from("auth_credentials").delete().eq("user_id", userId).then(() => {}, () => {});
    return c.json({ error: e instanceof Error ? e.message : "Failed to initialize workspace" }, 500);
  }

  await issueSession(c, userId, email, c.req.header("user-agent"));
  // The registrant just solved a PoW (requirePow gated this route) — persist it as their first
  // verified cryptographic claim so the ABI matrix sees them as a legitimate human from day one.
  const pb = await c.req.json<{ pow_challenge?: string; pow_nonce?: string }>().catch(() => ({} as { pow_challenge?: string; pow_nonce?: string }));
  logPowClaim(userId, pb.pow_challenge ?? "", pb.pow_nonce ?? "", "register");
  void sendVerificationEmail(userId, email); // best-effort; soft verification (non-blocking)
  return c.json({ userId, email, name: displayName, imageUrl: null, workspaceId }, 201);
});

// Best-effort verification email — never throws into the caller.
async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  try {
    const token = await signVerifyToken(userId, email);
    const appUrl = process.env.APP_URL ?? "https://app.mondaily.com";
    const link = `${appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await sendTransactionalEmail({
      to: [{ email }],
      subject: "Verify your Mondaily email",
      body: `<p>Welcome to Mondaily. Confirm this is your email to secure your account:</p>
             <p><a href="${link}">Verify my email</a></p>
             <p>This link expires in 72 hours. You can keep using Mondaily in the meantime.</p>`,
    });
  } catch { /* email not configured / transient — the in-app banner still lets them resend */ }
}

// POST /auth/verify-email — confirm ownership via the emailed token. Public (the user may not
// have an active session on the device they open the email link from).
router.post("/verify-email", rateLimit(), zValidator("json", z.object({ token: z.string().min(1) })), async (c) => {
  const { token } = c.req.valid("json");
  const claims = await verifyVerifyToken(token);
  if (!claims) return c.json({ error: "This verification link is invalid or has expired." }, 400);
  const { error } = await supabase.from("auth_credentials")
    .update({ email_verified: true, verified_at: new Date().toISOString() })
    .eq("user_id", claims.sub);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true, email: claims.email });
});

// POST /auth/resend-verification — authed; re-sends the verification email to the user on file.
router.post("/resend-verification", requireAuth, rateLimit({ max: 3, windowMs: 10 * 60_000 }), async (c) => {
  const userId = c.get("userId");
  const { data } = await supabase.from("auth_credentials").select("email, email_verified").eq("user_id", userId).maybeSingle();
  if (!data) return c.json({ ok: true }); // generic
  if (data.email_verified) return c.json({ ok: true, already: true });
  await sendVerificationEmail(userId, data.email as string);
  return c.json({ ok: true });
});

// POST /auth/login — verify password, or flag legacy Clerk users for activation.
// Escalating lockout on top of the rate limiter: after LOCK_THRESHOLD bad passwords for an
// email, that account is locked for LOCK_MS regardless of IP — stops slow distributed
// brute-force that stays under the per-minute rate limit. In-memory (per warm instance):
// a solid second layer alongside the PoW gate; back with Postgres for a hard global lock.
const failedLogins = new Map<string, { count: number; until: number }>();
const LOCK_THRESHOLD = 6;
const LOCK_MS = 15 * 60_000;
const LOCK_WINDOW_MS = 60 * 60_000;   // failures older than an hour stop counting toward a lock

/**
 * The lock is DURABLE first (Postgres), in-memory second.
 *
 * A distributed brute-force spreads attempts across serverless instances, so a per-instance Map
 * never reaches the threshold — the exact attack this lockout exists to stop. The counter now lives
 * in one place. If the store is unavailable it falls back to the Map, which is weak but better than
 * refusing every login because a table is missing.
 */
async function loginLockedSecs(email: string): Promise<number> {
  const st = await store.hit(`login-lock|${email}`, LOCK_WINDOW_MS);
  if (st) return st.lockedForSecs;
  const rec = failedLogins.get(email);
  return rec && rec.until > Date.now() ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}
async function recordLoginFail(email: string) {
  const key = `login-fail|${email}`;
  const st = await store.hit(key, LOCK_WINDOW_MS);
  if (st) {
    if (st.hits >= LOCK_THRESHOLD) {
      await store.lock(`login-lock|${email}`, LOCK_MS);
      await store.clear(key);
    }
    return;
  }
  const rec = failedLogins.get(email) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= LOCK_THRESHOLD) { rec.until = Date.now() + LOCK_MS; rec.count = 0; }
  failedLogins.set(email, rec);
}
/** A correct password forgives the record — otherwise one bad week locks a legitimate user out. */
async function clearLoginFails(email: string) {
  await store.clear(`login-fail|${email}`);
  await store.clear(`login-lock|${email}`);
  failedLogins.delete(email);
}

// requirePow: login now also demands a solved proof-of-work, so each attempt costs real CPU —
// the same anti-bot gate register/reset use. (The frontend solves it transparently.)
router.post("/login", rateLimit(), requirePow, zValidator("json", credSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const lock = await loginLockedSecs(email.toLowerCase());
  if (lock > 0) {
    c.header("Retry-After", String(lock));
    return c.json({ error: `Too many failed attempts. Try again in ${Math.ceil(lock / 60)} min.` }, 429);
  }
  const cred = await credByEmail(email);
  if (!cred) {
    // No native credential yet — is this a known (Clerk-era) user who needs to set a password?
    const member = await memberByEmail(email);
    if (member) return c.json({ requires_activation: true });
    return c.json({ error: "Invalid email or password." }, 401); // generic — no account enumeration
  }
  const ok = await verifyPassword(cred.password_hash as string, password);
  if (!ok) {
    await recordLoginFail(email.toLowerCase());
    return c.json({ error: "Invalid email or password." }, 401);
  }
  await clearLoginFails(email.toLowerCase()); // a correct password forgives past failures
  // 2FA branch: password verified but a second factor is enrolled → issue a 5-minute mfa token
  // instead of a session. Rows without the migrated columns simply don't have totp_enabled_at,
  // so this is a no-op until enrollment exists — no lockout path.
  if ((cred as Record<string, unknown>).totp_enabled_at) {
    // Trusted device: a valid 30-day trust cookie bound to (user, current enabled_at) skips the
    // prompt. Re-enrolling 2FA changes enabled_at → every previously trusted device re-prompts.
    const trustRaw = getCookie(c, TRUST_COOKIE);
    const enabledAtIso = String((cred as Record<string, unknown>).totp_enabled_at);
    if (trustRaw && await verifyTrustToken(trustRaw, cred.user_id as string, enabledAtIso)) {
      await issueSession(c, cred.user_id as string, cred.email as string, c.req.header("user-agent"));
      return c.json({ userId: cred.user_id, email: cred.email, ...(await sessionProfile(cred.user_id as string)) });
    }
    return c.json({ mfa_required: true, mfa_token: await signMfaToken(cred.user_id as string, cred.email as string) });
  }
  await issueSession(c, cred.user_id as string, cred.email as string, c.req.header("user-agent"));
  return c.json({ userId: cred.user_id, email: cred.email, ...(await sessionProfile(cred.user_id as string)) });
});

// ── Two-factor auth (TOTP, RFC 6238, in-house — see lib/totp.ts) ────────────────

/** POST /auth/2fa/login — complete a 2FA login: mfa token (password proof) + TOTP or recovery code. */
router.post("/2fa/login", rateLimit({ max: 8, windowMs: 5 * 60_000 }), zValidator("json", z.object({ mfa_token: z.string().min(1), code: z.string().min(6).max(64), trust_device: z.boolean().optional() })), async (c) => {
  const { mfa_token, code, trust_device } = c.req.valid("json");
  const claims = await verifyMfaToken(mfa_token);
  if (!claims) return c.json({ error: "This sign-in attempt expired — enter your password again." }, 401);
  const { data: cred } = await supabase.from("auth_credentials").select("*").eq("user_id", claims.sub).maybeSingle();
  const secret = (cred as Record<string, unknown> | null)?.totp_secret as string | undefined;
  if (!cred || !secret || !(cred as Record<string, unknown>).totp_enabled_at) {
    // 2FA was disabled between password and code — just sign in.
    await issueSession(c, claims.sub, claims.email, c.req.header("user-agent"));
    return c.json({ userId: claims.sub, email: claims.email, ...(await sessionProfile(claims.sub)) });
  }
  let ok = verifyTotp(secret, code);
  if (!ok) {
    // recovery-code path — single use: matching hash is removed on success
    const hashes = ((cred as Record<string, unknown>).recovery_codes as string[] | null) ?? [];
    const h = hashRecoveryCode(code);
    if (hashes.includes(h)) {
      ok = true;
      await supabase.from("auth_credentials").update({ recovery_codes: hashes.filter(x => x !== h) }).eq("user_id", claims.sub);
    }
  }
  if (!ok) return c.json({ error: "That code didn't match. Codes rotate every 30 seconds — try the current one." }, 401);
  // REAL device trust: HttpOnly 30-day cookie signed against (user, enabled_at). Only set when
  // the user asked for it, only after a successful second factor.
  if (trust_device) {
    const enabledAtIso = String((cred as Record<string, unknown>).totp_enabled_at);
    setCookie(c, TRUST_COOKIE, await signTrustToken(claims.sub, enabledAtIso), {
      httpOnly: true, secure: true, sameSite: "Strict", path: "/api/v1/auth", maxAge: 30 * 24 * 60 * 60,
    });
  }
  await issueSession(c, claims.sub, claims.email, c.req.header("user-agent"));
  return c.json({ userId: claims.sub, email: claims.email, ...(await sessionProfile(claims.sub)) });
});

/** POST /auth/2fa/setup — start enrollment (authenticated). Stores a PENDING secret; nothing is
 *  enforced until /2fa/enable verifies a code, so abandoning setup can never lock you out. */
router.post("/2fa/setup", rateLimit({ max: 5, windowMs: 10 * 60_000 }), async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const { data: cred } = await supabase.from("auth_credentials").select("email, totp_enabled_at").eq("user_id", userId).maybeSingle();
  if (!cred) return c.json({ error: "No native credential on this account." }, 400);
  if ((cred as Record<string, unknown>).totp_enabled_at) return c.json({ error: "Two-factor is already enabled. Disable it first to re-enroll." }, 409);
  const secret = generateTotpSecret();
  const { error } = await supabase.from("auth_credentials").update({ totp_secret: secret }).eq("user_id", userId);
  if (error) return c.json({ error: /totp_secret/i.test(error.message) ? "2FA isn't enabled yet — the migration hasn't been applied." : "Could not start enrollment." }, 503);
  return c.json({ secret, otpauth: otpauthUrl(secret, String(cred.email)) });
});

/** POST /auth/2fa/enable — finish enrollment: verify one code, mint recovery codes (returned ONCE). */
router.post("/2fa/enable", rateLimit({ max: 8, windowMs: 5 * 60_000 }), zValidator("json", z.object({ code: z.string().min(6).max(8) })), async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const { data: cred } = await supabase.from("auth_credentials").select("totp_secret, totp_enabled_at").eq("user_id", userId).maybeSingle();
  const secret = (cred as Record<string, unknown> | null)?.totp_secret as string | undefined;
  if (!secret) return c.json({ error: "Start setup first." }, 400);
  if ((cred as Record<string, unknown>).totp_enabled_at) return c.json({ error: "Already enabled." }, 409);
  if (!verifyTotp(secret, c.req.valid("json").code)) return c.json({ error: "That code didn't match — check your authenticator and try the current code." }, 400);
  const { plain, hashes } = generateRecoveryCodes();
  const { error } = await supabase.from("auth_credentials").update({ totp_enabled_at: new Date().toISOString(), recovery_codes: hashes }).eq("user_id", userId);
  if (error) return c.json({ error: "Could not enable two-factor." }, 500);
  return c.json({ ok: true, recovery_codes: plain });   // shown once, stored only as hashes
});

/** POST /auth/2fa/disable — requires a CURRENT code or recovery code (possession proof). */
router.post("/2fa/disable", rateLimit({ max: 8, windowMs: 5 * 60_000 }), zValidator("json", z.object({ code: z.string().min(6).max(16) })), async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const { data: cred } = await supabase.from("auth_credentials").select("totp_secret, totp_enabled_at, recovery_codes").eq("user_id", userId).maybeSingle();
  const secret = (cred as Record<string, unknown> | null)?.totp_secret as string | undefined;
  if (!secret || !(cred as Record<string, unknown>)?.totp_enabled_at) return c.json({ ok: true, already_disabled: true });
  const code = c.req.valid("json").code;
  const ok = verifyTotp(secret, code) || (((cred as Record<string, unknown>).recovery_codes as string[] | null) ?? []).includes(hashRecoveryCode(code));
  if (!ok) return c.json({ error: "That code didn't match." }, 401);
  const { error } = await supabase.from("auth_credentials").update({ totp_secret: null, totp_enabled_at: null, recovery_codes: null }).eq("user_id", userId);
  if (error) return c.json({ error: "Could not disable two-factor." }, 500);
  return c.json({ ok: true });
});

/** GET /auth/2fa/status — is 2FA enabled for the caller (+ remaining recovery codes)? */
router.get("/2fa/status", async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const { data: cred, error } = await supabase.from("auth_credentials").select("totp_enabled_at, recovery_codes").eq("user_id", userId).maybeSingle();
  if (error) return c.json({ available: false, enabled: false });   // migration not applied — honest
  return c.json({ available: true, enabled: !!(cred as Record<string, unknown> | null)?.totp_enabled_at, recovery_codes_left: (((cred as Record<string, unknown> | null)?.recovery_codes as string[] | null) ?? []).length });
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
  // Fingerprint the password this link is issued against, so using the link (or changing the
  // password any other way) invalidates it — see passwordFingerprint.
  const token = await signResetToken(
    cred.user_id as string,
    cred.email as string,
    passwordFingerprint(cred.password_hash as string | null),
  );
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

  // SINGLE USE: the link is bound to the password it was minted against. If that password has
  // changed — because this link was already used, or the user reset another way — the fingerprint
  // no longer matches and the link is spent. Without this the token stayed valid for its whole
  // 30-minute life AFTER a successful reset, so anyone still holding it could reset again, revoke
  // the owner's sessions and take the account.
  const { data: current } = await supabase.from("auth_credentials")
    .select("password_hash").eq("user_id", claims.sub).maybeSingle();
  const currentPv = passwordFingerprint((current as { password_hash?: string } | null)?.password_hash);
  if (currentPv !== claims.pv) {
    return c.json({ error: "This reset link has already been used. Request a new one." }, 400);
  }

  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("auth_credentials").update({ password_hash, updated_at: new Date().toISOString() }).eq("user_id", claims.sub);
  if (error) return c.json({ error: error.message }, 400);
  // Invalidate every existing session.
  await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", claims.sub).is("revoked_at", null);
  // SECURITY: a reset link only proves EMAIL possession. With 2FA enrolled, that must never be
  // enough for a session — the password is reset, but sign-in still requires the second factor.
  const { data: credRow } = await supabase.from("auth_credentials").select("totp_enabled_at").eq("user_id", claims.sub).maybeSingle();
  if ((credRow as Record<string, unknown> | null)?.totp_enabled_at) {
    return c.json({ ok: true, mfa_required: true, mfa_token: await signMfaToken(claims.sub, claims.email) });
  }
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
  const insertedId = await insertRefreshRow(row.user_id as string, next.hash, c.req.header("user-agent") ?? null, clientIp(c));
  await supabase.from("auth_refresh_tokens").update({ revoked_at: new Date().toISOString(), replaced_by: insertedId ?? null }).eq("id", row.id as string);
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

// POST /auth/pow-claim — an authenticated session submits a freshly-solved PoW. We re-verify the
// nonce server-side and persist it to pow_claims, giving the ABI matrix absolute cryptographic
// proof this operator is a real human (not a headless/botnet client).
// Uses requireJwt (session-only), NOT requireAuth: the claim is per-USER (logged with userId +
// "session" context, no workspace scope), and the auth-context helper that calls this doesn't send
// an X-Workspace-Id header — requireAuth was rejecting every claim with 400 before it could verify,
// so verified_pow never lit up. requireJwt authenticates the session without demanding a workspace.
router.post("/pow-claim", requireJwt, async (c) => {
  const { pow_challenge, pow_nonce } = await c.req.json<{ pow_challenge?: string; pow_nonce?: string }>().catch(() => ({} as { pow_challenge?: string; pow_nonce?: string }));
  if (!(await verifyPow(pow_challenge ?? "", pow_nonce ?? ""))) return c.json({ ok: false }, 400);
  logPowClaim(c.get("userId") as string, pow_challenge as string, pow_nonce as string, "session");
  return c.json({ ok: true });
});


/**
 * POST /auth/restore-workspace — undo a soft-delete inside the 14-day window (OWNER only).
 * Uses JWT-only auth on purpose: the normal auth gate answers 410 for deleted workspaces, so the
 * restore path verifies ownership itself. Idempotent; expired windows answer honestly.
 */
router.post("/restore-workspace", async (c) => {
  const userId = await sessionUserId(c);
  if (!userId) return c.json({ error: "Not authenticated." }, 401);
  const body = await c.req.json<{ workspace_id?: string }>().catch(() => ({} as never));
  const ws = String(body.workspace_id ?? "");
  if (!ws) return c.json({ error: "workspace_id required" }, 400);
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", userId).maybeSingle();
  if (member?.role !== "owner") return c.json({ error: "Only the workspace owner can restore it." }, 403);
  const { data: wsRow } = await supabase.from("workspaces").select("deleted_at, name").eq("id", ws).maybeSingle();
  if (!wsRow?.deleted_at) return c.json({ ok: true, already_active: true });
  if (Date.now() - Date.parse(String(wsRow.deleted_at)) > 14 * 86_400_000) {
    return c.json({ error: "The 14-day restore window has passed — this workspace's data has been (or is being) permanently erased." }, 410);
  }
  const { error } = await supabase.from("workspaces").update({ deleted_at: null }).eq("id", ws);
  if (error) return c.json({ error: "Could not restore the workspace." }, 500);
  const { clearDeletedCache } = await import("../middleware/auth");
  clearDeletedCache(ws);
  return c.json({ ok: true, restored: true, name: wsRow.name ?? null });
});

export { router as authRouter };

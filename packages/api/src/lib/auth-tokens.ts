import { sign, verify } from "hono/jwt";
import { createHash, randomBytes } from "node:crypto";

/**
 * Native session tokens for Sovereign Auth.
 *  - Access: stateless short-lived JWT (HS256, AUTH_JWT_SECRET), 15 min.
 *  - Refresh: opaque 256-bit random value; only its SHA-256 is stored in auth_refresh_tokens,
 *    so a DB leak never yields a usable token. Rotated on every refresh.
 * Both are delivered via HTTP-only, Secure, SameSite=Strict cookies (set in the routes).
 */
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
export const ACCESS_COOKIE = "md_at";
export const REFRESH_COOKIE = "md_rt";

function jwtSecret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error("AUTH_JWT_SECRET is not set");
  return s;
}

export interface AccessClaims { sub: string; email: string; type: "access" }

export async function signAccessToken(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, email, type: "access", iat: now, exp: now + ACCESS_TTL_SECONDS }, jwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "access" || typeof p.sub !== "string") return null;
    return { sub: p.sub, email: String(p.email ?? ""), type: "access" };
  } catch {
    return null;
  }
}

// ── Activation tokens — single-use, email-delivered proof of email ownership ──────
// A short-lived signed token bound to (user_id, email). Activation requires presenting
// one of these, so possessing a member's email is NOT enough to set their password.
const ACTIVATION_TTL_SECONDS = 30 * 60;
export async function signActivationToken(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, email, type: "activation", iat: now, exp: now + ACTIVATION_TTL_SECONDS }, jwtSecret());
}
export async function verifyActivationToken(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "activation" || typeof p.sub !== "string" || typeof p.email !== "string") return null;
    return { sub: p.sub, email: p.email };
  } catch {
    return null;
  }
}

// ── Email-verification tokens — single-purpose, email-delivered (72h) ─────────────
const VERIFY_TTL_SECONDS = 72 * 60 * 60;
export async function signVerifyToken(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, email, type: "verify_email", iat: now, exp: now + VERIFY_TTL_SECONDS }, jwtSecret());
}
export async function verifyVerifyToken(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "verify_email" || typeof p.sub !== "string" || typeof p.email !== "string") return null;
    return { sub: p.sub, email: p.email };
  } catch {
    return null;
  }
}

// ── Password-reset tokens — short-lived, single-purpose, email-delivered ──────────
const RESET_TTL_SECONDS = 30 * 60;
export async function signResetToken(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, email, type: "reset", iat: now, exp: now + RESET_TTL_SECONDS }, jwtSecret());
}
export async function verifyResetToken(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "reset" || typeof p.sub !== "string" || typeof p.email !== "string") return null;
    return { sub: p.sub, email: p.email };
  } catch {
    return null;
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Mint a fresh refresh token: the raw value goes to the cookie, the hash to the DB. */
export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: sha256(raw) };
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

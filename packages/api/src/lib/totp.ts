import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { sign, verify } from "hono/jwt";

/**
 * Sovereign TOTP (RFC 6238, SHA-1, 6 digits, 30s) — implemented in-house on node:crypto, zero
 * dependencies, verified against the RFC test vectors in the executed test suite.
 *
 * Contracts:
 *   • verification accepts ±1 time-step (clock skew) — nothing wider
 *   • comparisons are timing-safe
 *   • recovery codes are stored ONLY as SHA-256 hashes and each is single-use
 *   • the mfa token is a 5-minute single-purpose JWT (type:"mfa") — it proves "password already
 *     verified" and nothing else; it can never act as an access token
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));   // 160-bit, RFC-recommended
}

function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpCode(secretB32: string, atMs: number = Date.now()): string {
  return hotp(secretB32, Math.floor(atMs / 1000 / 30));
}

/** Timing-safe verify with ±1 step of clock skew. */
export function verifyTotp(secretB32: string, code: string, atMs: number = Date.now()): boolean {
  const given = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  const step = Math.floor(atMs / 1000 / 30);
  for (const s of [step, step - 1, step + 1]) {
    const expect = hotp(secretB32, s);
    if (timingSafeEqual(Buffer.from(expect), Buffer.from(given))) return true;
  }
  return false;
}

export function otpauthUrl(secretB32: string, email: string): string {
  return `otpauth://totp/Mondaily:${encodeURIComponent(email)}?secret=${secretB32}&issuer=Mondaily&algorithm=SHA1&digits=6&period=30`;
}

// ── recovery codes — 8× 10-char codes, stored hashed, single-use ────────────────
export function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 8 }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { plain, hashes: plain.map(p => createHash("sha256").update(p).digest("hex")) };
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

// ── mfa token — "password verified, second factor pending" (5 min, single purpose) ──
const MFA_TTL_SECONDS = 5 * 60;
function jwtSecret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error("AUTH_JWT_SECRET is not set");
  return s;
}

export async function signMfaToken(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, email, type: "mfa", iat: now, exp: now + MFA_TTL_SECONDS }, jwtSecret());
}

export async function verifyMfaToken(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "mfa" || typeof p.sub !== "string") return null;
    return { sub: p.sub, email: String(p.email ?? "") };
  } catch { return null; }
}

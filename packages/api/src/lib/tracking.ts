/**
 * Email open/click tracking tokens.
 *
 * The old tracking URLs exposed the raw `email_outbox` node UUID
 * (`/track/<node-id>/open.gif`) on an UNAUTHENTICATED route, letting anyone
 * enumerate UUIDs to read another workspace's email payload. We replace it with
 * a stateless, cryptographically-signed opaque token: `base64url(nodeId).hmac`.
 *
 * The HMAC is keyed by a server secret, so a token cannot be forged for an
 * arbitrary node id and cannot be enumerated. Verification recovers the node id
 * only after the signature checks out — no DB column required.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.EMAIL_TRACKING_SECRET || process.env.CRON_SECRET || process.env.CLERK_SECRET_KEY || "mondaily-dev-tracking-secret";
}

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

/** Build the opaque tracking token for an email_outbox node id. */
export function makeTrackingToken(nodeId: string): string {
  const p = b64url(nodeId);
  return `${p}.${sign(p)}`;
}

/** Verify a tracking token and return the node id, or null if tampered/invalid. */
export function verifyTrackingToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const p = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(p);
  // Constant-time compare to avoid signature-timing oracles.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") || null;
  } catch {
    return null;
  }
}

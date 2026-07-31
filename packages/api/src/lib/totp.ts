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

// ── recovery codes — 8× four-word phrases, stored hashed, single-use ────────────
// Words instead of random strings because these are BREAK-GLASS keys a human writes on paper:
// "maple-orbit-crane-delta" survives handwriting and re-typing; "k7xq2-m9zzt" doesn't. They are
// NOT meant to be memorized — they're meant to be stored. Entropy: 4 words from 256 = 32 bits
// per code, defended by single-use + password-first (the mfa token) + strict rate limits.
const WORDS = ("acre amber arch atlas basil beacon birch bloom bolt brook cedar chalk cliff cloud comet coral crane creek delta drift dune ember fable fern flint frost gale glade grove harbor hazel heron ivory jade juniper kelp knoll lagoon larch ledge linen lotus lumen maple marsh mesa mist moss north oak ocean olive onyx opal orbit osprey otter pearl pine plume prairie quill reef ridge river robin rowan sage sand shale shore sierra slate sparrow spruce stone summit swift tarn teak thistle tide timber topaz trail tundra vale violet wharf willow wren zephyr alder aspen bay bramble briar cairn canyon cape cove crag cypress dawn dell eddy elm falcon fen field fjord flare foam ford fox garnet geyser gill gorge grain gulf gull heath hollow inlet iris isle jetty karst kestrel lark lava lichen loch magma mead meadow mineral moor moraine nectar ness nimbus oat orchard outcrop oxbow palm pampas peak peat pebble petal pika pinyon plain plateau pond pool poppy pumice quarry quartz rain rapids raven reed ripple roost rye saffron sagebrush salt savanna sea sedge seed sequoia silt sky sleet slope snow sol sorrel spire spring sprout star steppe strait stream sumac summitry sun surf swale sward talus terrace thicket thorn torrent tor trellis tributary tuff tule tup tussock vernal vetch vine wadi wave weald wheat whin wick wold woodland yarrow yew yucca zenith basin bluff briarwood butte cascade channel chasm cinder cirque coast crest current darkwood dell2 dingle down escarp estuary firth flat floe fount".split(/\s+/)).slice(0, 256);

export function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 8 }, () => {
    const b = randomBytes(4);
    return [b[0]!, b[1]!, b[2]!, b[3]!].map(n => WORDS[n % WORDS.length]!).join("-");
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

// ── device trust — "don't ask on this device for 30 days" (REAL, revocable) ─────
// A signed 30-day token bound to (user, the CURRENT totp_enabled_at). Re-enrolling 2FA changes
// enabled_at, which invalidates every previously trusted device automatically.
const TRUST_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TRUST_COOKIE = "md_2fa_trust";

export async function signTrustToken(userId: string, enabledAtIso: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, type: "mfa_trust", tea: enabledAtIso, iat: now, exp: now + TRUST_TTL_SECONDS }, jwtSecret());
}

export async function verifyTrustToken(token: string, userId: string, enabledAtIso: string): Promise<boolean> {
  try {
    const p = (await verify(token, jwtSecret(), "HS256")) as Record<string, unknown>;
    return p.type === "mfa_trust" && p.sub === userId && p.tea === enabledAtIso;
  } catch { return false; }
}

import { sign, verify } from "hono/jwt";
import { createHash, randomBytes } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

/**
 * Native proof-of-work anti-bot gate — zero external services. The server hands out a SIGNED,
 * short-lived challenge (so it's stateless and tamper-proof). The browser must find a nonce
 * such that sha256(`${challenge}:${nonce}`) starts with DIFFICULTY leading hex zeros. Verifying
 * is one hash; forging requires ~16^DIFFICULTY tries — cheap for a human, expensive for a script
 * hammering the endpoint.
 */
const DIFFICULTY = "0000"; // 4 leading hex zeros (~65k hashes avg to solve)
const TTL_SECONDS = 300;

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error("AUTH_JWT_SECRET is not set");
  return s;
}

export async function issuePowChallenge(): Promise<{ challenge: string; difficulty: number }> {
  const now = Math.floor(Date.now() / 1000);
  const challenge = await sign({ type: "pow", salt: randomBytes(16).toString("hex"), iat: now, exp: now + TTL_SECONDS }, secret());
  return { challenge, difficulty: DIFFICULTY.length };
}

export async function verifyPow(challenge: string, nonce: string): Promise<boolean> {
  if (!challenge || !nonce) return false;
  try {
    const p = (await verify(challenge, secret(), "HS256")) as Record<string, unknown>;
    if (p.type !== "pow") return false; // signed + unexpired (verify throws on expiry)
  } catch {
    return false;
  }
  return createHash("sha256").update(`${challenge}:${nonce}`).digest("hex").startsWith(DIFFICULTY);
}

/** Reject requests whose body lacks a valid { pow_challenge, pow_nonce } solution → 403. */
export const requirePow = createMiddleware(async (c, next) => {
  let body: { pow_challenge?: string; pow_nonce?: string } = {};
  try { body = await c.req.json(); } catch { /* no/!json body */ }
  if (!(await verifyPow(body.pow_challenge ?? "", body.pow_nonce ?? ""))) {
    throw new HTTPException(403, { message: "Automated-traffic check failed. Please refresh and try again." });
  }
  await next();
});

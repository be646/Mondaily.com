import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../routes/auth.ts"), "utf8");

/**
 * A refresh token is rotated on every use, so presenting an already-revoked one means the same
 * token was used twice — it was copied.
 *
 * Rotation alone does not protect the victim: if the thief refreshes first, the session rotates to
 * THEM. The real user's next attempt fails and they are logged out, while the thief keeps rotating
 * indefinitely. The `replaced_by` chain was written "for audit" and never read.
 */
describe("refresh tokens detect reuse", () => {
  it("a revoked token is treated as a REPLAY, not merely as expired", () => {
    // Previously `!row || row.revoked_at || expired` collapsed all three into one 401, so a replay
    // was indistinguishable from a stale tab.
    expect(src).toMatch(/if \(row && row\.revoked_at\) \{/);
    expect(src).not.toMatch(/if \(!row \|\| row\.revoked_at \|\| new Date/);
  });

  it("a replay revokes EVERY live session for that user", () => {
    // Kills the thief's rotating session too. Both parties must re-authenticate with the password.
    expect(src).toMatch(/\.eq\("user_id", row\.user_id as string\)\.is\("revoked_at", null\)/);
  });

  it("says something true to the user", () => {
    expect(src).toMatch(/already used elsewhere/);
  });

  it("still rotates and records the chain the check reads", () => {
    expect(src).toMatch(/replaced_by: insertedId \?\? null/);
    expect(src).toMatch(/token_hash", sha256\(raw\)/);   // raw value is never stored
  });
});

describe("reuse detection does not punish normal concurrency", () => {
  it("a duplicate arriving within the grace window is a RACE, not theft", () => {
    // A single-page app fires many requests at once; when the access token expires they can all
    // 401 together and all call /refresh, so the 2nd and 3rd legitimately present a token the 1st
    // has just rotated. Nuking the family there signs honest users out mid-session — a
    // self-inflicted outage, and far likelier than the attack it guards against.
    expect(src).toMatch(/const revokedMsAgo = Date\.now\(\)/);
    expect(src).toMatch(/GRACE_MS = 30_000/);
    expect(src).toMatch(/if \(revokedMsAgo <= GRACE_MS\)/);
  });

  it("inside the window it fails WITHOUT revoking anything", () => {
    // The caller already holds the newer cookie and simply retries.
    const grace = src.match(/if \(revokedMsAgo <= GRACE_MS\) \{[\s\S]{0,200}?\}/)![0];
    expect(grace).not.toMatch(/update\(/);
    expect(grace).not.toMatch(/clearSessionCookies/);
    expect(grace).toMatch(/Retry/);
  });

  it("outside the window it still revokes the whole family", () => {
    // A stolen token surfaces later than an in-flight duplicate — that separation is the signal.
    expect(src).toMatch(/\.eq\("user_id", row\.user_id as string\)\.is\("revoked_at", null\)/);
    expect(src).toMatch(/already used elsewhere/);
  });
});


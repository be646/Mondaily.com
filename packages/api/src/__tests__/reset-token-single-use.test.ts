import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { passwordFingerprint } from "../lib/auth-tokens";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/**
 * A password-reset link must work exactly once.
 *
 * The token is a stateless JWT, so `exp` alone left it replayable for its full 30 minutes —
 * INCLUDING after the password had already been changed. Anyone still holding the link (forwarded
 * email, shared inbox, browser history, a proxy log) could reset again, which revokes the real
 * owner's sessions and issues the attacker a fresh one. Account takeover from a spent link.
 */
describe("reset links are single-use", () => {
  it("the fingerprint changes when the password hash changes", () => {
    const a = passwordFingerprint("$scrypt$oldhash");
    const b = passwordFingerprint("$scrypt$newhash");
    expect(a).not.toBe(b);
    expect(a).toBe(passwordFingerprint("$scrypt$oldhash"));   // stable for the same password
    expect(a).toHaveLength(16);
  });

  it("an empty/absent hash still yields a value, never a crash", () => {
    expect(passwordFingerprint(null)).toHaveLength(16);
    expect(passwordFingerprint(undefined)).toBe(passwordFingerprint(null));
  });

  it("the token is minted against the CURRENT password", () => {
    expect(read("routes/auth.ts")).toMatch(/signResetToken\([\s\S]{0,200}passwordFingerprint\(cred\.password_hash/);
  });

  it("reset REJECTS a token whose fingerprint no longer matches", () => {
    const src = read("routes/auth.ts");
    expect(src).toMatch(/const currentPv = passwordFingerprint\(/);
    expect(src).toMatch(/if \(currentPv !== claims\.pv\)/);
    expect(src).toMatch(/already been used/);
  });

  it("a legacy token without a fingerprint FAILS CLOSED", () => {
    // It cannot be proven unused. The cost of rejecting it is one extra "request a new link".
    expect(read("lib/auth-tokens.ts")).toMatch(/if \(typeof p\.pv !== "string" \|\| !p\.pv\) return null;/);
  });
});

import { describe, it, expect } from "vitest";
import { totpCode, verifyTotp, base32Encode, base32Decode, generateTotpSecret, generateRecoveryCodes, hashRecoveryCode, otpauthUrl } from "../lib/totp";

/** RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890"). The last 6 digits of
 *  the published 8-digit vectors are what a 6-digit TOTP produces at those exact times. */
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const VECTORS: [number, string][] = [
  [59_000, "287082"],
  [1_111_111_109_000, "081804"],
  [1_111_111_111_000, "050471"],
  [1_234_567_890_000, "005924"],
  [2_000_000_000_000, "279037"],
];

describe("TOTP — RFC 6238 conformance (executed)", () => {
  it("matches every RFC test vector", () => {
    for (const [ms, expected] of VECTORS) expect(totpCode(RFC_SECRET_B32, ms)).toBe(expected);
  });
  it("verify accepts the current step and ±1, rejects ±2", () => {
    const t = 1_111_111_111_000;
    expect(verifyTotp(RFC_SECRET_B32, "050471", t)).toBe(true);          // current
    expect(verifyTotp(RFC_SECRET_B32, "081804", t)).toBe(true);          // t-30s window (1111111109 in prev step)
    expect(verifyTotp(RFC_SECRET_B32, "287082", t)).toBe(false);         // from 1970 — far outside
    expect(verifyTotp(RFC_SECRET_B32, "000000", t)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "not-a-code", t)).toBe(false);
  });
  it("base32 round-trips and secrets are 160-bit", () => {
    const buf = Buffer.from("hello sovereign world!");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Decode(generateTotpSecret()).length).toBe(20);
  });
  it("recovery codes: 8 unique, hashes match, hash is case/space tolerant", () => {
    const { plain, hashes } = generateRecoveryCodes();
    expect(new Set(plain).size).toBe(8);
    expect(hashes).toHaveLength(8);
    expect(hashRecoveryCode(` ${plain[0]!.toUpperCase()} `)).toBe(hashes[0]);
  });
  it("otpauth url carries issuer + account and the raw secret", () => {
    const u = otpauthUrl("ABC234", "a@b.co");
    expect(u).toContain("otpauth://totp/Mondaily:");
    expect(u).toContain("secret=ABC234");
    expect(u).toContain("issuer=Mondaily");
  });
});

describe("2FA flow contracts (source-read)", () => {
  const read = () => require("node:fs").readFileSync(require("node:path").join(__dirname, "../routes/auth.ts"), "utf8");
  it("login never issues a session when 2FA is enabled; mfa token is the only bridge", () => {
    const a = read();
    expect(a).toContain("mfa_required: true");
    // 2026-07-31: the 2FA branch gained ONE bypass — a signed 30-day trust cookie, verified
    // against (user, current totp_enabled_at) so re-enrollment revokes every trusted device.
    // Anything else inside the branch must still return mfa_required, never a session.
    expect(a).toMatch(/verifyTrustToken\(trustRaw, cred\.user_id as string, enabledAtIso\)/);
    expect(a).toMatch(/return c\.json\(\{ mfa_required: true, mfa_token: await signMfaToken\(cred\.user_id/);
    expect(a).toContain("no lockout path");
  });
  it("recovery codes are single-use and returned exactly once; disable needs possession proof", () => {
    const a = read();
    expect(a).toContain("hashes.filter(x => x !== h)");
    expect(a).toContain("shown once, stored only as hashes");
    expect(a).toMatch(/2fa\/disable[\s\S]*?verifyTotp\(secret, code\)/);
  });
  it("pre-migration is honest and non-locking", () => {
    const a = read();
    expect(a).toContain("the migration hasn't been applied");
    expect(a).toContain("available: false, enabled: false");
  });
});

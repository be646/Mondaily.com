import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard: POST /auth/pow-claim must authenticate with requireJwt (session-only), NOT
// requireAuth. requireAuth demands an X-Workspace-Id header, but the sovereign-auth-context helper
// that submits the claim doesn't send one — so requireAuth rejected EVERY claim with a 400 before it
// could verify the nonce, and verified_pow (the oversight legitimacy signal) never lit up. The claim
// is inherently per-user (logged with userId + "session" context, no workspace), so session-only auth
// is correct. If this flips back to requireAuth the 400-on-every-session bug returns.
describe("POST /auth/pow-claim auth guard", () => {
  const src = readFileSync(join(__dirname, "../routes/auth.ts"), "utf8");
  it("uses requireJwt (session-only), never requireAuth", () => {
    expect(src).toMatch(/router\.post\("\/pow-claim",\s*requireJwt\b/);
    expect(src).not.toMatch(/router\.post\("\/pow-claim",\s*requireAuth\b/);
  });
  it("imports requireJwt", () => {
    expect(src).toMatch(/import \{[^}]*requireJwt[^}]*\} from "\.\.\/middleware\/auth"/);
  });
});

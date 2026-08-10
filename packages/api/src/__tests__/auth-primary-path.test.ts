import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sign-in path that converts should be the one that looks primary.
 *
 * Measured against production on 2026-08-10: of fifteen signups, the two that came through Google
 * were BOTH verified and one completed onboarding — the first real user ever to get through. All
 * thirteen that came through email-and-password verified zero times.
 *
 * The page had this backwards: Google was a plain bordered button while the credential submit
 * carried the sage primary treatment.
 */
const APP = join(__dirname, "../../../../apps/app/src");
const google = readFileSync(join(APP, "components/auth/google-auth-button.tsx"), "utf8");
const shell = readFileSync(join(APP, "components/auth/auth-shell.tsx"), "utf8");
const login = readFileSync(join(APP, "routes/auth/shadow-login.tsx"), "utf8");
const register = readFileSync(join(APP, "routes/auth/shadow-register.tsx"), "utf8");

describe("Google is the primary path", () => {
  it("the Google button carries the primary treatment", () => {
    expect(google).toMatch(/borderColor: SAGE, color: SAGE/);
  });

  it("the credential submit is secondary on BOTH forms", () => {
    for (const [name, src] of [["login", login], ["register", register]] as const) {
      expect(src, `${name} submit should be secondary`).toMatch(/<GlowButton type="submit" variant="secondary"/);
    }
  });

  it("secondary is quieter, never disabled-looking", () => {
    // Someone without a Google account must not feel pushed down a lesser path — the credential
    // form is a real, unhindered way in.
    expect(shell).toMatch(/color: "var\(--text-secondary\)"/);
    expect(shell).not.toMatch(/variant === "secondary"[\s\S]{0,120}opacity: 0\./);
  });

  it("still offers email and password, named explicitly", () => {
    // Removing the credential path would strand every user without a Google account, including
    // the four real people already registered that way.
    expect(google).toMatch(/or use email/);
    for (const src of [login, register]) expect(src).toMatch(/type="password"/);
  });
});

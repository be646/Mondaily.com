import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(__dirname, "../../../../apps/app/src/App.tsx"), "utf8");

/**
 * What a first-time visitor downloads before they can do anything.
 *
 * Guest calls, invite acceptance, workspace restore, email verification, activation, forgot/reset
 * password and onboarding shipped in the MAIN chunk, so every user downloaded pages most sessions
 * never open. Making them lazy took the entry chunk from 197KB to 181KB gzipped.
 */
describe("first-load cost", () => {
  const RARE = [
    "InviteAcceptPage", "RestoreWorkspacePage", "VerifyEmailPage",
    "ShadowActivatePage", "ShadowForgotPage", "ShadowResetPage",
    "TerminalOnboardingPage",
  ];
  // GuestCallPage and WorkspaceSelectPage look rare but are NOT: a guest clicking a call link
  // lands directly on the former (it is their first paint, and a lazy chunk delays joining a live
  // call), and the latter renders immediately after login for multi-workspace users. Both were
  // already pinned static by the calls-readiness tests — which were right, and caught me.
  const HOT = ["ShadowLoginPage", "ShadowRegisterPage", "DashboardLayout", "HomePage",
               "GuestCallPage", "WorkspaceSelectPage"];

  it("rarely-opened routes are lazy", () => {
    for (const r of RARE) {
      expect(app, `${r} should be lazy`).toMatch(new RegExp(`const ${r} = lazy\\(`));
    }
  });

  it("hot paths stay EAGER — a lazy chunk there costs a round-trip on first impression", () => {
    // Sign-in, sign-up and the dashboard are the pages a real session actually starts on.
    for (const h of HOT) {
      expect(app, `${h} must stay eager`).not.toMatch(new RegExp(`const ${h} = lazy\\(`));
    }
  });

  it("there is a Suspense boundary with a real fallback", () => {
    // A lazy route outside one throws instead of rendering.
    expect(app).toMatch(/<Suspense fallback=\{<RouteThinking \/>\}>/);
    const suspenseAt = app.indexOf("<Suspense");
    for (const r of RARE) {
      expect(app.indexOf(`<${r}`), `${r} must render inside Suspense`).toBeGreaterThan(suspenseAt);
    }
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Launch readiness for the first thing a new user ever sees.
 */
describe("onboarding checklist counts what exists", () => {
  const src = read("packages/api/src/routes/onboarding.ts");

  it("matches object types by STEM, not exact name", () => {
    // Measured in prod 2026-08-04: the workspace held 44 deals under "deals" while the checklist
    // reported deal:false, because it compared against "deal". A checklist that can never tick
    // tells a new user their work did not count.
    expect(src).toMatch(/\.ilike\("object_type", "deal%"\)/);
    expect(src).not.toMatch(/\.eq\("object_type", "deal"\)/);
    expect(src).toMatch(/object_type\.ilike\.people%/);
  });
});

describe("onboarding is driven by server state, not a browser flag", () => {
  it("the session reports whether the workspace is onboarded", () => {
    // workspaces.onboarded already existed and was already written by /onboarding/complete.
    // Nothing ever read it back.
    expect(read("packages/api/src/routes/auth.ts")).toMatch(/select\("onboarded"\)/);
    expect(read("apps/app/src/hooks/useCurrentUser.ts")).toMatch(/onboarded: boolean/);
  });

  it("routing sends an un-onboarded user to onboarding", () => {
    // Close the tab mid-onboarding, or sign in on another device, and the localStorage flag was
    // gone — landing the user on an empty dashboard, permanently un-onboarded.
    expect(read("apps/app/src/App.tsx")).toMatch(/if \(onboarded === false\) return <Navigate to="\/onboarding"/);
  });

  it("an unknown value defaults to ONBOARDED, never trapping an existing user", () => {
    // Failing open matters more than failing closed here: a bad lookup must not put established
    // users into a signup wizard.
    expect(read("packages/api/src/routes/auth.ts")).toMatch(/onboarded = \(ws as \{ onboarded\?: boolean \} \| null\)\?\.onboarded \?\? true/);
    expect(read("apps/app/src/components/auth/sovereign-auth-context.tsx")).toMatch(/onboarded: d\.onboarded \?\? true/);
  });
});

describe("a brand-new signup actually reaches onboarding", () => {
  it("registration does NOT set the localStorage flag — so the server flag is the only mechanism", () => {
    // The whole reason the server check has to exist. shadow-register registers and then calls
    // navigate(next); it never writes mondaily_needs_onboarding. The ONLY writer is the sidebar's
    // "create another workspace" action. So before the server check, a brand-new signup landed on
    // the dashboard and never onboarded at all — no trial stamped, no profile, no starter tasks,
    // and workspaces.onboarded false forever.
    const reg = read("apps/app/src/routes/auth/shadow-register.tsx");
    expect(reg).not.toMatch(/needs_onboarding/);

    const setters = read("apps/app/src/components/layout/sidebar.tsx");
    expect(setters).toMatch(/setItem\("mondaily_needs_onboarding", "1"\)/);
  });

  it("a new workspace starts un-onboarded, and only completing onboarding clears it", () => {
    const sql = read("packages/db/migrations/20260615_workspace_invites.sql");
    expect(sql).toMatch(/onboarded boolean NOT NULL DEFAULT false/);
    // Set true only by finishing the wizard or the explicit settings endpoint — never by merely
    // loading the dashboard, which would silently skip onboarding again.
    expect(read("packages/api/src/routes/onboarding.ts")).toMatch(/onboarded: true/);
    expect(read("packages/api/src/routes/app-data.ts")).toMatch(/settings\/complete-onboarding/);
  });
});


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

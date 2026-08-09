import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The status page must not assert what a probe can measure.
 *
 * Its feature table is authored by hand — reasonably, since "is this BUILT" is not something a
 * probe can answer. But three rows made a falsifiable claim: Email, Calendar and Billing were
 * hardcoded to "Needs configuration" and rendered unconditionally, so they went on saying so long
 * after Stripe, Google and native mail were configured and probing green.
 *
 * The page whose entire job is reporting truth was publishing a stale claim about itself.
 */
const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/status.tsx"), "utf8");
const server = readFileSync(join(__dirname, "../routes/status.ts"), "utf8");

describe("feature table defers to live probes", () => {
  it("consults the live check before rendering a status", () => {
    expect(page).toMatch(/const probe = f\.liveCheck \? liveByStatusId\.get\(f\.liveCheck\) : undefined/);
    expect(page).toMatch(/probe\?\.state === "operational" \? "live"/);
  });

  it("binds every falsifiable row to a probe that exists server-side", () => {
    // A liveCheck id with no matching server check is worse than none: it looks reconciled and
    // silently falls through to the authored value forever.
    const bound = [...page.matchAll(/liveCheck: "([^"]+)"/g)].map(m => m[1]!);
    expect(bound.length).toBeGreaterThan(0);
    for (const id of new Set(bound)) {
      expect(server, `status.ts has no check with id "${id}"`).toMatch(new RegExp(`id: "${id}"`));
    }
  });

  it("still lets the authored value stand where no probe can know", () => {
    // "Is this built" is not measurable; rows without a liveCheck must keep their authored status
    // rather than defaulting to something the page cannot support.
    expect(page).toMatch(/: f\.status;/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A save that quietly did not save is worse than an error.
 *
 * Measured across settings on 2026-08-05: 49 mutations, 11 with an onError, 3 reading isError. The
 * other 38 failed with no visible consequence at all — a toggle flipped, the request 500'd, and the
 * user was shown nothing, walking away believing the opposite of what was true.
 *
 * Fixing that per call site would have been 38 edits that the 39th mutation immediately escapes, so
 * the floor lives on the MutationCache. These guard the floor.
 */
const APP = join(__dirname, "../../../../apps/app/src");
const client = readFileSync(join(APP, "lib/query-client.ts"), "utf8");
const layout = readFileSync(join(APP, "routes/dashboard/layout.tsx"), "utf8");

describe("unhandled mutation failures are visible", () => {
  it("the query client raises an alert on any unhandled mutation error", () => {
    expect(client).toMatch(/mutationCache: new MutationCache\(\{/);
    expect(client).toMatch(/onError:[\s\S]{0,400}alertError\(/);
  });

  it("offers an explicit opt-out rather than inviting a bypass", () => {
    // Without a sanctioned `meta: { silent: true }`, the first background poll that legitimately
    // should not interrupt anyone gets "fixed" by deleting the handler for everybody.
    expect(client).toMatch(/mutation\.options\.meta\?\.silent/);
  });

  it("the alert surface is actually mounted", () => {
    // The app already contained a fully-built ToastHost that was never mounted anywhere — a
    // feedback surface nobody can see is the same as no feedback surface.
    expect(layout).toMatch(/<AlertHost \/>/);
    expect(layout).toMatch(/import \{ AlertHost \}/);
  });

  it("shows the server's message, not a JSON envelope", () => {
    // apiClient rejects with the raw response body, and the API answers {"error":"..."} — showing
    // that verbatim is barely better than showing nothing.
    const alerts = readFileSync(join(APP, "lib/alerts.ts"), "utf8");
    expect(alerts).toMatch(/JSON\.parse\(raw\)/);
    expect(alerts).toMatch(/parsed\.error \?\? parsed\.message \?\? raw/);
  });

  it("caps the stack so a failing loop cannot bury the page", () => {
    const alerts = readFileSync(join(APP, "lib/alerts.ts"), "utf8");
    expect(alerts).toMatch(/\.slice\(0, 3\)/);
  });
});

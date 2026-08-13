import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanFiles } from "./_scan";

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
    //
    // This used to pin the exact expression `parsed.error ?? parsed.message ?? raw`, and that
    // assertion FAILED on the fix for the production crash of 2026-08-11 — a correct change broke a
    // test that was describing syntax rather than behaviour. What matters is that the envelope is
    // unwrapped, which alerts-behaviour.test.ts now proves by running the function against the real
    // payloads. Here we only check the envelope is parsed at all.
    const alerts = readFileSync(join(APP, "lib/alerts.ts"), "utf8");
    expect(alerts).toMatch(/JSON\.parse\(raw\)/);
    expect(alerts).toMatch(/parsed\.error/);
  });

  it("caps the stack so a failing loop cannot bury the page", () => {
    const alerts = readFileSync(join(APP, "lib/alerts.ts"), "utf8");
    expect(alerts).toMatch(/\.slice\(0, 3\)/);
  });

  /**
   * No component may hand-roll the error envelope again.
   *
   * NINE places had written `JSON.parse((e as Error).message)?.error ?? "…"` and put the result
   * straight into React state. `error` is not always a string — a zod validation failure makes it an
   * OBJECT — so every one of them was the /calendar React #31 crash waiting for a different endpoint
   * to reject a body. Each looked reasonable in isolation, which is precisely how the class spread.
   *
   * `errorText(e, fallback)` from lib/alerts is the one way to do this, and it is tested against the
   * real payloads. This keeps it the only way.
   */
  it("nothing parses the error envelope by hand", () => {
    const files = scanFiles(APP, [".ts", ".tsx"], 100);   // throws if the walk collapses
    const offenders = files
      .filter(f => !f.endsWith("lib/alerts.ts"))          // the helper itself is allowed to parse
      .filter(f => /JSON\.parse\([^)]*\)[\s?.]*\.\s*error\b|\.error \?\? (msg|s\b)/.test(readFileSync(f, "utf8")))
      .map(f => f.slice(APP.length + 1));

    expect(offenders,
      `These pull .error out of a parsed body themselves. It can be a ZodError OBJECT, and rendering ` +
      `an object throws React #31 and unmounts the page. Use errorText(e, "fallback") from lib/alerts:\n` +
      offenders.join("\n"),
    ).toEqual([]);
  });
});

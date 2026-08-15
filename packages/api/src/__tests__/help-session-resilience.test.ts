import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const store = readFileSync(join(APP, "components/help/help-store.ts"), "utf8");
const panel = readFileSync(join(APP, "components/help/help-panel.tsx"), "utf8");

/**
 * REPORTED 2026-08-15 on /ask/new, and captured by the telemetry added the day before:
 * "Cannot read properties of undefined (reading 'category')". The stack put the throw inside a
 * useState INITIALIZER, and the screenshot showed the error card filling the screen with no
 * sidebar — the signature of the ROOT boundary catching it, not the page-level one.
 *
 * HelpProvider sits above the router Outlet and builds its state from localStorage in exactly such
 * an initializer. localStorage is untrusted input: it can hold a session written by any previous
 * version of the app, half-written by a tab that closed mid-save, or edited by hand.
 *
 * HONEST LIMIT: this was a single occurrence on an older bundle and I could not reproduce it, so
 * this hardens the path the evidence points at rather than confirming a root cause line by line.
 */
describe("a corrupt saved Help session cannot stop the app starting", () => {
  it("validates message ELEMENTS, not just that messages is an array", () => {
    // The old check confirmed the array and then trusted every element in it.
    expect(store).toMatch(/s\.messages\.filter\(/);
    expect(store).toMatch(/typeof \(m as HelpMsg\)\.role === "string"/);
  });

  it("drops malformed entries rather than repairing them", () => {
    // A conversation missing a turn is recoverable; an app that will not start is not.
    expect(store).toMatch(/return \{ \.\.\.s, messages \};/);
  });

  it("the provider's initializer cannot throw, whatever storage holds", () => {
    // Structural guarantee: this sits above the Outlet, so a throw here is the WHOLE app.
    expect(panel).toMatch(/try \{ return loadSession\(key\) \?\? newSession\(\); \}/);
    expect(panel).toMatch(/catch \{ return newSession\(\); \}/);
  });
});

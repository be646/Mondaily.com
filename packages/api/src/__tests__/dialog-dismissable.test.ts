import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const read = (p: string) => readFileSync(join(APP, p), "utf8");

/**
 * A dialog you cannot dismiss is a trap.
 *
 * Measured 2026-08-03: 31 of the 46 hand-rolled `fixed inset-0` dialogs never listened for Escape,
 * and 8 of those had no backdrop click either — the only way out was finding the X. Every one
 * predates <Modal>, which has always handled both.
 *
 * Converting 46 dialogs is a long job; being unable to close one is a bug today. useEscapeClose
 * closes that gap in a line so the conversions can follow without leaving users stuck meanwhile.
 */
describe("dialogs can be dismissed with Escape", () => {
  it("the shared hook exists and is wired to keydown", () => {
    const m = read("components/ui/modal.tsx");
    expect(m).toMatch(/export function useEscapeClose/);
    expect(m).toMatch(/addEventListener\("keydown"/);
  });

  it("the dialogs that trapped the user now listen for it", () => {
    // These eight had NEITHER Escape nor a click-away backdrop.
    for (const f of [
      "components/records/segment-builder.tsx",
      "components/records/dedup-panel.tsx",
      "components/graph/graph-context-drawer.tsx",
      "routes/dashboard/settings/objects.tsx",
      "routes/dashboard/reports/dashboard-view.tsx",
    ]) {
      expect(read(f), f).toMatch(/useEscapeClose\(/);
    }
  });

  it("the live-call overlay is deliberately NOT escapable", () => {
    // Escape hanging up a call in progress is a worse bug than the one being fixed. Left alone on
    // purpose, recorded here so nobody 'completes the sweep' by adding it.
    expect(read("components/calls/call-overlay.tsx")).not.toMatch(/useEscapeClose\(/);
  });
});

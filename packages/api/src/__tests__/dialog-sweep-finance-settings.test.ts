import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const read = (p: string) => readFileSync(join(APP, p), "utf8");

/**
 * Finance and settings dialogs use the one shell.
 *
 * 46 files hand-rolled their own `fixed inset-0` dialog. Each private copy drifted: different
 * padding, different header, its own Cancel/confirm pair, and 31 of them never listened for Escape.
 * The shared <Modal> has always had the hairline header, hairline footer, right-aligned actions,
 * Escape and backdrop dismissal — it was just used by one file.
 */
const CONVERTED = [
  "routes/dashboard/pipeline.tsx",
  "routes/dashboard/automations/index.tsx",
  "routes/dashboard/reports/index.tsx",
  "routes/dashboard/notes.tsx",
  "routes/dashboard/finance/quotes.tsx",
  "routes/dashboard/finance/expenses.tsx",
  "routes/dashboard/finance/credit-notes.tsx",
  "routes/dashboard/settings/account.tsx",
  "routes/dashboard/settings/workspace.tsx",
  "routes/dashboard/settings/integrations.tsx",
];

describe("converted dialogs", () => {
  it("use the shared Modal", () => {
    for (const f of CONVERTED) expect(read(f), f).toMatch(/from "@\/components\/ui\/modal"/);
  });

  it("no longer hand-roll an overlay", () => {
    for (const f of CONVERTED) {
      expect(read(f), f).not.toMatch(/fixed inset-0 z-50 (flex items-center justify-center )?bg-black\/60/);
    }
  });

  it("destructive confirms are danger-coloured, never the accent", () => {
    // A delete must never look like a save.
    for (const f of ["routes/dashboard/settings/account.tsx", "routes/dashboard/settings/workspace.tsx"]) {
      expect(read(f), f).toMatch(/#d1524a/);
    }
  });

  it("the support panel is left alone — it is a drawer, not a dialog", () => {
    // Modal is explicitly not for push-aside surfaces. Recorded so nobody 'finishes the sweep'.
    expect(read("routes/dashboard/settings/support.tsx")).toMatch(/<aside/);
    expect(read("routes/dashboard/settings/support.tsx")).not.toMatch(/from "@\/components\/ui\/modal"/);
  });
});

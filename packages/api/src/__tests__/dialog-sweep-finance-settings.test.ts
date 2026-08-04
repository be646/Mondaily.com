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
  "routes/dashboard/home.tsx",
  "routes/dashboard/messages.tsx",
  "routes/dashboard/reports/sales-report.tsx",
  "routes/dashboard/objects/[objectType]/index.tsx",
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

  it("no longer hand-roll a CENTRED dialog overlay", () => {
    // Scoped deliberately: several of these files still contain right-side DRAWERS and
    // dropdown backdrops, which are different surfaces and must not be converted.
    for (const f of CONVERTED) {
      expect(read(f), f).not.toMatch(/fixed inset-0 z-50 (flex items-center justify-center )?bg-black\/60/);
    }
  });

  it("drawers and dropdown backdrops are NOT swept into Modal", () => {
    // Recorded so a future pass does not "finish the job" by converting a push-aside panel.
    expect(read("routes/dashboard/discovery.tsx")).toMatch(/fixed right-0 top-0/);
    expect(read("routes/dashboard/objects/[objectType]/index.tsx")).toMatch(/fixed right-0 top-0/);
    expect(read("routes/dashboard/reports/sales-report.tsx")).toMatch(/border-l/);
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

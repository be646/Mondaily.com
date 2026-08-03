import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sheet = readFileSync(
  join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");

/**
 * A bulk field set asks before it replaces data.
 *
 * Measured 2026-08-03: all 44 deals read country "Albania". They once held Algeria, Guinea and
 * others, and every one changed inside the same sub-second burst on 2026-08-02 — a bulk "Set field"
 * on the whole selection. One click on the first country in an alphabetical list replaced 44 real
 * values. Nothing asked, and nothing could undo it.
 *
 * The session had already added a confirm before deleting ONE row; overwriting a column on 44 rows
 * is strictly more destructive and had none.
 */
describe("bulk set field", () => {
  it("routes through a confirmation instead of writing on click", () => {
    expect(sheet).toMatch(/onClick=\{\(\) => requestBulkSetField\(setFieldCol, v\)\}/);
    expect(sheet).toMatch(/function requestBulkSetField/);
  });

  it("counts what would be REPLACED, not merely what is selected", () => {
    // Filling blanks is cheap; replacing existing values is not. The dialog leads with the number
    // that can actually lose data.
    expect(sheet).toMatch(/const overwrites = rows\.filter/);
    expect(sheet).toMatch(/String\(cur\) !== value/);
  });

  it("skips the dialog when nothing would be lost", () => {
    // A confirm on a harmless action trains people to click through the dangerous one.
    expect(sheet).toMatch(/if \(overwrites === 0\) \{ void bulkSetField\(col, value\); return; \}/);
  });

  it("the confirm is destructive-coloured and states it cannot be undone", () => {
    expect(sheet).toMatch(/cannot be undone/);
    expect(sheet).toMatch(/#d1524a/);
  });
});

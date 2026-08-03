import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const outcomes = () => read("packages/api/src/lib/outcomes.ts");
const nodes = () => read("packages/api/src/routes/nodes.ts");
const close = () => read("packages/api/src/lib/period-close.ts");
const ui = () => read("apps/app/src/routes/dashboard/team-oversight.tsx");

/**
 * REPORTED 2026-08-03: Team Oversights showed legacy monthly sales instead of resetting.
 * MEASURED: the window was already correct (Aug 1 → Aug 3) and STOCK carried over correctly, but
 * value_won read 1,422,500 while the Brief read 0 for the SAME month and the SAME 9 deals — two
 * surfaces disagreeing about "value won this month", which is precisely what a shared money model
 * exists to prevent. Cause: the fallback removed from wonDate() had been re-implemented inline at
 * the call site.
 */
describe("no caller re-implements the updated_at fallback for WINS", () => {
  it("the outcomes engine dates a win from won_at alone", () => {
    const src = outcomes();
    expect(src).not.toMatch(/moneyWonDate\(row as never\) \|\| String\(row\.updated_at/);
    expect(src).toMatch(/if \(isWonRow && !when\) \{ undatedWins \+= 1; continue; \}/);
  });

  it("the close worker does too — it had the same bug", () => {
    // Snapshots filed before this counted the undated wins into whichever month their rows were
    // last touched. They are immutable by design; /periods/drift reports the disagreement.
    expect(close()).toMatch(/if \(!within\(String\(d\.won_at \?\? ""\) \|\| null\)\) continue;/);
    expect(close()).not.toMatch(/String\(d\.won_at \?\? ""\) \|\| \(row as \{ updated_at/);
  });

  it("a sweep finds no surviving win-date fallback anywhere", () => {
    for (const f of ["packages/api/src/lib/outcomes.ts", "packages/api/src/lib/money.ts",
                     "packages/api/src/lib/period-close.ts", "packages/api/src/routes/activities.ts"]) {
      expect(read(f), f).not.toMatch(/won_at[^\n]{0,40}\?\?[^\n]{0,20}updated_at/);
    }
  });
});

describe("lost deals are not silently zeroed to be consistent", () => {
  it("keeps dating lost by updated_at, because no lost date has ever existed", () => {
    // Zeroing them for symmetry would delete real reporting with no way to recover it.
    const src = outcomes();
    expect(src).toMatch(/const lostAt = String\(d\.lost_at \?\? ""\) \|\| null;/);
    expect(src).toMatch(/if \(!isWonRow && !lostAt\) undatedLost \+= 1;/);
  });

  it("stamps lost_at going forward, so the approximation heals", () => {
    const src = nodes();
    expect(src).toMatch(/if \(\/lost\/i\.test\(after\) && !\/lost\/i\.test\(before\) && !nextData\.lost_at\)/);
    // And survives a wholesale data replace, like won_at does.
    expect(src).toMatch(/if \(prevData\.lost_at && !nextData\.lost_at\) nextData\.lost_at = prevData\.lost_at;/);
  });

  it("discloses both gaps rather than hiding either", () => {
    expect(outcomes()).toMatch(/undated_wins: undatedWins, undated_lost: undatedLost/);
  });
});

describe("the UI names its window and admits what it left out", () => {
  it("names the period concretely — 'August 2026', not 'this month'", () => {
    // On the 3rd a tile reading 0.00 is correct and looks broken; naming the period tells a reader
    // the number is new rather than missing.
    const src = ui();
    expect(src).toMatch(/function windowName\(period: Period, range: \{ start: Date \}\): string/);
    expect(src).toMatch(/case "month":   return d\.toLocaleDateString\("en-GB", \{ month: "long", year: "numeric" \}\)/);
    expect(src).toMatch(/Sales · \{win\}/);
  });

  it("the won tile discloses wins with no close date", () => {
    expect(ui()).toMatch(/without a close date/);
  });

  it("STOCK tiles keep their as-of labelling and are NOT windowed", () => {
    const src = ui();
    expect(src).toMatch(/label="Open pipeline"[\s\S]{0,200}as of today/);
  });
});

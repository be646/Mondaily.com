import { describe, it, expect } from "vitest";
import { compareWindows } from "@mondaily/shared/baseline";

/** Baseline engine — REAL executed tests. The one shared "vs last period" comparator. */
describe("compareWindows — the honest-delta contract", () => {
  it("both zero → none (a dash, never 0%)", () => {
    expect(compareWindows(0, 0)).toMatchObject({ kind: "none", label: "", direction: 0 });
  });
  it("no baseline → new (never a % against nothing)", () => {
    expect(compareWindows(7, 0)).toMatchObject({ kind: "new", label: "new", direction: 1, pct: null });
  });
  it("tiny baseline → raw counts, not a wild percentage", () => {
    expect(compareWindows(12, 3)).toMatchObject({ kind: "raw", label: "12 vs 3", pct: null });
    expect(compareWindows(1, 4)).toMatchObject({ kind: "raw", label: "1 vs 4", direction: -1 });
  });
  it("adequate baseline → rounded pct; display capped as >maxPct", () => {
    expect(compareWindows(126, 22)).toMatchObject({ kind: "pct", pct: 473, label: "473%", direction: 1 });
    expect(compareWindows(15, 20)).toMatchObject({ kind: "pct", pct: -25, label: "25%", direction: -1 });
    expect(compareWindows(60000, 5)).toMatchObject({ kind: "pct", label: ">999%" });
  });
  it("flat → empty label, direction 0", () => {
    expect(compareWindows(9, 9)).toMatchObject({ kind: "flat", label: "", direction: 0 });
  });
  it("the raw comparison ALWAYS travels in detail", () => {
    for (const [a, b] of [[0, 0], [7, 0], [12, 3], [126, 22], [9, 9]] as const) {
      expect(compareWindows(a, b).detail).toBe(`${a} this period vs ${b} previous`);
    }
  });
  it("minBase is tunable (money callers can pass a higher floor)", () => {
    expect(compareWindows(300, 40, { minBase: 100 }).kind).toBe("raw");
    expect(compareWindows(300, 150, { minBase: 100 }).kind).toBe("pct");
  });
});

describe("business-outcomes engine (source-read guards)", () => {
  it("outcomes endpoint: admin-gated, currency-converted with honest unconverted counts, engine deltas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    const r = a.slice(a.indexOf('router.get("/outcomes"'));
    expect(r).toContain("requireAuth, requireAdminRole");
    expect(r).toContain("makeBaseConverter(ws)");
    expect(r).toMatch(/unconverted/);                          // disclosed, not silently face-valued
    expect(r).toMatch(/compareWindows\(Math\.round\(teamNow\.won\)/);
    // pipeline is a balance as-of-now, never a windowed flow
    expect(r).toContain("a BALANCE (as of now), not a windowed flow");
  });
  it("Team Oversight windows are calendar-anchored (no rolling 30d) and Sales strip mounts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const t = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/team-oversight.tsx"), "utf8");
    expect(t).not.toContain("PERIOD_TO_DAYS");
    expect(t).toMatch(/function calendarDays/);
    expect(t).toMatch(/<SalesStrip period=\{period\} \/>/);
    expect(t).toMatch(/useOutcomes\(period\)/);
  });
});

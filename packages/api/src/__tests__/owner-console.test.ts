import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stalledDeals } from "../routes/owner";
import type { NodeRow } from "../lib/money";

const owner = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
const NOW = Date.parse("2026-07-30T00:00:00Z");
const deal = (o: Partial<NodeRow>): NodeRow => ({ id: o.id ?? "d", data: o.data ?? {}, created_at: o.created_at ?? "2026-01-01T00:00:00Z", updated_at: o.updated_at ?? "2026-01-01T00:00:00Z" });

/** The Owner Console: one payload, money definitions borrowed — never re-derived. */
describe("stalled deals — the money going cold", () => {
  it("counts only OPEN deals untouched for 30+ days", () => {
    const rows = [
      deal({ data: { stage: "Negotiation", deal_value: 100, name: "Cold" }, updated_at: "2026-05-01T00:00:00Z" }),
      deal({ data: { stage: "Negotiation", deal_value: 50, name: "Warm" }, updated_at: "2026-07-25T00:00:00Z" }),
      deal({ data: { stage: "Closed Won", deal_value: 999, name: "Done" }, updated_at: "2026-01-01T00:00:00Z" }),   // closed ≠ stalled
      deal({ data: { stage: "Closed Lost", deal_value: 999 }, updated_at: "2026-01-01T00:00:00Z" }),
    ];
    const s = stalledDeals(rows, NOW);
    expect(s.count).toBe(1);
    expect(s.value).toBe(100);
    expect(s.top[0]).toMatchObject({ name: "Cold", days_stale: 90 });
  });

  it("ranks the top list by value, capped", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      deal({ id: `d${i}`, data: { stage: "Lead", deal_value: i * 10, name: `D${i}` }, updated_at: "2026-01-01T00:00:00Z" }));
    const s = stalledDeals(rows, NOW);
    expect(s.top).toHaveLength(6);
    expect(s.top[0].name).toBe("D9");   // highest value first
  });
});

describe("the console borrows the money model, gated, bounded", () => {
  it("is admin/owner only", () => {
    expect(owner).toMatch(/router\.get\("\/console", requireAdminRole/);
  });
  it("imports every money number from lib/money — none re-derived", () => {
    for (const fn of ["closedWonIn", "pipelineCreatedIn", "openPipeline", "weightedForecast", "closersIn", "invoiceMetrics"]) {
      expect(owner).toContain(fn);
    }
    expect(owner).toMatch(/from "\.\.\/lib\/money"/);
  });
  it("reads nodes only through pagedNodes", () => {
    expect(owner).toMatch(/pagedNodes\(ws, \{ eq: "invoice" \}\)/);
    expect(owner).toMatch(/pagedNodes\(ws, \{ ilike: "%deal%" \}\)/);
    expect(owner).not.toMatch(/from\("nodes"\)/);
  });
  it("surfaces the circuit breaker's live state", () => {
    expect(owner).toMatch(/AUTONOMY_HOURLY_CAP/);
    expect(owner).toMatch(/autonomyUsageLastHour/);
  });
});

describe("the console page reads fields that exist", () => {
  it("reads the readiness payload's `group` key — singular, as the API returns it", () => {
    const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");
    const api = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");
    expect(api).toMatch(/^    group,$/m);                       // what the API actually sends
    expect(page).toMatch(/readiness\.data\?\.group \?\? \{\}/); // what the page reads
    expect(page).not.toMatch(/readiness\.data\?\.groups/);      // the typo that hid the System section
  });
});

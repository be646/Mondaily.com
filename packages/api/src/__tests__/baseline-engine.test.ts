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
    // Re-pointed same-day: the engine moved into lib/outcomes.ts (shared by route + brief).
    const r = a.slice(a.indexOf('router.get("/outcomes"'));
    expect(r).toContain("requireAuth, requireAdminRole");
    const lib = readFileSync(join(__dirname, "../lib/outcomes.ts"), "utf8");
    expect(lib).toContain("makeBaseConverter(ws)");
    expect(lib).toMatch(/unconverted/);                        // disclosed, not silently face-valued
    expect(lib).toMatch(/compareWindows\(Math\.round\(teamNow\.won\)/);
    // pipeline is a balance as-of-now, never a windowed flow
    expect(lib).toContain("a BALANCE (as of now), not a windowed flow");
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

describe("executive brief — autonomous, safe, honest (source-read guards)", () => {
  it("cron is fail-closed on CRON_SECRET; job resolves recipients server-side and skips quiet workspaces", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const appTs = readFileSync(join(__dirname, "../app.ts"), "utf8");
    const cron = appTs.slice(appTs.indexOf('app.get("/api/cron/executive-brief"'));
    expect(cron).toContain("Cron disabled — CRON_SECRET is not configured.");
    const job = readFileSync(join(__dirname, "../jobs/executive-brief.ts"), "utf8");
    expect(job).toMatch(/\.in\("role", \["owner", "admin"\]\)/);   // recipients from DB roles only
    expect(job).toContain("computeOutcomes(ws, monthStart, monthEnd, prevStart, prevEnd)");
    expect(job).toMatch(/groundingViolations\(candidate, digest\)\.length === 0/);
    expect(job).toContain("skipped++");                            // honest skip for quiet workspaces
    expect(job).toContain("could not be currency-converted and are excluded");
    const vj = readFileSync(join(__dirname, "../../vercel.json"), "utf8");
    expect(vj).toContain('"/api/cron/executive-brief", "schedule": "0 7 1 * *"');
  });
  it("the outcomes route delegates to lib/outcomes (one engine for route, brief, report)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    const r = a.slice(a.indexOf('router.get("/outcomes"'), a.indexOf('router.get("/outcomes"') + 900);
    expect(r).toContain("computeOutcomes(ws, start, end, prevStart, prevEnd)");
  });
});

describe("Secret Brain — shadow-mode contract (source-read guards)", () => {
  it("the job is READ-ONLY over workspace data: writes touch ONLY brain tables", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const job = readFileSync(join(__dirname, "../jobs/secret-brain.ts"), "utf8");
    // every insert/update targets brain_runs or intelligence_signals — nothing else
    const writes = [...job.matchAll(/\.from\("([^"]+)"\)\s*\.\s*(insert|update|upsert|delete)/g)].map(m => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    for (const t of writes) expect(["brain_runs", "intelligence_signals"]).toContain(t);
    // no AI in the detection path, no mail, no decisions
    expect(job).not.toMatch(/aiGateway/);
    expect(job).not.toMatch(/sendTransactionalEmail/);
    expect(job).not.toMatch(/decision_queue"\)\s*\.\s*(insert|update)/);
    // honest disable when the migration isn't applied
    expect(job).toContain('return { enabled: false');
    // proof-of-work recorded
    expect(job).toMatch(/rows_scanned/);
  });
  it("signals carry evidence ids; the read endpoint is admin-only and honest about states", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const job = readFileSync(join(__dirname, "../jobs/secret-brain.ts"), "utf8");
    for (const ev of ["node_id", "task_ids", "decision_ids"]) expect(job).toContain(ev);
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    const r = a.slice(a.indexOf('router.get("/brain"'));
    expect(r).toContain("requireAuth, requireAdminRole");
    expect(r).toContain('reason: "migration_not_applied"');
  });
  it("the shadow panel hides rather than fakes, and the migration constrains mode to shadow", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ui = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/activity.tsx"), "utf8");
    expect(ui).toContain("if (!q.data?.enabled) return null;");
    expect(ui).toContain("found nothing to flag");
    const mig = readFileSync(join(__dirname, "../../../db/migrations/20260731_secret_brain.sql"), "utf8");
    expect(mig).toContain("check (mode in ('shadow'))");
  });
});

describe("loss-reason capture + lost-deal analysis", () => {
  it("stage→lost transitions pause for ONE modal; reason lands in the SAME patch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const APP = join(__dirname, "../../../../apps/app/src");
    const rt = readFileSync(join(APP, "components/records/record-table.tsx"), "utf8");
    expect(rt).toMatch(/isLostStage\(newVal\) && !record\.data\.loss_reason/);
    expect(rt).toMatch(/\.\.\.\(extra \?\? \{\}\)/);          // same-patch read-merge-write
    const bv = readFileSync(join(APP, "components/records/board-view.tsx"), "utf8");
    expect(bv).toMatch(/isLostStage\(newStage\) && !rec\.data\.loss_reason/);
    const lm = readFileSync(join(APP, "components/records/loss-reason.tsx"), "utf8");
    expect(lm).toContain("Skip");                             // skipping is allowed, honestly
  });
  it("the engine groups lost deals by reason with an honest 'no reason recorded' bucket", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const lib = readFileSync(join(__dirname, "../lib/outcomes.ts"), "utf8");
    expect(lib).toContain('"no reason recorded"');
    expect(lib).toMatch(/lost_reasons/);
  });
});

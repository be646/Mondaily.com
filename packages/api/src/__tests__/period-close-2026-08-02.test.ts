import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotHash, sha256, workspacePeriodConfig, METRICS_VERSION, PERIOD_TYPES } from "../lib/period-close";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lib = () => read("packages/api/src/lib/period-close.ts");
const routes = () => read("packages/api/src/routes/periods.ts");
const sql = () => read("packages/db/migrations/20260802_period_snapshots.sql");
const app = () => read("packages/api/src/app.ts");

const base = {
  workspace_id: "ws_1", period_type: "MONTHLY" as const, period_key: "2026-M07",
  period_start: "2026-07-01T00:00:00.000Z", period_end: "2026-08-01T00:00:00.000Z",
  metrics: {
    revenue_collected: 100, expenses_approved: 10, credits_issued: 0, net_margin: 90,
    deals_won_count: 2, tasks_completed: 5, outstanding_at_close: 40, base_currency: "USD",
  },
  inputs: {
    invoices_scanned: 3, expenses_scanned: 1, credit_notes_scanned: 0, deals_scanned: 4,
    tasks_scanned: 6, source_digest: "abc", metrics_version: 1, unconverted: 0,
  },
  prev_hash: null as string | null,
};

/**
 * A snapshot is EVIDENCE of what was reported, not the source of truth for it. These tests are
 * about the properties that make the evidence worth anything.
 */
describe("the hash is evidence, not decoration", () => {
  it("is stable for the same content regardless of key order", () => {
    const reordered = { ...base, metrics: Object.fromEntries(Object.entries(base.metrics).reverse()) as typeof base.metrics };
    expect(snapshotHash(reordered)).toBe(snapshotHash(base));
  });

  it("changes when ANY metric changes", () => {
    const tampered = { ...base, metrics: { ...base.metrics, revenue_collected: 100.01 } };
    expect(snapshotHash(tampered)).not.toBe(snapshotHash(base));
  });

  it("changes when the SPAN changes, so a period cannot be relabelled", () => {
    expect(snapshotHash({ ...base, period_end: "2026-08-02T00:00:00.000Z" })).not.toBe(snapshotHash(base));
  });

  it("covers the inputs, so the same totals from different rows are not identical", () => {
    expect(snapshotHash({ ...base, inputs: { ...base.inputs, source_digest: "xyz" } })).not.toBe(snapshotHash(base));
  });

  it("CHAINS: changing a predecessor changes every successor", () => {
    // A per-row hash alone lets a row be rewritten together with its own hash and look untouched.
    const a = snapshotHash({ ...base, prev_hash: sha256("first") });
    const b = snapshotHash({ ...base, prev_hash: sha256("tampered") });
    expect(a).not.toBe(b);
  });

  it("the chain is actually verified, not merely stored", () => {
    const src = lib();
    expect(src).toMatch(/export async function verifyChain/);
    expect(src).toMatch(/content does not match its hash/);
    expect(src).toMatch(/chain link does not match the previous snapshot/);
    expect(routes()).toMatch(/router\.get\("\/verify"/);
  });
});

describe("the close is calendar-driven and idempotent", () => {
  it("asks the calendar which periods ENDED, never 'what happened since I last ran'", () => {
    // Crons are skipped by deploys and fire twice on retries; a cursor makes both of those wrong.
    const src = lib();
    expect(src).toMatch(/elapsedPeriods\(since, now, type, cfg\)/);
    // Reading a stored cursor, not the word — the comments name it to explain why it is absent.
    expect(src).not.toMatch(/last_run|lastRun|\.from\("cron_state"\)/);
  });

  it("treats a unique violation as SUCCESS — a concurrent run won the race", () => {
    expect(lib()).toMatch(/if \(String\(error\.code\) === "23505"\) return \{ \.\.\.base, status: "already_closed" \}/);
  });

  it("bounds the backfill, so a new workspace is not asked to close every week since 1970", () => {
    expect(lib()).toMatch(/lookbackDays \?\? 400/);
  });

  it("has NO active-period pointer to advance", () => {
    // The calendar is the only authority. A pointer is a second one, and they disagree after a
    // missed run — at which point every number moves for a reason nobody can see.
    const src = lib() + routes();
    expect(src).not.toMatch(/active_period|period_id\b|setActivePeriod/);
    expect(routes()).toMatch(/There is deliberately no stored "active period"/);
  });
});

describe("nothing is destroyed to make a period 'reset'", () => {
  it("the migration grants INSERT and SELECT only — no update, no delete", () => {
    const src = sql();
    expect(src).toMatch(/grant select, insert on period_snapshots to service_role;/);
    expect(src).not.toMatch(/grant[^;]*update[^;]*on period_snapshots/);
  });

  it("a trigger refuses UPDATE and DELETE even for the service role", () => {
    expect(sql()).toMatch(/before update or delete on period_snapshots/);
    expect(sql()).toMatch(/append-only/);
  });

  it("no DELETE or DROP of historical records anywhere in the engine", () => {
    const src = lib() + routes();
    expect(src).not.toMatch(/\.delete\(\)/);
    expect(src).not.toMatch(/drop table|truncate/i);
  });

  it("one close per period per workspace, enforced by the database", () => {
    expect(sql()).toMatch(/unique \(workspace_id, period_type, period_key\)/);
  });
});

describe("FLOW and STOCK are not treated the same", () => {
  it("revenue counts on the date the money moved, not the date the document was made", () => {
    expect(lib()).toMatch(/isCollected\(status\) && within\(moneyEventDate/);
  });

  it("outstanding is recorded with NO window — a balance, not a flow", () => {
    const src = lib();
    expect(src).toMatch(/if \(isOutstanding\(status\)\) outstanding \+= valueOf\(d\)/);
    expect(src).toMatch(/an unpaid invoice does not stop being unpaid/);
  });

  it("values rows from their FROZEN base amount, and discloses what it could not", () => {
    const src = lib();
    expect(src).toMatch(/m\.modelled && m\.base_amount != null/);
    expect(src).toMatch(/unconverted \+= 1/);
  });
});

describe("derived metrics carry their definition", () => {
  it("stores a metrics_version, so a changed formula does not silently invalidate history", () => {
    expect(METRICS_VERSION).toBeGreaterThanOrEqual(1);
    expect(lib()).toMatch(/metrics_version: METRICS_VERSION/);
  });

  it("drift separates 'the inputs moved' from 'we changed the maths'", () => {
    expect(lib()).toMatch(/version_changed: Number\(inputs\.metrics_version \?\? 0\) !== METRICS_VERSION/);
  });

  it("compares money in minor units, so a float re-sum does not cry wolf", () => {
    expect(lib()).toMatch(/Math\.round\(filedValue \* 100\) !== Math\.round\(liveValue \* 100\)/);
  });
});

describe("the cron runs hourly on purpose", () => {
  it("is scheduled hourly, not monthly at UTC midnight", () => {
    // A single monthly UTC trigger closes a Warsaw month two hours early and an Auckland month
    // twelve hours late. Hourly + calendar lets every workspace close on its own midnight.
    expect(read("packages/api/vercel.json")).toMatch(/"path": "\/api\/cron\/period-close", "schedule": "5 \* \* \* \*"/);
  });

  it("fails closed without CRON_SECRET, like every other cron here", () => {
    const src = app();
    const route = src.slice(src.indexOf('app.get("/api/cron/period-close"'));
    expect(route).toMatch(/Cron disabled — CRON_SECRET is not configured/);
    expect(route).toMatch(/Unauthorized/);
  });

  it("one workspace failing does not stop the others closing", () => {
    const src = app();
    const route = src.slice(src.indexOf('app.get("/api/cron/period-close"'));
    expect(route).toMatch(/try \{[\s\S]{0,600}\} catch \(e\) \{/);
  });
});

describe("the manual close is a preview first", () => {
  it("is owner/admin only and dry-run by default", () => {
    const src = routes();
    expect(src).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(src).toMatch(/role !== "owner" && role !== "admin"/);
  });

  it("a dry run writes nothing and says so", () => {
    const src = routes();
    const dry = src.slice(src.indexOf("if (dry_run) {"), src.indexOf("const results = await closeDuePeriods"));
    expect(dry).not.toMatch(/\.insert\(|closeDuePeriods/);
    expect(src).toMatch(/Nothing was written\. Closing does not delete or reset anything/);
  });

  it("previews the period that ENDED, which is what a close writes", () => {
    expect(routes()).toMatch(/const prev = previousPeriod\(now, t, cfg\)/);
  });
});

describe("all four period types are supported", () => {
  it("weekly, monthly, quarterly and yearly", () => {
    expect(PERIOD_TYPES).toEqual(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]);
  });
});

describe("a backdated payment books revenue in the month the money arrived", () => {
  it("stamps paid_at from the closing PAYMENT, not from now()", () => {
    // Found live while verifying the close: a payment recorded as 2026-07-15 marked the invoice
    // paid today, so its revenue landed in August. Period accounting cannot be correct if the
    // event date is the data-entry date.
    const src = read("packages/api/src/routes/invoices.ts");
    expect(src).not.toMatch(/if \(body\.status === "paid" && !current\.paid_at\) statusUpdates\.paid_at = new Date/);
    expect(src).toMatch(/statusUpdates\.paid_at = updatedPayments/);
    expect(src).toMatch(/\.sort\(\)\s*\n?\s*\.pop\(\)/);
  });

  it("falls back to now() only when no payment carries a usable date", () => {
    expect(read("packages/api/src/routes/invoices.ts"))
      .toMatch(/\.pop\(\) \?\? new Date\(\)\.toISOString\(\)/);
  });

  it("the PATCH can carry a real payment date, so backdating is possible at all", () => {
    // Until now the field was not in the schema, so zod stripped it and a backdated payment was
    // silently impossible — the reason my first live probe appeared to show no drift.
    const src = read("packages/api/src/routes/invoices.ts");
    expect(src).toMatch(/paid_at: z\.string\(\)\.datetime\(\)\.optional\(\)/);
    expect(src).toMatch(/statusUpdates\.paid_at = body\.paid_at \?\? new Date\(\)\.toISOString\(\)/);
  });
});

describe("the timezone is read from where it actually lives", () => {
  it("prefers the workspaces.timezone COLUMN over settings.timezone", () => {
    // Found while checking the Settings picker: the picker writes to the column, and app-data
    // treats settings.timezone as a legacy fallback. Reading settings alone made the entire
    // timezone story inert — a workspace could pick Europe/Warsaw and every boundary would still
    // be computed in UTC. Invisible, too, because UTC is a plausible answer.
    expect(workspacePeriodConfig({ timezone: "Europe/Warsaw", settings: { timezone: "UTC" } }).timeZone)
      .toBe("Europe/Warsaw");
  });

  it("falls back to settings when the column is empty", () => {
    expect(workspacePeriodConfig({ timezone: null, settings: { timezone: "America/New_York" } }).timeZone)
      .toBe("America/New_York");
    expect(workspacePeriodConfig({ timezone: "   ", settings: { timezone: "America/New_York" } }).timeZone)
      .toBe("America/New_York");
  });

  it("still keeps week_start, which only exists in settings", () => {
    expect(workspacePeriodConfig({ timezone: "Europe/Warsaw", settings: { week_start: 1 } }).weekStart).toBe(1);
  });

  it("survives a missing row entirely", () => {
    expect(workspacePeriodConfig(null).timeZone).toBe("UTC");
    expect(workspacePeriodConfig(undefined).timeZone).toBe("UTC");
  });

  it("every caller selects the column, not settings alone", () => {
    expect(routes()).toMatch(/\.select\("settings, timezone"\)/);
    const cron = app().slice(app().indexOf('app.get("/api/cron/period-close"'));
    expect(cron).toMatch(/\.select\("id, settings, timezone"\)/);
  });
});

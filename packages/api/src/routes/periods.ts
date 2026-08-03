import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import {
  periodKey, periodBounds, previousPeriod, getPeriodBounds,
  type PeriodType, type Timeframe,
} from "@mondaily/shared/period";
import { closeDuePeriods, computeMetrics, driftFor, verifyChain, workspacePeriodConfig, PERIOD_TYPES, METRICS_VERSION } from "../lib/period-close";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

const TYPE = z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]);
const TIMEFRAME = z.enum(["TODAY", "WEEK", "MONTH", "QUARTER", "YEAR", "ALL_TIME"]);

async function configFor(workspaceId: string) {
  // Both, because the timezone lives in the COLUMN and the Settings picker writes there.
  const { data } = await supabase.from("workspaces").select("settings, timezone").eq("id", workspaceId).maybeSingle();
  return workspacePeriodConfig(data as { timezone?: unknown; settings?: unknown } | null);
}

/**
 * GET /periods/current — what period is it, according to the calendar.
 *
 * There is deliberately no stored "active period" to read. The calendar is the only authority: a
 * pointer is a second one, and after a missed cron or a replay the two disagree, at which point
 * every number in the product moves for a reason nobody can see.
 */
router.get("/current", async (c) => {
  const ws = c.get("workspaceId");
  const cfg = await configFor(ws);
  const now = new Date();
  const periods = Object.fromEntries(PERIOD_TYPES.map(t => {
    const b = periodBounds(now, t, cfg);
    const prev = previousPeriod(now, t, cfg);
    return [t, {
      key: periodKey(now, t, cfg),
      start: b.start.toISOString(), end: b.end.toISOString(),
      previous_key: periodKey(prev.start, t, cfg),
    }];
  }));
  return c.json({ now: now.toISOString(), time_zone: cfg.timeZone, week_start: cfg.weekStart, periods });
});

/**
 * GET /periods/bounds?timeframe=MONTH — the window a report should apply.
 *
 * Exposed so the browser stops deriving windows from its own clock and locale. A user in a
 * different timezone from their workspace was, until now, filtering by THEIR midnight.
 */
router.get("/bounds", zValidator("query", z.object({ timeframe: TIMEFRAME })), async (c) => {
  const cfg = await configFor(c.get("workspaceId"));
  const timeframe = c.req.valid("query").timeframe;
  const now = new Date();
  const b = getPeriodBounds(timeframe, now, cfg);

  // The comparison window comes from the SAME authority as the current one. Resolving "this month"
  // on the server and "last month" in the browser would compare a workspace-timezone window
  // against a browser-timezone one, and every delta would be quietly wrong by the offset.
  const PREV_TYPE: Partial<Record<Timeframe, PeriodType>> = {
    WEEK: "WEEKLY", MONTH: "MONTHLY", QUARTER: "QUARTERLY", YEAR: "YEARLY",
  };
  let previous: { start: string; end: string } | null = null;
  const type = PREV_TYPE[timeframe];
  if (type) {
    const p = previousPeriod(now, type, cfg);
    previous = { start: p.start.toISOString(), end: p.end.toISOString() };
  } else if (timeframe === "TODAY") {
    const today = getPeriodBounds("TODAY", now, cfg)!;
    const y = getPeriodBounds("TODAY", new Date(today.start.getTime() - 1000), cfg)!;
    previous = { start: y.start.toISOString(), end: y.end.toISOString() };
  }

  return c.json({
    timeframe,
    time_zone: cfg.timeZone,
    week_start: cfg.weekStart,
    // null means NO FILTER, which is different from a filter that happens to match everything.
    bounds: b ? { start: b.start.toISOString(), end: b.end.toISOString() } : null,
    previous,
  });
});

/** GET /periods/snapshots — closed periods on file, newest first. */
router.get("/snapshots", zValidator("query", z.object({
  period_type: TYPE.optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
})), async (c) => {
  const { period_type, limit } = c.req.valid("query");
  let q = supabase.from("period_snapshots")
    .select("snapshot_id, period_type, period_key, period_start, period_end, metrics, inputs, closed_at, closed_by, hash, prev_hash")
    .eq("workspace_id", c.get("workspaceId"))
    .order("period_end", { ascending: false }).limit(limit);
  if (period_type) q = q.eq("period_type", period_type);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ snapshots: data ?? [], metrics_version: METRICS_VERSION });
});

/**
 * GET /periods/drift — does a recomputation still agree with what was filed?
 *
 * This is the read-side answer to "why not just serve the snapshot for history". The live ledger
 * stays authoritative; where it disagrees with the snapshot we SAY SO. A drift is not automatically
 * an error — a backdated invoice is a legitimate correction — but a number that silently changed
 * after being reported is exactly what a person needs told.
 */
router.get("/drift", zValidator("query", z.object({ period_type: TYPE, period_key: z.string().max(32) })), async (c) => {
  const { period_type, period_key } = c.req.valid("query");
  const d = await driftFor(c.get("workspaceId"), period_type, period_key);
  if (!d) return c.json({ error: "No snapshot on file for that period." }, 404);
  return c.json(d);
});

/** GET /periods/verify — recompute the hash chain; proves nothing was rewritten after close. */
router.get("/verify", zValidator("query", z.object({ period_type: TYPE })), async (c) => {
  return c.json(await verifyChain(c.get("workspaceId"), c.req.valid("query").period_type));
});

/**
 * POST /periods/close — run the close on demand.
 *
 * Owner-gated and DRY-RUN BY DEFAULT. A dry run computes exactly what would be written and returns
 * it without writing, so "simulate a rollover" means see the numbers first, not mutate history and
 * hope. Because the close is idempotent, the wet run is safe to repeat — but it still has to be
 * asked for explicitly.
 */
router.post("/close", zValidator("json", z.object({
  period_type: TYPE.optional(),
  dry_run: z.boolean().default(true),
})), async (c) => {
  const role = c.get("role") || "member";
  if (role !== "owner" && role !== "admin") return c.json({ error: "Owner/admin only." }, 403);
  const ws = c.get("workspaceId");
  const { period_type, dry_run } = c.req.valid("json");
  const cfg = await configFor(ws);
  const now = new Date();
  const types = period_type ? [period_type as PeriodType] : PERIOD_TYPES;

  if (dry_run) {
    // Show the CLOSED period — the one that just ended — since that is what a close writes.
    const preview = [];
    for (const t of types) {
      const prev = previousPeriod(now, t, cfg);
      const key = periodKey(prev.start, t, cfg);
      const { data: existing } = await supabase.from("period_snapshots").select("snapshot_id")
        .eq("workspace_id", ws).eq("period_type", t).eq("period_key", key).maybeSingle();
      const { metrics, inputs } = await computeMetrics(ws, prev);
      preview.push({
        period_type: t, period_key: key,
        period_start: prev.start.toISOString(), period_end: prev.end.toISOString(),
        already_closed: !!existing, metrics, inputs,
      });
    }
    return c.json({
      dry_run: true, time_zone: cfg.timeZone, preview,
      note: "Nothing was written. Closing does not delete or reset anything — it files a snapshot of what the period held.",
    });
  }

  const { data: wsRow } = await supabase.from("workspaces").select("settings, timezone").eq("id", ws).maybeSingle();
  const results = await closeDuePeriods(ws, wsRow as { timezone?: unknown; settings?: unknown } | null, now, { types, closedBy: "manual" });
  return c.json({ dry_run: false, results });
});

export { router as periodsRouter };

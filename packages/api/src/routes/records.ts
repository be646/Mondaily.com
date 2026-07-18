import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { loadRates, userDisplayCurrency, workspaceBaseCurrency } from "../lib/currency-store";
import { aggregateGrouped, aggregateRows, aggregateTop, applyFilters, type AggRow, type MoneyCtx } from "../lib/aggregate";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

// Hard cap for the in-memory numeric/grouped path. Beyond this we return `truncated: true` rather
// than silently pretending the total covers every row. `count` (no group-by) uses a cheap SQL count
// and is never truncated.
const CAP = 10_000;

// A safe key regex — used for object_type, group_by, and every filter column. No dynamic SQL is ever
// built from these (filters + grouping run in-memory over already-fetched rows), but we still bound
// the shape so nothing weird reaches the query builder.
const KEY = /^[a-z0-9_.-]+$/i;

const aggInput = z.object({
  object_type: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, "invalid object_type"),
  column: z.string().min(1).max(120),
  op: z.enum(["count", "sum", "avg", "min", "max", "filled", "checked", "top"]),
  // "none" | "date" (time bucket) | keyword alias | any validated column key.
  group_by: z.string().max(120).regex(KEY, "invalid group_by").default("none"),
  // Ranked-rows count for op:"top" — bounded so a caller can't ask for the whole table.
  limit: z.number().int().min(1).max(50).default(10),
  // Time-bucket granularity for group_by:"date" only (ignored otherwise). Default month (back-compat).
  bucket: z.enum(["hour", "day", "week", "month", "quarter", "year"]).default("month"),
  // Equality filters (AND-combined) — the safe subset the record table's quickFilters use. Applied
  // in-memory; a column that doesn't exist simply matches nothing (honest empty, never an error).
  filters: z.array(z.object({ column: z.string().min(1).max(120).regex(KEY), value: z.string().max(200) })).max(8).optional(),
  // Frontend passes this when the column is a currency type (it already resolves the type). We never
  // re-infer money-ness from the data — only convert when the caller says it's a money column.
  currency: z.boolean().default(false),
  // Optional date-range filter on a ROOT timestamp column (never an arbitrary data key), applied in
  // SQL via .gte/.lte BEFORE the cap so the fetched window is correct + truncation stays honest. The
  // field is an enum (no dynamic column from user input); from/to are inclusive UTC ISO instants.
  date_filter: z.object({
    field: z.enum(["created_at", "updated_at"]),
    from: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid from date").optional(),
    to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid to date").optional(),
  }).refine((d) => d.from != null || d.to != null, "date_filter needs from or to").optional(),
});

/**
 * POST /records/aggregate — generic, workspace-scoped aggregation over a single record column.
 * One source of truth: it reads the SAME `nodes` rows the record table and reports read. It is
 * deliberately GENERIC — it never computes finance concepts (paid/outstanding); those stay in the
 * finance domain routes. Currency sums convert to the caller's display currency and fail closed.
 */
router.post("/aggregate", zValidator("json", aggInput), async (c) => {
  const ws = c.get("workspaceId");
  const { object_type, column, op, group_by, currency, filters, date_filter, limit, bucket } = c.req.valid("json");
  const hasFilters = !!filters?.length;

  // Narrow a nodes query by the date_filter (root timestamp column, fixed name, parameterized value —
  // no dynamic SQL). Applied BEFORE the cap so the fetched window is the correct date-scoped set.
  const withDate = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q): Q => {
    if (!date_filter) return q;
    let out = q;
    if (date_filter.from) out = out.gte(date_filter.field, date_filter.from);
    if (date_filter.to) out = out.lte(date_filter.field, date_filter.to);
    return out;
  };

  // Cheap path: a plain unfiltered count never fetches rows (a date_filter stays a cheap SQL count).
  if (op === "count" && group_by === "none" && !hasFilters) {
    const { count, error } = await withDate(supabase
      .from("nodes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("object_type", object_type));
    if (error) return c.json({ error: error.message }, 400);
    return c.json({
      op, column, group_by, object_type,
      value: count ?? 0, total_rows: count ?? 0, truncated: false, unconverted: 0, currency: null,
    });
  }

  // Everything else needs the rows. Date-filter in SQL, then cap the fetch; flag truncation honestly.
  const { data, error } = await withDate(supabase
    .from("nodes")
    .select("id,data,created_at,updated_at")
    .eq("workspace_id", ws)
    .eq("object_type", object_type))
    .order("created_at", { ascending: true })
    .limit(CAP + 1);
  if (error) return c.json({ error: error.message }, 400);

  const all = (data ?? []) as AggRow[];
  const truncated = all.length > CAP;
  // Equality filters (the record table's quickFilters) applied in-memory — no dynamic SQL.
  const rows = applyFilters(truncated ? all.slice(0, CAP) : all, filters);

  // Money context — only when the caller flags the column as currency. Target is the user's display
  // currency (fallback: workspace base). Reuses the shared, fail-closed currency helpers only.
  let money: MoneyCtx | undefined;
  let currencyCode: string | null = null;
  const numericOp = op === "sum" || op === "avg" || op === "min" || op === "max";
  if (currency && (numericOp || op === "top")) {
    const [target, base, { rates }] = await Promise.all([
      userDisplayCurrency(ws, c.get("userId")),
      workspaceBaseCurrency(ws),
      loadRates(),
    ]);
    money = { target, base, rates };
    currencyCode = target;
  }

  // Ranked top-N rows by a numeric/currency column. Sort runs in-memory over the already
  // workspace/date/filter-scoped, capped rows — never an ORDER BY on a JSON data key. When truncated
  // the caller must present this as "ranked within the first N rows", not a global ranking.
  if (op === "top") {
    const t = aggregateTop(rows, column, limit, money);
    return c.json({ op, column, group_by, object_type, rows: t.rows, total_rows: rows.length, truncated, unconverted: t.unconverted, currency: currencyCode });
  }

  if (group_by !== "none") {
    // Bucket a date group on the SAME timestamp the caller filtered on (else updated_at-filtered rows
    // would be grouped by created_at). Defaults to created_at when there's no date_filter.
    const dateField = date_filter?.field ?? "created_at";
    const groups = aggregateGrouped(rows, op, column, group_by, money, bucket, dateField);
    const unconverted = groups.reduce((s, g) => s + g.unconverted, 0);
    return c.json({ op, column, group_by, object_type, groups, total_rows: rows.length, truncated, unconverted, currency: currencyCode });
  }

  const r = aggregateRows(rows, op, column, money);
  return c.json({
    op, column, group_by, object_type,
    value: r.value, total_rows: r.count, truncated, unconverted: r.unconverted, currency: currencyCode,
  });
});

export const recordsRouter = router;

import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { loadRates, userDisplayCurrency, workspaceBaseCurrency } from "../lib/currency-store";
import { aggregateGrouped, aggregateRows, type AggRow, type MoneyCtx } from "../lib/aggregate";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

// Hard cap for the in-memory numeric/grouped path. Beyond this we return `truncated: true` rather
// than silently pretending the total covers every row. `count` (no group-by) uses a cheap SQL count
// and is never truncated.
const CAP = 10_000;

const aggInput = z.object({
  object_type: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, "invalid object_type"),
  column: z.string().min(1).max(120),
  op: z.enum(["count", "sum", "avg", "min", "max", "filled", "checked"]),
  group_by: z.enum(["none", "status", "stage", "owner", "date"]).default("none"),
  // Frontend passes this when the column is a currency type (it already resolves the type). We never
  // re-infer money-ness from the data — only convert when the caller says it's a money column.
  currency: z.boolean().default(false),
});

/**
 * POST /records/aggregate — generic, workspace-scoped aggregation over a single record column.
 * One source of truth: it reads the SAME `nodes` rows the record table and reports read. It is
 * deliberately GENERIC — it never computes finance concepts (paid/outstanding); those stay in the
 * finance domain routes. Currency sums convert to the caller's display currency and fail closed.
 */
router.post("/aggregate", zValidator("json", aggInput), async (c) => {
  const ws = c.get("workspaceId");
  const { object_type, column, op, group_by, currency } = c.req.valid("json");

  // Cheap path: a plain count with no grouping never fetches rows.
  if (op === "count" && group_by === "none") {
    const { count, error } = await supabase
      .from("nodes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("object_type", object_type);
    if (error) return c.json({ error: error.message }, 400);
    return c.json({
      op, column, group_by, object_type,
      value: count ?? 0, total_rows: count ?? 0, truncated: false, unconverted: 0, currency: null,
    });
  }

  // Everything else needs the rows. Cap the fetch; flag truncation honestly.
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,created_at")
    .eq("workspace_id", ws)
    .eq("object_type", object_type)
    .order("created_at", { ascending: true })
    .limit(CAP + 1);
  if (error) return c.json({ error: error.message }, 400);

  const all = (data ?? []) as AggRow[];
  const truncated = all.length > CAP;
  const rows = truncated ? all.slice(0, CAP) : all;

  // Money context — only when the caller flags the column as currency. Target is the user's display
  // currency (fallback: workspace base). Reuses the shared, fail-closed currency helpers only.
  let money: MoneyCtx | undefined;
  let currencyCode: string | null = null;
  const numericOp = op === "sum" || op === "avg" || op === "min" || op === "max";
  if (currency && numericOp) {
    const [target, base, { rates }] = await Promise.all([
      userDisplayCurrency(ws, c.get("userId")),
      workspaceBaseCurrency(ws),
      loadRates(),
    ]);
    money = { target, base, rates };
    currencyCode = target;
  }

  if (group_by !== "none") {
    const groups = aggregateGrouped(rows, op, column, group_by, money);
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

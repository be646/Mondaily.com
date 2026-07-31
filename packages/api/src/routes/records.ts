import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { aiGateway } from "../lib/ai-gateway";
import { evaluateFormula, formulaFields } from "@mondaily/shared/formula";
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

/**
 * Sheet display-column config — WORKSPACE-SHARED custom columns for a records sheet.
 * Storage is schema-free (a nodes row, object_type="sheet_config"), the house pattern for
 * config-shaped data. Previously custom columns lived in per-browser localStorage, so two
 * members saw different sheets; this makes the sheet ONE shared object.
 * GET returns { columns } (empty when unset). PUT replaces the column list (read-merge-write
 * on the nodes row; caps keep a hostile payload bounded).
 */
router.get("/sheet-config/:objectType", async (c) => {
  const ws = c.get("workspaceId");
  const objectType = c.req.param("objectType");
  const { data } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws)
    .eq("object_type", "sheet_config").eq("data->>sheet", objectType).limit(1).maybeSingle();
  return c.json({ columns: (data?.data as { columns?: unknown[] } | null)?.columns ?? [], exists: !!data });
});

router.post("/sheet-config/:objectType", async (c) => {
  const ws = c.get("workspaceId");
  const userId = c.get("userId");
  const objectType = c.req.param("objectType");
  const body = await c.req.json<{ columns?: { key: string; type: string; meta?: Record<string, string> }[] }>().catch(() => ({} as never));
  const columns = Array.isArray(body.columns) ? body.columns.slice(0, 100).map(col => ({
    key: String(col.key).slice(0, 120), type: String(col.type).slice(0, 60),
    ...(col.meta ? { meta: Object.fromEntries(Object.entries(col.meta).slice(0, 10).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 2000)])) } : {}),
  })) : [];
  const { data: existing } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws)
    .eq("object_type", "sheet_config").eq("data->>sheet", objectType).limit(1).maybeSingle();
  if (existing) {
    // read-merge-write: replace ONLY the columns key, keep the rest of data intact
    const merged = { ...(existing.data as Record<string, unknown>), columns };
    const { error } = await supabase.from("nodes").update({ data: merged }).eq("id", existing.id).eq("workspace_id", ws);
    if (error) return c.json({ error: "Could not save sheet columns." }, 500);
  } else {
    const { error } = await supabase.from("nodes").insert({ workspace_id: ws, vertical: "shared", object_type: "sheet_config", created_by: userId, data: { sheet: objectType, columns } });
    if (error) return c.json({ error: "Could not save sheet columns." }, 500);
  }
  return c.json({ ok: true, columns });
});

/**
 * POST /records/formula-builder — describe a computed column in words, get a formula WITH PROOF.
 * The AI proposes only the expression; everything that matters is verified in code:
 *   • the formula is parsed + executed by the shared safe evaluator against REAL sample rows
 *   • referenced fields are checked against the sheet's actual columns (unknown → warning)
 *   • the client shows the preview and the user APPROVES before anything is saved
 * Nothing is saved here — this endpoint proposes and proves, it never mutates.
 */
router.post("/formula-builder", async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json<{ object_type?: string; description?: string }>().catch(() => ({} as never));
  const objectType = String(body.object_type ?? "").trim();
  const description = String(body.description ?? "").trim().slice(0, 500);
  if (!objectType || !description) return c.json({ error: "object_type and description required" }, 400);

  // Real sample rows — both the field inventory and the proof come from actual data.
  const { data: rows } = await supabase.from("nodes").select("data").eq("workspace_id", ws)
    .eq("object_type", objectType).order("updated_at", { ascending: false }).limit(5);
  const samples = (rows ?? []).map(r => (r.data ?? {}) as Record<string, unknown>);
  const fieldSet = new Set<string>();
  for (const sm of samples) for (const k of Object.keys(sm)) fieldSet.add(k);
  const fields = [...fieldSet].slice(0, 60);

  const system = `You translate a plain-language request into ONE formula for a records sheet. Reply with ONLY the formula — no prose, no backticks.
Grammar: field references as {field_name}; operators + - * / % & (concat) = != > < >= <=; AND OR NOT; functions IF(cond,a,b), ROUND(x,digits), ABS(x), MIN(...), MAX(...), SUM(...), DAYS(a,b), TODAY(), CONCAT(...), LEN(x).
Use ONLY fields from the provided list. If the request cannot be expressed in this grammar, reply exactly: IMPOSSIBLE`;
  const prompt = `Available fields: ${fields.join(", ") || "(none yet)"}\nRequest: ${description}`;

  let formula = "";
  try {
    const { text } = await aiGateway({ system, prompt, maxTokens: 120, workspaceId: ws, userId: c.get("userId"), feature: "formula_builder" });
    formula = (text ?? "").trim().replace(/^`+|`+$/g, "").split("\n")[0]!.trim();
  } catch { return c.json({ error: "AI is unavailable right now — you can still write the formula by hand." }, 503); }
  if (!formula || formula.toUpperCase() === "IMPOSSIBLE") {
    return c.json({ ok: false, reason: "not_expressible", detail: "That can't be expressed in the formula grammar — try describing a per-row calculation over this sheet's fields." });
  }

  // ── PROOF: execute against the real samples; check field references ──
  const known = new Set(fields.map(f => f.toLowerCase().replace(/\s+/g, "_")));
  const unknown = formulaFields(formula).filter(f => !known.has(f.toLowerCase().replace(/\s+/g, "_")));
  const preview = samples.slice(0, 3).map((sm): { name: string; value?: unknown; error?: string } => {
    const res = evaluateFormula(formula, sm);
    const name = String(sm.name ?? sm.title ?? "—").slice(0, 60);
    if (res.ok) return { name, value: res.value };
    // cast: Vercel's build resolves the shared union without literal discrimination
    return { name, error: (res as unknown as { error: string }).error };
  });
  const allFailed = preview.length > 0 && preview.every(pv => "error" in pv);
  const warnings = [
    ...(unknown.length ? [`References field(s) not present on sample rows: ${unknown.join(", ")}`] : []),
    ...(allFailed ? ["The formula errored on every sample row — review before adding."] : []),
    ...(preview.length === 0 ? ["No records yet to preview against — the formula parsed but is unproven."] : []),
  ];
  return c.json({ ok: true, formula, fields_used: formulaFields(formula), preview, warnings });
});

export const recordsRouter = router;

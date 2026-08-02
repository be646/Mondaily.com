import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { aiGateway } from "../lib/ai-gateway";
import { evaluateFormula, formulaFields } from "@mondaily/shared/formula";
import { loadRates, userDisplayCurrency, workspaceBaseCurrency } from "../lib/currency-store";
import { aggregateGrouped, aggregateRows, aggregateTop, applyFilters, type AggRow, type MoneyCtx } from "../lib/aggregate";
import { listNodes as ubcListNodes } from "@mondaily/db/ubc";

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
  // The record table reads its group column VERBATIM — alias folding (stage→deal_stage etc.)
  // attached its subtotals to groups the client considers different rows.
  group_exact: z.boolean().optional().default(false),
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
  const { object_type, column, op, group_by, group_exact, currency, filters, date_filter, limit, bucket } = c.req.valid("json");
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
    const groups = aggregateGrouped(rows, op, column, group_by, money, bucket, dateField, group_exact);
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
 * POST /records/schema-unify — the supervised data pass behind schema single-source (2026-08-01).
 * Owner/admin only, dry_run by default. Two operations, both MEASURED live before this was built:
 *
 *  1. CASE-normalize categorical columns: values equal ignoring case merge to the most common
 *     casing ("negotiation" → "Negotiation"). STRICTLY case-only — two values that differ in more
 *     than casing are never touched (the measured lesson: similar names are usually
 *     distinct populations).
 *  2. Owner unification: on NON-task types, assigned_to MOVES to owner when owner is empty, and
 *     is dropped when identical to owner. CONFLICTS (both set, different values — 47 measured on
 *     people) are NEVER auto-resolved; they are counted and reported for human review.
 */
router.post("/schema-unify", denyViewerWrites, zValidator("json", z.object({
  dry_run: z.boolean().default(true),
})), async (c) => {
  const ws = c.get("workspaceId");
  const role = c.get("role") || "member";
  if (role !== "owner" && role !== "admin") return c.json({ error: "Owner/admin only." }, 403);
  const { dry_run } = c.req.valid("json");

  const CAT = /stage|status|priority|country|region|label|^category$|^type$/;
  const report: Record<string, { caseMerges: Record<string, Record<string, string>>; ownerMoved: number; ownerDeduped: number; ownerConflicts: number; updated: number }> = {};

  const { data: typeRows } = await supabase.rpc("object_type_counts", { ws });
  const types = ((typeRows ?? []) as { object_type: string }[]).map(r => r.object_type)
    .filter(t => !/task/.test(t) && t !== "sheet_config" && t !== "support_ticket");

  for (const t of types) {
    const { data } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws).eq("object_type", t).limit(2000);
    const rows = (data ?? []) as { id: string; data: Record<string, unknown> }[];
    if (!rows.length) continue;

    // 1) canonical casing per categorical column: most common variant wins
    const canonical: Record<string, Record<string, string>> = {};
    const catCols = [...new Set(rows.flatMap(r => Object.keys(r.data)))].filter(k => CAT.test(k.toLowerCase()));
    for (const col of catCols) {
      const variants = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const v = String(r.data[col] ?? "").trim();
        if (!v || v.length > 30) continue;
        const inner = variants.get(v.toLowerCase()) ?? new Map<string, number>();
        inner.set(v, (inner.get(v) ?? 0) + 1); variants.set(v.toLowerCase(), inner);
      }
      for (const [, inner] of variants) {
        if (inner.size < 2) continue;
        // Title Case wins when present (the app's display standard) — pure frequency preferred
        // lowercase "negotiation" over "Negotiation" just because more rows carried it.
        const cands = [...inner.entries()].sort((a, b) => b[1] - a[1]);
        const titled = cands.find(([v]) => /^[A-Z]/.test(v) && v === v.replace(/\b\w/g, ch => ch.toUpperCase()));
        const winner = (titled ?? cands[0]!)[0];
        for (const [variant] of inner) {
          if (variant !== winner) (canonical[col] = canonical[col] ?? {})[variant] = winner;
        }
      }
    }

    let ownerMoved = 0, ownerDeduped = 0, ownerConflicts = 0, updated = 0;
    for (const r of rows) {
      const next = { ...r.data };
      let changed = false;
      for (const [col, map] of Object.entries(canonical)) {
        const v = String(next[col] ?? "").trim();
        if (v && map[v]) { next[col] = map[v]; changed = true; }
      }
      const owner = String(next.owner ?? "").trim();
      const assigned = String(next.assigned_to ?? "").trim();
      if (assigned && !owner) { next.owner = assigned; delete next.assigned_to; ownerMoved++; changed = true; }
      else if (assigned && owner && assigned === owner) { delete next.assigned_to; ownerDeduped++; changed = true; }
      else if (assigned && owner && assigned !== owner) { ownerConflicts++; }   // NEVER auto-resolved
      if (changed) {
        updated++;
        if (!dry_run) {
          const { error } = await supabase.from("nodes").update({ data: next }).eq("id", r.id).eq("workspace_id", ws);
          if (error) return c.json({ error: `Update failed on ${t}/${r.id}: ${error.message}`, partial_report: report }, 500);
        }
      }
    }
    if (updated || ownerConflicts || Object.keys(canonical).length) {
      report[t] = { caseMerges: canonical, ownerMoved, ownerDeduped, ownerConflicts, updated };
    }
  }
  return c.json({ dry_run, report });
});

/**
 * GET /records/export/:objectType — SERVER-side CSV of every matching record (same q/filters/sort
 * params as GET /nodes), so an export is the whole filtered set — the client button used to
 * serialize only the loaded page and silently stop at its edge.
 *
 * Enforces the role export permission from Security settings (access_controls.<role>.export);
 * the toggle existed in the UI but nothing checked it on this path. Default matches the UI:
 * owner/admin may export, member/viewer may not.
 */
router.get("/export/:objectType", async (c) => {
  const ws = c.get("workspaceId");
  const role = c.get("role") || "member";
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const controls = ((wsRow?.settings as Record<string, unknown> | null)?.access_controls ?? null) as Record<string, { export?: boolean }> | null;
  const mayExport = controls ? Boolean(controls[role]?.export) : role === "owner" || role === "admin";
  if (!mayExport) return c.json({ error: "Your role does not have CSV export permission — ask a workspace admin." }, 403);

  const objectType = c.req.param("objectType");
  const q = c.req.query("q") || undefined;
  let filters: import("@mondaily/db/ubc").NodeFilter[] | undefined;
  try { const raw = c.req.query("filters"); filters = raw ? JSON.parse(raw).slice(0, 20) : undefined; } catch { filters = undefined; }
  const sortCol = c.req.query("sort_col") || undefined;
  const sortDir = c.req.query("sort_dir") === "desc" ? "desc" as const : "asc" as const;

  // Page through the whole filtered set (bounded), never just the first page.
  const EXPORT_CAP = 20_000;
  const rows: { id: string; data: Record<string, unknown>; updated_at?: string }[] = [];
  for (let offset = 0; offset < EXPORT_CAP; offset += 1000) {
    const page = await ubcListNodes(ws, { object_type: objectType, q, filters, sort_col: sortCol, sort_dir: sortDir, limit: 1000, offset });
    rows.push(...(page as typeof rows));
    if (page.length < 1000) break;
  }
  const truncated = rows.length >= EXPORT_CAP;

  const cols = [...new Set(rows.flatMap(r => Object.keys(r.data)))].filter(k => {
    // structured (object-valued) fields don't belong in a CSV cell
    return !rows.some(r => r.data[k] && typeof r.data[k] === "object");
  }).slice(0, 60);
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [
    [...cols, "updated_at"].map(esc).join(","),
    ...rows.map(r => [...cols.map(k => esc(r.data[k])), esc(r.updated_at ?? "")].join(",")),
    ...(truncated ? [`# TRUNCATED: first ${EXPORT_CAP} rows only`] : []),
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${objectType}-${rows.length}-rows.csv"`);
  return c.body(lines.join("\n"));
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

router.post("/sheet-config/:objectType", denyViewerWrites, async (c) => {
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
 * Saved views — WORKSPACE-SHARED, stored on the same sheet_config row (read-merge-write, only
 * the `views` key is replaced). Previously views lived in per-browser localStorage: invisible to
 * teammates and absent on a new device. Same house pattern as columns above.
 */
router.get("/sheet-views/:objectType", async (c) => {
  const ws = c.get("workspaceId");
  const objectType = c.req.param("objectType");
  const { data } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws)
    .eq("object_type", "sheet_config").eq("data->>sheet", objectType).limit(1).maybeSingle();
  return c.json({ views: (data?.data as { views?: unknown[] } | null)?.views ?? [] });
});

router.post("/sheet-views/:objectType", denyViewerWrites, async (c) => {
  const ws = c.get("workspaceId");
  const userId = c.get("userId");
  const objectType = c.req.param("objectType");
  const body = await c.req.json<{ views?: unknown[] }>().catch(() => ({} as never));
  // Bounded, shape-checked: each view is a small config object, never free-form.
  const views = (Array.isArray(body.views) ? body.views : []).slice(0, 30).map((v) => {
    const view = (v ?? {}) as Record<string, unknown>;
    return {
      id: String(view.id ?? "").slice(0, 60),
      name: String(view.name ?? "").slice(0, 60),
      filters: (Array.isArray(view.filters) ? view.filters : []).slice(0, 20),
      sortRules: (Array.isArray(view.sortRules) ? view.sortRules : []).slice(0, 5),
      hiddenCols: (Array.isArray(view.hiddenCols) ? view.hiddenCols : []).slice(0, 100).map(String),
      groupBy: view.groupBy == null ? null : String(view.groupBy).slice(0, 120),
    };
  }).filter(v => v.id && v.name);
  const { data: existing } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws)
    .eq("object_type", "sheet_config").eq("data->>sheet", objectType).limit(1).maybeSingle();
  if (existing) {
    const merged = { ...(existing.data as Record<string, unknown>), views };
    const { error } = await supabase.from("nodes").update({ data: merged }).eq("id", existing.id).eq("workspace_id", ws);
    if (error) return c.json({ error: "Could not save views." }, 500);
  } else {
    const { error } = await supabase.from("nodes").insert({ workspace_id: ws, vertical: "shared", object_type: "sheet_config", created_by: userId, data: { sheet: objectType, views } });
    if (error) return c.json({ error: "Could not save views." }, 500);
  }
  return c.json({ ok: true, views });
});

/**
 * POST /records/formula-builder — describe a computed column in words, get a formula WITH PROOF.
 * The AI proposes only the expression; everything that matters is verified in code:
 *   • the formula is parsed + executed by the shared safe evaluator against REAL sample rows
 *   • referenced fields are checked against the sheet's actual columns (unknown → warning)
 *   • the client shows the preview and the user APPROVES before anything is saved
 * Nothing is saved here — this endpoint proposes and proves, it never mutates.
 */
router.post("/formula-builder", denyViewerWrites, async (c) => {
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

/**
 * Schema reconciliation — the prerequisite for making object_definitions the column spine.
 *
 * MEASURED LIVE FIRST (2026-08-02), and the measurement changed the plan. The schema does not
 * describe the data today, so inverting the column source straight away would have deleted columns
 * from real sheets:
 *   • `name` is absent from the schema of deals / companies / people, which instead define
 *     "Deal Name" / "Company Name". Every record stores `name`. The primary column of 350+ records
 *     would have gone blank.
 *   • people: 5 schema attributes vs 31 live data keys. companies: 6 vs 24.
 *   • doctor-training-records and tax-cost-entries have 13 of 14 attributes with NO data at all —
 *     those sheets hold scraped web leads, not what their schema claims.
 *
 * So the schema is reconciled to reality FIRST, under human review, and only then can it be
 * authoritative. Read-only audit here; the write path adopts an EXPLICIT list and never drops
 * anything on its own (same shape as /schema-unify: owner-gated, nothing inferred silently).
 */
const SCHEMA_KEY = (n: string) => String(n).toLowerCase().trim().replace(/\s+/g, "_");

/**
 * Type inference from real values — mirrors the sheet's inferColKind so a sheet keeps its look.
 *
 * The KEY NAME decides the semantic types (stage/status/owner/country). Those are not shapes a
 * value scan can see: a stage column is just short strings, indistinguishable from any other
 * option set. Recording them properly is what eventually lets the schema say which attribute IS
 * the stage and which IS the owner, instead of every surface re-deriving it from a regex over
 * column names.
 */
function inferAttrType(values: unknown[], key = ""): string {
  const k = key.toLowerCase();
  if (/country/.test(k)) return "country";
  if (/^(owner|deal_owner|owner_id|account_owner)$/.test(k)) return "owner";
  if (/^(assigned_to|assignee)$/.test(k)) return "assignee";
  if (/stage/.test(k)) return "stage";
  if (/status/.test(k)) return "status";

  const vals = values.filter(v => v != null && String(v).trim() !== "").slice(0, 200);
  if (!vals.length) return "text";
  const all = (re: RegExp) => vals.every(v => re.test(String(v).trim()));
  if (vals.every(v => typeof v === "boolean")) return "checkbox";
  if (all(/^\S+@\S+\.\S+$/)) return "email";
  if (all(/^https?:\/\//i)) return "url";
  if (all(/^[+\d][\d\s()+-]{5,}$/)) return "phone";
  if (all(/^\d{4}-\d{2}-\d{2}([T ]|$)/)) return "date";
  if (vals.every(v => typeof v === "number" || /^-?[\d.,\s]+%?$/.test(String(v).trim()))) {
    return all(/%\s*$/) ? "percentage" : "number";
  }
  // Few distinct short values across many records = an option set, not free text.
  const distinct = new Set(vals.map(v => String(v).trim().toLowerCase()));
  if (distinct.size <= 12 && vals.length >= 8 && [...distinct].every(d => d.length <= 32)) return "select";
  return "text";
}

router.get("/schema-audit/:objectType", async (c) => {
  const ws = c.get("workspaceId");
  const objectType = c.req.param("objectType");
  const { data: def } = await supabase.from("object_definitions")
    .select("id, slug, attributes").eq("workspace_id", ws).eq("slug", objectType).maybeSingle();
  const { data: recs } = await supabase.from("nodes")
    .select("data").eq("workspace_id", ws).eq("object_type", objectType).limit(500);

  const rows = (recs ?? []) as { data: Record<string, unknown> }[];
  const attrs = (Array.isArray(def?.attributes) ? def!.attributes : []) as { id?: string; name: string; type?: string }[];
  const schemaKeys = new Map(attrs.map(a => [SCHEMA_KEY(a.name), a]));

  // Count only NON-EMPTY occurrences: a key present on every row but always blank is not evidence
  // of a real field, and adopting it would add a permanently empty column.
  const counts = new Map<string, unknown[]>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (v == null || String(v).trim() === "") continue;
      (counts.get(k) ?? counts.set(k, []).get(k)!).push(v);
    }
  }
  const unmapped = [...counts.entries()]
    .filter(([k]) => !schemaKeys.has(k))
    .map(([k, vals]) => ({
      key: k, filled: vals.length,
      coverage: rows.length ? Math.round((vals.length / rows.length) * 100) : 0,
      suggested_type: inferAttrType(vals, k),
      samples: [...new Set(vals.map(v => String(v).slice(0, 40)))].slice(0, 3),
    }))
    .sort((a, b) => b.filled - a.filled);
  const dead = attrs
    .filter(a => !counts.has(SCHEMA_KEY(a.name)))
    .map(a => ({ id: a.id, name: a.name, key: SCHEMA_KEY(a.name), type: a.type ?? "text" }));

  return c.json({
    object_type: objectType,
    has_definition: !!def,
    records_sampled: rows.length,
    matched: attrs.length - dead.length,
    attributes: attrs.length,
    unmapped,
    dead,
  });
});

router.post("/schema-adopt/:objectType", denyViewerWrites, zValidator("json", z.object({
  keys: z.array(z.object({ key: z.string().max(120), type: z.string().max(40) })).max(60),
  dry_run: z.boolean().default(true),
})), async (c) => {
  const ws = c.get("workspaceId");
  const role = c.get("role") || "member";
  if (role !== "owner" && role !== "admin") return c.json({ error: "Owner/admin only." }, 403);
  const objectType = c.req.param("objectType");
  const { keys, dry_run } = c.req.valid("json");

  const { data: def } = await supabase.from("object_definitions")
    .select("id, attributes").eq("workspace_id", ws).eq("slug", objectType).maybeSingle();
  if (!def) return c.json({ error: `No object definition for "${objectType}".` }, 404);

  const attrs = (Array.isArray(def.attributes) ? def.attributes : []) as { id?: string; name: string; type?: string }[];
  const have = new Set(attrs.map(a => SCHEMA_KEY(a.name)));
  const valid = new Set(ATTR_TYPES_FOR_ADOPT);
  // Adopt under the DATA KEY as the name, so SCHEMA_KEY(name) round-trips to the same key the
  // records use. Naming it prettily ("Deal Name") is exactly how the schema stopped matching the
  // data in the first place — display naming is a separate, later decision.
  const added = keys
    .filter(k => !have.has(SCHEMA_KEY(k.key)) && /^[a-zA-Z0-9_-]{1,64}$/.test(k.key))
    .map(k => ({ id: crypto.randomUUID(), name: k.key, type: valid.has(k.type) ? k.type : "text" }));

  if (dry_run) return c.json({ dry_run: true, would_add: added, skipped: keys.length - added.length });
  if (!added.length) return c.json({ ok: true, added: [], note: "Nothing to add." });

  const { error } = await supabase.from("object_definitions")
    .update({ attributes: [...attrs, ...added] })
    .eq("workspace_id", ws).eq("id", def.id);
  if (error) return c.json({ error: "Could not update the schema." }, 500);
  return c.json({ ok: true, added, attributes_total: attrs.length + added.length });
});

const ATTR_TYPES_FOR_ADOPT = ["text", "number", "date", "datetime", "select", "multi_select", "relation",
  "currency", "percentage", "url", "email", "phone", "checkbox", "long_text", "status", "stage",
  "assignee", "owner", "tag", "category", "country"];

export const recordsRouter = router;

import { zValidator } from "../lib/validate";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { aiGateway } from "../lib/ai-gateway";
import { makeBaseConverter } from "../lib/currency-store";
import { composeWorkspaceReport, reportToXlsx, reportToHtml } from "../lib/report-export";
import { reportToPdf } from "../lib/report-pdf";
import { readSchedule, reportEmailHtml, REPORT_CADENCES, currentPeriodKey } from "../lib/report-schedule";
import { workspacePeriodConfig } from "../lib/period-close";
import { sendWorkspaceEmail } from "../lib/mail";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const reportType = z.enum(["insight", "funnel", "time_in_stage", "historical", "forecast"]);
const reportInput = z.object({ name: z.string().min(1), type: reportType, config: z.record(z.unknown()) });

function unpack(node: { id: string; data: Record<string, unknown>; created_by?: string | null; updated_at: string }) {
  return { id: node.id, ...node.data, created_by: node.created_by, updated_at: node.updated_at };
}

router.get("/", async (c) => {
  const { data, error } = await supabase.from("nodes").select("id,data,created_by,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").order("updated_at", { ascending: false });
  return error ? c.json({ error: error.message }, 400) : c.json((data ?? []).map((node) => unpack(node as never)));
});

/**
 * Downloadable workspace reports — Excel workbook + HTML (charts, print-to-PDF).
 *
 * Registered BEFORE "/:id" so the static paths can never be captured by the param route.
 * Auth is the session cookie: app.mondaily.com → api.mondaily.com is same-site, so a plain
 * link click carries the session and streams the file — no token in the URL.
 */
const exportQuery = z.object({
  period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]).default("monthly"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** "1" = the last COMPLETED period (what a scheduled email covers) instead of period-to-date. */
  complete: z.string().optional(),
});

router.get("/export.xlsx", zValidator("query", exportQuery), async (c) => {
  const { period, start, end, complete } = c.req.valid("query");
  try {
    const bundle = await composeWorkspaceReport(c.get("workspaceId"), period, { start, end }, new Date(), { complete: complete === "1" });
    const bytes = reportToXlsx(bundle);
    const name = `mondaily-${period}-report-${bundle.meta.range.end.slice(0, 10)}.xlsx`;
    return c.body(bytes.buffer as ArrayBuffer, 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "report export failed" }, 400);
  }
});

router.get("/export.pdf", zValidator("query", exportQuery), async (c) => {
  const { period, start, end, complete } = c.req.valid("query");
  try {
    const bundle = await composeWorkspaceReport(c.get("workspaceId"), period, { start, end }, new Date(), { complete: complete === "1" });
    const bytes = reportToPdf(bundle);
    return c.body(bytes.buffer as ArrayBuffer, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mondaily-${period}-report-${bundle.meta.range.end.slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "report export failed" }, 400);
  }
});

router.get("/export.html", zValidator("query", exportQuery), async (c) => {
  const { period, start, end, complete } = c.req.valid("query");
  const download = c.req.query("download") === "1";
  try {
    const bundle = await composeWorkspaceReport(c.get("workspaceId"), period, { start, end }, new Date(), { complete: complete === "1" });
    const html = reportToHtml(bundle);
    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
    if (download) headers["Content-Disposition"] = `attachment; filename="mondaily-${period}-report-${bundle.meta.range.end.slice(0, 10)}.html"`;
    return c.body(html, 200, headers);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "report export failed" }, 400);
  }
});

/**
 * Report schedule — "email me this report every <cadence>".
 *
 * Stored in workspaces.settings.report_schedule; the hourly cron (app.ts /api/cron/report-delivery)
 * sends the last COMPLETED period on the workspace's own calendar. Owner/admin only: the schedule
 * emails owners/admins, so only they may create that obligation.
 */
router.get("/schedule", async (c) => {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", c.get("workspaceId")).maybeSingle();
  return c.json(readSchedule((data?.settings ?? {}) as Record<string, unknown>));
});

router.post("/schedule", zValidator("json", z.object({
  enabled: z.record(z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]), z.boolean()),
})), async (c) => {
  const role = c.get("role") || "member";
  if (role !== "owner" && role !== "admin") return c.json({ error: "Owner/admin only." }, 403);
  const ws = c.get("workspaceId");
  const { enabled } = c.req.valid("json");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const prev = readSchedule(settings);
  const cleaned: Record<string, boolean> = {};
  for (const cad of REPORT_CADENCES) if (enabled[cad] === true) cleaned[cad] = true;
  // Enabling a cadence anchors last_sent to the CURRENT period, so the first email arrives when
  // this period ENDS — not an immediate mail covering a period the user already lived through.
  const { data: wsRow } = await supabase.from("workspaces").select("timezone, settings").eq("id", ws).maybeSingle();
  const cfg = workspacePeriodConfig(wsRow as { timezone?: unknown; settings?: unknown } | null);
  const last_sent = { ...(prev.last_sent ?? {}) };
  for (const cad of REPORT_CADENCES) {
    if (cleaned[cad] && !prev.enabled[cad]) last_sent[cad] = currentPeriodKey(cad, cfg, new Date());
  }
  const report_schedule = { enabled: cleaned, last_sent };
  const { error } = await supabase.from("workspaces").update({ settings: { ...settings, report_schedule } }).eq("id", ws);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ enabled: cleaned });
});

/** Send the CALLER a test of the scheduled email now — same composition + template as the cron. */
router.post("/schedule/send-test", zValidator("json", z.object({
  period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { period } = c.req.valid("json");
  const { data: me } = await supabase.from("workspace_members")
    .select("email, name").eq("workspace_id", ws).eq("user_id", c.get("userId")).maybeSingle();
  const email = typeof me?.email === "string" && me.email.includes("@") ? me.email : null;
  if (!email) return c.json({ error: "Your membership has no email address to send to." }, 400);
  try {
    const bundle = await composeWorkspaceReport(ws, period, undefined, new Date(), { complete: true });
    const { subject, body } = reportEmailHtml(bundle, ws);
    const ok = await sendWorkspaceEmail(ws, { subject: `[Test] ${subject}`, body, to: [{ email, name: (me?.name as string) ?? undefined }] });
    return ok ? c.json({ sent: true, to: email }) : c.json({ error: "Mail transport declined the message — check the workspace email setup on /status." }, 502);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "send failed" }, 400);
  }
});

router.post("/", zValidator("json", reportInput), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "report", data: body, created_by: c.get("userId") }).select("id,data,created_by,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "created", diff: { object_type: "report" } });
  return c.json(unpack(data as never), 201);
});

router.get("/:id", async (c) => {
  const { data } = await supabase.from("nodes").select("id,data,created_by,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").eq("id", c.req.param("id")).maybeSingle();
  return data ? c.json(unpack(data as never)) : c.json({ error: "Report not found" }, 404);
});

router.post("/:id", zValidator("json", reportInput.extend({ id: z.string().optional() })), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").update({ data: { name: body.name, type: body.type, config: body.config } }).eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").eq("id", c.req.param("id")).select("id,data,created_by,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "updated", diff: { report: body } });
  return c.json(unpack(data as never));
});

/**
 * Runs a saved report's aggregation and returns its chart data — shared by
 * the HTTP route below and Ask Mondaily's run_report tool, so "explain
 * this report" computes the exact same numbers the report page shows
 * instead of a second, possibly-divergent implementation.
 */
/**
 * Bounded, PAGED reads for report inputs.
 *
 * Both the node scan and the activity lookups were unbounded `.select()` calls. Past PostgREST's
 * max-rows cap that silently returns a SUBSET — for the funnel that means `everReached` undercounts
 * which records reached a stage, so the report shows an invented drop-off with no indication that
 * anything was missing. (Same failure mode as the credit-ledger totals; see lib/credits.)
 *
 * `.in("node_id", ids)` was also passed every node id at once, which blows the request URL length on
 * a large workspace — so it is chunked here as well.
 */
const PAGE = 1000;
const SCAN_CAP = 50_000;   // hard ceiling so one report can never scan an unbounded table

async function pagedSelect<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < SCAN_CAP; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) break;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Activities for a set of nodes — chunked over node ids AND paged within each chunk. */
async function activitiesForNodes(
  workspaceId: string,
  nodeIds: string[],
  columns: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const CHUNK = 200;                       // keeps the `in()` list well inside URL limits
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  for (let i = 0; i < nodeIds.length; i += CHUNK) {
    const ids = nodeIds.slice(i, i + CHUNK);
    const res = await pagedSelect<Record<string, unknown>>((from, to) =>
      supabase.from("activities").select(columns)
        .eq("workspace_id", workspaceId).in("node_id", ids)
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>);
    rows.push(...res.rows);
    truncated = truncated || res.truncated;
  }
  return { rows, truncated };
}

export async function runReportData(
  workspaceId: string,
  reportId: string,
  input: { type?: string; config?: Record<string, unknown> } = {}
): Promise<{ error: string } | { data: { label: string; value: number; previous?: number; dropoff?: number | null; average_days?: number; forecast?: boolean }[]; total?: number; change?: number | null; chart_type: string; forecast_from?: number; slope?: number; truncated?: boolean }> {
  const { data: reportNode } = await supabase.from("nodes").select("data").eq("workspace_id", workspaceId).eq("object_type", "report").eq("id", reportId).maybeSingle();
  if (!reportNode) return { error: "Report not found" };
  const stored = reportNode.data as { type?: string; config?: Record<string, unknown> };
  const type = input.type ?? stored.type ?? "insight";
  const config = { ...(stored.config ?? {}), ...(input.config ?? {}) };
  const objectType = String(config.object_type ?? "deal");
  // Object types drift between singular/plural ("invoice" vs "invoices", "deal" vs "deals"), which
  // left many reports matching ZERO records → blank charts. Try the configured type first, then the
  // singular/plural variant, then a case-insensitive match, so a legit report still finds its data.
  const variants = Array.from(new Set([
    objectType,
    objectType.endsWith("s") ? objectType.slice(0, -1) : `${objectType}s`,
  ]));
  type ReportNode = { id: string; data: Record<string, any> | null; created_at: string; updated_at: string };
  let nodes: ReportNode[] = [];
  // pagedSelect already knows when it stopped at the ceiling; that fact was computed and then
  // discarded, so a report built from a partial scan presented its numbers as the whole picture.
  // A report is read as fact, so the shortfall has to travel with the figures.
  let truncated = false;
  for (const v of variants) {
    const r = await pagedSelect<ReportNode>((from, to) =>
      supabase.from("nodes").select("id,data,created_at,updated_at")
        .eq("workspace_id", workspaceId).eq("object_type", v)
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: ReportNode[] | null; error: unknown }>);
    nodes = r.rows;
    truncated = truncated || r.truncated;
    if (nodes.length) break; // found real data for this variant
  }

  // Honour config.range. The builder offers "Last 30 days / 90 days / 1 year" and stores it, but
  // nothing here ever read it — every report aggregated the whole table all-time while the UI
  // said "Last 30 days". Filter on created_at (the same field every branch below buckets by).
  const RANGE_DAYS: Record<string, number> = { "30d": 30, "90d": 90, "1y": 365 };
  const rangeDays = RANGE_DAYS[String(config.range ?? "")];
  if (rangeDays) {
    const cutoff = Date.now() - rangeDays * 86_400_000;
    nodes = nodes.filter((n) => {
      const t = Date.parse(String(n.created_at ?? ""));
      return Number.isNaN(t) ? true : t >= cutoff;   // keep rows with no usable date rather than silently dropping them
    });
  }

  if (type === "funnel") {
    const stages: string[] = Array.isArray(config.stages) ? config.stages.map(String) : [];
    const stageField = String(config.stage_field ?? "stage");
    // A funnel must count records that EVER REACHED each stage, not records currently sitting in
    // it. The old version compared current-stage snapshots — a deal that advanced past Lead is no
    // longer in Lead, so "drop-off" was not a conversion rate at all, and Math.max(0, …) quietly
    // reported 0% whenever a later stage held more records than an earlier one. Stage history
    // comes from the same activity diffs the time_in_stage branch uses.
    const nodeIds = (nodes ?? []).map((n) => n.id);
    const everReached = new Map<string, Set<string>>();
    for (const n of nodes ?? []) {
      const cur = String(n.data?.[stageField] ?? "").toLowerCase();
      if (cur) everReached.set(n.id, new Set([cur]));
    }
    if (nodeIds.length) {
      const { rows: acts } = await activitiesForNodes(workspaceId, nodeIds, "node_id,diff");
      for (const a of acts) {
        const diff = a.diff as Record<string, unknown> | null;
        const v = diff?.[stageField] ?? (diff?.data as Record<string, unknown> | undefined)?.[stageField];
        const key = String(v ?? "").toLowerCase();
        if (!key) continue;
        const set = everReached.get(a.node_id as string) ?? new Set<string>();
        set.add(key);
        everReached.set(a.node_id as string, set);
      }
    }
    const reachedCount = (stage: string) =>
      [...everReached.values()].filter((set) => set.has(stage.toLowerCase())).length;

    const values = stages.map((stage, index) => {
      const value = reachedCount(stage);
      const previous = index === 0 ? null : reachedCount(String(stages[index - 1] ?? ""));
      // null (not 0) when there is no comparable base or the data can't support the figure —
      // the chart renders nothing rather than an invented "0%".
      const dropoff = previous && previous > 0 && value <= previous
        ? Math.round((1 - value / previous) * 100)
        : null;
      // average_days omitted: it was hardcoded 0 and shipped as if it were a real metric.
      return { label: stage, value, dropoff };
    });
    return { data: values, chart_type: "funnel", truncated };
  }
  if (type === "time_in_stage") {
    const stageField = String(config.stage_field ?? "stage");
    const nodeIds = (nodes ?? []).map((n) => n.id);
    // TRUE time-in-stage: how long each record has sat in its CURRENT stage, measured from when it
    // ENTERED that stage (the latest activity that changed the stage field), not from created_at and
    // not to updated_at (which moves on any edit). Falls back to created_at when there's no stage-change
    // history for the record (e.g. it was created directly into its current stage).
    const enteredAt = new Map<string, number>(); // node_id → ms timestamp it entered current stage
    if (nodeIds.length) {
      const { rows: acts } = await activitiesForNodes(workspaceId, nodeIds, "node_id,created_at,diff");
      for (const a of acts) {
        const diff = a.diff as Record<string, unknown> | null;
        const changed = diff && (stageField in diff || (diff.data as Record<string, unknown> | undefined)?.[stageField] !== undefined);
        if (changed) enteredAt.set(a.node_id as string, new Date(a.created_at as string).getTime());
      }
    }
    const now = Date.now();
    const grouped = new Map<string, number[]>();
    for (const node of nodes ?? []) {
      const stage = String(node.data?.[stageField] ?? "Unknown");
      const since = enteredAt.get(node.id) ?? new Date(node.created_at).getTime();
      const days = Math.max(0, (now - since) / 86_400_000);
      grouped.set(stage, [...(grouped.get(stage) ?? []), days]);
    }
    return { data: [...grouped].map(([label, values]) => ({ label, value: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(1)) })), chart_type: "bar", truncated };
  }
  if (type === "historical") {
    const field = String(config.field ?? "value");
    // This branch never touched `nodes`, so the range filter above did not apply to it: a
    // "Last 30 days" historical report still aggregated all-time, over an unbounded activity scan.
    const { rows: activities } = await pagedSelect<{ created_at: string; diff: unknown; node_id: string }>((from, to) => {
      let q = supabase.from("activities").select("created_at,diff,node_id")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: true });
      if (config.record_id) q = q.eq("node_id", String(config.record_id));
      if (rangeDays) q = q.gte("created_at", new Date(Date.now() - rangeDays * 86_400_000).toISOString());
      return q.range(from, to) as unknown as PromiseLike<{ data: { created_at: string; diff: unknown; node_id: string }[] | null; error: unknown }>;
    });
    const data = activities.flatMap((activity) => {
      const diff = activity.diff as Record<string, unknown> | null;
      const raw = diff?.[field] ?? (diff?.data as Record<string, unknown> | undefined)?.[field];
      const value = Number(raw);
      return Number.isFinite(value) ? [{ label: new Date(activity.created_at).toLocaleDateString(), value }] : [];
    });
    return { data, chart_type: "line", truncated };
  }

  const metric = String(config.metric ?? "count");
  const field = String(config.field ?? "value");
  const groupBy = String(config.group_by ?? "month");
  // Multi-currency: when records carry a `currency` field, sum/average must not mix currencies
  // raw — convert each value to the workspace base via the stored ECB rates (fail-closed: face
  // value when a rate is missing). Count metrics never need this.
  const moneyAware = metric !== "count" && (nodes ?? []).some((n) => n.data?.currency);
  const conv = moneyAware ? await makeBaseConverter(workspaceId) : null;
  // ISO-8601 week label — unique across months/years (day-of-month/7 collided every "W1–W5").
  const isoWeekLabel = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day); // shift to the Thursday of this ISO week
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${t.getUTCFullYear()} W${String(week).padStart(2, "0")}`;
  };
  const groups = new Map<string, number[]>();
  for (const node of nodes ?? []) {
    const date = new Date(node.created_at);
    const label = groupBy === "day" ? date.toISOString().slice(0, 10) : groupBy === "week" ? isoWeekLabel(date) : groupBy === "quarter" ? `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}` : date.toLocaleDateString("en", { month: "short", year: "numeric" });
    const raw = Number(node.data?.[field] ?? 0);
    const value = conv ? conv.toBase(raw, node.data?.currency as string | undefined) : raw;
    groups.set(label, [...(groups.get(label) ?? []), value]);
  }
  const data = [...groups].map(([label, values]) => ({ label, value: metric === "count" ? values.length : metric === "average" ? Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(2)) : values.reduce((sum, value) => sum + value, 0) }));
  const total = metric === "average" ? Number((data.reduce((sum, item) => sum + item.value, 0) / Math.max(data.length, 1)).toFixed(2)) : data.reduce((sum, item) => sum + item.value, 0);

  // FORECAST — project the next N periods from the REAL historical trend via least-squares linear
  // regression on the actual grouped values (never fabricated: it's a transparent projection).
  if (type === "forecast" && data.length >= 3) {
    const ys = data.map((d) => d.value);
    const n = ys.length;
    const xs = ys.map((_, i) => i);
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i]! - meanX) * (ys[i]! - meanY); den += (xs[i]! - meanX) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    const horizon = Math.max(1, Math.min(6, Number(config.horizon ?? 3)));
    const projected = Array.from({ length: horizon }, (_, k) => ({
      label: `+${k + 1}`,
      value: Math.max(0, Number((intercept + slope * (n + k)).toFixed(2))),
      forecast: true,
    }));
    // change is NOT computed here (config.compare is never read and no prior-period query
    // runs), so report null rather than a fabricated 0 that the UI rendered as "+0%" in green.
    return { data: [...data, ...projected], total, change: null, chart_type: "line", forecast_from: data.length, slope: Number(slope.toFixed(3)), truncated };
  }

  return { data, total, change: null, chart_type: String(config.chart_type ?? "line"), truncated };
}

/**
 * Delete a saved report. This existed nowhere: Ask's create_report told users "It's saved under
 * Reports" while the index never listed them and nothing could remove one — an append-only shelf.
 */
router.delete("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const { data, error } = await supabase.from("nodes").delete()
    .eq("workspace_id", ws).eq("object_type", "report").eq("id", c.req.param("id"))
    .select("id").maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: "Report not found" }, 404);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: ws, actor_type: "human", actor_id: c.get("userId"), action: "deleted", diff: { object_type: "report" } }).then(() => {}, () => {});
  return c.json({ deleted: true });
});

router.post("/:id/run", async (c) => {
  const input: { type?: string; config?: Record<string, unknown> } = await c.req.json<{ type?: string; config?: Record<string, unknown> }>().catch(() => ({}));
  const result = await runReportData(c.get("workspaceId"), c.req.param("id"), input);
  if ("error" in result) return c.json({ error: result.error }, result.error === "Report not found" ? 404 : 400);
  return c.json(result);
});

// AI insight — a GROUNDED narrative computed strictly from the report's REAL data points. The model
// is given the actual numbers and told to describe only what they show (trend, peak, change,
// forecast direction) — never to invent figures. Empty/thin data → an honest "not enough data yet".
router.post("/:id/insight", async (c) => {
  const ws = c.get("workspaceId");
  const input: { type?: string; config?: Record<string, unknown> } = await c.req.json<{ type?: string; config?: Record<string, unknown> }>().catch(() => ({}));
  const result = await runReportData(ws, c.req.param("id"), input);
  if ("error" in result) return c.json({ error: result.error }, 400);
  const data = result.data ?? [];
  if (data.length < 2) return c.json({ insight: "Not enough data yet to draw a meaningful insight — add more records or widen the date range." });

  // Give the model the real series only.
  const series = data.map((d) => `${d.label}: ${d.value}${(d as { forecast?: boolean }).forecast ? " (projected)" : ""}`).join("; ");
  const first = data[0]!.value, last = data[data.length - 1]!.value;
  const peak = data.reduce((m, d) => (d.value > m.value ? d : m), data[0]!);
  try {
    const { text } = await aiGateway({
      system:
        "You are a business analyst. Describe ONLY what the provided numbers show — trend direction, the peak, the overall change, and (if projected points are present) where the forecast is heading. " +
        "NEVER invent figures not in the data. Be concrete and specific, cite the real numbers, 2-3 short sentences, plain language, no preamble.",
      prompt: `Report data points — ${series}. First=${first}, last=${last}, peak=${peak.label} (${peak.value}).`,
      maxTokens: 220,
      workspaceId: ws, userId: c.get("userId"), feature: "report_insight",
    });
    return c.json({ insight: (text || "").trim() || "The data shows the values above; no strong trend detected." });
  } catch {
    // Deterministic fallback so the panel always has something real (no fabrication).
    const dir = last > first ? "up" : last < first ? "down" : "flat";
    const pct = first ? Math.round(((last - first) / Math.abs(first)) * 100) : 0;
    return c.json({ insight: `Trend is ${dir} — from ${first} to ${last}${first ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : ""}. Peak was ${peak.value} at ${peak.label}.` });
  }
});

export { router as reportsRouter };

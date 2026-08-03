import { createHash } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import {
  periodConfigFrom, elapsedPeriods, periodKey, periodBounds,
  type PeriodType, type PeriodConfig, type Bounds,
} from "@mondaily/shared/period";
import { isCollected, isOutstanding, moneyEventDate } from "@mondaily/shared/finance";
import { readMoney } from "@mondaily/shared/money";
import { makeBaseConverter } from "./currency-store";

/**
 * The period close.
 *
 * Three decisions shape this file, and each one is a bug avoided rather than a feature added:
 *
 *  1. CALENDAR-DRIVEN, not cursor-driven. The worker never asks "what happened since I last ran".
 *     Crons get skipped by deploys and outages, and fire twice on retries. It asks the calendar
 *     which periods ENDED, which gives the same answer however many times it is asked and
 *     backfills the ones a skipped run missed.
 *
 *  2. IDEMPOTENT by construction. The unique key on (workspace, period_type, period_key) means a
 *     double fire conflicts instead of double-counting. Nothing here checks "did I already do
 *     this" in application code, because that check is a race.
 *
 *  3. NO POINTER. There is deliberately no "active period" field to advance. The calendar already
 *     says what period it is; a stored pointer is a second authority that can disagree with it
 *     after a missed run or a replay, and when two authorities disagree every number moves. A
 *     snapshot records what was true at close; it does not decide what period we are in.
 */

export const PERIOD_TYPES: PeriodType[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];

/**
 * The workspace's period config, read from where the timezone ACTUALLY lives.
 *
 * `workspaces.timezone` is a real column and the Settings → General picker writes to it;
 * `settings.timezone` is only a legacy fallback (app-data prefers the column, so this must too).
 * Reading settings alone made the whole timezone story inert: a workspace could pick Europe/Warsaw
 * and every boundary would still be computed in UTC, which is precisely the bug this engine exists
 * to prevent — and it would have been invisible, because UTC is a plausible answer.
 */
export function workspacePeriodConfig(row: { timezone?: unknown; settings?: unknown } | null | undefined): PeriodConfig {
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  const column = typeof row?.timezone === "string" && row.timezone.trim() ? row.timezone.trim() : null;
  return periodConfigFrom({ ...settings, ...(column ? { timezone: column } : {}) });
}

export interface PeriodMetrics {
  /** FLOW — cash that actually landed inside the period, in workspace base currency. */
  revenue_collected: number;
  /** FLOW — expenses approved inside the period. */
  expenses_approved: number;
  /** FLOW — credit notes executed inside the period. */
  credits_issued: number;
  /** revenue − expenses − credits. Stored WITH its formula version (see METRICS_VERSION). */
  net_margin: number;
  deals_won_count: number;
  tasks_completed: number;
  /** STOCK, as of the close instant — a balance, not a flow. Recorded so the close is a full
   *  picture, and labelled so nobody sums it across periods. */
  outstanding_at_close: number;
  base_currency: string;
}

/**
 * Bumped whenever a metric's DEFINITION changes.
 *
 * A stored `net_margin` is a derived number, and a derivation that changes silently invalidates
 * every figure already written. Versioning it means an old snapshot can still say what it meant,
 * and a drift check can tell "the inputs moved" apart from "we changed the maths".
 */
export const METRICS_VERSION = 1;

export interface SnapshotInputs {
  invoices_scanned: number;
  expenses_scanned: number;
  credit_notes_scanned: number;
  deals_scanned: number;
  tasks_scanned: number;
  /** Digest of the contributing row ids — lets a recomputation say WHERE a drift came from. */
  source_digest: string;
  metrics_version: number;
  /** Rows counted at today's rate because they predate the money model. Disclosed, never hidden. */
  unconverted: number;
}

/** Canonical JSON: key order fixed, so the same content always hashes the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * The snapshot's content hash, chained to its predecessor.
 *
 * `prev_hash` is what turns a hash from a label into evidence: editing one historical row changes
 * its hash, which breaks the chain for every snapshot after it. A per-row hash alone would let a
 * row be rewritten together with its own hash and look untouched.
 */
export function snapshotHash(input: {
  workspace_id: string; period_type: PeriodType; period_key: string;
  period_start: string; period_end: string;
  metrics: PeriodMetrics; inputs: SnapshotInputs; prev_hash: string | null;
}): string {
  return sha256(canonical(input));
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compute one period's metrics from the live ledger.
 *
 * Exported because the DRIFT check re-runs exactly this against a closed period: if a recomputation
 * of a settled month no longer matches what was filed, something changed after the close, and that
 * is worth surfacing rather than silently serving whichever number was asked for.
 */
export async function computeMetrics(workspaceId: string, bounds: Bounds): Promise<{ metrics: PeriodMetrics; inputs: SnapshotInputs }> {
  const startIso = bounds.start.toISOString();
  const endIso = bounds.end.toISOString();

  const [{ base, toBase }, invoices, expenses, creditNotes, deals, tasks] = await Promise.all([
    makeBaseConverter(workspaceId),
    supabase.from("nodes").select("id,data").eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "invoice"),
    supabase.from("nodes").select("id,data").eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "expense"),
    supabase.from("nodes").select("id,data").eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "credit_note"),
    supabase.from("nodes").select("id,data,updated_at").eq("workspace_id", workspaceId).eq("object_type", "deals"),
    supabase.from("tasks").select("id,status,completed_at,updated_at").eq("workspace_id", workspaceId)
      .gte("updated_at", startIso).lt("updated_at", endIso),
  ]);

  const ids: string[] = [];
  let unconverted = 0;

  // Value a row from its FROZEN base amount where it has one, so a snapshot taken today and the
  // same period recomputed next year agree. Rows predating the money model convert at today's
  // rate and are counted in `unconverted` — a mixed basis is not wrong, but it must not pretend
  // to be uniform.
  const valueOf = (d: Record<string, unknown>): number => {
    const m = readMoney(d);
    if (m.modelled && m.base_amount != null && (m.base_currency ?? "").toUpperCase() === base.toUpperCase()) {
      return m.base_amount;
    }
    unconverted += 1;
    return toBase(m.amount, m.currency || base);
  };

  const within = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= bounds.start.getTime() && t < bounds.end.getTime();
  };

  let revenue = 0, outstanding = 0;
  for (const row of invoices.data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? "draft");
    // FLOW: counted on the date the money actually moved, not the date the document was made.
    if (isCollected(status) && within(moneyEventDate(d as never))) {
      revenue += valueOf(d); ids.push(String(row.id));
    }
    // STOCK: the balance as of the close. No window — an unpaid invoice does not stop being unpaid
    // because a month ended.
    if (isOutstanding(status)) outstanding += valueOf(d);
  }

  let expensesTotal = 0;
  for (const row of expenses.data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? "").toLowerCase();
    if (status !== "approved" && status !== "verified") continue;
    if (!within(String(d.date ?? d.approved_at ?? "") || null)) continue;
    expensesTotal += valueOf(d); ids.push(String(row.id));
  }

  let credits = 0;
  for (const row of creditNotes.data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? "").toLowerCase();
    if (status !== "verified" && status !== "executed") continue;
    if (!within(String(d.updated_at ?? d.created_at ?? "") || null)) continue;
    credits += valueOf(d); ids.push(String(row.id));
  }

  let dealsWon = 0;
  for (const row of deals.data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const stage = String(d.deal_stage ?? d.stage ?? "").toLowerCase().replace(/[\s_-]+/g, " ");
    if (stage !== "closed won" && stage !== "won") continue;
    if (!within(String(d.won_at ?? "") || (row as { updated_at?: string }).updated_at || null)) continue;
    dealsWon += 1; ids.push(String(row.id));
  }

  const tasksDone = (tasks.data ?? []).filter(t => {
    const status = String((t as { status?: string }).status ?? "").toLowerCase();
    return status === "done" || status === "completed";
  });
  for (const t of tasksDone) ids.push(String((t as { id: string }).id));

  const round = (n: number) => Math.round(n * 100) / 100;
  const metrics: PeriodMetrics = {
    revenue_collected: round(revenue),
    expenses_approved: round(expensesTotal),
    credits_issued: round(credits),
    net_margin: round(revenue - expensesTotal - credits),
    deals_won_count: dealsWon,
    tasks_completed: tasksDone.length,
    outstanding_at_close: round(outstanding),
    base_currency: base,
  };

  const inputs: SnapshotInputs = {
    invoices_scanned: (invoices.data ?? []).length,
    expenses_scanned: (expenses.data ?? []).length,
    credit_notes_scanned: (creditNotes.data ?? []).length,
    deals_scanned: (deals.data ?? []).length,
    tasks_scanned: (tasks.data ?? []).length,
    source_digest: sha256(ids.sort().join(",")),
    metrics_version: METRICS_VERSION,
    unconverted,
  };

  return { metrics, inputs };
}

export interface CloseResult {
  workspace_id: string;
  period_type: PeriodType;
  period_key: string;
  status: "written" | "already_closed" | "failed";
  detail?: string;
}

/** Close one period. Safe to call repeatedly: the unique key makes a repeat a no-op, not a duplicate. */
export async function closePeriod(
  workspaceId: string, type: PeriodType, key: string, bounds: Bounds,
  cfg: PeriodConfig, closedBy: "scheduled" | "backfill" | "manual",
): Promise<CloseResult> {
  const base = { workspace_id: workspaceId, period_type: type, period_key: key };

  const { data: existing } = await supabase
    .from("period_snapshots").select("snapshot_id")
    .eq("workspace_id", workspaceId).eq("period_type", type).eq("period_key", key).maybeSingle();
  if (existing) return { ...base, status: "already_closed" };

  const { metrics, inputs } = await computeMetrics(workspaceId, bounds);

  // The chain link: the most recent snapshot of this type for this workspace.
  const { data: prev } = await supabase
    .from("period_snapshots").select("hash")
    .eq("workspace_id", workspaceId).eq("period_type", type)
    .order("period_end", { ascending: false }).limit(1).maybeSingle();
  const prevHash = (prev?.hash as string | undefined) ?? null;

  const period_start = bounds.start.toISOString();
  const period_end = bounds.end.toISOString();
  const hash = snapshotHash({ ...base, period_start, period_end, metrics, inputs, prev_hash: prevHash });

  const { error } = await supabase.from("period_snapshots").insert({
    ...base, period_start, period_end,
    time_zone: cfg.timeZone, week_start: cfg.weekStart,
    metrics, inputs, hash, prev_hash: prevHash, closed_by: closedBy,
  });

  // A unique violation means a concurrent run won the race — which is success, not failure.
  if (error) {
    if (String(error.code) === "23505") return { ...base, status: "already_closed" };
    return { ...base, status: "failed", detail: error.message };
  }
  return { ...base, status: "written" };
}

/**
 * Close every period that has ended and is not yet on file, for one workspace.
 *
 * `lookback` bounds the backfill: without it, a workspace created today would be asked to close
 * every week since 1970. It is a window on the CALENDAR, not a cursor — running twice inside it
 * still produces exactly one snapshot per period.
 */
export async function closeDuePeriods(
  workspaceId: string, workspaceRow: { timezone?: unknown; settings?: unknown } | null | undefined, now = new Date(),
  opts: { lookbackDays?: number; types?: PeriodType[]; closedBy?: "scheduled" | "backfill" | "manual" } = {},
): Promise<CloseResult[]> {
  const cfg = workspacePeriodConfig(workspaceRow);
  const lookback = opts.lookbackDays ?? 400;         // a year plus slack, so a yearly close is reachable
  const since = new Date(now.getTime() - lookback * 86_400_000);
  const out: CloseResult[] = [];

  for (const type of opts.types ?? PERIOD_TYPES) {
    for (const { key, bounds } of elapsedPeriods(since, now, type, cfg)) {
      out.push(await closePeriod(workspaceId, type, key, bounds, cfg, opts.closedBy ?? "scheduled"));
    }
  }
  return out;
}

/**
 * Recompute a closed period and compare it with what was filed.
 *
 * This is the read-side answer to "why not just serve the snapshot". The live ledger stays
 * authoritative, and where a recomputation disagrees with the snapshot we say so instead of
 * quietly picking one. A drift is not necessarily an error — a backdated invoice is a legitimate
 * correction — but it is always something a person should be told about rather than shown a number
 * that silently changed.
 */
export interface Drift {
  period_key: string;
  drifted: boolean;
  /** Metric name → { snapshot, live }. Empty when they agree. */
  changes: Record<string, { snapshot: number; live: number }>;
  /** True when the snapshot was written under an older metric DEFINITION, which is not a data drift. */
  version_changed: boolean;
}

export async function driftFor(workspaceId: string, type: PeriodType, key: string): Promise<Drift | null> {
  const { data: snap } = await supabase
    .from("period_snapshots").select("period_key, period_start, period_end, metrics, inputs")
    .eq("workspace_id", workspaceId).eq("period_type", type).eq("period_key", key).maybeSingle();
  if (!snap) return null;

  const { metrics: live } = await computeMetrics(workspaceId, {
    start: new Date(String(snap.period_start)), end: new Date(String(snap.period_end)),
  });
  const filed = (snap.metrics ?? {}) as Record<string, number>;
  const inputs = (snap.inputs ?? {}) as Record<string, unknown>;

  const changes: Drift["changes"] = {};
  for (const [k, liveValue] of Object.entries(live)) {
    if (typeof liveValue !== "number") continue;
    const filedValue = Number(filed[k] ?? 0);
    // Money is compared in whole minor units: a float re-sum can differ in the last bit without
    // anything having actually changed, and reporting that as drift would cry wolf every read.
    if (Math.round(filedValue * 100) !== Math.round(liveValue * 100)) {
      changes[k] = { snapshot: filedValue, live: liveValue };
    }
  }

  return {
    period_key: key,
    drifted: Object.keys(changes).length > 0,
    changes,
    version_changed: Number(inputs.metrics_version ?? 0) !== METRICS_VERSION,
  };
}

/** Verify the hash chain for a workspace — proves no snapshot was rewritten after the fact. */
export async function verifyChain(workspaceId: string, type: PeriodType): Promise<{
  ok: boolean; checked: number; broken: { period_key: string; reason: string }[];
}> {
  const { data } = await supabase
    .from("period_snapshots")
    .select("period_key, period_type, period_start, period_end, metrics, inputs, hash, prev_hash")
    .eq("workspace_id", workspaceId).eq("period_type", type)
    .order("period_end", { ascending: true });

  const rows = data ?? [];
  const broken: { period_key: string; reason: string }[] = [];
  let expectedPrev: string | null = null;

  for (const r of rows) {
    const recomputed = snapshotHash({
      workspace_id: workspaceId,
      period_type: r.period_type as PeriodType,
      period_key: String(r.period_key),
      period_start: new Date(String(r.period_start)).toISOString(),
      period_end: new Date(String(r.period_end)).toISOString(),
      metrics: r.metrics as PeriodMetrics,
      inputs: r.inputs as SnapshotInputs,
      prev_hash: (r.prev_hash as string | null) ?? null,
    });
    if (recomputed !== r.hash) broken.push({ period_key: String(r.period_key), reason: "content does not match its hash" });
    else if ((r.prev_hash ?? null) !== expectedPrev) broken.push({ period_key: String(r.period_key), reason: "chain link does not match the previous snapshot" });
    expectedPrev = String(r.hash);
  }
  return { ok: broken.length === 0, checked: rows.length, broken };
}

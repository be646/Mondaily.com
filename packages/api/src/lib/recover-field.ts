import { supabase } from "@mondaily/db/client";

/**
 * Recover a column that a bulk edit overwrote.
 *
 * On 2026-08-02 every deal's `country` became "Albania". The picker was innocent — it writes only
 * on an explicit click. The activity trail showed the truth: these records once held Algeria,
 * Guinea and others, and every one changed inside the SAME sub-second burst. That is the bulk
 * "Set field" action applied to a whole selection, with Albania simply first in an alphabetical
 * list. Nothing asked, and nothing could undo it.
 *
 * The pre-overwrite values still exist, because every write files an activity row carrying a full
 * snapshot of `data`. This reads back through those snapshots and proposes what each record held
 * before the burst.
 *
 * THE RULE that keeps this honest: a value is only proposed when the overwrite was part of a BURST
 * — several records changed to the same value within seconds of each other. A lone edit is somebody
 * choosing, and reverting it would be this tool destroying data rather than restoring it. Bursts are
 * detected from the data, not from a hardcoded timestamp, so this works for the next accident too.
 */

/** Records changing to the same value inside this window count as one bulk action. */
const BURST_WINDOW_MS = 10_000;
/** Below this, it is a person editing a few rows, not a bulk overwrite. */
const MIN_BURST_SIZE = 5;

export interface FieldRecovery {
  node_id: string;
  name: string;
  field: string;
  current: string | null;
  /** What the record held before the bulk write, or null when nothing justifies a restore. */
  proposed: string | null;
  overwritten_at: string | null;
  burst_size: number | null;
  reason: string;
}

interface Snap { at: string; data: Record<string, unknown> }

function snapshots(acts: { created_at: string; diff: unknown }[]): Snap[] {
  return acts
    .filter(a => a.diff)
    .map(a => {
      const raw = typeof a.diff === "string" ? safeParse(a.diff) : (a.diff as Record<string, unknown>);
      return { at: a.created_at, data: ((raw?.data as Record<string, unknown>) ?? raw ?? {}) as Record<string, unknown> };
    })
    .sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

export async function proposeFieldRecovery(
  workspaceId: string, objectType: string, field: string,
): Promise<FieldRecovery[]> {
  const { data: nodes } = await supabase
    .from("nodes").select("id, data")
    .eq("workspace_id", workspaceId).eq("object_type", objectType).limit(1000);

  // Pass 1 — for every record, find the write that set its CURRENT value, and what it replaced.
  const changes: { node_id: string; name: string; at: string; from: string; to: string }[] = [];
  const noHistory: FieldRecovery[] = [];

  for (const n of nodes ?? []) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const current = d[field] == null ? "" : String(d[field]);
    const base = { node_id: n.id as string, name: String(d.name ?? "(unnamed)"), field, current: current || null };
    if (!current) continue;

    const { data: acts } = await supabase
      .from("activities").select("created_at, diff")
      .eq("node_id", n.id).order("created_at", { ascending: true }).limit(200);

    const snaps = snapshots((acts ?? []) as { created_at: string; diff: unknown }[]);
    let lastChange: { at: string; from: string } | null = null;
    let prev: Record<string, unknown> | null = null;
    for (const s of snaps) {
      if (prev) {
        const before = prev[field] == null ? "" : String(prev[field]);
        const after = s.data[field] == null ? "" : String(s.data[field]);
        if (before !== after && after === current) lastChange = { at: s.at, from: before };
      }
      prev = s.data;
    }
    if (!lastChange || !lastChange.from) {
      noHistory.push({ ...base, proposed: null, overwritten_at: null, burst_size: null,
        reason: lastChange ? "The value it replaced was empty — there is nothing to restore."
                           : "No recorded change to this field; the current value is the only one it has ever had." });
      continue;
    }
    changes.push({ node_id: base.node_id, name: base.name, at: lastChange.at, from: lastChange.from, to: current });
  }

  // Pass 2 — a change is only a BULK OVERWRITE if many records took the same value at once.
  const out: FieldRecovery[] = [...noHistory];
  for (const c of changes) {
    const t = new Date(c.at).getTime();
    const burst = changes.filter(o =>
      o.to === c.to && Math.abs(new Date(o.at).getTime() - t) <= BURST_WINDOW_MS);
    const base = { node_id: c.node_id, name: c.name, field, current: c.to, overwritten_at: c.at };
    if (burst.length < MIN_BURST_SIZE) {
      out.push({ ...base, proposed: null, burst_size: burst.length,
        reason: `Only ${burst.length} record${burst.length === 1 ? "" : "s"} changed to "${c.to}" around then — that is somebody editing, not a bulk overwrite. Left alone.` });
      continue;
    }
    out.push({ ...base, proposed: c.from, burst_size: burst.length,
      reason: `${burst.length} records were set to "${c.to}" within seconds of each other — a bulk overwrite. This record held "${c.from}" immediately before it.` });
  }
  return out;
}

/** Restores the proposed values. Read-merge-write: PATCH replaces `data` wholesale. */
export async function applyFieldRecovery(
  workspaceId: string, recoveries: FieldRecovery[],
) {
  let restored = 0;
  for (const r of recoveries) {
    if (!r.proposed) continue;
    const { data: row } = await supabase
      .from("nodes").select("data").eq("id", r.node_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!row) continue;
    const merged = { ...((row.data ?? {}) as Record<string, unknown>), [r.field]: r.proposed };
    const { error } = await supabase.from("nodes").update({ data: merged })
      .eq("id", r.node_id).eq("workspace_id", workspaceId);
    if (!error) restored++;
  }
  return { restored, left_alone: recoveries.filter(r => !r.proposed).length };
}

export function renderRecoveryTable(rows: FieldRecovery[]): string {
  const head = "record                         | now        | restore to  | why";
  const body = rows.map(r =>
    `${r.name.slice(0, 30).padEnd(30)} | ${(r.current ?? "—").padEnd(10)} | ` +
    `${(r.proposed ?? "LEFT ALONE").padEnd(11)} | ${r.reason}`).join("\n");
  return [head, "-".repeat(head.length), body].join("\n");
}

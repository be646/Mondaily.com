import { supabase } from "@mondaily/db/client";
import { dealStageOf } from "@mondaily/shared/deal-stage";

/**
 * Supervised reconciliation of the two stage fields.
 *
 * Deals carry both `deal_stage` and `stage`. Measured in prod 2026-08-03, they DISAGREE on 28 of 44
 * records — one reading "Closed Won" while the other reads "Lead" on the same 500,000 deal.
 *
 * Everything that could have picked a winner globally was checked and ruled out:
 *
 *   - Both are DECLARED schema attributes, so neither is a stray leftover.
 *   - Both draw from the SAME seven values, so neither is a junk field holding a different
 *     vocabulary (which is how `status` was ruled out of the stage chain).
 *   - Both are actively edited: 88 `deal_stage` changes vs 96 `stage` changes across the
 *     conflicting records, so neither is abandoned.
 *   - `won_at` — the one server-stamped fact that could corroborate a "Closed Won" — exists on
 *     exactly ONE of the 28.
 *
 * So there is no global answer, and inventing one would bake a wrong stage into revenue permanently.
 * What remains is per-record evidence: which field a human actually touched LAST. That is real where
 * the two fields moved at different times, and meaningless where a single import wrote both in the
 * same instant — which is the case for 20 of the 28.
 *
 * This proposes a value only for the records with a genuine recency gap, and reports the rest as
 * undecidable rather than guessing. Same contract as the win-date backfill: evidence or nothing.
 */

export interface StageProposal {
  node_id: string;
  name: string;
  deal_stage: string | null;
  stage: string | null;
  /** The value both fields would be set to, or null when nothing justifies one. */
  proposed: string | null;
  winner: "deal_stage" | "stage" | null;
  /** Milliseconds between the two fields' last changes. 0 means one write touched both. */
  gap_ms: number | null;
  reason: string;
}

interface ActivityRow { created_at: string; diff: unknown }

/** Last time each stage field actually CHANGED, from the activity snapshots. */
function lastChanges(acts: ActivityRow[]): { deal: string | null; stage: string | null } {
  const ordered = [...acts]
    .filter(a => a.diff)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let deal: string | null = null, stage: string | null = null;
  let prev: Record<string, unknown> | null = null;
  for (const a of ordered) {
    const raw = typeof a.diff === "string" ? safeParse(a.diff) : (a.diff as Record<string, unknown>);
    const cur = ((raw?.data as Record<string, unknown>) ?? raw ?? {}) as Record<string, unknown>;
    if (prev) {
      if (String(prev.deal_stage) !== String(cur.deal_stage)) deal = a.created_at;
      if (String(prev.stage) !== String(cur.stage)) stage = a.created_at;
    }
    prev = cur;
  }
  return { deal, stage };
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

export async function proposeStageReconciliation(workspaceId: string): Promise<StageProposal[]> {
  const { data: nodes } = await supabase
    .from("nodes").select("id, data")
    .eq("workspace_id", workspaceId).eq("object_type", "deals").limit(1000);

  const conflicts = (nodes ?? []).filter(n => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    return d.deal_stage !== undefined && d.stage !== undefined
      && String(d.deal_stage) !== String(d.stage);
  });

  const out: StageProposal[] = [];
  for (const n of conflicts) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const { data: acts } = await supabase
      .from("activities").select("created_at, diff")
      .eq("node_id", n.id).order("created_at", { ascending: true }).limit(200);

    const { deal, stage } = lastChanges((acts ?? []) as ActivityRow[]);
    const base = {
      node_id: n.id as string,
      name: String(d.name ?? "(unnamed)"),
      deal_stage: d.deal_stage == null ? null : String(d.deal_stage),
      stage: d.stage == null ? null : String(d.stage),
    };

    if (!deal || !stage) {
      out.push({ ...base, proposed: null, winner: null, gap_ms: null,
        reason: "Only one field has a recorded change; a single-sided history cannot say which value the other was meant to have." });
      continue;
    }
    const gap = Math.abs(new Date(deal).getTime() - new Date(stage).getTime());
    if (gap === 0) {
      // The decisive case: one write touched both, so "last edited" is a tie, not a signal.
      out.push({ ...base, proposed: null, winner: null, gap_ms: 0,
        reason: "Both fields last changed in the SAME write — an import, not a human choosing between them. There is nothing here to prefer." });
      continue;
    }
    const winner = new Date(deal).getTime() > new Date(stage).getTime() ? "deal_stage" : "stage";
    out.push({ ...base, proposed: winner === "deal_stage" ? base.deal_stage : base.stage, winner, gap_ms: gap,
      reason: `A human changed \`${winner}\` ${Math.round(gap / 86_400_000)} days after the other field; the later edit is what they last believed.` });
  }
  return out;
}

/** Writes BOTH fields to the agreed value, so the record stops disagreeing with itself. */
export async function applyStageReconciliation(workspaceId: string, proposals: StageProposal[]) {
  let updated = 0;
  for (const p of proposals) {
    if (!p.proposed) continue;
    const { data: row } = await supabase
      .from("nodes").select("data").eq("id", p.node_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!row) continue;
    // Read-merge-write: PATCH replaces `data` wholesale, so anything not re-sent would be erased.
    const merged = { ...((row.data ?? {}) as Record<string, unknown>), deal_stage: p.proposed, stage: p.proposed };
    const { error } = await supabase.from("nodes").update({ data: merged })
      .eq("id", p.node_id).eq("workspace_id", workspaceId);
    if (!error) updated++;
  }
  return { updated, skipped: proposals.filter(p => !p.proposed).length };
}

export function renderStageTable(rows: StageProposal[]): string {
  const head = "deal                           | deal_stage   | stage        | → set to     | why";
  const line = "-".repeat(head.length);
  const body = rows.map(r =>
    `${r.name.slice(0, 30).padEnd(30)} | ${(r.deal_stage ?? "—").padEnd(12)} | ${(r.stage ?? "—").padEnd(12)} | ` +
    `${(r.proposed ?? "LEFT ALONE").padEnd(12)} | ${r.reason}`).join("\n");
  return [head, line, body].join("\n");
}

/** Deal stage is resolved through the shared helper everywhere else; re-exported for callers. */
export { dealStageOf };

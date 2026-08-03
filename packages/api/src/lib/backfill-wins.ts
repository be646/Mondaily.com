import { supabase } from "@mondaily/db/client";
import { dealStage, dealValue, isWon, type NodeRow } from "./money";

/**
 * Supervised backfill for deals that are Won but carry no close date.
 *
 * THE RULE THIS ENFORCES, and the reason it will often propose nothing: a close date must come
 * from evidence that the deal actually closed then. Not from when the row was created, not from
 * when it was last edited — both answer questions about the database rather than the business.
 *
 * The brief that commissioned this asked for a `created_at` fallback "as a conservative baseline".
 * It is not conservative; it is a fabricated business event with a plausible-looking timestamp,
 * and it is strictly worse than the current state. Today the Brief says "9 won without a close
 * date", which is true and visibly incomplete. Backfilled from `created_at` it would say
 * "1,422,500 closed won in June" — false, and indistinguishable from a real figure. A number that
 * is wrong in a way nobody can detect is the one failure mode worth refusing outright.
 *
 * So: evidence sources are ranked, and where none exists the deal is reported as `no_evidence`
 * and left alone. A human may still supply a date per deal — that is a decision, recorded with its
 * provenance, not a guess the system made on their behalf.
 */

export type EvidenceSource =
  /** An activity row whose diff shows the stage moving into Won. The only automatic source. */
  | "stage_transition"
  /** The deal's own `closed_at`/`close_date` field, if some import populated one. */
  | "recorded_close_field"
  /** A human supplied this date explicitly for this deal. */
  | "operator_supplied"
  /** Nothing supports a date. Nothing is proposed. */
  | "no_evidence";

export interface WinProposal {
  deal_id: string;
  title: string;
  amount: number;
  /** null whenever the source is `no_evidence` — the whole point of the exercise. */
  proposed_closed_at: string | null;
  source: EvidenceSource;
  /** What was actually inspected, so a reviewer can check the reasoning rather than trust it. */
  evidence_detail: string;
}

const WON_FIELDS = ["closed_at", "close_date", "won_on", "date_won"] as const;

/** Deals that are Won and carry no `won_at`. */
export async function undatedWins(workspaceId: string): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase
      .from("nodes").select("id, data, created_at, updated_at")
      .eq("workspace_id", workspaceId).eq("object_type", "deals")
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read deals: ${error.message}`);
    const page = (data ?? []) as NodeRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.filter(r => isWon(dealStage(r.data)) && !(r.data ?? {}).won_at);
}

/**
 * Look for a real transition into Won in the activity trail.
 *
 * Reads the activity `diff`, not merely the fact that an activity exists: a deal being edited on a
 * date says nothing about when it was won. Only a diff that shows the stage ARRIVING at a won value
 * dates the win, and the earliest such transition is the one that counts — later ones are
 * re-saves of a deal that was already won.
 */
async function transitionEvidence(workspaceId: string, dealId: string): Promise<{ at: string; detail: string } | null> {
  const { data } = await supabase
    .from("activities")
    .select("action, created_at, diff")
    .eq("workspace_id", workspaceId).eq("node_id", dealId)
    .order("created_at", { ascending: true }).limit(500);

  for (const a of data ?? []) {
    const diff = a.diff as Record<string, unknown> | null;
    if (!diff) continue;
    // A diff is stored as { field: { from, to } } or { before, after }. Accept either shape, and
    // require that the AFTER value is won while the BEFORE value is not — an edit that leaves the
    // stage on Won is not the moment it was won.
    const candidates: { before: unknown; after: unknown }[] = [];
    for (const key of ["stage", "deal_stage"]) {
      const entry = diff[key] as { from?: unknown; to?: unknown } | undefined;
      if (entry && typeof entry === "object") candidates.push({ before: entry.from, after: entry.to });
    }
    const before = (diff.before ?? {}) as Record<string, unknown>;
    const after = (diff.after ?? {}) as Record<string, unknown>;
    if (Object.keys(before).length || Object.keys(after).length) {
      candidates.push({ before: before.deal_stage ?? before.stage, after: after.deal_stage ?? after.stage });
    }
    for (const c of candidates) {
      const wasWon = isWon(String(c.before ?? ""));
      const nowWon = isWon(String(c.after ?? ""));
      if (nowWon && !wasWon) {
        return { at: String(a.created_at), detail: `activity "${a.action}" shows stage ${String(c.before ?? "—")} → ${String(c.after ?? "—")}` };
      }
    }
  }
  return null;
}

/**
 * Build a proposal per undated win.
 *
 * `supplied` lets an operator provide a date for specific deals — the only way a deal with no
 * evidence ever gets one, and it is recorded as `operator_supplied` so the provenance survives.
 */
export async function proposeWinDates(
  workspaceId: string,
  supplied: Record<string, string> = {},
): Promise<WinProposal[]> {
  const deals = await undatedWins(workspaceId);
  const out: WinProposal[] = [];

  for (const d of deals) {
    const data = (d.data ?? {}) as Record<string, unknown>;
    const base = {
      deal_id: d.id,
      title: String(data.name ?? data.title ?? "Untitled"),
      amount: dealValue(data),
    };

    // 1. A date the operator decided on, for this specific deal.
    const byHand = supplied[d.id];
    if (byHand && Number.isFinite(Date.parse(byHand))) {
      out.push({ ...base, proposed_closed_at: new Date(byHand).toISOString(), source: "operator_supplied",
        evidence_detail: "supplied by an operator for this deal" });
      continue;
    }

    // 2. A close date already on the record from some earlier import.
    const recorded = WON_FIELDS.map(f => data[f]).find(v => v && Number.isFinite(Date.parse(String(v))));
    if (recorded) {
      out.push({ ...base, proposed_closed_at: new Date(String(recorded)).toISOString(), source: "recorded_close_field",
        evidence_detail: `record already carries ${WON_FIELDS.find(f => data[f] === recorded)}` });
      continue;
    }

    // 3. A real transition in the audit trail.
    const t = await transitionEvidence(workspaceId, d.id);
    if (t) {
      out.push({ ...base, proposed_closed_at: t.at, source: "stage_transition", evidence_detail: t.detail });
      continue;
    }

    // 4. Nothing. Deliberately NOT created_at — see the note at the top of this file.
    out.push({ ...base, proposed_closed_at: null, source: "no_evidence",
      evidence_detail: "no stage-transition activity and no recorded close field; created_at is not evidence of when it was won" });
  }
  return out;
}

/** A monospace table for the dry run, so a reviewer reads rows rather than JSON. */
export function renderProposalTable(proposals: WinProposal[]): string {
  const cols = [
    { h: "DEAL ID", w: 10, get: (p: WinProposal) => p.deal_id.slice(0, 8) },
    { h: "TITLE", w: 28, get: (p: WinProposal) => p.title },
    { h: "AMOUNT", w: 12, get: (p: WinProposal) => p.amount.toLocaleString() },
    { h: "PROPOSED CLOSED_AT", w: 22, get: (p: WinProposal) => p.proposed_closed_at?.slice(0, 19) ?? "— none —" },
    { h: "SOURCE", w: 20, get: (p: WinProposal) => p.source },
  ];
  const pad = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w));
  const line = cols.map(c => "─".repeat(c.w)).join("─┼─");
  const head = cols.map(c => pad(c.h, c.w)).join(" │ ");
  const body = proposals.map(p => cols.map(c => pad(String(c.get(p)), c.w)).join(" │ "));
  const withDate = proposals.filter(p => p.proposed_closed_at).length;
  return [
    head, line, ...body, line,
    `${proposals.length} undated win(s) · ${withDate} with evidence · ${proposals.length - withDate} without`,
    proposals.length - withDate > 0
      ? "Deals without evidence are left alone. created_at is when the row was made, not when the deal was won."
      : "",
  ].filter(Boolean).join("\n");
}

/**
 * Apply the proposals that HAVE a date.
 *
 * Writes `won_at` (the field the money model reads) and records provenance alongside it, so a
 * backfilled date can always be told apart from one the product stamped at the moment of the win.
 */
export async function applyWinDates(workspaceId: string, proposals: WinProposal[]): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0, skipped = 0;

  for (const p of proposals) {
    if (!p.proposed_closed_at) { skipped++; continue; }
    // Re-read rather than trusting the proposal's age: a deal may have been won properly between
    // the dry run and the commit, and overwriting a real date with a backfilled one is exactly the
    // silent overwrite this whole exercise is against.
    const { data: row } = await supabase.from("nodes").select("data")
      .eq("workspace_id", workspaceId).eq("id", p.deal_id).maybeSingle();
    if (!row) { errors.push(`${p.deal_id}: not found`); continue; }
    const data = (row.data ?? {}) as Record<string, unknown>;
    if (data.won_at) { skipped++; continue; }

    const { error } = await supabase.from("nodes")
      .update({ data: { ...data, won_at: p.proposed_closed_at, won_at_source: p.source, won_at_backfilled: true } })
      .eq("workspace_id", workspaceId).eq("id", p.deal_id);
    if (error) errors.push(`${p.deal_id}: ${error.message}`); else updated++;
  }
  return { updated, skipped, errors };
}

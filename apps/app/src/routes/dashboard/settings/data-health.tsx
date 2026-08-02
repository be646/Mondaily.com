import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { FieldSelect } from "../../../components/ui/controls";
import { dialogs } from "../../../components/ui/dialog-service";
import { AlertTriangle, Copy, ShieldCheck, Trash2, Search } from "lucide-react";

/**
 * Data health — the supervised half of the cleaning toolkit.
 *
 * The `/clean` endpoints have been able to find and collapse duplicates for a while; what did not
 * exist was a way for a person to LOOK at what they would do first. That gap is the whole point of
 * this page. Every mutation here is preceded by a dry run the user has actually read, and the two
 * kinds of match are kept visually apart on purpose:
 *
 *  - STRONG (source_url, email) identifies the same entity. Safe to collapse.
 *  - WEAK (name, phone) are candidates only. Two real businesses share a name every day, so these
 *    are shown and never acted on — there is deliberately no button to bulk-resolve them.
 *
 * The server refuses to delete a copy that carries notes, tasks or graph edges, because no merge
 * capability exists to carry them across. Those groups surface here as blocked, with the reason,
 * rather than being quietly dropped from the count.
 */

interface TypeCount { object_type: string; n: number }
interface DupGroup { matched_on: string; value: string; copies: number; node_ids: string[] }
interface DupScan {
  object_type: string;
  total_records: number;
  strong_groups: DupGroup[];
  weak_groups: DupGroup[];
  summary: {
    redundant_records_by_strong_key: number;
    would_remain: number;
    strong_group_count: number;
    weak_group_count: number;
    truncated: boolean;
  };
}
interface DedupePlan {
  dry_run?: boolean;
  summary: {
    total_records: number;
    unkeyed_records_left_alone: number;
    duplicate_groups: number;
    groups_to_collapse: number;
    groups_blocked_by_attachments: number;
    records_to_delete: number;
    would_remain: number;
  };
  plan: { name: string; copies: number; keep: string; delete: number }[];
  blocked: { name: string; copies: number; why: string }[];
  survivor_rule?: string;
  identity_rule?: string;
  deleted?: number;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-2">
      <div className="font-mono text-[16px] tabular-nums" style={{
        color: tone === "warn" ? "var(--status-warn)" : tone === "good" ? "#2f9e6b" : "var(--text-primary)",
      }}>{value}</div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

export function DataHealthSettings() {
  const [objectType, setObjectType] = useState<string>("");
  const [scan, setScan] = useState<DupScan | null>(null);
  const [plan, setPlan] = useState<DedupePlan | null>(null);
  const [executed, setExecuted] = useState<DedupePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: types } = useQuery<{ types: TypeCount[] }>({
    queryKey: ["clean-types"],
    queryFn: () => apiClient.get("/clean/types"),
  });

  const reset = () => { setScan(null); setPlan(null); setExecuted(null); setError(null); };

  const scanMut = useMutation({
    mutationFn: () => apiClient.post<DupScan>("/clean/duplicates", { object_type: objectType }),
    onSuccess: s => { setScan(s); setPlan(null); setExecuted(null); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const planMut = useMutation({
    mutationFn: () => apiClient.post<DedupePlan>("/clean/dedupe-records", { object_type: objectType, dry_run: true }),
    onSuccess: p => { setPlan(p); setExecuted(null); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const applyMut = useMutation({
    mutationFn: () => apiClient.post<DedupePlan>("/clean/dedupe-records", { object_type: objectType, dry_run: false }),
    onSuccess: r => { setExecuted(r); setPlan(null); setError(null); scanMut.mutate(); },
    onError: (e: Error) => setError(e.message),
  });

  // The confirm names the exact counts from the plan the user just read, not a generic warning.
  // "Are you sure?" is not a safety feature; "this deletes 14 records and cannot be undone" is.
  async function confirmAndApply() {
    if (!plan) return;
    const ok = await dialogs.confirm({
      title: `Delete ${plan.summary.records_to_delete} duplicate ${objectType}?`,
      description: `${plan.summary.groups_to_collapse} group${plan.summary.groups_to_collapse === 1 ? "" : "s"} will collapse to one record each, leaving ${plan.summary.would_remain} of ${plan.summary.total_records}. `
        + `The full payload of every deleted record is written to the audit trail, but the records themselves do not come back.`,
      confirmLabel: `Delete ${plan.summary.records_to_delete}`,
      destructive: true,
    });
    if (ok) applyMut.mutate();
  }

  const busy = scanMut.isPending || planMut.isPending || applyMut.isPending;

  return (
    <div className="max-w-3xl">
      <h2 className="text-[15px] font-medium tracking-tight text-[var(--text-primary)]">Data health</h2>
      <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
        Find records that describe the same thing twice, review exactly what would be removed, then decide.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>Record type</label>
          <FieldSelect
            value={objectType}
            onChange={v => { setObjectType(v); reset(); }}
            options={[
              { value: "", label: "Choose a type…" },
              ...(types?.types ?? []).map(t => ({ value: t.object_type, label: `${t.object_type} · ${t.n}` })),
            ]}
          />
        </div>
        <button
          onClick={() => scanMut.mutate()}
          disabled={!objectType || busy}
          className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
        >
          <Search size={12}/>{scanMut.isPending ? "Scanning…" : "Scan for duplicates"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-sm border px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--status-warn)", color: "var(--status-warn)" }}>
          {error}
        </div>
      )}

      {scan && (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="records" value={scan.total_records}/>
            <Stat label="same entity (strong)" value={scan.summary.strong_group_count} tone={scan.summary.strong_group_count ? "warn" : "good"}/>
            <Stat label="candidates (weak)" value={scan.summary.weak_group_count}/>
            <Stat label="would remain" value={scan.summary.would_remain}/>
          </div>
          {scan.summary.truncated && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--status-warn)" }}>
              The scan hit its group cap, so this is a partial picture — clean what is shown and scan again.
            </p>
          )}

          {scan.strong_groups.length > 0 && (
            <section className="mt-5">
              <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
                <Copy size={12}/> Same entity
              </h3>
              <p className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Matched on a source URL or an email address — these are one thing recorded more than once.
              </p>
              <ul className="divide-y divide-[var(--border-faint)] rounded-sm border border-[var(--border-soft)]">
                {scan.strong_groups.slice(0, 40).map((g, i) => (
                  <li key={`${g.matched_on}-${g.value}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                    <span className="truncate" style={{ color: "var(--text-secondary)" }} title={g.value}>{g.value}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {g.matched_on} · {g.copies} copies
                    </span>
                  </li>
                ))}
              </ul>
              {scan.strong_groups.length > 40 && (
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Showing 40 of {scan.strong_groups.length}. The plan below covers all of them.
                </p>
              )}
            </section>
          )}

          {scan.weak_groups.length > 0 && (
            <section className="mt-5">
              <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
                <AlertTriangle size={12} style={{ color: "var(--status-warn)" }}/> Possible duplicates
              </h3>
              <p className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Matched only on a name or a phone number. Two real businesses share a name every day, so
                there is no bulk action here on purpose — open them and decide one at a time.
              </p>
              <ul className="divide-y divide-[var(--border-faint)] rounded-sm border border-[var(--border-soft)]">
                {scan.weak_groups.slice(0, 20).map((g, i) => (
                  <li key={`${g.matched_on}-${g.value}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                    <span className="truncate" style={{ color: "var(--text-secondary)" }} title={g.value}>{g.value}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {g.matched_on} · {g.copies}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {scan.strong_groups.length === 0 && scan.weak_groups.length === 0 && (
            <p className="mt-5 flex items-center gap-1.5 text-[12px]" style={{ color: "#2f9e6b" }}>
              <ShieldCheck size={13}/> No duplicates found in {objectType}.
            </p>
          )}

          {scan.strong_groups.length > 0 && (
            <button
              onClick={() => planMut.mutate()}
              disabled={busy}
              className="mt-5 inline-flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              {planMut.isPending ? "Building plan…" : "Preview what would be removed"}
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="mt-6 rounded-sm border p-4" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
          <h3 className="text-[12px] font-medium text-[var(--text-primary)]">Plan · nothing has changed yet</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="groups to collapse" value={plan.summary.groups_to_collapse}/>
            <Stat label="records deleted" value={plan.summary.records_to_delete} tone="warn"/>
            <Stat label="blocked" value={plan.summary.groups_blocked_by_attachments}/>
            <Stat label="would remain" value={plan.summary.would_remain} tone="good"/>
          </div>
          {plan.survivor_rule && (
            <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Which copy survives: {plan.survivor_rule}. Identity: {plan.identity_rule}
            </p>
          )}

          {/* The scan and the plan apply DIFFERENT identity rules, on purpose: the scan flags a
              shared source URL or email so a human can look, while the plan requires the URL AND a
              matching name before it will delete anything, because one website hosts two real
              businesses often enough to matter. Left unexplained, "1 duplicate found → 0 to remove"
              reads as a broken tool rather than a deliberately cautious one. */}
          {scan && plan.summary.groups_to_collapse < scan.summary.strong_group_count && (
            <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              The scan flagged {scan.summary.strong_group_count} group{scan.summary.strong_group_count === 1 ? "" : "s"} but
              only {plan.summary.groups_to_collapse} can be collapsed automatically. Removing a record needs a
              stricter match than flagging one for review: a shared web address is enough to look, but not
              enough to delete, because one site can host two real businesses.
            </p>
          )}

          {plan.blocked.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium" style={{ color: "var(--status-warn)" }}>
                {plan.blocked.length} group{plan.blocked.length === 1 ? "" : "s"} left alone
              </p>
              <ul className="mt-1 space-y-0.5">
                {plan.blocked.slice(0, 8).map((b, i) => (
                  <li key={i} className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{b.name}</span> — {b.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.summary.records_to_delete > 0 ? (
            <button
              onClick={confirmAndApply}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
              style={{ background: "#d1524a" }}
            >
              <Trash2 size={12}/>{applyMut.isPending ? "Removing…" : `Remove ${plan.summary.records_to_delete} duplicate${plan.summary.records_to_delete === 1 ? "" : "s"}`}
            </button>
          ) : (
            <p className="mt-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Nothing can be removed automatically — every duplicate copy carries notes, tasks or links.
            </p>
          )}
        </div>
      )}

      {executed && (
        <div className="mt-6 rounded-sm border px-4 py-3 text-[12px]"
          style={{ borderColor: "#2f9e6b", color: "var(--text-secondary)" }}>
          Removed {executed.deleted ?? executed.summary.records_to_delete} duplicate records.
          The full payload of each is in the audit trail.
        </div>
      )}
    </div>
  );
}

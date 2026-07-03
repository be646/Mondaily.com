import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface TrainingPolicy {
  enabled: boolean;
  retention_days: number;
  captured: number;
  last_capture_at: string | null;
  last_export_at: string | null;
  last_purge_at: string | null;
  updated_at: string | null;
}

interface ExportPayload { workspace_id: string; exported_at: string; count: number; rows: unknown[] }

const RETENTION_OPTIONS = [30, 90, 180, 365, 730];

function fmt(ts: string | null): string {
  if (!ts) return "Never";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export function TrainingSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["training-policy"], queryFn: () => apiClient.get<TrainingPolicy>("/training/policy") });
  const [busy, setBusy] = useState<"export" | "purge" | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["training-policy"] });

  const savePolicy = useMutation({
    mutationFn: (body: { enabled: boolean; retention_days?: number }) => apiClient.post("/training/policy", body),
    onSuccess: refresh,
  });

  const p = query.data;

  async function exportData() {
    setBusy("export");
    try {
      const payload = await apiClient.get<ExportPayload>("/training/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mondaily-training-export-${payload.exported_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      refresh();
    } finally { setBusy(null); }
  }

  async function purgeData() {
    setBusy("purge");
    try { await apiClient.delete("/training"); setConfirmPurge(false); refresh(); }
    finally { setBusy(null); }
  }

  if (query.isLoading || !p) return <PageSkeleton rows={6} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Training data"
        description="Workspace-controlled AI training capture. Off by default. Only your own approvals/edits are ever captured, and prompts are PII-redacted before storage."
      />

      {/* ── Opt-in ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <ShieldCheck size={14} /> Capture human-in-the-loop training data
          </h2>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${p.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-[var(--surface-hover)] text-[var(--text-muted)]"}`}>
            {p.enabled ? "Enabled" : "Off (default)"}
          </span>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--text-muted)]">
            When enabled, each time a member approves, rejects, or edits an agent recommendation in the Decision Queue, that
            verdict is snapshotted (PII-redacted) so you can later export it to fine-tune your own models. Nothing from
            connected inboxes, calendars, or files is ever captured. Disabling stops all future capture immediately.
          </p>
          <label className="flex items-center gap-3 text-sm text-[var(--text-faint)] cursor-pointer">
            <button
              type="button" role="switch" aria-checked={p.enabled}
              onClick={() => savePolicy.mutate({ enabled: !p.enabled, retention_days: p.retention_days })}
              disabled={savePolicy.isPending} className="md-toggle" data-on={p.enabled}
            >
              <span className="md-toggle-thumb" />
            </button>
            {p.enabled ? "Training capture is enabled for this workspace" : "Enable training capture for this workspace"}
          </label>
        </div>
      </section>

      {/* ── Retention ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Retention period</h2>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-[var(--text-muted)]">Captured examples older than this are automatically deleted by the daily job.</p>
          <div className="flex flex-wrap gap-2">
            {RETENTION_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => savePolicy.mutate({ enabled: p.enabled, retention_days: d })}
                disabled={savePolicy.isPending}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${p.retention_days === d ? "border-[var(--section-accent)] text-[var(--text-primary)]" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Data controls ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Database size={14} /> Your training data</h2>
          <span className="font-mono text-xs text-[var(--text-muted)]">{p.captured.toLocaleString()} example{p.captured === 1 ? "" : "s"}</span>
        </div>
        <div className="space-y-4 p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <div><dt className="text-[var(--text-muted)]">Last capture</dt><dd className="text-[var(--text-faint)] tabular-nums">{fmt(p.last_capture_at)}</dd></div>
            <div><dt className="text-[var(--text-muted)]">Last export</dt><dd className="text-[var(--text-faint)] tabular-nums">{fmt(p.last_export_at)}</dd></div>
            <div><dt className="text-[var(--text-muted)]">Last purge</dt><dd className="text-[var(--text-faint)] tabular-nums">{fmt(p.last_purge_at)}</dd></div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={exportData} disabled={busy !== null || p.captured === 0}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <Download size={13} /> {busy === "export" ? "Exporting…" : "Export training data (JSON)"}
            </button>
            {!confirmPurge ? (
              <button
                onClick={() => setConfirmPurge(true)} disabled={busy !== null || p.captured === 0}
                className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
              >
                <Trash2 size={13} /> Delete all training data
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-faint)]">Delete {p.captured.toLocaleString()} example{p.captured === 1 ? "" : "s"}? This can't be undone.</span>
                <button onClick={purgeData} disabled={busy !== null} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60">
                  {busy === "purge" ? "Deleting…" : "Confirm delete"}
                </button>
                <button onClick={() => setConfirmPurge(false)} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
              </div>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">Export and delete are owner/admin only and act only on this workspace's data.</p>
        </div>
      </section>
    </div>
  );
}

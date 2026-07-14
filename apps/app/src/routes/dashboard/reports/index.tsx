import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, LayoutDashboard, Plus, Zap, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageSkeletonCards, DelayedLoading, ErrorState } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";

interface DashboardItem { id: string; name?: string; updated_at: string; widgets?: unknown[] }
interface ObjectType   { slug: string; name_plural: string }


function NewDashboardDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4">
      <div className="surface-modal w-full max-w-sm rounded-sm p-5 shadow-[0_24px_64px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>New dashboard</h2>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={14}/></button>
        </div>
        <input
          ref={inputRef}
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); if (e.key === "Escape") onClose(); }}
          placeholder="e.g. Sales overview, Q2 metrics…"
          className="key-input w-full mb-3"
        />
        <button
          onClick={() => { if (name.trim()) onCreate(name.trim()); }}
          disabled={!name.trim()}
          className="btn-primary w-full py-2.5 text-sm font-semibold"
        >
          Create dashboard
        </button>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [creating, setCreating] = useState(false);

  // Page-level reports context — no specific report/dashboard selected yet.
  useEffect(() => {
    useAskContextStore.getState().setContext({
      route: "/reports",
      scope_label: "the Reports page",
    });
    return () => useAskContextStore.getState().setContext(null);
  }, []);

  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn:  () => apiClient.get<ObjectType[]>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQ.data ?? [];

  const dashboardsQ = useQuery({
    queryKey: ["dashboards"],
    queryFn:  () => apiClient.get<DashboardItem[]>("/dashboards"),
  });

  const createDashboard = useMutation({
    mutationFn: (name: string) => apiClient.post<DashboardItem>("/dashboards", { name }),
    onSuccess:  item => { qc.invalidateQueries({ queryKey: ["dashboards"] }); navigate(`/reports/dashboards/${item.id}`); },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Shared command header — same pattern as Decisions / Discovery / Agents. Honest state:
          reports recompute from live records; no fabricated "AI ran" claim. */}
      <CommandPageHeader
        icon={BarChart2}
        callsign="SIGNAL"
        title="Reports"
        subtitle="Live analytics computed from your records — AI insight where a run exists."
        status={[{ label: "computed from records", kind: "monitoring" }]}
      />

      {/* ── Live Reports ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Zap size={14} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Live Reports</h2>
          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
            Computed live from your records · AI insights on demand
          </span>
        </div>

        {objectsQ.isLoading ? (
          <DelayedLoading onRetry={() => objectsQ.refetch()}><PageSkeletonCards count={3} label="Loading reports…"/></DelayedLoading>
        ) : objectsQ.isError ? (
          <ErrorState error={objectsQ.error as Error} onRetry={() => objectsQ.refetch()} />
        ) : objects.length === 0 ? (
          <EmptyState icon={BarChart2} title="No object types yet" description="Reports appear here once your workspace has record types to analyse." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {objects.map(obj => (
              <Link
                key={obj.slug}
                to={`/reports/sales?object=${obj.slug}`}
                className="group flex flex-col gap-2.5 overflow-hidden rounded-sm border p-4 transition-colors hover:border-[var(--section-accent)]"
                style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border"
                    style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>
                    <BarChart2 size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{obj.name_plural}</p>
                    {/* Honest scope — live reports recompute from real records on open (no stored run). */}
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>Computed from your {obj.name_plural.toLowerCase()} on open</p>
                  </div>
                  <ArrowRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--section-accent)" }} />
                </div>
                {/* Real capabilities every live report provides — AI is "on demand" (generated on the
                    report page), never claimed as pre-computed. */}
                <div className="flex flex-wrap gap-1">
                  {["KPIs", "Charts", "Filters", "AI insights on demand"].map(cap => (
                    <span key={cap} className="rounded-sm border px-1.5 py-0.5 text-[9.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{cap}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Dashboards ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={14} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dashboards</h2>
            <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
              Pin live widgets &amp; custom charts
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            disabled={createDashboard.isPending}
            className="btn-secondary text-xs"
          >
            <Plus size={11} /> New dashboard
          </button>
        </div>

        {dashboardsQ.isLoading ? (
          <DelayedLoading onRetry={() => dashboardsQ.refetch()}><PageSkeletonCards count={3} label="Loading dashboards…"/></DelayedLoading>
        ) : dashboardsQ.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardsQ.data.map(dashboard => {
              const allWidgets = Array.isArray(dashboard.widgets) ? dashboard.widgets as Array<{ type?: string }> : [];
              const liveCount   = allWidgets.filter(w => w.type === "live").length;
              const reportCount = allWidgets.filter(w => w.type === "report").length;
              const totalCount  = allWidgets.length;
              const otherCount  = Math.max(0, totalCount - liveCount - reportCount);
              // Real widget composition (live / chart / other) — heights proportional to actual counts,
              // not decorative noise.
              const comp = [
                { n: liveCount, color: "#2f9e6b" },
                { n: reportCount, color: "var(--text-secondary)" },
                { n: otherCount, color: "var(--border-strong)" },
              ].filter(x => x.n > 0);
              const compMax = Math.max(1, ...comp.map(x => x.n));
              return (
                <Link
                  key={dashboard.id}
                  to={`/reports/dashboards/${dashboard.id}`}
                  className="surface-card group overflow-hidden rounded-sm transition-colors hover:border-[var(--border-strong)]"
                  style={{ borderColor: "var(--border-soft)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-soft)"; }}
                >
                  {/* Preview area */}
                  <div className="relative h-28 overflow-hidden px-4 pt-3 pb-0" style={{ background: "var(--surface-hover)" }}>
                    {totalCount === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Empty · click to add widgets</p>
                      </div>
                    ) : (
                      <>
                        {/* Widget type badges */}
                        <div className="mb-2 flex gap-1.5">
                          {liveCount > 0 && (
                            <span className="rounded-sm border border-[#2f9e6b]/25 bg-[#2f9e6b]/10 px-2 py-0.5 text-[10px] font-medium text-[#2f9e6b]">
                              {liveCount} live
                            </span>
                          )}
                          {reportCount > 0 && (
                            <span className="rounded-sm border border-stone-500/30 bg-stone-600/10 px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                              {reportCount} chart{reportCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {totalCount > 0 && liveCount === 0 && reportCount === 0 && (
                            <span className="rounded-sm border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                              {totalCount} widget{totalCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {/* Real widget composition — bar per widget type, height ∝ actual count. */}
                        <div className="flex items-end gap-1.5 h-12">
                          {comp.map((seg, i) => (
                            <div key={i} className="flex-1 rounded-t-sm transition-all"
                              style={{ height: `${Math.max(14, (seg.n / compMax) * 100)}%`, background: seg.color, opacity: 0.55 }} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Info row */}
                  <div className="flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--border-soft)" }}>
                    <LayoutDashboard size={13} className="text-[var(--text-muted)] shrink-0"/>
                    <h3 className="flex-1 truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{dashboard.name || "Untitled dashboard"}</h3>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {new Date(dashboard.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="Create a dashboard to pin live object widgets and custom charts side by side."
            action={
              <button onClick={() => setCreating(true)} className="btn-primary text-sm">
                Create dashboard
              </button>
            }
          />
        )}
      </section>

      {creating && (
        <NewDashboardDialog
          onCreate={name => { setCreating(false); createDashboard.mutate(name); }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

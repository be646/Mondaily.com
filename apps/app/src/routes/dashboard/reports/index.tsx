import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, LayoutDashboard, Plus, Zap, ArrowRight, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface DashboardItem { id: string; name?: string; updated_at: string; widgets?: unknown[] }
interface ObjectType   { slug: string; name_plural: string }

const OBJECT_ACCENTS: Record<string, { border: string; bg: string; icon: string; arrow: string }> = {
  deals:      { border: "border-emerald-500/20", bg: "from-emerald-500/[.07] to-blue-500/[.04]",    icon: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", arrow: "text-emerald-400" },
  contacts:   { border: "border-blue-500/20",    bg: "from-blue-500/[.07] to-violet-500/[.04]",     icon: "bg-blue-500/10 border-blue-500/20 text-blue-400",          arrow: "text-blue-400"    },
  companies:  { border: "border-violet-500/20",  bg: "from-violet-500/[.07] to-blue-500/[.04]",     icon: "bg-violet-500/10 border-violet-500/20 text-violet-400",    arrow: "text-violet-400"  },
  properties: { border: "border-amber-500/20",   bg: "from-amber-500/[.07] to-orange-500/[.04]",    icon: "bg-amber-500/10 border-amber-500/20 text-amber-400",       arrow: "text-amber-400"   },
  invoices:   { border: "border-cyan-500/20",    bg: "from-cyan-500/[.07] to-blue-500/[.04]",       icon: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",          arrow: "text-cyan-400"    },
  projects:   { border: "border-rose-500/20",    bg: "from-rose-500/[.07] to-pink-500/[.04]",       icon: "bg-rose-500/10 border-rose-500/20 text-rose-400",          arrow: "text-rose-400"    },
};
const DEFAULT_ACCENT = { border: "border-slate-500/20", bg: "from-slate-500/[.07] to-slate-700/[.04]", icon: "bg-slate-700/50 border-slate-600/30 text-slate-400", arrow: "text-slate-400" };

function NewDashboardDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/[.09] bg-[#0d0f13] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">New dashboard</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors"><X size={14}/></button>
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
          className="flex w-full items-center justify-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-red-400 transition-colors"
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
      <PageHeader
        title="Reports"
        description="Live analytics built directly from your records."
      />

      {/* ── Live Reports ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Zap size={14} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-white">Live Reports</h2>
          <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-slate-500">
            Auto-detects value, status &amp; trends · AI insights included
          </span>
        </div>

        {objectsQ.isLoading ? (
          <div className="h-28 animate-pulse rounded-xl border border-white/[.06] bg-white/[.02]" />
        ) : objects.length === 0 ? (
          <p className="text-sm text-slate-600">No object types found in this workspace.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {objects.map(obj => {
              const c = OBJECT_ACCENTS[obj.slug] ?? DEFAULT_ACCENT;
              return (
                <Link
                  key={obj.slug}
                  to={`/reports/sales?object=${obj.slug}`}
                  className={`group flex items-center gap-4 overflow-hidden rounded-xl border ${c.border} bg-gradient-to-r ${c.bg} p-4 hover:brightness-110 transition-all`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${c.icon}`}>
                    <BarChart2 size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{obj.name_plural}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">KPIs · charts · AI insights · filters</p>
                  </div>
                  <ArrowRight size={14} className={`shrink-0 ${c.arrow} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Dashboards ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={14} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-white">Dashboards</h2>
            <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-slate-500">
              Pin live widgets &amp; custom charts
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            disabled={createDashboard.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <Plus size={11} /> New dashboard
          </button>
        </div>

        {dashboardsQ.isLoading ? (
          <PageSkeleton rows={3} />
        ) : dashboardsQ.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboardsQ.data.map(dashboard => {
              const allWidgets = Array.isArray(dashboard.widgets) ? dashboard.widgets as Array<{ type?: string }> : [];
              const liveCount   = allWidgets.filter(w => w.type === "live").length;
              const reportCount = allWidgets.filter(w => w.type === "report").length;
              const totalCount  = allWidgets.length;
              // Mini bar heights — vary based on dashboard id for visual variety
              const seed = dashboard.id.charCodeAt(0) ?? 0;
              const bars = [4,7,5,9,6,8,3].map((h, i) => Math.max(2, (h + ((seed + i) % 4)) * 7));
              return (
                <Link
                  key={dashboard.id}
                  to={`/reports/dashboards/${dashboard.id}`}
                  className="group overflow-hidden rounded-xl border border-white/[.08] hover:border-white/20 transition-all hover:shadow-lg hover:shadow-black/20"
                >
                  {/* Preview area */}
                  <div className="relative h-28 overflow-hidden bg-gradient-to-br from-slate-800/60 to-slate-900/80 px-4 pt-3 pb-0">
                    {totalCount === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-[11px] text-slate-600">Empty · click to add widgets</p>
                      </div>
                    ) : (
                      <>
                        {/* Widget type badges */}
                        <div className="mb-2 flex gap-1.5">
                          {liveCount > 0 && (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                              {liveCount} live
                            </span>
                          )}
                          {reportCount > 0 && (
                            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                              {reportCount} chart{reportCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {totalCount > 0 && liveCount === 0 && reportCount === 0 && (
                            <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-slate-500">
                              {totalCount} widget{totalCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {/* Decorative mini chart */}
                        <div className="flex items-end gap-1 h-12">
                          {bars.map((h, i) => (
                            <div
                              key={i}
                              className="flex-1 rounded-t-sm transition-all group-hover:opacity-100"
                              style={{ height: h, background: `rgba(239,68,68,${0.15 + i * 0.04})` }}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Info row */}
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[.05]">
                    <LayoutDashboard size={13} className="text-red-400 shrink-0"/>
                    <h3 className="flex-1 truncate text-sm font-medium text-white">{dashboard.name || "Untitled dashboard"}</h3>
                    <span className="shrink-0 text-[10px] text-slate-600">
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
              <button onClick={() => setCreating(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
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

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Zap, Mail, GitBranch, Play, Pause, MoreHorizontal, Trash2, Copy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";

interface Automation {
  id: string;
  name: string;
  type: "workflow" | "sequence";
  status: string;
  updated_at: string;
  data?: { steps?: unknown[]; enrollments?: unknown[] };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    draft:    "bg-slate-700/50 text-slate-400 border-slate-600/30",
    paused:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    archived: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${map[status] ?? map.draft}`}>
      {status}
    </span>
  );
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiClient.get<Automation[]>("/automations"),
  });
  const items = query.data ?? [];
  const sequences = items.filter(i => i.data && (i.data as any).type === "sequence" || !i.type || i.type === "sequence");
  const workflows  = items.filter(i => (i.data as any)?.type === "workflow" || i.type === "workflow");

  const createSequence = useMutation({
    mutationFn: () => apiClient.post<{ id: string }>("/sequences/new", {
      name: "New Sequence",
      stop_on_reply: true,
      sending_days: ["Mon","Tue","Wed","Thu","Fri"],
      send_start: "09:00",
      send_end: "17:00",
      daily_limit: 50,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unsubscribe: true,
    }),
    onSuccess: (seq) => navigate(`/automations/sequences/${seq.id}`),
  });

  function formatDate(s: string) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const Section = ({ title, icon: Icon, items, newHref, newLabel, onNew }: {
    title: string; icon: any; items: Automation[]; newHref?: string; newLabel: string; onNew?: () => void;
  }) => (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-slate-500"/>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">{items.length}</span>
        </div>
        {onNew ? (
          <button
            onClick={onNew}
            disabled={createSequence.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors disabled:opacity-50"
          >
            <Plus size={11}/> {newLabel}
          </button>
        ) : (
          <Link
            to={newHref!}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors"
          >
            <Plus size={11}/> {newLabel}
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[.08] px-6 py-8 text-center">
          <Icon size={20} className="mx-auto mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No {title.toLowerCase()} yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[.08]">
          {items.map((item, i) => {
            const steps = (item.data as any)?.steps?.length ?? 0;
            const enrolled = (item.data as any)?.enrollments?.length ?? 0;
            const href = title.toLowerCase().includes("sequence")
              ? `/automations/sequences/${item.id}`
              : `/automations/workflows/${item.id}`;
            return (
              <div
                key={item.id}
                className={`group relative flex items-center gap-4 px-4 py-3.5 hover:bg-white/[.02] transition-colors ${i < items.length - 1 ? "border-b border-white/[.06]" : ""}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${title.toLowerCase().includes("sequence") ? "border-purple-500/20 bg-purple-500/[.08] text-purple-400" : "border-red-500/20 bg-red-500/[.08] text-red-400"}`}>
                  <Icon size={14}/>
                </div>

                <Link to={href} className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {steps > 0 ? `${steps} step${steps !== 1 ? "s" : ""}` : "No steps"}
                    {enrolled > 0 ? ` · ${enrolled} enrolled` : ""}
                    {item.updated_at ? ` · Updated ${formatDate(item.updated_at)}` : ""}
                  </p>
                </Link>

                <StatusBadge status={(item.data as any)?.status ?? item.status ?? "draft"}/>

                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === item.id ? null : item.id); }}
                    className="rounded-md p-1.5 text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-white/[.06] hover:text-slate-300 transition-all"
                  >
                    <MoreHorizontal size={14}/>
                  </button>
                  {menuOpen === item.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)}/>
                      <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-lg border border-white/[.08] bg-[#13151a] shadow-xl">
                        <Link to={href} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white">
                          <Play size={11}/> Open
                        </Link>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white">
                          <Copy size={11}/> Duplicate
                        </button>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/[.06]">
                          <Trash2 size={11}/> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[.06] px-6 py-3">
        <Zap size={16} className="text-red-400"/>
        <h1 className="flex-1 text-[15px] font-semibold text-white tracking-tight">Automations</h1>
        <button
          onClick={() => createSequence.mutate()}
          disabled={createSequence.isPending}
          className="flex items-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition-all active:translate-y-[1px] disabled:opacity-50"
        >
          <Plus size={13}/> New sequence
        </button>
      </div>

      {query.isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500"/>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-6 max-w-4xl">
          <Section
            title="Email Sequences"
            icon={Mail}
            items={items.filter(i => (i.data as any)?.type === "sequence" || !(i.data as any)?.type)}
            newLabel="New sequence"
            onNew={() => createSequence.mutate()}
          />
          <Section
            title="Workflows"
            icon={GitBranch}
            items={items.filter(i => (i.data as any)?.type === "workflow")}
            newHref="/automations/workflows/new"
            newLabel="New workflow"
          />
        </div>
      )}
    </div>
  );
}

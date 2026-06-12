import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, DollarSign, User, ChevronRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface DealRecord {
  id: string;
  object_type: string;
  data: Record<string, unknown>;
  updated_at: string;
}

interface Member { id: string; name: string; email: string; avatar_url?: string | null }

const STAGES = ["Lead", "Qualified", "In Progress", "Proposal", "Negotiation", "Closed Won", "Closed Lost"] as const;
type Stage = typeof STAGES[number];

const STAGE_META: Record<Stage, { color: string; dot: string; bg: string }> = {
  "Lead":        { color: "text-slate-300",   dot: "bg-slate-400",   bg: "bg-slate-500/10"  },
  "Qualified":   { color: "text-blue-300",    dot: "bg-blue-400",    bg: "bg-blue-500/10"   },
  "In Progress": { color: "text-violet-300",  dot: "bg-violet-400",  bg: "bg-violet-500/10" },
  "Proposal":    { color: "text-amber-300",   dot: "bg-amber-400",   bg: "bg-amber-500/10"  },
  "Negotiation": { color: "text-orange-300",  dot: "bg-orange-400",  bg: "bg-orange-500/10" },
  "Closed Won":  { color: "text-emerald-300", dot: "bg-emerald-400", bg: "bg-emerald-500/10"},
  "Closed Lost": { color: "text-red-300",     dot: "bg-red-400",     bg: "bg-red-500/10"    },
};

function fmt(v: unknown) {
  if (v == null || v === "") return null;
  return String(v);
}

function fmtValue(v: unknown) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (isNaN(n)) return String(v);
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;
}

function memberInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Deal card ────────────────────────────────────────────────────────────────
function DealCard({
  deal, members, onMove,
}: {
  deal: DealRecord;
  members: Member[];
  onMove: (stage: Stage) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const d = deal.data;
  const name  = fmt(d.name ?? d.title) ?? "Untitled deal";
  const value = fmtValue(d.deal_value);
  const owner = fmt(d.deal_owner ?? d.assigned_to);
  const ownerMember = owner ? members.find(m => m.id === owner || m.name === owner || m.email === owner) : null;
  const stage = String(d.deal_stage ?? "Lead") as Stage;
  const meta  = STAGE_META[stage] ?? STAGE_META["Lead"];

  return (
    <div className="group rounded-lg border border-white/[.06] bg-[#0d0f13] hover:border-white/[.11] transition-colors p-3 cursor-default">
      {/* Header: name + link */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          to={`/objects/deals/${deal.id}`}
          className="text-sm font-medium text-white hover:text-red-300 transition-colors leading-snug line-clamp-2 flex-1"
        >
          {name}
        </Link>
        <Link to={`/objects/deals/${deal.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-400">
          <ChevronRight size={13}/>
        </Link>
      </div>

      {/* Value row */}
      {value && (
        <div className="flex items-center gap-1 mb-2">
          <DollarSign size={11} className="text-emerald-400 shrink-0"/>
          <span className="text-xs font-semibold text-emerald-400">{value}</span>
        </div>
      )}

      {/* Owner */}
      {ownerMember ? (
        <div className="flex items-center gap-1.5 mb-3">
          <div className="h-5 w-5 rounded-full bg-red-500/20 border border-red-500/20 flex items-center justify-center text-[9px] font-bold text-red-300">
            {memberInitials(ownerMember.name)}
          </div>
          <span className="text-xs text-slate-500">{ownerMember.name}</span>
        </div>
      ) : owner ? (
        <div className="flex items-center gap-1.5 mb-3">
          <User size={11} className="text-slate-600"/>
          <span className="text-xs text-slate-500">{owner}</span>
        </div>
      ) : null}

      {/* Move stage button */}
      <div className="relative">
        <button
          onClick={() => setMoveOpen(o => !o)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold border border-white/[.06] transition-colors ${meta.bg} ${meta.color}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}/>
          {stage}
          <ChevronRight size={9} className={`transition-transform ${moveOpen ? "rotate-90" : ""}`}/>
        </button>
        {moveOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-white/[.08] bg-[#13151c] py-1 shadow-xl"
            onMouseLeave={() => setMoveOpen(false)}
          >
            {STAGES.map(s => {
              const m = STAGE_META[s];
              return (
                <button
                  key={s}
                  onClick={() => { onMove(s); setMoveOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${s === stage ? `${m.color} font-semibold` : "text-slate-400 hover:text-white hover:bg-white/[.03]"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`}/>
                  {s}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pipeline page ────────────────────────────────────────────────────────────
export function PipelinePage() {
  const qc = useQueryClient();

  const dealsQuery = useQuery({
    queryKey: ["pipeline-deals"],
    queryFn: async () => {
      const all = await apiClient.get<DealRecord[]>("/nodes?limit=200");
      return all.filter(n => n.object_type.toLowerCase().includes("deal"));
    },
  });

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
  });

  const moveDeal = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.patch(`/nodes/${id}`, { data }),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["pipeline-deals"] });
      const prev = qc.getQueryData<DealRecord[]>(["pipeline-deals"]);
      qc.setQueryData<DealRecord[]>(["pipeline-deals"], old =>
        (old ?? []).map(d => d.id === id ? { ...d, data: { ...d.data, ...data } } : d)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["pipeline-deals"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pipeline-deals"] }),
  });

  const deals    = dealsQuery.data ?? [];
  const members  = membersQuery.data ?? [];

  const byStage = STAGES.reduce((acc, s) => {
    acc[s] = deals.filter(d => String(d.data.deal_stage ?? "Lead") === s);
    return acc;
  }, {} as Record<Stage, DealRecord[]>);

  const totalValue = deals.reduce((sum, d) => {
    const v = parseFloat(String(d.data.deal_value ?? 0));
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  const wonValue = byStage["Closed Won"].reduce((sum, d) => {
    const v = parseFloat(String(d.data.deal_value ?? 0));
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[.06] px-6 py-4 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-white">Sales Pipeline</h1>
          <p className="mt-0.5 text-xs text-slate-600">
            {deals.length} deal{deals.length !== 1 ? "s" : ""} ·{" "}
            <span className="text-emerald-400">{fmtValue(wonValue) ?? "$0"} won</span>
            {totalValue > 0 && <> · <span className="text-slate-400">{fmtValue(totalValue) ?? "$0"} total pipeline</span></>}
          </p>
        </div>
        <Link
          to="/objects/deals"
          className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors"
        >
          <Plus size={12}/> New deal
        </Link>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 min-h-0 overflow-x-auto px-4 py-4 gap-3">
        {STAGES.map(stage => {
          const cards = byStage[stage];
          const meta  = STAGE_META[stage];
          const stageValue = cards.reduce((s, d) => {
            const v = parseFloat(String(d.data.deal_value ?? 0));
            return s + (isNaN(v) ? 0 : v);
          }, 0);

          return (
            <div
              key={stage}
              className="flex flex-col shrink-0 w-[220px] rounded-xl border border-white/[.06] bg-white/[.015] overflow-hidden"
            >
              {/* Column header */}
              <div className="px-3 py-2.5 border-b border-white/[.06]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`}/>
                    <span className={`text-xs font-semibold ${meta.color}`}>{stage}</span>
                  </div>
                  <span className="rounded-full bg-white/[.06] px-1.5 py-0.5 text-[10px] text-slate-500 font-medium">{cards.length}</span>
                </div>
                {stageValue > 0 && (
                  <p className="mt-1 text-[10px] text-slate-600 pl-4">{fmtValue(stageValue)}</p>
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
                {dealsQuery.isLoading ? (
                  <div className="space-y-2">
                    {[1,2].map(i => <div key={i} className="h-20 rounded-lg bg-white/[.03] animate-pulse"/>)}
                  </div>
                ) : cards.length === 0 ? (
                  <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-white/[.05]">
                    <span className="text-[10px] text-slate-700">No deals</span>
                  </div>
                ) : (
                  cards.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      members={members}
                      onMove={newStage => moveDeal.mutate({ id: deal.id, data: { ...deal.data, deal_stage: newStage } })}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

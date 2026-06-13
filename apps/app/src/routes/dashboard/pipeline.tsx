import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Plus, DollarSign, User, ChevronRight, ChevronDown, X, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface DealRecord {
  id: string;
  object_type: string;
  data: Record<string, unknown>;
  updated_at: string;
}

interface Member { id: string; name: string; email: string; avatar_url?: string | null }

const DEFAULT_STAGES = ["Lead", "Qualified", "In Progress", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

const STAGE_DOT: Record<string, string> = {
  "Lead":        "bg-zinc-400",
  "Qualified":   "bg-blue-400",
  "In Progress": "bg-violet-400",
  "Proposal":    "bg-amber-400",
  "Negotiation": "bg-orange-400",
  "Closed Won":  "bg-emerald-400",
  "Closed Lost": "bg-red-400",
};
const STAGE_TEXT: Record<string, string> = {
  "Lead":        "text-zinc-300",
  "Qualified":   "text-blue-300",
  "In Progress": "text-violet-300",
  "Proposal":    "text-amber-300",
  "Negotiation": "text-orange-300",
  "Closed Won":  "text-emerald-300",
  "Closed Lost": "text-red-300",
};

function dotColor(stage: string) { return STAGE_DOT[stage] ?? "bg-zinc-500"; }
function textColor(stage: string) { return STAGE_TEXT[stage] ?? "text-zinc-300"; }

function fmtVal(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function fmtDisplay(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n.toLocaleString()}`;
}

function memberInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Calc types ───────────────────────────────────────────────────────────────
type CalcType = "count" | "count_empty" | "count_filled" | "pct_empty" | "pct_filled" | "sum" | "avg" | "max" | "min";
const CALC_LABELS: Record<CalcType, string> = {
  count: "Count", count_empty: "Count empty", count_filled: "Count filled",
  pct_empty: "% empty", pct_filled: "% filled",
  sum: "Sum", avg: "Average", max: "Max", min: "Min",
};

function calcResult(cards: DealRecord[], type: CalcType): string {
  const total = cards.length;
  if (total === 0) return "—";
  const vals = cards.map(d => fmtVal(d.data.deal_value)).filter((n): n is number => n !== null);
  switch (type) {
    case "count":        return String(total);
    case "count_empty":  return String(total - vals.length);
    case "count_filled": return String(vals.length);
    case "pct_empty":    return `${Math.round(((total - vals.length) / total) * 100)}%`;
    case "pct_filled":   return `${Math.round((vals.length / total) * 100)}%`;
    case "sum":          return vals.length ? fmtDisplay(vals.reduce((a, b) => a + b, 0)) : "—";
    case "avg":          return vals.length ? fmtDisplay(vals.reduce((a, b) => a + b, 0) / vals.length) : "—";
    case "max":          return vals.length ? fmtDisplay(Math.max(...vals)) : "—";
    case "min":          return vals.length ? fmtDisplay(Math.min(...vals)) : "—";
  }
}

// ─── Calc footer dropdown ─────────────────────────────────────────────────────
function CalcFooter({ cards }: { cards: DealRecord[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CalcType>("sum");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const result = calcResult(cards, type);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors border-t border-zinc-800/50"
      >
        <span className="text-zinc-600">{CALC_LABELS[type]}</span>
        <div className="flex items-center gap-1">
          <span className="font-medium text-zinc-400">{result}</span>
          <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
        </div>
      </button>
      {open && (
        <div className="dropdown-panel absolute bottom-full left-0 right-0 mb-1">
          {(Object.keys(CALC_LABELS) as CalcType[]).map(t => (
            <button
              key={t}
              onClick={() => { setType(t); setOpen(false); }}
              className={`dropdown-item justify-between ${t === type ? "dropdown-item-active" : ""}`}
            >
              <span>{CALC_LABELS[t]}</span>
              {t === type && <Check size={10} className="text-zinc-300"/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Move stage pill dropdown ─────────────────────────────────────────────────
function StagePill({ stage, stages, onMove }: { stage: string; stages: string[]; onMove: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold border border-white/[.05] transition-colors bg-zinc-900/60 ${textColor(stage)}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor(stage)}`}/>
        {stage}
        <ChevronRight size={9} className={`transition-transform ${open ? "rotate-90" : ""}`}/>
      </button>
      {open && (
        <div className="dropdown-panel absolute left-0 top-full">
          {stages.map(s => (
            <button
              key={s}
              onClick={() => { onMove(s); setOpen(false); }}
              className={`dropdown-item ${s === stage ? "dropdown-item-active" : ""}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dotColor(s)}`}/>
              <span className={s === stage ? textColor(s) : ""}>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Deal card ────────────────────────────────────────────────────────────────
function DealCard({ deal, members, stages, onMove }: {
  deal: DealRecord; members: Member[]; stages: string[]; onMove: (stage: string) => void;
}) {
  const d = deal.data;
  const name  = String(d.name ?? d.title ?? "Untitled deal");
  const value = fmtVal(d.deal_value);
  const owner = String(d.deal_owner ?? d.assigned_to ?? "");
  const ownerMember = owner ? members.find(m => m.id === owner || m.name === owner || m.email === owner) : null;
  const stage = String(d.deal_stage ?? "Lead");

  return (
    <div className="group rounded-md border border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/60 hover:bg-zinc-900/70 transition-all p-3 cursor-default">
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          to={`/objects/deals/${deal.id}`}
          className="text-[12px] font-medium text-zinc-100 hover:text-white transition-colors leading-snug line-clamp-2 flex-1"
        >
          {name}
        </Link>
        <Link to={`/objects/deals/${deal.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-zinc-400">
          <ChevronRight size={12}/>
        </Link>
      </div>

      {value !== null && (
        <div className="flex items-center gap-1 mb-2">
          <DollarSign size={10} className="text-emerald-400 shrink-0"/>
          <span className="text-[11px] font-semibold text-emerald-400">{fmtDisplay(value)}</span>
        </div>
      )}

      {ownerMember ? (
        <div className="flex items-center gap-1.5 mb-2.5">
          <div className="h-4 w-4 rounded-full bg-red-500/20 flex items-center justify-center text-[8px] font-bold text-red-300">
            {memberInitials(ownerMember.name)}
          </div>
          <span className="text-[10px] text-zinc-500">{ownerMember.name}</span>
        </div>
      ) : owner ? (
        <div className="flex items-center gap-1.5 mb-2.5">
          <User size={10} className="text-zinc-600"/>
          <span className="text-[10px] text-zinc-500">{owner}</span>
        </div>
      ) : null}

      <StagePill stage={stage} stages={stages} onMove={onMove}/>
    </div>
  );
}

// ─── Create deal modal (same as deals page) ───────────────────────────────────
function CreateDealModal({ defaultStage, onClose, onCreated }: {
  defaultStage: string; onClose: () => void; onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const AUTO = new Set(["updated_at", "created_at", "workspace_id", "id"]);
  const cached = (queryClient.getQueryData<Array<{ data: Record<string, unknown> }>>(["records", "deals"])) ?? [];
  const cols = Array.from(new Set(cached.flatMap(r => Object.keys(r.data)))).filter(k => !AUTO.has(k)).slice(0, 8);
  const fieldKeys = cols.length > 0 ? cols : ["name", "deal_stage", "deal_value", "deal_owner"];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init = Object.fromEntries(fieldKeys.map(k => [k, ""]));
    init.deal_stage = defaultStage;
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k.trim()) data[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      await apiClient.post("/nodes", { vertical: "shared", object_type: "deals", data });
      queryClient.invalidateQueries({ queryKey: ["pipeline-deals"] });
      queryClient.invalidateQueries({ queryKey: ["records", "deals"] });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create deal");
    } finally { setSaving(false); }
  }, [values, queryClient, onClose, onCreated]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-white tracking-tight">New Deal</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border border-white/[.05] bg-zinc-900/60 ${textColor(defaultStage)}`}>
              {defaultStage}
            </span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
          {fieldKeys.map(k => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-white/[.04] last:border-0">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600 select-none truncate">{label(k)}</span>
              <input
                value={values[k] ?? ""}
                onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                placeholder="—"
                className="w-full rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-sm text-white placeholder-slate-700 outline-none focus:border-red-500/30 focus:bg-white/[.05] transition-colors"
              />
            </div>
          ))}
          {error && <p className="pt-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[.06] px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border-x border-t border-white/[.08] border-b-2 border-b-white/[.14] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 transition-all hover:bg-white/[.05] hover:text-white active:translate-y-[1px]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create deal"}
            <kbd className="rounded border border-red-400/40 bg-red-600/40 px-1.5 py-0.5 text-[10px] font-normal text-red-200/70">⌘↵</kbd>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Pipeline page ────────────────────────────────────────────────────────────
export function PipelinePage() {
  const qc = useQueryClient();
  const [stages, setStages] = useState<string[]>(DEFAULT_STAGES);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [createForStage, setCreateForStage] = useState<string | null>(null);
  const newStageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingStage) setTimeout(() => newStageRef.current?.focus(), 50);
  }, [addingStage]);

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

  const deals   = dealsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const byStage = stages.reduce((acc, s) => {
    acc[s] = deals.filter(d => String(d.data.deal_stage ?? "Lead") === s);
    return acc;
  }, {} as Record<string, DealRecord[]>);

  const totalValue = deals.reduce((sum, d) => {
    const v = fmtVal(d.data.deal_value); return sum + (v ?? 0);
  }, 0);
  const wonValue = (byStage["Closed Won"] ?? []).reduce((sum, d) => {
    const v = fmtVal(d.data.deal_value); return sum + (v ?? 0);
  }, 0);

  function commitNewStage() {
    const name = newStageName.trim();
    if (name && !stages.includes(name)) setStages(prev => [...prev, name]);
    setNewStageName("");
    setAddingStage(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/50 px-6 py-3 shrink-0">
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500 select-none">Pipeline</span>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {deals.length} deal{deals.length !== 1 ? "s" : ""}
            {wonValue > 0 && <> · <span className="text-emerald-500">{fmtDisplay(wonValue)} won</span></>}
            {totalValue > 0 && <> · <span className="text-zinc-500">{fmtDisplay(totalValue)} pipeline</span></>}
          </p>
        </div>
        <button
          onClick={() => setCreateForStage(stages[0] ?? "Lead")}
          className="flex items-center gap-1.5 rounded-md border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-red-400 active:translate-y-[1px] active:border-b active:border-b-red-500/50"
        >
          <Plus size={11}/> New deal
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 min-h-0 overflow-x-auto px-4 py-4 gap-2">
        {stages.map(stage => {
          const cards = byStage[stage] ?? [];
          return (
            <div
              key={stage}
              className="flex flex-col shrink-0 w-[220px] border border-zinc-800/50 rounded-lg overflow-hidden bg-transparent"
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/50 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor(stage)}`}/>
                  <span className={`text-[11px] font-semibold truncate ${textColor(stage)}`}>{stage}</span>
                  <span className="text-[10px] text-zinc-600 font-medium shrink-0">{cards.length}</span>
                </div>
                <button
                  onClick={() => setCreateForStage(stage)}
                  className="flex items-center justify-center h-5 w-5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all shrink-0"
                  title={`Add deal to ${stage}`}
                >
                  <Plus size={11}/>
                </button>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[80px]">
                {dealsQuery.isLoading ? (
                  <div className="space-y-1.5">
                    {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-zinc-800/20 animate-pulse"/>)}
                  </div>
                ) : cards.length === 0 ? (
                  <button
                    onClick={() => setCreateForStage(stage)}
                    className="flex w-full h-12 items-center justify-center rounded-md border border-dashed border-zinc-800/60 hover:border-zinc-700/60 hover:bg-zinc-800/20 transition-all group/empty"
                  >
                    <Plus size={11} className="text-zinc-700 group-hover/empty:text-zinc-500 transition-colors"/>
                  </button>
                ) : (
                  cards.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      members={members}
                      stages={stages}
                      onMove={newStage => moveDeal.mutate({ id: deal.id, data: { ...deal.data, deal_stage: newStage } })}
                    />
                  ))
                )}
              </div>

              {/* Calc footer */}
              <CalcFooter cards={cards}/>
            </div>
          );
        })}

        {/* Add new stage column */}
        {addingStage ? (
          <div className="flex flex-col shrink-0 w-[220px] border border-zinc-700/60 rounded-lg overflow-hidden bg-transparent">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800/50">
              <input
                ref={newStageRef}
                value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitNewStage();
                  if (e.key === "Escape") { setAddingStage(false); setNewStageName(""); }
                }}
                placeholder="Stage name…"
                className="flex-1 bg-transparent text-[11px] text-white placeholder-zinc-600 outline-none"
              />
              <button onClick={commitNewStage} className="text-zinc-500 hover:text-emerald-400 transition-colors"><Check size={12}/></button>
              <button onClick={() => { setAddingStage(false); setNewStageName(""); }} className="text-zinc-600 hover:text-zinc-300 transition-colors"><X size={12}/></button>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[80px]">
              <span className="text-[10px] text-zinc-700">New stage</span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingStage(true)}
            className="flex shrink-0 w-[220px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-800/60 hover:border-zinc-700/60 hover:bg-zinc-900/20 transition-all text-zinc-600 hover:text-zinc-400 self-start min-h-[80px]"
          >
            <Plus size={13}/>
            <span className="text-[10px]">Add stage</span>
          </button>
        )}
      </div>

      {/* Create deal modal */}
      {createForStage && (
        <CreateDealModal
          defaultStage={createForStage}
          onClose={() => setCreateForStage(null)}
          onCreated={() => setCreateForStage(null)}
        />
      )}
    </div>
  );
}

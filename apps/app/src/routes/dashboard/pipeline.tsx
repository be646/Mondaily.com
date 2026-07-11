import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Plus, DollarSign, User, ChevronRight, ChevronDown, X, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useCurrency, convertAmount, CURRENCY_SYMBOL } from "../../hooks/useCurrency";

interface DealRecord {
  id: string;
  object_type: string;
  data: Record<string, unknown>;
  updated_at: string;
}

interface Member { id: string; name: string; email: string; avatar_url?: string | null }

const DEFAULT_STAGES = ["Lead", "Qualified", "In Progress", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

const STAGE_DOT: Record<string, string> = {
  "Lead":        "bg-stone-400",
  "Qualified":   "bg-[#717784]",
  "In Progress": "bg-stone-400",
  "Proposal":    "bg-[#97824f]",
  "Negotiation": "bg-[#a68762]",
  "Closed Won":  "bg-[#5f8169]",
  "Closed Lost": "bg-stone-400",
};
const STAGE_TEXT: Record<string, string> = {
  "Lead":        "text-stone-300",
  "Qualified":   "text-[#717784]",
  "In Progress": "text-stone-300",
  "Proposal":    "text-[#97824f]",
  "Negotiation": "text-[#a68762]",
  "Closed Won":  "text-[#5f8169]",
  "Closed Lost": "text-stone-300",
};

function dotColor(stage: string) { return STAGE_DOT[stage] ?? "bg-stone-500"; }
function textColor(stage: string) { return STAGE_TEXT[stage] ?? "text-stone-300"; }

function fmtVal(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function fmtDisplay(n: number, sym = "$") {
  return n >= 1_000_000 ? `${sym}${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${sym}${(n / 1_000).toFixed(0)}K`
    : `${sym}${n.toLocaleString()}`;
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

function calcResult(cards: DealRecord[], type: CalcType, dealValue: (d: DealRecord) => number | null = (d) => fmtVal(d.data.deal_value), sym = "$"): string {
  const total = cards.length;
  if (total === 0) return "—";
  const vals = cards.map(dealValue).filter((n): n is number => n !== null);
  switch (type) {
    case "count":        return String(total);
    case "count_empty":  return String(total - vals.length);
    case "count_filled": return String(vals.length);
    case "pct_empty":    return `${Math.round(((total - vals.length) / total) * 100)}%`;
    case "pct_filled":   return `${Math.round((vals.length / total) * 100)}%`;
    case "sum":          return vals.length ? fmtDisplay(vals.reduce((a, b) => a + b, 0), sym) : "—";
    case "avg":          return vals.length ? fmtDisplay(vals.reduce((a, b) => a + b, 0) / vals.length, sym) : "—";
    case "max":          return vals.length ? fmtDisplay(Math.max(...vals), sym) : "—";
    case "min":          return vals.length ? fmtDisplay(Math.min(...vals), sym) : "—";
  }
}

// ─── Calc footer dropdown ─────────────────────────────────────────────────────
function CalcFooter({ cards, dealValue, sym }: { cards: DealRecord[]; dealValue?: (d: DealRecord) => number | null; sym?: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CalcType>("sum");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const result = calcResult(cards, type, dealValue, sym);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:bg-stone-800/30 transition-colors border-t border-stone-800/50"
      >
        <span className="text-[var(--text-secondary)]">{CALC_LABELS[type]}</span>
        <div className="flex items-center gap-1">
          <span className="font-medium text-[var(--text-faint)]">{result}</span>
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
              {t === type && <Check size={10} className="text-[var(--text-faint)]"/>}
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
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold border border-[var(--border-soft)] transition-colors bg-stone-900/60 ${textColor(stage)}`}
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

// ─── Inline editable field for pipeline cards ─────────────────────────────────
function CardField({
  value, onSave, placeholder = "—", numeric = false, className = "",
}: {
  value: string; onSave: (v: string) => void; placeholder?: string;
  numeric?: boolean; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) onSave(trimmed);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={numeric ? "number" : "text"}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
          e.stopPropagation();
        }}
        className={`w-full bg-stone-800 text-[11px] text-[var(--text-primary)] outline-none rounded px-1.5 py-0.5 border border-stone-600/60 ${numeric ? "text-right font-mono" : ""} ${className}`}
      />
    );
  }

  const shown = value || placeholder;
  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`block truncate cursor-text text-[11px] ${value ? "" : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"} ${className}`}
    >
      {shown}
    </span>
  );
}

// ─── Deal card ────────────────────────────────────────────────────────────────
function DealCard({ deal, members, stages, onMove, onPatch }: {
  deal: DealRecord; members: Member[]; stages: string[];
  onMove: (stage: string) => void;
  onPatch: (fields: Record<string, unknown>) => void;
}) {
  const d = deal.data;
  const name  = String(d.name ?? d.title ?? "");
  const value = fmtVal(d.deal_value);
  const owner = String(d.deal_owner ?? d.assigned_to ?? "");
  const ownerMember = owner ? members.find(m => m.id === owner || m.name === owner || m.email === owner) : null;
  const stage = String(d.deal_stage ?? "Lead");

  return (
    <div className="group rounded-md border border-stone-800/60 bg-stone-900/40 hover:border-stone-700/60 hover:bg-stone-900/70 transition-all p-3 cursor-default">
      {/* Name row */}
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        <CardField
          value={name}
          onSave={v => onPatch({ name: v })}
          placeholder="Untitled deal"
          className="flex-1 font-medium text-[var(--text-primary)]"
        />
        <Link to={`/objects/deals/${deal.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-secondary)] hover:text-[var(--text-faint)]">
          <ChevronRight size={12}/>
        </Link>
      </div>

      {/* Value row */}
      <div className="flex items-center gap-1 mb-2">
        <DollarSign size={10} className="text-[#5f8169] shrink-0"/>
        <CardField
          value={value !== null ? String(deal.data.deal_value) : ""}
          onSave={v => onPatch({ deal_value: v === "" ? null : v })}
          placeholder="Value…"
          numeric
          className="flex-1 text-[#5f8169] font-semibold"
        />
      </div>

      {/* Owner row */}
      <div className="flex items-center gap-1.5 mb-2.5">
        {ownerMember ? (
          <div className="h-4 w-4 rounded-full bg-stone-500/20 flex items-center justify-center text-[8px] font-bold text-[var(--text-faint)] shrink-0">
            {memberInitials(ownerMember.name)}
          </div>
        ) : (
          <User size={10} className="text-[var(--text-faint)] shrink-0"/>
        )}
        <CardField
          value={owner}
          onSave={v => onPatch({ deal_owner: v })}
          placeholder="Owner…"
          className="flex-1 text-[var(--text-muted)]"
        />
      </div>

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
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_24px_64px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">New Deal</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border border-[var(--border-soft)] bg-stone-900/60 ${textColor(defaultStage)}`}>
              {defaultStage}
            </span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="max-h-[400px] overflow-auto px-5 py-4 space-y-0.5">
          {fieldKeys.map(k => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-[var(--border-soft)] last:border-0">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)] select-none truncate">{label(k)}</span>
              <input
                value={values[k] ?? ""}
                onChange={e => setValues(prev => ({ ...prev, [k]: e.target.value }))}
                placeholder="—"
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-[var(--surface-hover)] transition-colors"
              />
            </div>
          ))}
          {error && <p className="pt-2 text-xs text-[var(--text-faint)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-soft)] px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-[var(--text-faint)] transition-all hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border border-stone-500/30 bg-stone-600 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-all hover:bg-stone-500 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create deal"}
            <kbd className="rounded border border-stone-500/30 bg-stone-600/40 px-1.5 py-0.5 text-[10px] font-normal text-[#9c6b72]/70">⌘↵</kbd>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Pipeline page ────────────────────────────────────────────────────────────
export function PipelinePage() {
  const qc = useQueryClient();
  const { display, rates } = useCurrency();
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

  function patchDeal(id: string, fields: Record<string, unknown>) {
    const deal = (qc.getQueryData<DealRecord[]>(["pipeline-deals"]) ?? []).find(d => d.id === id);
    if (!deal) return;
    const newData = { ...deal.data, ...fields };
    qc.setQueryData<DealRecord[]>(["pipeline-deals"], old =>
      (old ?? []).map(d => d.id === id ? { ...d, data: newData } : d)
    );
    apiClient.patch(`/nodes/${id}`, { data: newData }).catch(() => {
      qc.invalidateQueries({ queryKey: ["pipeline-deals"] });
    });
  }

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

  // Deal values convert to the viewer's display currency (ECB rates; fail-closed to face value
  // when a rate is missing) so mixed-currency pipelines sum honestly.
  const dealValue = useCallback((d: DealRecord): number | null => {
    const v = fmtVal(d.data.deal_value);
    if (v === null) return null;
    const cur = String(d.data.currency ?? "").toUpperCase();
    if (!cur || cur === display) return v;
    return convertAmount(v, cur, display, rates) ?? v;
  }, [display, rates]);
  const curSym = CURRENCY_SYMBOL[display] ?? "$";
  const totalValue = deals.reduce((sum, d) => sum + (dealValue(d) ?? 0), 0);
  const wonValue = (byStage["Closed Won"] ?? []).reduce((sum, d) => sum + (dealValue(d) ?? 0), 0);

  function commitNewStage() {
    const name = newStageName.trim();
    if (name && !stages.includes(name)) setStages(prev => [...prev, name]);
    setNewStageName("");
    setAddingStage(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-800/50 px-6 py-3 shrink-0">
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] select-none">Pipeline</span>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {deals.length} deal{deals.length !== 1 ? "s" : ""}
            {wonValue > 0 && <> · <span className="text-[#5f8169]">{fmtDisplay(wonValue, curSym)} won</span></>}
            {totalValue > 0 && <> · <span className="text-[var(--text-muted)]">{fmtDisplay(totalValue, curSym)} pipeline</span></>}
          </p>
        </div>
        <button
          onClick={() => setCreateForStage(stages[0] ?? "Lead")}
          className="flex items-center gap-1.5 rounded-md border border-stone-500/30 bg-stone-600 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] transition-all hover:bg-stone-500"
        >
          <Plus size={11}/> New deal
        </button>
      </div>

      {/* Kanban board — on phones each column is ~85vw with scroll-snap (swipe one at a time);
          from sm+ it's the normal 220px multi-column board. Deal moves use the card menu, so the
          board stays usable on touch without drag-and-drop. */}
      <div className="flex flex-1 min-h-0 overflow-x-auto px-4 py-4 gap-2 snap-x snap-mandatory scroll-px-4 sm:snap-none">
        {stages.map(stage => {
          const cards = byStage[stage] ?? [];
          return (
            <div
              key={stage}
              className="flex flex-col shrink-0 w-[85vw] max-w-[240px] snap-start sm:w-[220px] sm:max-w-none border border-stone-800/50 rounded-lg overflow-hidden bg-transparent"
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-800/50 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor(stage)}`}/>
                  <span className={`text-[11px] font-semibold truncate ${textColor(stage)}`}>{stage}</span>
                  <span className="text-[10px] text-[var(--text-secondary)] font-medium shrink-0">{cards.length}</span>
                </div>
                <button
                  onClick={() => setCreateForStage(stage)}
                  className="flex items-center justify-center h-5 w-5 rounded text-[var(--text-secondary)] hover:text-[var(--text-faint)] hover:bg-stone-800/50 transition-all shrink-0"
                  title={`Add deal to ${stage}`}
                >
                  <Plus size={11}/>
                </button>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[80px]">
                {dealsQuery.isLoading ? (
                  <div className="space-y-1.5">
                    {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-stone-800/20 animate-pulse"/>)}
                  </div>
                ) : cards.length === 0 ? (
                  <button
                    onClick={() => setCreateForStage(stage)}
                    className="flex w-full h-12 items-center justify-center rounded-md border border-dashed border-stone-800/60 hover:border-stone-700/60 hover:bg-stone-800/20 transition-all group/empty"
                  >
                    <Plus size={11} className="text-[var(--text-faint)] group-hover/empty:text-[var(--text-muted)] transition-colors"/>
                  </button>
                ) : (
                  cards.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      members={members}
                      stages={stages}
                      onMove={newStage => moveDeal.mutate({ id: deal.id, data: { ...deal.data, deal_stage: newStage } })}
                      onPatch={fields => patchDeal(deal.id, fields)}
                    />
                  ))
                )}
              </div>

              {/* Calc footer */}
              <CalcFooter cards={cards} dealValue={dealValue} sym={curSym}/>
            </div>
          );
        })}

        {/* Add new stage column */}
        {addingStage ? (
          <div className="flex flex-col shrink-0 w-[85vw] max-w-[240px] snap-start sm:w-[220px] sm:max-w-none border border-stone-700/60 rounded-lg overflow-hidden bg-transparent">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-800/50">
              <input
                ref={newStageRef}
                value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitNewStage();
                  if (e.key === "Escape") { setAddingStage(false); setNewStageName(""); }
                }}
                placeholder="Stage name…"
                className="flex-1 bg-transparent text-[11px] text-[var(--text-primary)] placeholder-stone-600 outline-none"
              />
              <button onClick={commitNewStage} className="text-[var(--text-muted)] hover:text-[#5f8169] transition-colors"><Check size={12}/></button>
              <button onClick={() => { setAddingStage(false); setNewStageName(""); }} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors"><X size={12}/></button>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[80px]">
              <span className="text-[10px] text-[var(--text-faint)]">New stage</span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingStage(true)}
            className="flex shrink-0 w-[85vw] max-w-[240px] snap-start sm:w-[220px] sm:max-w-none flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-800/60 hover:border-stone-700/60 hover:bg-stone-900/20 transition-all text-[var(--text-secondary)] hover:text-[var(--text-faint)] self-start min-h-[80px]"
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

import { useState, useRef, useEffect, useCallback } from "react";
import { LossReasonModal, isLostStage, type PendingLoss } from "./loss-reason";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Check, X, ChevronRight, ChevronDown } from "lucide-react";
import { LeadScoreBadge } from "./lead-score-badge";
import { PortalDropdown } from "./record-table";
import { apiClient } from "../../lib/api-client";
import { useCurrency, convertAmount, CURRENCY_SYMBOL } from "../../hooks/useCurrency";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; lead_score?: number | null }
interface Member { id: string; name: string; email: string; avatar_url?: string | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, { dot: string; text: string }> = {
  lead:        { dot: "bg-stone-400",    text: "text-stone-400" },
  new:         { dot: "bg-stone-400",    text: "text-stone-400" },
  open:        { dot: "bg-[#717784]",    text: "text-[#717784]" },
  qualified:   { dot: "bg-[#717784]",    text: "text-[#717784]" },
  "in progress": { dot: "bg-stone-400", text: "text-stone-400" },
  active:      { dot: "bg-stone-400",  text: "text-stone-400" },
  proposal:    { dot: "bg-[#c6892e]",   text: "text-[#c6892e]" },
  review:      { dot: "bg-[#c6892e]",   text: "text-[#c6892e]" },
  negotiation: { dot: "bg-[#c6892e]",  text: "text-[#c6892e]" },
  "closed won": { dot: "bg-[#2f9e6b]", text: "text-[#2f9e6b]" },
  won:         { dot: "bg-[#2f9e6b]", text: "text-[#2f9e6b]" },
  done:        { dot: "bg-[#2f9e6b]", text: "text-[#2f9e6b]" },
  completed:   { dot: "bg-[#2f9e6b]", text: "text-[#2f9e6b]" },
  "closed lost": { dot: "bg-stone-400",  text: "text-stone-400" },
  lost:        { dot: "bg-stone-400",     text: "text-stone-400" },
  rejected:    { dot: "bg-stone-400",     text: "text-stone-400" },
};
export function stageStyle(s: string) {   // exported: the new-record drawer colors its stage pills with THE same palette
  return STAGE_COLORS[s.toLowerCase()] ?? { dot: "bg-stone-500", text: "text-stone-400" };
}

function fmtVal(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function fmtDisplay(n: number, sym = "") {
  return n >= 1_000_000 ? `${sym}${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${sym}${(n / 1_000).toFixed(0)}K`
    : `${sym}${n.toLocaleString()}`;
}
// Convert a record's value from its own currency (data.currency, else workspace base) into display.
type BoardValueReader = (raw: number, recordCurrency: string | null) => number;
function memberInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function labelOf(k: string) { return k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

/** Find the best column to group by: prefer explicit stage/status names */
function detectGroupCol(records: NodeRecord[]): string | null {
  if (!records.length) return null;
  const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  const priority = ["deal_stage", "stage", "status", "phase", "state", "pipeline_stage", "hiring_stage", "property_status"];
  for (const p of priority) {
    if (allKeys.includes(p)) return p;
  }
  // Fallback: any key whose values look categorical (≤12 unique non-numeric values)
  for (const k of allKeys) {
    const vals = records.map(r => String(r.data[k] ?? "")).filter(Boolean);
    const unique = new Set(vals);
    if (unique.size >= 2 && unique.size <= 12 && !vals.every(v => !isNaN(Number(v)))) return k;
  }
  return null;
}

/** Find the best value column to show on cards (currency/number) */
function detectValueCol(records: NodeRecord[], groupCol: string): string | null {
  const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data)))).filter(k => k !== groupCol && k !== "name");
  const priority = ["deal_value", "value", "amount", "price", "budget", "salary", "revenue", "arr", "funding_raised"];
  for (const p of priority) { if (allKeys.includes(p)) return p; }
  // Fallback: first column where >50% of records have numeric values
  for (const k of allKeys) {
    const vals = records.map(r => r.data[k]).filter(v => v != null && !isNaN(Number(v)));
    if (vals.length > records.length * 0.3) return k;
  }
  return null;
}

// ─── Calc footer ─────────────────────────────────────────────────────────────
type CalcType = "count"|"count_empty"|"count_filled"|"pct_empty"|"pct_filled"|"sum"|"avg"|"max"|"min";
const CALC_LABELS: Record<CalcType, string> = {
  count: "Count", count_empty: "Count empty", count_filled: "Count filled",
  pct_empty: "% empty", pct_filled: "% filled",
  sum: "Sum", avg: "Average", max: "Max", min: "Min",
};

function CalcFooter({ cards, valueCol, sym = "", toDisplay }: { cards: NodeRecord[]; valueCol: string | null; sym?: string; toDisplay?: BoardValueReader }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CalcType>("count");
  const btnRef = useRef<HTMLButtonElement>(null);

  const total = cards.length;
  function result(): string {
    if (total === 0) return "—";
    // Money calcs convert each card's value into the display currency before aggregating, so a
    // mixed-currency column sums honestly instead of adding raw EUR + USD as one number.
    const vals = valueCol
      ? cards.map(c => { const n = fmtVal(c.data[valueCol]); return n == null ? null : (toDisplay ? toDisplay(n, (c.data.currency as string | undefined) ?? null) : n); }).filter((n): n is number => n !== null)
      : [];
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

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-stone-500 hover:text-stone-400 border-t border-[var(--border-soft)] transition-colors"
      >
        <span className="text-stone-600">{CALC_LABELS[type]}</span>
        <div className="flex items-center gap-1">
          <span className="font-medium text-stone-400">{result()}</span>
          <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
        </div>
      </button>
      {open && (
        <PortalDropdown triggerRef={btnRef} onClose={() => setOpen(false)} direction="up" minWidth={170}>
          {(Object.keys(CALC_LABELS) as CalcType[]).map(t => (
            <button key={t} onClick={() => { setType(t); setOpen(false); }}
              className={`dropdown-item justify-between ${t === type ? "dropdown-item-active" : ""}`}>
              <span>{CALC_LABELS[t]}</span>
              {t === type && <Check size={10} className="text-stone-400"/>}
            </button>
          ))}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Stage pill ───────────────────────────────────────────────────────────────
function StagePill({ value, stages, onMove }: { value: string; stages: string[]; onMove: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { dot, text } = stageStyle(value);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold border border-[var(--border-soft)] bg-transparent transition-colors ${text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`}/>
        {value}
        <ChevronRight size={9} className={`transition-transform ${open ? "rotate-90" : ""}`}/>
      </button>
      {/* Portal: the absolute panel rendered INSIDE the column's overflow containers and was
          clipped after a few pixels — stages below the fold were unpickable. */}
      {open && (
        <PortalDropdown triggerRef={btnRef} onClose={() => setOpen(false)} minWidth={150}>
          {stages.map(s => {
            const sc = stageStyle(s);
            return (
              <button key={s} onClick={() => { onMove(s); setOpen(false); }}
                className={`dropdown-item ${s === value ? "dropdown-item-active" : ""}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`}/>
                <span className={s === value ? sc.text : ""}>{s}</span>
              </button>
            );
          })}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Inline editable field ────────────────────────────────────────────────────
function CardField({ value, onSave, placeholder = "—", numeric = false, className = "" }: {
  value: string; onSave: (v: string) => void;
  placeholder?: string; numeric?: boolean; className?: string;
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

  if (editing) return (
    <input ref={inputRef} type={numeric ? "number" : "text"} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setDraft(value); setEditing(false); } e.stopPropagation(); }}
      className={`w-full bg-stone-800 text-[11px] text-[var(--text-primary)] outline-none rounded px-1.5 py-0.5 border border-stone-600/60 ${numeric ? "text-right font-mono" : ""} ${className}`}
    />
  );

  return (
    <span onClick={() => { setDraft(value); setEditing(true); }}
      className={`block truncate cursor-text text-[11px] ${value ? "" : "text-stone-700 hover:text-stone-500"} ${className}`}>
      {value || placeholder}
    </span>
  );
}

// ─── Record card ──────────────────────────────────────────────────────────────
function RecordCard({ record, objectType, groupCol, valueCol, members, stages, onMove, onPatch }: {
  record: NodeRecord; objectType: string; groupCol: string; valueCol: string | null;
  members: Member[]; stages: string[];
  onMove: (stage: string) => void; onPatch: (fields: Record<string, unknown>) => void;
}) {
  const d = record.data;
  const name    = String(d.name ?? d.title ?? "");
  const rawVal  = valueCol ? d[valueCol] : null;
  const numVal  = fmtVal(rawVal);
  const stageVal = String(d[groupCol] ?? stages[0] ?? "");
  const ownerKey = ["deal_owner", "owner", "assigned_to", "assigned", "contact", "member"].find(k => d[k]);
  const ownerRaw = ownerKey ? String(d[ownerKey] ?? "") : "";
  const ownerMember = ownerRaw ? members.find(m => m.id === ownerRaw || m.name === ownerRaw || m.email === ownerRaw) : null;
  // Never print a raw id as a person. Some records store the owner as a user UUID; when it
  // resolves to a member we show their name, and when it doesn't, the card said
  // "10c0bcfb-2db4-458c-…" — code where a person belongs. Unresolvable ids display as unassigned.
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerRaw) || /^user_[A-Za-z0-9]+$/.test(ownerRaw);
  const owner = ownerMember ? (ownerMember.name || ownerMember.email || "") : looksLikeId ? "" : ownerRaw;

  return (
    <div className="group rounded-md border border-stone-800/60 bg-stone-900/40 hover:border-stone-700/60 hover:bg-stone-900/70 transition-all p-3 cursor-default">
      {/* Name */}
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        <CardField value={name} onSave={v => onPatch({ name: v })} placeholder="Untitled" className="flex-1 font-medium text-stone-100"/>
        {record.lead_score != null && <LeadScoreBadge score={record.lead_score} size="sm"/>}
        <Link to={`/objects/${objectType}/${record.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-stone-600 hover:text-stone-400">
          <ChevronRight size={12}/>
        </Link>
      </div>

      {/* Value (if detected) */}
      {valueCol && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[10px] text-stone-600 shrink-0">{labelOf(valueCol)}</span>
          <CardField
            value={rawVal != null ? String(rawVal) : ""}
            onSave={v => onPatch({ [valueCol]: v === "" ? null : v })}
            placeholder="—"
            numeric
            className="flex-1 text-[#2f9e6b] font-semibold text-right"
          />
        </div>
      )}

      {/* Owner (if detected) */}
      {ownerKey && (
        <div className="flex items-center gap-1.5 mb-2.5">
          {ownerMember ? (
            <div className="h-4 w-4 rounded-full bg-stone-500/20 flex items-center justify-center text-[8px] font-bold text-stone-400 shrink-0">
              {memberInitials(ownerMember.name)}
            </div>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-stone-700 shrink-0"/>
          )}
          <CardField value={owner} onSave={v => onPatch({ [ownerKey]: v })} placeholder="Owner…" className="flex-1 text-stone-500"/>
        </div>
      )}

      <StagePill value={stageVal} stages={stages} onMove={onMove}/>
    </div>
  );
}

// ─── Add record mini-modal ────────────────────────────────────────────────────
function AddCardModal({ objectType, groupCol, defaultStage, allRecords, onClose, onCreated }: {
  objectType: string; groupCol: string; defaultStage: string;
  allRecords: NodeRecord[]; onClose: () => void; onCreated: () => void;
}) {
  const qc = useQueryClient();
  const AUTO = new Set(["updated_at", "created_at", "workspace_id", "id"]);
  const cached = allRecords;
  const cols = Array.from(new Set(cached.flatMap(r => Object.keys(r.data)))).filter(k => !AUTO.has(k)).slice(0, 8);
  const fieldKeys = cols.length > 0 ? cols : ["name", groupCol];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init = Object.fromEntries(fieldKeys.map(k => [k, ""]));
    init[groupCol] = defaultStage;
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const save = useCallback(async () => {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) { if (k.trim()) data[k] = v; }
    if (!data.name) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      const safeType = objectType.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      await apiClient.post("/nodes", { vertical: "shared", object_type: safeType, data });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) });
      onCreated(); onClose();
    } catch (e: any) { setError(e?.message || "Failed"); } finally { setSaving(false); }
  }, [values, objectType, qc, onClose, onCreated]);

  useEffect(() => {
    function h(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save, onClose]);

  const { text } = stageStyle(defaultStage);
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">New {objectType.replace(/[-_]/g, " ")}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border border-[var(--border-soft)] bg-stone-900/60 ${text}`}>{defaultStage}</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"><X size={14}/></button>
        </div>
        <div className="max-h-[360px] overflow-auto px-5 py-4 space-y-0.5">
          {fieldKeys.map(k => (
            <div key={k} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2 border-b border-[var(--border-soft)] last:border-0">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-600 truncate">{labelOf(k)}</span>
              <input value={values[k] ?? ""} onChange={e => setValues(p => ({ ...p, [k]: e.target.value }))}
                placeholder="—"
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30 focus:bg-[var(--surface-hover)] transition-colors"/>
            </div>
          ))}
          {error && <p className="pt-2 text-xs text-stone-400">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-soft)] px-5 py-3.5">
          <button onClick={onClose} className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] transition-all">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50 transition-all">
            {saving ? "Creating…" : "Create"}
            <kbd className="rounded border border-stone-500/30 bg-stone-600/40 px-1.5 py-0.5 text-[10px] font-normal text-stone-400">⌘↵</kbd>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Board View (exported) ────────────────────────────────────────────────────
export function BoardView({ objectType, search = "", conditions = [] }: { objectType: string; search?: string; conditions?: { col: string; op: string; value?: string }[] }) {
  const qc = useQueryClient();
  // Currency — column calc footers show money in the workspace display currency (same FX source
  // as Finance Reports / Pipeline / the sales report). Per-card editable values stay raw.
  const { base, display, rates } = useCurrency();
  const curSym = CURRENCY_SYMBOL[display] ?? "";
  const toDisplay = useCallback<BoardValueReader>((raw, recordCurrency) => {
    const from = (recordCurrency || base).toUpperCase();
    if (from === display) return raw;
    const v = convertAmount(raw, from, display, rates);
    return v == null ? raw : v;
  }, [base, display, rates]);
  const [createForStage, setCreateForStage] = useState<string | null>(null);
  const [stages, setStages]                 = useState<string[]>([]);
  const [addingStage, setAddingStage]       = useState(false);
  const [newStageName, setNewStageName]     = useState("");
  const newStageRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (addingStage) setTimeout(() => newStageRef.current?.focus(), 50); }, [addingStage]);

  // Same SQL search + conditions as the table view (state lives on the page) — switching
  // Table→Board used to silently drop every active filter.
  const serverConds = conditions.filter(c => c.op !== "gt" && c.op !== "lt" && !/owner|assign/i.test(c.col));
  const recordsQuery = useQuery({
    queryKey: ["records", "board", objectType, search.trim(), JSON.stringify(serverConds)],
    queryFn: () => {
      const params = new URLSearchParams({ object_type: objectType, limit: "1000" });
      if (search.trim()) params.set("q", search.trim());
      if (serverConds.length) params.set("filters", JSON.stringify(serverConds));
      return apiClient.get<NodeRecord[]>(`/nodes?${params}`);
    },
  });
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
  });

  const records = recordsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const groupCol  = detectGroupCol(records);
  const valueCol  = groupCol ? detectValueCol(records, groupCol) : null;

  // Build stages from data + any user-added ones
  useEffect(() => {
    if (!groupCol || !records.length) return;
    const fromData = Array.from(new Set(records.map(r => String(r.data[groupCol] ?? "")).filter(Boolean)));
    setStages(prev => {
      const merged = [...fromData];
      for (const s of prev) { if (!merged.includes(s)) merged.push(s); }
      return merged;
    });
  }, [records, groupCol]);

  const [pendingLoss, setPendingLoss] = useState<PendingLoss | null>(null);

  const moveRecord = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`/nodes/${id}`, { data }),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) });
      const prev = recordsQuery.data;
      qc.setQueriesData<NodeRecord[]>({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) }, old =>
        (old ?? []).map(r => r.id === id ? { ...r, data: { ...r.data, ...data } } : r)
      );
      return { prev };
    },
    onError: () => qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) }),
  });

  function patchRecord(id: string, fields: Record<string, unknown>) {
    const rec = (recordsQuery.data ?? []).find(r => r.id === id);
    if (!rec) return;
    const newData = { ...rec.data, ...fields };
    qc.setQueriesData<NodeRecord[]>({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) }, old =>
      (old ?? []).map(r => r.id === id ? { ...r, data: newData } : r)
    );
    apiClient.patch(`/nodes/${id}`, { data: newData }).catch(() => {
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) });
    });
  }

  function commitNewStage() {
    const name = newStageName.trim();
    if (name && !stages.includes(name)) setStages(prev => [...prev, name]);
    setNewStageName(""); setAddingStage(false);
  }

  if (!groupCol && !recordsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
      {pendingLoss && <LossReasonModal pending={pendingLoss} onClose={() => setPendingLoss(null)} />}
        <div className="text-center space-y-2">
          <p className="text-sm text-stone-400">Board view requires a stage or status column</p>
          <p className="text-xs text-stone-600">Add a column named "stage", "status", or "phase" to use board view</p>
        </div>
      </div>
    );
  }

  const byStage = stages.reduce((acc, s) => {
    acc[s] = records.filter(r => String(r.data[groupCol!] ?? "") === s);
    return acc;
  }, {} as Record<string, NodeRecord[]>);

  return (
    <div className="flex flex-1 min-h-0 overflow-x-auto px-4 py-4 gap-2">
      {stages.map(stage => {
        const cards = byStage[stage] ?? [];
        const { dot, text } = stageStyle(stage);
        return (
          <div key={stage} className="flex flex-col shrink-0 w-[220px] border border-stone-800/50 rounded-sm overflow-hidden bg-transparent">
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-800/50 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}/>
                <span className={`text-[11px] font-semibold truncate ${text}`}>{stage}</span>
                <span className="text-[10px] text-stone-600 font-medium shrink-0">{cards.length}</span>
              </div>
              <button onClick={() => setCreateForStage(stage)}
                className="flex items-center justify-center h-5 w-5 rounded text-stone-600 hover:text-stone-400 hover:bg-stone-800/50 transition-all shrink-0"
                title={`Add to ${stage}`}>
                <Plus size={11}/>
              </button>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[80px]">
              {recordsQuery.isLoading ? (
                <div className="space-y-1.5">
                  {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-stone-800/20 animate-pulse"/>)}
                </div>
              ) : cards.length === 0 ? (
                <button onClick={() => setCreateForStage(stage)}
                  className="flex w-full h-12 items-center justify-center rounded-md border border-dashed border-stone-800/60 hover:border-stone-700/60 hover:bg-stone-800/20 transition-all group/empty">
                  <Plus size={11} className="text-stone-700 group-hover/empty:text-stone-500 transition-colors"/>
                </button>
              ) : (
                cards.map(rec => (
                  <RecordCard
                    key={rec.id}
                    record={rec}
                    objectType={objectType}
                    groupCol={groupCol!}
                    valueCol={valueCol}
                    members={members}
                    stages={stages}
                    onMove={newStage => {
                      if (isLostStage(newStage) && !rec.data.loss_reason) {
                        setPendingLoss({ name: String(rec.data.name ?? rec.data.title ?? "This deal"),
                          apply: (reason) => moveRecord.mutate({ id: rec.id, data: { ...rec.data, [groupCol!]: newStage, ...(reason ? { loss_reason: reason } : {}) } }) });
                        return;
                      }
                      moveRecord.mutate({ id: rec.id, data: { ...rec.data, [groupCol!]: newStage } });
                    }}
                    onPatch={fields => patchRecord(rec.id, fields)}
                  />
                ))
              )}
            </div>

            <CalcFooter cards={cards} valueCol={valueCol} sym={curSym} toDisplay={toDisplay}/>
          </div>
        );
      })}

      {/* Add new stage */}
      {addingStage ? (
        <div className="flex flex-col shrink-0 w-[220px] border border-stone-700/60 rounded-sm overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-800/50">
            <input ref={newStageRef} value={newStageName} onChange={e => setNewStageName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitNewStage(); if (e.key === "Escape") { setAddingStage(false); setNewStageName(""); } }}
              placeholder="Stage name…"
              className="flex-1 bg-transparent text-[11px] text-[var(--text-primary)] placeholder-stone-600 outline-none"/>
            <button onClick={commitNewStage} className="text-stone-500 hover:text-[#2f9e6b] transition-colors"><Check size={12}/></button>
            <button onClick={() => { setAddingStage(false); setNewStageName(""); }} className="text-stone-600 hover:text-stone-400 transition-colors"><X size={12}/></button>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-[80px]">
            <span className="text-[10px] text-stone-700">New stage</span>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddingStage(true)}
          className="flex shrink-0 w-[220px] flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-stone-800/60 hover:border-stone-700/60 hover:bg-stone-900/20 transition-all text-stone-600 hover:text-stone-400 self-start min-h-[80px]">
          <Plus size={13}/>
          <span className="text-[10px]">Add stage</span>
        </button>
      )}

      {createForStage && groupCol && (
        <AddCardModal
          objectType={objectType}
          groupCol={groupCol}
          defaultStage={createForStage}
          allRecords={records}
          onClose={() => setCreateForStage(null)}
          onCreated={() => setCreateForStage(null)}
        />
      )}
    </div>
  );
}

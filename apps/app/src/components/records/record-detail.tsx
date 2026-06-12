import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, Check, Building2, Users, Wifi, Calendar,
  DollarSign, Users2, Mail, Phone, Tag, Clock, Plus,
  ChevronDown, Sparkles, MapPin, TrendingUp, Square,
  CheckSquare, FileText, X,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { detectStageFromActivity } from "../../lib/ai-enrichment";
import { PageSkeleton, ErrorState } from "../ui/page-state";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Activity { id: string; action: string; diff?: Record<string, unknown> | null; ai_summary?: string | null; created_at: string; actor_type: string }
interface RecordData { id: string; object_type: string; vertical: string; data: Record<string, unknown>; ai_summary?: string; activities?: Activity[]; updated_at: string }
interface NoteRecord  { id: string; data: Record<string, unknown>; updated_at: string }
interface TaskRecord  { id: string; data: Record<string, unknown>; updated_at: string }
interface Category   { name: string; color: string }

// ─── Constants ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "from-red-500/30 to-red-600/10 text-red-300 border-red-500/20",
  "from-blue-500/30 to-blue-600/10 text-blue-300 border-blue-500/20",
  "from-emerald-500/30 to-emerald-600/10 text-emerald-300 border-emerald-500/20",
  "from-purple-500/30 to-purple-600/10 text-purple-300 border-purple-500/20",
  "from-amber-500/30 to-amber-600/10 text-amber-300 border-amber-500/20",
];

const PIPE_STAGES = ["Lead","Qualified","In Progress","Proposal","Negotiation"] as const;

const STAGE_STYLES: Record<string, string> = {
  "Lead":        "bg-slate-500/15 text-slate-300 border-slate-500/20",
  "Qualified":   "bg-blue-500/15 text-blue-300 border-blue-500/20",
  "In Progress": "bg-violet-500/15 text-violet-300 border-violet-500/20",
  "Proposal":    "bg-amber-500/15 text-amber-300 border-amber-500/20",
  "Negotiation": "bg-orange-500/15 text-orange-300 border-orange-500/20",
  "Closed Won":  "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  "Closed Lost": "bg-red-500/15 text-red-300 border-red-500/20",
};
void STAGE_STYLES; // used for reference below

const STAGE_DOT: Record<string, string> = {
  "Lead": "bg-slate-400", "Qualified": "bg-blue-400", "In Progress": "bg-violet-400",
  "Proposal": "bg-amber-400", "Negotiation": "bg-orange-400",
};

const CATEGORY_COLORS = [
  { name: "Red",    bg: "bg-red-500/20",     text: "text-red-300",     dot: "bg-red-400"     },
  { name: "Blue",   bg: "bg-blue-500/20",    text: "text-blue-300",    dot: "bg-blue-400"    },
  { name: "Green",  bg: "bg-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-400" },
  { name: "Purple", bg: "bg-purple-500/20",  text: "text-purple-300",  dot: "bg-purple-400"  },
  { name: "Amber",  bg: "bg-amber-500/20",   text: "text-amber-300",   dot: "bg-amber-400"   },
  { name: "Slate",  bg: "bg-slate-500/20",   text: "text-slate-300",   dot: "bg-slate-400"   },
] as const;

const TABS = ["Overview","Activity","Emails","Calls","Company","Notes","Tasks","Files"] as const;
type Tab = typeof TABS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  return String(name).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}
function avatarColor(name: string) {
  return AVATAR_COLORS[(initials(name).charCodeAt(0) || 0) % AVATAR_COLORS.length]!;
}
function fmt(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Inline field ─────────────────────────────────────────────────────────────
function InlineField({ label, value, onSave, numeric = false }: { label: string; value: unknown; onSave: (v: string) => void; numeric?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(value));
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(fmt(value)); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  function commit() {
    setEditing(false);
    if (draft !== fmt(value)) { onSave(draft); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  }
  return (
    <div className="group grid grid-cols-[100px_1fr] items-start gap-2 py-2 border-b border-white/[.04] last:border-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600 pt-0.5 select-none truncate">{label}</span>
      <div className="min-w-0 flex items-center gap-1">
        {editing ? (
          <input
            ref={inputRef} value={draft} type={numeric ? "number" : "text"}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
            className="w-full rounded border border-red-500/30 bg-white/[.05] px-2 py-0.5 text-xs text-white outline-none"
          />
        ) : (
          <button
            onClick={() => { setEditing(true); setDraft(fmt(value)); }}
            className="min-w-0 text-left text-xs text-slate-300 hover:text-white transition-colors truncate group-hover:underline group-hover:decoration-dotted group-hover:decoration-slate-600 underline-offset-2"
          >
            {fmt(value)}
          </button>
        )}
        {saved && <Check size={10} className="text-emerald-400 shrink-0"/>}
      </div>
    </div>
  );
}

// ─── Highlight card ───────────────────────────────────────────────────────────
type Accent = "slate"|"red"|"blue"|"emerald"|"amber"|"purple";
const ACCENT_MAP: Record<Accent, string> = {
  slate: "text-slate-400", red: "text-red-400", blue: "text-blue-400",
  emerald: "text-emerald-400", amber: "text-amber-400", purple: "text-purple-400",
};

function HighlightCard({ icon: Icon, label, value, accent = "slate", onSave, numeric }: {
  icon: React.ElementType; label: string; value: unknown; accent?: Accent;
  onSave?: (v: string) => void; numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(value));
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(fmt(value)); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  function commit() {
    setEditing(false);
    if (onSave && draft !== fmt(value)) { onSave(draft); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  }
  return (
    <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-3.5 hover:border-white/[.09] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={ACCENT_MAP[accent]}/>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{label}</span>
        </div>
        {saved && <Check size={10} className="text-emerald-400"/>}
      </div>
      {editing ? (
        <input
          ref={inputRef} value={draft} type={numeric ? "number" : "text"}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
          className="w-full rounded border border-red-500/30 bg-white/[.05] px-2 py-1 text-sm text-white outline-none"
        />
      ) : (
        <button
          onClick={() => onSave && setEditing(true)}
          className={`text-left text-sm font-semibold text-white truncate w-full ${onSave ? "hover:text-red-300 transition-colors" : "cursor-default"}`}
        >
          {fmt(value)}
        </button>
      )}
    </div>
  );
}

// ─── Deal pipeline progress bar ───────────────────────────────────────────────
function DealProgressBar({ stage, onSave }: { stage: string; onSave: (v: string) => void }) {
  const isWon  = stage === "Closed Won";
  const isLost = stage === "Closed Lost";
  const activeIdx = PIPE_STAGES.indexOf(stage as typeof PIPE_STAGES[number]);
  return (
    <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 col-span-2">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-purple-400"/>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Deal Pipeline</span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => onSave("Closed Won")} className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${isWon ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "text-slate-600 border-white/[.06] hover:text-emerald-300 hover:border-emerald-500/20"}`}>Won</button>
          <button onClick={() => onSave("Closed Lost")} className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${isLost ? "bg-red-500/20 text-red-300 border-red-500/30" : "text-slate-600 border-white/[.06] hover:text-red-300 hover:border-red-500/20"}`}>Lost</button>
        </div>
      </div>
      <div className="flex items-start">
        {PIPE_STAGES.map((s, i) => {
          const isActive = s === stage;
          const isPast   = activeIdx > i && !isWon && !isLost;
          const dot = STAGE_DOT[s] ?? "bg-slate-400";
          const dotCls = isActive ? `${dot} ring-2 ring-white/30 scale-125` : isPast ? `${dot} opacity-50` : "bg-white/[.08]";
          return (
            <div key={s} className="flex flex-col items-center flex-1">
              <div className="flex items-center w-full">
                {i > 0 && <div className={`h-px flex-1 transition-colors ${isPast || isActive ? "bg-white/20" : "bg-white/[.05]"}`}/>}
                <button onClick={() => onSave(s)} className="shrink-0 hover:scale-110 transition-transform">
                  <div className={`h-3 w-3 rounded-full transition-all ${dotCls}`}/>
                </button>
                {i < PIPE_STAGES.length - 1 && <div className={`h-px flex-1 transition-colors ${isPast ? "bg-white/20" : "bg-white/[.05]"}`}/>}
              </div>
              <span className={`mt-2 text-[9px] font-medium uppercase tracking-wide text-center leading-tight max-w-[50px] ${isActive ? "text-white" : isPast ? "text-slate-600" : "text-slate-700"}`}>{s}</span>
            </div>
          );
        })}
      </div>
      {(isWon || isLost) && (
        <div className={`mt-4 rounded-md px-3 py-2 text-xs font-semibold text-center ${isWon ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
          {isWon ? "✓ Deal Won" : "✗ Deal Lost"}
        </div>
      )}
    </div>
  );
}

// ─── Category pills ───────────────────────────────────────────────────────────
function CategoryPills({ categories, onUpdate }: { categories: Category[]; onUpdate: (cats: Category[]) => void }) {
  const [open, setOpen]       = useState(false);
  const [newName, setNewName] = useState("");
  const [colorIdx, setColorIdx] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const MAX = 3;
  const overflow = categories.length - MAX;
  function colorFor(name: string) { return CATEGORY_COLORS.find(c => c.name === name) ?? CATEGORY_COLORS[CATEGORY_COLORS.length - 1]!; }
  function add() {
    if (!newName.trim()) return;
    onUpdate([...categories, { name: newName.trim(), color: CATEGORY_COLORS[colorIdx]?.name ?? "Slate" }]);
    setNewName(""); setOpen(false);
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {categories.slice(0, MAX).map((cat, i) => {
          const c = colorFor(cat.color);
          return (
            <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/[.06] group ${c.bg} ${c.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`}/>
              {cat.name}
              <button onClick={() => onUpdate(categories.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 hover:text-white"><X size={8}/></button>
            </span>
          );
        })}
        {overflow > 0 && <span className="rounded-full bg-white/[.05] border border-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">+{overflow}</span>}
        <button onClick={() => setOpen(o => !o)} className="h-5 w-5 rounded-full border border-dashed border-white/[.12] bg-white/[.03] hover:bg-white/[.06] flex items-center justify-center text-slate-600 hover:text-slate-400 transition-colors">
          <Plus size={9}/>
        </button>
      </div>
      {open && (
        <div ref={overlayRef} className="dropdown-panel absolute left-0 top-full mt-2 w-52 p-3 z-50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Add Tag</p>
          <input
            ref={inputRef} value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setOpen(false); }}
            placeholder="Tag name…"
            className="w-full rounded border border-white/[.08] bg-white/[.04] px-2 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-red-500/30 mb-3"
          />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Color</p>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {CATEGORY_COLORS.map((c, i) => (
              <button key={i} onClick={() => setColorIdx(i)} className={`h-5 w-5 rounded-full ${c.dot} transition-transform ${colorIdx === i ? "scale-125 ring-2 ring-white/30" : "hover:scale-110"}`}/>
            ))}
          </div>
          <button onClick={add} disabled={!newName.trim()} className="w-full rounded-md bg-red-500/20 border border-red-500/30 text-red-300 text-xs py-1.5 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Add tag
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────
function ActivityDot({ type }: { type: "create"|"update"|"system" }) {
  const cls = type === "create" ? "bg-emerald-500" : type === "update" ? "bg-blue-500" : "bg-slate-600";
  return <div className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${cls} ring-2 ring-[#13151a]`}/>;
}

function ActivityFeed({ activities, createdAt }: { activities?: Activity[]; createdAt: string }) {
  const events = [
    { id: "created", action: "created", actor_type: "system", created_at: createdAt, diff: null, ai_summary: "Record created" },
    ...(activities ?? []),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return (
    <div className="space-y-0">
      {events.map((ev, i) => {
        const isCreate = ev.action === "created";
        const isUpdate = ev.action === "updated" || ev.action === "patched";
        const type = isCreate ? "create" : isUpdate ? "update" : "system";
        let label = ev.action.charAt(0).toUpperCase() + ev.action.slice(1);
        if (isUpdate && ev.diff) {
          const fields = Object.keys(ev.diff).filter(k => k !== "updated_at");
          if (fields.length) label = `Updated ${fields.map(f => f.replace(/_/g, " ")).join(", ")}`;
        }
        return (
          <div key={ev.id ?? i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <ActivityDot type={type}/>
              {i < events.length - 1 && <div className="w-px flex-1 bg-white/[.05] mt-1"/>}
            </div>
            <div className="pb-5 min-w-0">
              <p className="text-sm text-slate-300">{ev.ai_summary || label}</p>
              <p className="mt-0.5 text-xs text-slate-600">{relativeTime(ev.created_at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Highlight grids ──────────────────────────────────────────────────────────
function CompanyHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <HighlightCard icon={Wifi}       label="Connection"   value={data.connection_strength ?? "Not set"}        accent="emerald"/>
      <HighlightCard icon={Calendar}   label="Next meeting"  value={data.next_interaction ?? "Not scheduled"}    accent="blue"/>
      <HighlightCard icon={Users2}     label="Team size"     value={data.employee_range ?? "—"}                  accent="slate"  onSave={v => onSave("employee_range", v)}/>
      <HighlightCard icon={DollarSign} label="Est. ARR"      value={data.arr ?? "—"}                             accent="amber"  onSave={v => onSave("arr", v)} numeric/>
      <HighlightCard icon={TrendingUp} label="Funding"       value={data.funding_raised ?? "—"}                  accent="purple" onSave={v => onSave("funding_raised", v)} numeric/>
      <HighlightCard icon={MapPin}     label="HQ / Country"  value={data.country ?? data.location ?? "—"}        accent="red"    onSave={v => onSave("country", v)}/>
    </div>
  );
}

function PeopleHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <HighlightCard icon={Wifi}      label="Connection"   value={data.connection_strength ?? "Not set"}        accent="emerald"/>
      <HighlightCard icon={Calendar}  label="Next meeting"  value={data.next_interaction ?? "Not scheduled"}    accent="blue"/>
      <HighlightCard icon={Building2} label="Company"       value={data.company ?? "—"}                        accent="purple" onSave={v => onSave("company", v)}/>
      <HighlightCard icon={Mail}      label="Email"         value={data.email ?? "—"}                          accent="blue"   onSave={v => onSave("email", v)}/>
      <HighlightCard icon={Phone}     label="Phone"         value={data.phone ?? "—"}                          accent="slate"  onSave={v => onSave("phone", v)}/>
      <HighlightCard icon={MapPin}    label="Location"      value={data.location ?? data.city ?? data.country ?? "—"} accent="red" onSave={v => onSave("location", v)}/>
    </div>
  );
}

function DealHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2">
        <DealProgressBar stage={String(data.deal_stage ?? "Lead")} onSave={v => onSave("deal_stage", v)}/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <HighlightCard icon={DollarSign} label="Deal value" value={data.deal_value ?? "—"} accent="emerald" onSave={v => onSave("deal_value", v)} numeric/>
        <HighlightCard icon={Users}      label="Deal owner" value={data.deal_owner ?? "—"} accent="blue"    onSave={v => onSave("deal_owner", v)}/>
      </div>
    </div>
  );
}

// ─── Notes tab ────────────────────────────────────────────────────────────────
function NotesTab({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const notesQuery = useQuery({
    queryKey: ["notes", recordId],
    queryFn: async () => {
      const all = await apiClient.get<NoteRecord[]>("/nodes?object_type=note&limit=200");
      return all.filter(n => n.data.parent_id === recordId);
    },
  });
  const createNote = useMutation({
    mutationFn: () => apiClient.post<NoteRecord>("/nodes", {
      vertical: vertical || "shared",
      object_type: "note",
      data: { parent_id: recordId, title: "Untitled note", content: "", created_at: new Date().toISOString() },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", recordId] }),
  });
  const notes = notesQuery.data ?? [];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Notes</p>
        <button onClick={() => createNote.mutate()} disabled={createNote.isPending} className="flex items-center gap-1.5 rounded-md border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors disabled:opacity-50">
          <Plus size={12}/> New note
        </button>
      </div>
      {createNote.isPending && (
        <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 animate-pulse">
          <div className="h-3 w-32 rounded bg-white/[.05] mb-2"/>
          <div className="h-2 w-48 rounded bg-white/[.04]"/>
        </div>
      )}
      {notes.length === 0 && !createNote.isPending ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
          <FileText size={18} className="mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No notes yet. Click "New note" to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 hover:border-white/[.09] transition-colors cursor-pointer">
              <p className="text-sm font-medium text-white">{String(note.data.title || "Untitled note")}</p>
              <p className="mt-0.5 text-xs text-slate-600">{String(note.data.content || "no content")} • {relativeTime(String(note.data.created_at || note.updated_at))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tasks tab ────────────────────────────────────────────────────────────────
function TasksTab({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const [adding, setAdding]     = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks", recordId],
    queryFn: async () => {
      const all = await apiClient.get<TaskRecord[]>("/nodes?object_type=task&limit=200");
      return all.filter(t => t.data.parent_id === recordId);
    },
  });
  const createTask = useMutation({
    mutationFn: (title: string) => apiClient.post<TaskRecord>("/nodes", {
      vertical: vertical || "shared",
      object_type: "task",
      data: { parent_id: recordId, title, done: false, assignee: null, created_at: new Date().toISOString() },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks", recordId] }); setNewTitle(""); setAdding(false); },
  });
  const toggleTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`/nodes/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", recordId] }),
  });

  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 30); }, [adding]);

  const tasks = tasksQuery.data ?? [];
  const sorted = [...tasks.filter(t => !t.data.done), ...tasks.filter(t => t.data.done)];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Tasks</p>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors">
          <Plus size={12}/> Add task
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-500/20 bg-white/[.02] px-3 py-2.5">
          <Square size={14} className="text-slate-600 shrink-0"/>
          <input
            ref={inputRef} value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newTitle.trim()) createTask.mutate(newTitle.trim());
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
            placeholder="Task title… (Enter to save)"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
          />
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-slate-600 hover:text-slate-400 transition-colors"><X size={12}/></button>
        </div>
      )}
      {tasks.length === 0 && !adding ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
          <CheckSquare size={18} className="mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No tasks yet. Click "Add task" to get started.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sorted.map(task => {
            const isDone = Boolean(task.data.done);
            return (
              <div key={task.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[.02] transition-colors">
                <button onClick={() => toggleTask.mutate({ id: task.id, data: { ...task.data, done: !isDone } })} className="shrink-0">
                  {isDone ? <CheckSquare size={15} className="text-emerald-400"/> : <Square size={15} className="text-slate-600 hover:text-slate-400 transition-colors"/>}
                </button>
                <span className={`flex-1 text-sm ${isDone ? "line-through text-slate-600" : "text-slate-300"}`}>{String(task.data.title || "Untitled task")}</span>
                {task.data.assignee != null && <span className="text-[10px] text-slate-600 shrink-0 rounded bg-white/[.04] px-1.5 py-0.5">{String(task.data.assignee)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function RecordDetail({ recordId, objectType }: { recordId: string; objectType: string }) {
  const qc = useQueryClient();
  const [tab, setTab]         = useState<Tab>("Overview");
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const query = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => apiClient.get<RecordData>(`/nodes/${recordId}`),
  });

  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.patch(`/nodes/${recordId}`, { data }),
    onSuccess: (updated) => {
      qc.setQueryData(["record", recordId], updated);
      qc.invalidateQueries({ queryKey: ["records", objectType] });
    },
  });

  const save = useCallback((field: string, rawVal: string) => {
    if (!query.data) return;
    const current = query.data.data;
    const isNum = typeof current[field] === "number" || /arr|value|funding|followers/.test(field);
    const val = isNum ? (parseFloat(rawVal) || rawVal) : rawVal;
    patch.mutate({ ...current, [field]: val });
  }, [query.data, patch]);

  const saveCategories = useCallback((cats: Category[]) => {
    if (!query.data) return;
    patch.mutate({ ...query.data.data, categories: cats });
  }, [query.data, patch]);

  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const acts = query.data.activities ?? [];
    if (!acts.length || !objectType.toLowerCase().includes("deal")) return;
    const cur = String(query.data.data.deal_stage ?? "");
    for (const act of acts) {
      const detected = detectStageFromActivity(`${act.action} ${act.ai_summary ?? ""}`);
      if (detected && detected !== cur) {
        const t = setTimeout(() => {
          patch.mutate({ ...query.data.data, deal_stage: detected });
          setAutoMsg(`AI moved stage to "${detected}" based on activity`);
          setTimeout(() => setAutoMsg(null), 5000);
        }, 1500);
        return () => clearTimeout(t);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data?.activities, objectType]);

  if (query.isLoading) return <div className="p-8"><PageSkeleton/></div>;
  if (query.isError || !query.data) return (
    <div className="p-8"><ErrorState error={(query.error as Error) ?? new Error("Record not found")} onRetry={() => query.refetch()}/></div>
  );

  const record = query.data;
  const data   = record.data;
  const name   = fmt(data.name ?? data.title ?? record.id);
  const type   = objectType.toLowerCase();
  const isCompany = type === "companies" || type.includes("compan");
  const isPeople  = type === "people"    || type.includes("person") || type.includes("contact");
  const isDeals   = type === "deals"     || type.includes("deal");

  const email      = String(data.email ?? "");
  const categories: Category[] = Array.isArray(data.categories) ? (data.categories as Category[]) : [];
  const leftFields = Object.entries(data).filter(([k]) => k !== "name" && k !== "categories");
  const companyTabLabel = isCompany ? "People" : isPeople ? "Company" : "Related";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-white/[.06] px-6 py-3 shrink-0">
        <Link to={`/objects/${objectType}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors">
          <ChevronLeft size={13}/>{objectType}
        </Link>
        <span className="text-xs text-slate-700">/</span>
        <span className="text-xs text-slate-400 truncate">{name}</span>
        {patch.isPending && <span className="ml-auto text-xs text-slate-600 animate-pulse">Saving…</span>}
      </div>

      {/* AI banner */}
      {autoMsg && (
        <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/[.06] px-6 py-2 text-xs text-emerald-400 shrink-0">
          <Sparkles size={12} className="shrink-0"/>{autoMsg}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel ── */}
        <aside className="flex w-[272px] shrink-0 flex-col border-r border-white/[.06] overflow-auto">

          {/* Avatar + name + CTA buttons */}
          <div className="px-5 pt-6 pb-4 border-b border-white/[.06]">
            <div className={`mx-auto h-14 w-14 rounded-2xl border bg-gradient-to-br flex items-center justify-center text-xl font-bold ${avatarColor(name)}`}>
              {initials(name)}
            </div>
            <div className="mt-3 text-center">
              <h1 className="text-[14px] font-semibold text-white tracking-tight leading-snug">{name}</h1>
              <span className="mt-1 inline-block rounded-md bg-white/[.04] border border-white/[.06] px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-wide capitalize">
                {record.object_type}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <a
                href={email ? `mailto:${email}` : undefined}
                onClick={e => { if (!email) e.preventDefault(); }}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-medium transition-colors ${email ? "text-slate-300 hover:text-white hover:bg-white/[.06] cursor-pointer" : "text-slate-600 cursor-not-allowed"}`}
              >
                <Mail size={12}/>Compose email
              </a>
              <div ref={listRef} className="relative">
                <button
                  onClick={() => setListOpen(o => !o)}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors"
                >
                  <Users size={12}/>Add to list
                  <ChevronDown size={11} className={`ml-auto transition-transform ${listOpen ? "rotate-180" : ""}`}/>
                </button>
                {listOpen && (
                  <div className="dropdown-panel absolute left-0 right-0 top-full mt-1 z-50">
                    {["Newsletter","Hot leads","VIP customers","Demo queue"].map(list => (
                      <button key={list} onClick={() => setListOpen(false)} className="dropdown-item w-full">{list}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="px-4 py-3 border-b border-white/[.06]">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Categories</p>
            <CategoryPills categories={categories} onUpdate={saveCategories}/>
          </div>

          {/* Record details */}
          <div className="flex-1 overflow-auto px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-700">Record Details</p>
            {leftFields.map(([key, val]) => (
              <InlineField key={key} label={key.replace(/_/g, " ")} value={val} numeric={typeof val === "number"} onSave={v => save(key, v)}/>
            ))}
            {leftFields.length === 0 && <p className="text-xs text-slate-600 py-2">No attributes</p>}
          </div>
        </aside>

        {/* ── Right panel ── */}
        <main className="flex flex-1 min-w-0 flex-col overflow-hidden">

          {/* Tab bar */}
          <div className="flex border-b border-white/[.06] shrink-0 overflow-x-auto">
            {TABS.map(t => {
              const label = t === "Company" ? companyTabLabel : t;
              return (
                <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap shrink-0 ${tab === t ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
                  {label}
                  {tab === t && <span className="absolute bottom-0 left-0 right-0 h-px bg-red-500"/>}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-6">

            {tab === "Overview" && (
              <div className="space-y-7 max-w-3xl">
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-600">Highlights</p>
                  {isCompany && <CompanyHighlights data={data} onSave={save}/>}
                  {isPeople  && <PeopleHighlights  data={data} onSave={save}/>}
                  {isDeals   && <DealHighlights    data={data} onSave={save}/>}
                  {!isCompany && !isPeople && !isDeals && (
                    <div className="grid grid-cols-2 gap-3">
                      <HighlightCard icon={Clock} label="Updated" value={new Date(record.updated_at).toLocaleDateString()} accent="slate"/>
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-600">Recent Activity</p>
                  <ActivityFeed activities={record.activities} createdAt={record.updated_at}/>
                </div>
              </div>
            )}

            {tab === "Activity" && (
              <div className="max-w-xl">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-600">Full Activity</p>
                <ActivityFeed activities={record.activities} createdAt={record.updated_at}/>
              </div>
            )}

            {tab === "Notes"   && <NotesTab recordId={recordId} vertical={record.vertical}/>}
            {tab === "Tasks"   && <TasksTab recordId={recordId} vertical={record.vertical}/>}

            {(tab === "Emails" || tab === "Calls" || tab === "Files") && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
                <Plus size={20} className="mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">{tab}</p>
                <p className="mt-1 text-xs text-slate-600">No {tab.toLowerCase()} yet for this record.</p>
              </div>
            )}

            {tab === "Company" && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
                <Building2 size={20} className="mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">{companyTabLabel}</p>
                <p className="mt-1 text-xs text-slate-600">No associated {companyTabLabel.toLowerCase()} yet.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

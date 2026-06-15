import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, Check, Building2, Users, Wifi, Calendar,
  DollarSign, Users2, Mail, Phone, Tag, Clock, Plus,
  ChevronDown, Sparkles, MapPin, TrendingUp, Square,
  CheckSquare, FileText, X, Link2, Search, UserCheck,
  Camera, ExternalLink,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { detectStageFromActivity } from "../../lib/ai-enrichment";
import { PageSkeleton, ErrorState } from "../ui/page-state";
import { TagPicker, TagBadges } from "./tag-picker";
import { ActivityTimeline } from "./activity-timeline";
import { LeadScoreBadge } from "./lead-score-badge";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Activity { id: string; action: string; diff?: Record<string, unknown> | null; ai_summary?: string | null; created_at: string; actor_type: string }
interface RecordData { id: string; object_type: string; vertical: string; data: Record<string, unknown>; ai_summary?: string; activities?: Activity[]; updated_at: string }
interface NoteRecord  { id: string; data: Record<string, unknown>; updated_at: string }
interface TaskRecord  { id: string; data: Record<string, unknown>; updated_at: string }
interface Category   { name: string; color: string }
interface Member     { id: string; name: string; email: string; role?: string; avatar_url?: string | null }
interface RelatedNode { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }

// ─── Industry taxonomy ────────────────────────────────────────────────────────
export const INDUSTRY_TAXONOMY: { name: string; bg: string; text: string; border: string }[] = [
  { name: "B2B",                    bg: "#1e3a5f", text: "#93c5fd", border: "#3b82f6" },
  { name: "B2C",                    bg: "#4a1942", text: "#f0abfc", border: "#d946ef" },
  { name: "SaaS",                   bg: "#2d1b69", text: "#c4b5fd", border: "#7c3aed" },
  { name: "Web Services & Apps",    bg: "#0c3341", text: "#67e8f9", border: "#06b6d4" },
  { name: "Consulting",             bg: "#3d2700", text: "#fcd34d", border: "#f59e0b" },
  { name: "FinTech",                bg: "#052e16", text: "#6ee7b7", border: "#10b981" },
  { name: "HealthTech",             bg: "#042f2e", text: "#5eead4", border: "#14b8a6" },
  { name: "EdTech",                 bg: "#1e1b4b", text: "#a5b4fc", border: "#6366f1" },
  { name: "E-commerce",             bg: "#3b1206", text: "#fda4af", border: "#f43f5e" },
  { name: "AI / ML",               bg: "#1a0a2e", text: "#e879f9", border: "#a855f7" },
  { name: "Cybersecurity",          bg: "#2d0a0a", text: "#fca5a5", border: "#ef4444" },
  { name: "Marketplace",            bg: "#0c1a3d", text: "#93c5fd", border: "#2563eb" },
  { name: "Manufacturing",          bg: "#1c1917", text: "#d6d3d1", border: "#78716c" },
  { name: "Real Estate",            bg: "#1c1100", text: "#fde68a", border: "#d97706" },
  { name: "Logistics & Supply",     bg: "#0d2d0d", text: "#86efac", border: "#22c55e" },
  { name: "Media & Entertainment",  bg: "#3b0764", text: "#e9d5ff", border: "#9333ea" },
  { name: "Legal",                  bg: "#1c1c1c", text: "#e5e7eb", border: "#6b7280" },
  { name: "Energy",                 bg: "#1a2e05", text: "#bef264", border: "#84cc16" },
  { name: "Agency",                 bg: "#271100", text: "#fdba74", border: "#ea580c" },
  { name: "Nonprofit",              bg: "#052e16", text: "#a7f3d0", border: "#059669" },
];

// ─── Constants ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "from-red-500/30 to-red-600/10 text-red-300 border-red-500/20",
  "from-blue-500/30 to-blue-600/10 text-blue-300 border-blue-500/20",
  "from-emerald-500/30 to-emerald-600/10 text-emerald-300 border-emerald-500/20",
  "from-purple-500/30 to-purple-600/10 text-purple-300 border-purple-500/20",
  "from-amber-500/30 to-amber-600/10 text-amber-300 border-amber-500/20",
];
const PIPE_STAGES = ["Lead","Qualified","In Progress","Proposal","Negotiation"] as const;
const STAGE_DOT: Record<string, string> = {
  "Lead": "bg-slate-400", "Qualified": "bg-blue-400", "In Progress": "bg-violet-400",
  "Proposal": "bg-amber-400", "Negotiation": "bg-orange-400",
};
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

// ─── Avatar / logo uploader ───────────────────────────────────────────────────
function AvatarSection({ name, logoUrl, onSave, wrapClass = "mx-auto" }: { name: string; logoUrl?: string; onSave: (url: string) => void; wrapClass?: string }) {
  const [open, setOpen]     = useState(false);
  const [urlDraft, setUrl]  = useState("");
  const [error, setError]   = useState("");
  const popRef  = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function applyUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) { setError("Enter a URL"); return; }
    if (!/^https?:\/\/.+/.test(trimmed)) { setError("Must start with https://"); return; }
    onSave(trimmed); setOpen(false); setUrl(""); setError("");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const res = ev.target?.result; if (typeof res === "string") { onSave(res); setOpen(false); } };
    reader.readAsDataURL(file);
  }

  return (
    <div className={`relative ${wrapClass} w-14`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative group h-14 w-14 rounded-2xl overflow-hidden focus:outline-none"
        title="Change logo"
      >
        {logoUrl ? (
          <img src={logoUrl} alt={name} className="h-full w-full object-cover"/>
        ) : (
          <div className={`h-full w-full border bg-gradient-to-br flex items-center justify-center text-xl font-bold ${avatarColor(name)}`}>
            {initials(name)}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
          <Camera size={16} className="text-white"/>
        </div>
      </button>

      {open && (
        <div ref={popRef} className="dropdown-panel absolute left-1/2 top-full mt-2 w-64 p-3 z-50 -translate-x-1/2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Logo / Avatar</p>

          <input
            type="text"
            value={urlDraft}
            onChange={e => { setUrl(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") applyUrl(urlDraft); if (e.key === "Escape") setOpen(false); }}
            placeholder="Paste image URL…"
            className="w-full rounded border border-white/[.08] bg-white/[.04] px-2 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-red-500/30 mb-1"
          />
          {error && <p className="text-[10px] text-red-400 mb-1">{error}</p>}

          <div className="flex gap-2 mt-2">
            <button
              onClick={() => applyUrl(urlDraft)}
              className="flex-1 rounded-md bg-red-500/20 border border-red-500/30 text-red-300 text-xs py-1.5 hover:bg-red-500/30 transition-colors"
            >
              <ExternalLink size={10} className="inline mr-1"/>Apply URL
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 rounded-md border border-white/[.08] bg-white/[.03] text-slate-400 text-xs py-1.5 hover:bg-white/[.06] transition-colors"
            >
              Upload file
            </button>
          </div>

          {logoUrl && (
            <button
              onClick={() => { onSave(""); setOpen(false); }}
              className="mt-2 w-full text-center text-[10px] text-slate-600 hover:text-red-400 transition-colors"
            >
              Remove logo
            </button>
          )}

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
        </div>
      )}
    </div>
  );
}

// ─── Industry category pills ───────────────────────────────────────────────────
export function CategoryPills({ categories, onUpdate }: { categories: Category[]; onUpdate: (cats: Category[]) => void }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const ref    = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);

  const MAX = 3;
  const overflow = categories.length - MAX;
  const selected = new Set(categories.map(c => c.name));

  const filtered = INDUSTRY_TAXONOMY.filter(t =>
    !query || t.name.toLowerCase().includes(query.toLowerCase())
  );

  function toggle(t: typeof INDUSTRY_TAXONOMY[number]) {
    if (selected.has(t.name)) {
      onUpdate(categories.filter(c => c.name !== t.name));
    } else {
      onUpdate([...categories, { name: t.name, color: t.border }]);
    }
  }

  function styleFor(colorHex: string) {
    const cat = INDUSTRY_TAXONOMY.find(t => t.border === colorHex || t.name === colorHex);
    return cat ?? INDUSTRY_TAXONOMY[0]!;
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {categories.slice(0, MAX).map((cat, i) => {
          const s = styleFor(cat.color);
          return (
            <span
              key={i}
              style={{ background: s.bg, color: s.text, borderColor: s.border + "55" }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border group"
            >
              {cat.name}
              <button onClick={() => onUpdate(categories.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-white ml-0.5">
                <X size={8}/>
              </button>
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="rounded-full bg-white/[.05] border border-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">+{overflow}</span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="h-5 w-5 rounded-full border border-dashed border-white/[.14] bg-white/[.03] hover:bg-white/[.07] flex items-center justify-center text-slate-600 hover:text-slate-400 transition-colors"
        >
          <Plus size={9}/>
        </button>
      </div>

      {open && (
        <div className="dropdown-panel absolute left-0 top-full mt-2 w-60 z-50 p-2">
          <div className="flex items-center gap-1.5 border border-white/[.07] rounded-md px-2 py-1.5 mb-2 bg-white/[.02]">
            <Search size={11} className="text-slate-600 shrink-0"/>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search industries…"
              className="flex-1 bg-transparent text-xs text-white placeholder-slate-600 outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {filtered.map(t => {
              const isOn = selected.has(t.name);
              return (
                <button
                  key={t.name}
                  onClick={() => toggle(t)}
                  className="flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 hover:bg-white/[.04] transition-colors"
                >
                  <span
                    style={{ background: t.bg, color: t.text, borderColor: t.border + "55" }}
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border flex-1 text-left"
                  >
                    {t.name}
                  </span>
                  {isOn && <Check size={11} className="text-emerald-400 shrink-0"/>}
                </button>
              );
            })}
            {filtered.length === 0 && <p className="px-2 py-2 text-xs text-slate-600">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
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
    <div className="group grid grid-cols-[100px_1fr] items-start gap-2 py-2 border-b border-zinc-800/40 last:border-0">
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

// ─── Highlight card (fully editable) ─────────────────────────────────────────
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
    <div className={`rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3.5 transition-colors ${onSave ? "hover:border-zinc-700/70 cursor-pointer" : ""}`}>
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
          title={onSave ? "Click to edit" : undefined}
        >
          {fmt(value)}
        </button>
      )}
    </div>
  );
}

// ─── Deal pipeline ────────────────────────────────────────────────────────────
function DealProgressBar({ stage, onSave }: { stage: string; onSave: (v: string) => void }) {
  const isWon  = stage === "Closed Won";
  const isLost = stage === "Closed Lost";
  const activeIdx = PIPE_STAGES.indexOf(stage as typeof PIPE_STAGES[number]);
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4 col-span-2">
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
                {i > 0 && <div className={`h-px flex-1 ${isPast || isActive ? "bg-white/20" : "bg-white/[.05]"}`}/>}
                <button onClick={() => onSave(s)} className="shrink-0 hover:scale-110 transition-transform">
                  <div className={`h-3 w-3 rounded-full transition-all ${dotCls}`}/>
                </button>
                {i < PIPE_STAGES.length - 1 && <div className={`h-px flex-1 ${isPast ? "bg-white/20" : "bg-white/[.05]"}`}/>}
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

// ─── Member / assignee section ────────────────────────────────────────────────
function AssigneesSection({ assignedTo, onAssign }: { assignedTo: string | null; onAssign: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: members = [] } = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    staleTime: 60_000,
  });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const current = assignedTo ? members.find(m => m.id === assignedTo || m.name === assignedTo) : null;

  return (
    <div className="px-4 py-3 border-b border-zinc-800/50">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Assigned to</p>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 w-full rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-2.5 py-2 hover:bg-zinc-800/40 transition-colors"
        >
          {current ? (
            <>
              <div className="h-6 w-6 rounded-full bg-red-500/20 border border-red-500/20 flex items-center justify-center text-[10px] font-bold text-red-300 shrink-0">
                {initials(current.name)}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs text-slate-300 truncate leading-none">{current.name}</p>
                {current.role && <p className="text-[10px] text-slate-600 mt-0.5 capitalize">{current.role}</p>}
              </div>
            </>
          ) : (
            <>
              <UserCheck size={14} className="text-slate-600 shrink-0"/>
              <span className="text-xs text-slate-600 flex-1 text-left">Unassigned</span>
            </>
          )}
          <ChevronDown size={11} className={`text-slate-600 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}/>
        </button>

        {open && (
          <div className="dropdown-panel absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto">
            <button
              onClick={() => { onAssign(null); setOpen(false); }}
              className={`dropdown-item w-full ${!assignedTo ? "dropdown-item-active" : ""}`}
            >
              <UserCheck size={12} className="text-slate-600"/>
              Unassigned
              {!assignedTo && <Check size={10} className="ml-auto text-red-400"/>}
            </button>
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => { onAssign(m.id); setOpen(false); }}
                className={`dropdown-item w-full ${assignedTo === m.id ? "dropdown-item-active" : ""}`}
              >
                <div className="h-5 w-5 rounded-full bg-red-500/20 border border-red-500/20 flex items-center justify-center text-[9px] font-bold text-red-300 shrink-0">
                  {initials(m.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="truncate block text-xs">{m.name}</span>
                  {m.role && <span className="text-[10px] text-slate-600 capitalize">{m.role}</span>}
                </div>
                {assignedTo === m.id && <Check size={10} className="ml-auto text-red-400 shrink-0"/>}
              </button>
            ))}
            {members.length === 0 && <p className="px-3 py-2 text-xs text-slate-600">No members yet</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────
function ActivityDot({ type }: { type: "create"|"update"|"system" }) {
  const cls = type === "create" ? "bg-emerald-500" : type === "update" ? "bg-blue-500" : "bg-slate-600";
  return <div className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${cls} ring-2 ring-[#0d0f13]`}/>;
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
      <HighlightCard icon={Wifi}       label="Connection"   value={data.connection_strength ?? "Not set"}     accent="emerald"/>
      <HighlightCard icon={Calendar}   label="Next meeting"  value={data.next_interaction ?? "Not scheduled"} accent="blue"/>
      <HighlightCard icon={Users2}     label="Team size"     value={data.employee_range ?? "—"}               accent="slate"  onSave={v => onSave("employee_range", v)}/>
      <HighlightCard icon={DollarSign} label="Est. ARR"      value={data.arr ?? "—"}                          accent="amber"  onSave={v => onSave("arr", v)} numeric/>
      <HighlightCard icon={TrendingUp} label="Funding"       value={data.funding_raised ?? "—"}               accent="purple" onSave={v => onSave("funding_raised", v)} numeric/>
      <HighlightCard icon={MapPin}     label="HQ / Country"  value={data.country ?? data.location ?? "—"}     accent="red"    onSave={v => onSave("country", v)}/>
    </div>
  );
}
function PeopleHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <HighlightCard icon={Wifi}      label="Connection"   value={data.connection_strength ?? "Not set"}     accent="emerald"/>
      <HighlightCard icon={Calendar}  label="Next meeting"  value={data.next_interaction ?? "Not scheduled"} accent="blue"/>
      <HighlightCard icon={Building2} label="Company"       value={data.company ?? "—"}                     accent="purple" onSave={v => onSave("company", v)}/>
      <HighlightCard icon={Mail}      label="Email"         value={data.email ?? "—"}                       accent="blue"   onSave={v => onSave("email", v)}/>
      <HighlightCard icon={Phone}     label="Phone"         value={data.phone ?? "—"}                       accent="slate"  onSave={v => onSave("phone", v)}/>
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

// ─── Inline notes panel (embedded in Overview) ────────────────────────────────
function InlineNotesPanel({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const { data: notes = [], isLoading } = useQuery({
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Notes</p>
        <button
          onClick={() => createNote.mutate()}
          disabled={createNote.isPending}
          className="flex items-center gap-1 rounded-md border border-white/[.07] bg-white/[.02] px-2 py-1 text-[10px] text-slate-500 hover:text-white hover:bg-white/[.05] transition-colors"
        >
          <Plus size={10}/> New note
        </button>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-white/[.02] animate-pulse"/>
      ) : notes.length === 0 && !createNote.isPending ? (
        <button
          onClick={() => createNote.mutate()}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[.06] bg-white/[.01] px-3 py-3 text-xs text-slate-600 hover:text-slate-400 hover:border-white/[.10] transition-colors"
        >
          <FileText size={13}/>
          Click to add a note…
        </button>
      ) : (
        <div className="space-y-1.5">
          {createNote.isPending && (
            <div className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2.5 animate-pulse">
              <div className="h-2.5 w-28 rounded bg-white/[.05] mb-1.5"/>
              <div className="h-2 w-40 rounded bg-white/[.04]"/>
            </div>
          )}
          {notes.slice(0, 3).map(note => (
            <div key={note.id} className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2.5 hover:border-white/[.09] cursor-pointer transition-colors">
              <p className="text-xs font-medium text-white">{String(note.data.title || "Untitled note")}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">
                {String(note.data.content || "This note has no content")} • {relativeTime(String(note.data.created_at || note.updated_at))}
              </p>
            </div>
          ))}
          {notes.length > 3 && (
            <p className="text-[10px] text-slate-600 text-center py-1">+{notes.length - 3} more notes</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inline tasks panel (embedded in Overview) ────────────────────────────────
function InlineTasksPanel({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tasks = [], isLoading } = useQuery({
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
      data: { parent_id: recordId, title, done: false, created_at: new Date().toISOString() },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks", recordId] }); setNewTitle(""); setAdding(false); },
  });
  const toggleTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`/nodes/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", recordId] }),
  });

  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 30); }, [adding]);

  const todo = tasks.filter(t => !t.data.done);
  const done = tasks.filter(t => t.data.done);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">
          Tasks {todo.length > 0 && <span className="ml-1 rounded-full bg-red-500/20 text-red-300 px-1.5 py-0.5 text-[9px] font-bold">{todo.length}</span>}
        </p>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-md border border-white/[.07] bg-white/[.02] px-2 py-1 text-[10px] text-slate-500 hover:text-white hover:bg-white/[.05] transition-colors"
        >
          <Plus size={10}/> Add task
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-white/[.02] px-2.5 py-2 mb-1.5">
          <Square size={13} className="text-slate-600 shrink-0"/>
          <input
            ref={inputRef} value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newTitle.trim()) createTask.mutate(newTitle.trim());
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
            placeholder="Task title… Enter to save"
            className="flex-1 bg-transparent text-xs text-white placeholder-slate-600 outline-none"
          />
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-slate-600 hover:text-slate-400"><X size={11}/></button>
        </div>
      )}

      {isLoading ? (
        <div className="h-10 rounded-lg bg-white/[.02] animate-pulse"/>
      ) : tasks.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[.06] bg-white/[.01] px-3 py-3 text-xs text-slate-600 hover:text-slate-400 hover:border-white/[.10] transition-colors"
        >
          <CheckSquare size={13}/>
          Click to add a task…
        </button>
      ) : (
        <div className="space-y-0.5">
          {[...todo, ...done].slice(0, 5).map(task => {
            const isDone = Boolean(task.data.done);
            return (
              <div key={task.id} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/[.02] transition-colors">
                <button onClick={() => toggleTask.mutate({ id: task.id, data: { ...task.data, done: !isDone } })} className="shrink-0">
                  {isDone
                    ? <CheckSquare size={13} className="text-emerald-400"/>
                    : <Square size={13} className="text-slate-600 hover:text-slate-400 transition-colors"/>}
                </button>
                <span className={`flex-1 text-xs ${isDone ? "line-through text-slate-600" : "text-slate-300"}`}>{String(task.data.title || "Untitled")}</span>
              </div>
            );
          })}
          {tasks.length > 5 && <p className="text-[10px] text-slate-600 text-center py-1">+{tasks.length - 5} more</p>}
        </div>
      )}
    </div>
  );
}

// ─── Full notes tab ───────────────────────────────────────────────────────────
function NotesTab({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const { data: notes = [], isLoading } = useQuery({
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
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">Notes</p>
        <button onClick={() => createNote.mutate()} disabled={createNote.isPending} className="flex items-center gap-1.5 rounded-md border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors disabled:opacity-50">
          <Plus size={12}/> New note
        </button>
      </div>
      {createNote.isPending && <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 animate-pulse"><div className="h-3 w-32 rounded bg-white/[.05] mb-2"/><div className="h-2 w-48 rounded bg-white/[.04]"/></div>}
      {notes.length === 0 && !isLoading && !createNote.isPending ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
          <FileText size={18} className="mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No notes yet. Click "New note" to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 hover:border-white/[.09] transition-colors cursor-pointer">
              <p className="text-sm font-medium text-white">{String(note.data.title || "Untitled note")}</p>
              <p className="mt-0.5 text-xs text-slate-600">{String(note.data.content || "This note has no content")} • {relativeTime(String(note.data.created_at || note.updated_at))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Full tasks tab ───────────────────────────────────────────────────────────
function TasksTab({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const [adding, setAdding]     = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: tasks = [] } = useQuery({
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
      data: { parent_id: recordId, title, done: false, created_at: new Date().toISOString() },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks", recordId] }); setNewTitle(""); setAdding(false); },
  });
  const toggleTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`/nodes/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", recordId] }),
  });
  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 30); }, [adding]);
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
          <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) createTask.mutate(newTitle.trim()); if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
            placeholder="Task title… (Enter to save)" className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"/>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-slate-600 hover:text-slate-400"><X size={12}/></button>
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

// ─── Related records tab ──────────────────────────────────────────────────────
function RelatedTab({ recordId, tabLabel }: { recordId: string; tabLabel: string }) {
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchRef  = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { if (searchOpen) setTimeout(() => searchInput.current?.focus(), 30); }, [searchOpen]);

  const { data: related = [], isLoading: relLoading } = useQuery({
    queryKey: ["related", recordId],
    queryFn: () => apiClient.get<RelatedNode[]>(`/nodes/${recordId}/related`),
  });
  const { data: allNodes = [], isLoading: allLoading } = useQuery({
    queryKey: ["all-nodes-search"],
    queryFn: () => apiClient.get<RelatedNode[]>("/nodes?limit=200"),
    enabled: searchOpen,
  });
  const linkRecord = useMutation({
    mutationFn: (targetId: string) => apiClient.post(`/nodes/${recordId}/relate`, { target_id: targetId, relationship: "related" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["related", recordId] }); setSearchOpen(false); setSearchText(""); },
  });

  const relatedIds = new Set(related.map(r => r.id));
  const searchResults = allNodes.filter(n => {
    if (n.id === recordId || relatedIds.has(n.id)) return false;
    const name = String(n.data.name ?? n.data.title ?? "").toLowerCase();
    return !searchText || name.includes(searchText.toLowerCase());
  }).slice(0, 8);

  function rname(r: RelatedNode) { return String(r.data.name ?? r.data.title ?? r.id); }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">{tabLabel}</p>
        <div ref={searchRef} className="relative">
          <button onClick={() => setSearchOpen(o => !o)} className="flex items-center gap-1.5 rounded-md border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors">
            <Link2 size={12}/> Link record
          </button>
          {searchOpen && (
            <div className="dropdown-panel absolute right-0 top-full mt-1 w-72 z-50 p-2">
              <div className="flex items-center gap-2 border border-white/[.08] rounded-md px-2 py-1.5 mb-2 bg-white/[.02]">
                <Search size={12} className="text-slate-600 shrink-0"/>
                <input ref={searchInput} value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search records…" className="flex-1 bg-transparent text-xs text-white placeholder-slate-600 outline-none"/>
              </div>
              {allLoading ? <p className="text-xs text-slate-600 px-2 py-2">Loading…</p> : searchResults.length === 0 ? (
                <p className="text-xs text-slate-600 px-2 py-2">{searchText ? "No matches" : "No records to link"}</p>
              ) : searchResults.map(r => (
                <button key={r.id} onClick={() => linkRecord.mutate(r.id)} disabled={linkRecord.isPending}
                  className="flex items-center gap-2.5 w-full rounded-md px-2 py-2 hover:bg-white/[.04] transition-colors group">
                  <div className={`h-6 w-6 rounded-lg border bg-gradient-to-br flex items-center justify-center text-[9px] font-bold shrink-0 ${avatarColor(rname(r))}`}>{initials(rname(r))}</div>
                  <div className="min-w-0 text-left"><p className="text-xs text-slate-300 truncate">{rname(r)}</p><p className="text-[10px] text-slate-600 capitalize">{r.object_type}</p></div>
                  <Link2 size={11} className="text-slate-700 group-hover:text-red-400 ml-auto shrink-0 transition-colors"/>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {relLoading ? <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 rounded-lg bg-white/[.02] animate-pulse"/>)}</div>
       : related.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
          <Link2 size={18} className="mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No linked records yet.</p>
          <p className="mt-1 text-xs text-slate-700">Click "Link record" to associate companies, people, or deals.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {related.map(r => {
            const n = rname(r);
            return (
              <Link key={r.id} to={`/objects/${r.object_type}/${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/[.06] bg-white/[.02] p-3 hover:border-white/[.10] hover:bg-white/[.03] transition-colors group">
                <div className={`h-8 w-8 rounded-lg border bg-gradient-to-br flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(n)}`}>{initials(n)}</div>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-white truncate">{n}</p><p className="text-xs text-slate-600 capitalize">{r.object_type}</p></div>
                <ChevronLeft size={13} className="text-slate-700 group-hover:text-slate-400 rotate-180 transition-colors shrink-0"/>
              </Link>
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
  const [tab, setTab]           = useState<Tab>("Overview");
  const [listOpen, setListOpen] = useState(false);
  const [tagOpen, setTagOpen]   = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
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

  const assignMember = useCallback((memberId: string | null) => {
    if (!query.data) return;
    const next = { ...query.data.data };
    if (memberId) next.assigned_to = memberId; else delete next.assigned_to;
    patch.mutate(next);
  }, [query.data, patch]);

  const saveLogo = useCallback((url: string) => {
    if (!query.data) return;
    patch.mutate({ ...query.data.data, logo_url: url || undefined });
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
  const logoUrl    = data.logo_url ? String(data.logo_url) : undefined;
  const assignedTo = data.assigned_to ? String(data.assigned_to) : null;
  const categories: Category[] = Array.isArray(data.categories) ? (data.categories as Category[]) : [];
  const leftFields = Object.entries(data).filter(([k]) =>
    !["name","categories","assigned_to","logo_url"].includes(k)
  );
  const companyTabLabel = isCompany ? "People" : isPeople ? "Company" : "Related";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-zinc-800/50 px-6 py-3 shrink-0">
        <Link to={`/objects/${objectType}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors">
          <ChevronLeft size={13}/>{objectType}
        </Link>
        <span className="text-xs text-slate-700">/</span>
        <span className="text-xs text-slate-400 truncate">{name}</span>
        {patch.isPending && <span className="ml-auto text-xs text-slate-600 animate-pulse">Saving…</span>}
      </div>

      {autoMsg && (
        <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/[.06] px-6 py-2 text-xs text-emerald-400 shrink-0">
          <Sparkles size={12} className="shrink-0"/>{autoMsg}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel ── */}
        <aside className="flex w-[272px] shrink-0 flex-col border-r border-zinc-800/50 overflow-auto">

          <div className="px-5 pt-5 pb-4 border-b border-zinc-800/50">
            {/* Entity header — horizontal layout */}
            <div className="flex items-center gap-3">
              <AvatarSection name={name} logoUrl={logoUrl} onSave={saveLogo} wrapClass="shrink-0"/>
              <div className="flex-1 min-w-0">
                <h1 className="text-[13px] font-bold text-white tracking-wide leading-snug uppercase truncate">{name}</h1>
                <p className="mt-0.5 text-[11px] text-zinc-500 truncate">
                  {fmt((data.domain ?? data.website ?? "") as string) !== "—"
                    ? fmt((data.domain ?? data.website ?? "") as string)
                    : record.object_type}
                </p>
              </div>
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
                <button onClick={() => setListOpen(o => !o)} className="flex w-full items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors">
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
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setTagOpen(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors"
              >
                <Tag size={12}/> Tags
              </button>
              <button
                onClick={() => setTimelineOpen(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[.06] transition-colors"
              >
                <Clock size={12}/> Activity
              </button>
            </div>
            <div className="mt-2"><TagBadges nodeId={recordId} onOpenPicker={() => setTagOpen(true)}/></div>
          </div>

          {/* Assignee */}
          <AssigneesSection assignedTo={assignedTo} onAssign={assignMember}/>

          {/* Lead score */}
          {(record as Record<string,unknown>).lead_score != null && (
            <div className="px-4 py-3 border-b border-zinc-800/50">
              <LeadScoreBadge score={(record as Record<string,unknown>).lead_score as number} size="md" />
            </div>
          )}

          {/* Categories (industry taxonomy) */}
          <div className="px-4 py-3 border-b border-zinc-800/50">
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
          <div className="flex border-b border-zinc-800/50 shrink-0 overflow-x-auto">
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

          <div className="flex-1 overflow-auto p-6">

            {tab === "Overview" && (
              <div className="space-y-7 max-w-3xl">
                {/* Highlights */}
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

                {/* Embedded Notes + Tasks side-by-side */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 p-4">
                    <InlineNotesPanel recordId={recordId} vertical={record.vertical}/>
                  </div>
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 p-4">
                    <InlineTasksPanel recordId={recordId} vertical={record.vertical}/>
                  </div>
                </div>

                {/* Activity */}
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
            {tab === "Company" && <RelatedTab recordId={recordId} tabLabel={companyTabLabel}/>}

            {(tab === "Emails" || tab === "Calls" || tab === "Files") && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
                <Plus size={20} className="mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">{tab}</p>
                <p className="mt-1 text-xs text-slate-600">No {tab.toLowerCase()} yet for this record.</p>
              </div>
            )}
          </div>
        </main>
      </div>

      {tagOpen && <TagPicker nodeId={recordId} onClose={() => setTagOpen(false)} />}
      {timelineOpen && <ActivityTimeline nodeId={recordId} onClose={() => setTimelineOpen(false)} />}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { LogoMark } from "@/components/logo";
import { Link } from "react-router-dom";
import {
  ChevronLeft, Check, Building2, Users, Wifi, Calendar,
  DollarSign, Users2, Mail, Phone, Tag, Clock, Plus,
  ChevronDown, MapPin, TrendingUp, Square,
  CheckSquare, FileText, X, Link2, Search, UserCheck,
  Camera, ExternalLink, Briefcase, Percent, Receipt,
  CreditCard, Star, List, Trash2, Pencil, PhoneCall,
  MessageSquare, Video, AlignLeft,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { detectStageFromActivity } from "../../lib/ai-enrichment";
import { PageSkeleton, ErrorState } from "../ui/page-state";
import { TagPicker, TagBadges } from "./tag-picker";
import { StagePill, DEFAULT_STAGE_OPTIONS, DEFAULT_STATUS_OPTIONS } from "./record-table";
import { ActivityTimeline } from "./activity-timeline";
import { LeadScoreBadge } from "./lead-score-badge";
import { useAskContextStore } from "../../lib/ask-context-store";
import { AIAgentOwnerChip, AIInsightBadge, AIHealthScore, AISignalList } from "../ai/ai-intelligence";

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
  { name: "SaaS",                   bg: "#2d1b69", text: "#c4b5fd", border: "var(--accent)" },
  { name: "Web Services & Apps",    bg: "#0c3341", text: "var(--accent)", border: "var(--accent)" },
  { name: "Consulting",             bg: "#3d2700", text: "#fcd34d", border: "#f59e0b" },
  { name: "FinTech",                bg: "#052e16", text: "#6ee7b7", border: "#10b981" },
  { name: "HealthTech",             bg: "#042f2e", text: "#5eead4", border: "#14b8a6" },
  { name: "EdTech",                 bg: "#1e1b4b", text: "#a5b4fc", border: "var(--accent)" },
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
  "from-red-500/30 to-red-600/10 text-stone-300 border-stone-500/20",
  "from-blue-500/30 to-blue-600/10 text-blue-300 border-blue-500/20",
  "from-emerald-500/30 to-emerald-600/10 text-emerald-300 border-emerald-500/20",
  "from-stone-500/30 to-stone-600/10 text-stone-300 border-stone-500/20",
  "from-amber-500/30 to-amber-600/10 text-amber-300 border-amber-500/20",
];
const PIPE_STAGES = ["Lead","Qualified","In Progress","Proposal","Negotiation"] as const;
const STAGE_DOT: Record<string, string> = {
  "Lead": "bg-stone-400", "Qualified": "bg-blue-400", "In Progress": "bg-stone-400",
  "Proposal": "bg-amber-400", "Negotiation": "bg-orange-400",
};
function getTabsForType(type: string): string[] {
  const t = type.toLowerCase();
  if (t === "companies" || t.includes("compan")) return ["Overview","People","Deals","Contact Log","Finance","Notes","Tasks","Files"];
  if (t === "people" || t.includes("person") || t.includes("contact")) return ["Overview","Company","Deals","Emails","Contact Log","Finance","Notes","Tasks"];
  if (t === "deals" || t.includes("deal")) return ["Overview","Contact","Company","Contact Log","Notes","Tasks"];
  if (t.includes("invest")) return ["Overview","Notes","Tasks"];
  if (t.includes("tax") || t.includes("cost")) return ["Overview","Notes","Files"];
  if (t === "tasks" || t.includes("task")) return ["Overview","Notes"];
  if (t.includes("visit") || t.includes("payment")) return ["Overview","Notes","Files"];
  if (t.includes("expense")) return ["Overview","Notes","Files"];
  return ["Overview","Notes","Tasks","Files"];
}

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
        className="relative group h-14 w-14 rounded-sm overflow-hidden focus:outline-none"
        title="Change logo"
      >
        {logoUrl ? (
          <img src={logoUrl} alt={name} className="h-full w-full object-cover"/>
        ) : (
          <div className={`h-full w-full border bg-gradient-to-br flex items-center justify-center text-xl font-bold ${avatarColor(name)}`}>
            {initials(name)}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm">
          <Camera size={16} className="text-[var(--text-primary)]"/>
        </div>
      </button>

      {open && (
        <div ref={popRef} className="dropdown-panel absolute left-1/2 top-full mt-2 w-64 p-3 z-50 -translate-x-1/2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-600 mb-2">Logo / Avatar</p>

          <input
            type="text"
            value={urlDraft}
            onChange={e => { setUrl(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") applyUrl(urlDraft); if (e.key === "Escape") setOpen(false); }}
            placeholder="Paste image URL…"
            className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-600 outline-none focus:border-stone-500/30 mb-1"
          />
          {error && <p className="text-[10px] text-stone-400 mb-1">{error}</p>}

          <div className="flex gap-2 mt-2">
            <button
              onClick={() => applyUrl(urlDraft)}
              className="flex-1 rounded-md bg-stone-500/20 border border-stone-500/30 text-stone-300 text-xs py-1.5 hover:bg-stone-500/30 transition-colors"
            >
              <ExternalLink size={10} className="inline mr-1"/>Apply URL
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] text-stone-400 text-xs py-1.5 hover:bg-[var(--surface-hover)] transition-colors"
            >
              Upload file
            </button>
          </div>

          {logoUrl && (
            <button
              onClick={() => { onSave(""); setOpen(false); }}
              className="mt-2 w-full text-center text-[10px] text-stone-600 hover:text-stone-400 transition-colors"
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
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [customName, setCustomName] = useState("");
  const ref       = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); setCustomName(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);

  const MAX = 3;
  const overflow = categories.length - MAX;
  const selected = new Set(categories.map(c => c.name));

  const CUSTOM_COLORS = ["var(--accent)","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","var(--accent)","var(--accent)"];
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

  function addCustom() {
    const n = customName.trim();
    if (!n || selected.has(n)) return;
    const color = CUSTOM_COLORS[(n.charCodeAt(0) || 0) % CUSTOM_COLORS.length]!;
    onUpdate([...categories, { name: n, color }]);
    setCustomName("");
    customRef.current?.focus();
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
              <button onClick={() => onUpdate(categories.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--text-primary)] ml-0.5">
                <X size={8}/>
              </button>
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="rounded-full bg-[var(--surface-hover)] border border-[var(--border-soft)] px-2 py-0.5 text-[10px] text-stone-500">+{overflow}</span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="h-5 w-5 rounded-full border border-dashed border-[var(--border-soft)] bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-stone-600 hover:text-stone-400 transition-colors"
        >
          <Plus size={9}/>
        </button>
      </div>

      {open && (
        <div className="dropdown-panel absolute left-0 top-full mt-2 w-64 z-50 p-2">
          <div className="flex items-center gap-1.5 border border-[var(--border-soft)] rounded-md px-2 py-1.5 mb-2 bg-[var(--surface-hover)]">
            <Search size={11} className="text-stone-600 shrink-0"/>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search industries…"
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-stone-600 outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
            {filtered.map(t => {
              const isOn = selected.has(t.name);
              return (
                <button
                  key={t.name}
                  onClick={() => toggle(t)}
                  className="flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 hover:bg-[var(--surface-hover)] transition-colors"
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
            {filtered.length === 0 && <p className="px-2 py-2 text-xs text-stone-600">No matches</p>}
          </div>
          {/* Create custom category */}
          <div className="border-t border-[var(--border-soft)] mt-1 pt-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-stone-600 px-1 mb-1.5">Create custom</p>
            <div className="flex items-center gap-1.5">
              <input
                ref={customRef}
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addCustom(); }}
                placeholder="Category name…"
                className="flex-1 bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-600 outline-none focus:border-[var(--border-soft)]"
              />
              <button
                onClick={addCustom}
                disabled={!customName.trim() || selected.has(customName.trim())}
                className="rounded-md bg-[var(--surface-hover)] border border-[var(--border-soft)] px-2 py-1.5 text-[10px] text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-30"
              >
                Add
              </button>
            </div>
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
    <div className="group grid grid-cols-[100px_1fr] items-start gap-2 py-2 border-b border-stone-800/40 last:border-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-stone-600 pt-0.5 select-none truncate">{label}</span>
      <div className="min-w-0 flex items-center gap-1">
        {editing ? (
          <input
            ref={inputRef} value={draft} type={numeric ? "number" : "text"}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
            className="w-full rounded border border-stone-500/30 bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none"
          />
        ) : (
          <button
            onClick={() => { setEditing(true); setDraft(fmt(value)); }}
            className="min-w-0 text-left text-xs text-stone-300 hover:text-[var(--text-primary)] transition-colors truncate group-hover:underline group-hover:decoration-dotted group-hover:decoration-stone-600 underline-offset-2"
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
  slate: "text-stone-400", red: "text-stone-400", blue: "text-blue-400",
  emerald: "text-emerald-400", amber: "text-amber-400", purple: "text-stone-400",
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
    <div className={`rounded-lg border border-stone-800/70 bg-stone-900/40 p-3.5 transition-colors ${onSave ? "hover:border-stone-700/70 cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={ACCENT_MAP[accent]}/>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">{label}</span>
        </div>
        {saved && <Check size={10} className="text-emerald-400"/>}
      </div>
      {editing ? (
        <input
          ref={inputRef} value={draft} type={numeric ? "number" : "text"}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
          className="w-full rounded border border-stone-500/30 bg-[var(--surface-hover)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
        />
      ) : (
        <button
          onClick={() => onSave && setEditing(true)}
          className={`text-left text-sm font-semibold text-[var(--text-primary)] truncate w-full ${onSave ? "hover:text-stone-300 transition-colors" : "cursor-default"}`}
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
    <div className="rounded-lg border border-stone-800/60 bg-stone-900/30 p-4 col-span-2">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-stone-400"/>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">Deal Pipeline</span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => onSave("Closed Won")} className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${isWon ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "text-stone-600 border-[var(--border-soft)] hover:text-emerald-300 hover:border-emerald-500/20"}`}>Won</button>
          <button onClick={() => onSave("Closed Lost")} className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${isLost ? "bg-stone-500/20 text-stone-300 border-stone-500/30" : "text-stone-600 border-[var(--border-soft)] hover:text-stone-300 hover:border-stone-500/20"}`}>Lost</button>
        </div>
      </div>
      <div className="flex items-start">
        {PIPE_STAGES.map((s, i) => {
          const isActive = s === stage;
          const isPast   = activeIdx > i && !isWon && !isLost;
          const dot = STAGE_DOT[s] ?? "bg-stone-400";
          const dotCls = isActive ? `${dot} ring-2 ring-white/30 scale-125` : isPast ? `${dot} opacity-50` : "bg-[var(--surface-hover)]";
          return (
            <div key={s} className="flex flex-col items-center flex-1">
              <div className="flex items-center w-full">
                {i > 0 && <div className={`h-px flex-1 ${isPast || isActive ? "bg-[var(--surface-hover)]" : "bg-[var(--surface-hover)]"}`}/>}
                <button onClick={() => onSave(s)} className="shrink-0 hover:scale-110 transition-transform">
                  <div className={`h-3 w-3 rounded-full transition-all ${dotCls}`}/>
                </button>
                {i < PIPE_STAGES.length - 1 && <div className={`h-px flex-1 ${isPast ? "bg-[var(--surface-hover)]" : "bg-[var(--surface-hover)]"}`}/>}
              </div>
              <span className={`mt-2 text-[9px] font-medium uppercase tracking-wide text-center leading-tight max-w-[50px] ${isActive ? "text-[var(--text-primary)]" : isPast ? "text-stone-600" : "text-stone-700"}`}>{s}</span>
            </div>
          );
        })}
      </div>
      {(isWon || isLost) && (
        <div className={`mt-4 rounded-md px-3 py-2 text-xs font-semibold text-center ${isWon ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-stone-500/10 text-stone-400 border border-stone-500/20"}`}>
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
    <div className="px-4 py-3 border-b border-stone-800/50">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Assigned to</p>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 w-full rounded-lg border border-stone-800/60 bg-stone-900/30 px-2.5 py-2 hover:bg-stone-800/40 transition-colors"
        >
          {current ? (
            <>
              <div className="h-6 w-6 rounded-full bg-stone-500/20 border border-stone-500/20 flex items-center justify-center text-[10px] font-bold text-stone-300 shrink-0">
                {initials(current.name)}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs text-stone-300 truncate leading-none">{current.name}</p>
                {current.role && <p className="text-[10px] text-stone-600 mt-0.5 capitalize">{current.role}</p>}
              </div>
            </>
          ) : (
            <>
              <UserCheck size={14} className="text-stone-600 shrink-0"/>
              <span className="text-xs text-stone-600 flex-1 text-left">Unassigned</span>
            </>
          )}
          <ChevronDown size={11} className={`text-stone-600 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}/>
        </button>

        {open && (
          <div className="dropdown-panel absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto">
            <button
              onClick={() => { onAssign(null); setOpen(false); }}
              className={`dropdown-item w-full ${!assignedTo ? "dropdown-item-active" : ""}`}
            >
              <UserCheck size={12} className="text-stone-600"/>
              Unassigned
              {!assignedTo && <Check size={10} className="ml-auto text-stone-400"/>}
            </button>
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => { onAssign(m.id); setOpen(false); }}
                className={`dropdown-item w-full ${assignedTo === m.id ? "dropdown-item-active" : ""}`}
              >
                <div className="h-5 w-5 rounded-full bg-stone-500/20 border border-stone-500/20 flex items-center justify-center text-[9px] font-bold text-stone-300 shrink-0">
                  {initials(m.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="truncate block text-xs">{m.name}</span>
                  {m.role && <span className="text-[10px] text-stone-600 capitalize">{m.role}</span>}
                </div>
                {assignedTo === m.id && <Check size={10} className="ml-auto text-stone-400 shrink-0"/>}
              </button>
            ))}
            {members.length === 0 && <p className="px-3 py-2 text-xs text-stone-600">No members yet</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline member picker for owner/assignee fields in Record Details ─────────
function MemberPickerField({ label, currentName, members, onSelect }: {
  label: string;
  currentName: string;
  members: Member[];
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="mb-3 relative">
      <p className="mb-1 text-[10px] text-stone-600 capitalize">{label}</p>
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-stone-800/50 bg-stone-900/20 px-2.5 py-1.5 text-xs hover:bg-stone-800/30 transition-colors">
        {currentName
          ? <><div className="h-5 w-5 rounded-full bg-stone-500/20 border border-stone-500/20 flex items-center justify-center text-[9px] font-bold text-stone-300 shrink-0">{initials(currentName)}</div><span className="text-stone-300 truncate">{currentName}</span></>
          : <><UserCheck size={12} className="text-stone-600 shrink-0"/><span className="text-stone-600">Unassigned</span></>
        }
        <ChevronDown size={10} className="ml-auto text-stone-600 shrink-0"/>
      </button>
      {open && (
        <div className="dropdown-panel absolute left-0 right-0 top-full mt-1 z-50 max-h-44 overflow-y-auto">
          <button onClick={() => { onSelect(""); setOpen(false); }} className="dropdown-item w-full">
            <UserCheck size={12} className="text-stone-600"/>Unassigned
          </button>
          {members.map(m => (
            <button key={m.id} onClick={() => { onSelect(m.name); setOpen(false); }} className="dropdown-item w-full">
              <div className="h-5 w-5 rounded-full bg-stone-500/20 border border-stone-500/20 flex items-center justify-center text-[9px] font-bold text-stone-300 shrink-0">{initials(m.name)}</div>
              <span className="truncate">{m.name}</span>
              {currentName === m.name && <Check size={10} className="ml-auto text-stone-400 shrink-0"/>}
            </button>
          ))}
          {members.length === 0 && <p className="px-3 py-2 text-xs text-stone-600">No members</p>}
        </div>
      )}
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────
function ActivityDot({ type }: { type: "create"|"update"|"system" }) {
  const cls = type === "create" ? "bg-emerald-500" : type === "update" ? "bg-amber-500" : "bg-stone-600";
  return <div className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${cls} ring-2 ring-[var(--surface-card)]`}/>;
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
              {i < events.length - 1 && <div className="w-px flex-1 bg-[var(--surface-hover)] mt-1"/>}
            </div>
            <div className="pb-5 min-w-0">
              <p className="text-sm text-stone-300">{ev.ai_summary || label}</p>
              <p className="mt-0.5 text-xs text-stone-600">{relativeTime(ev.created_at)}</p>
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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

function InvestmentHighlights({ data, onSave }: { data: Record<string,unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <HighlightCard icon={DollarSign} label="Amount"       value={data.amount ?? data.investment_amount ?? "—"}       accent="emerald" onSave={v => onSave("amount", v)} numeric/>
      <HighlightCard icon={TrendingUp} label="Round"        value={data.round ?? data.investment_round ?? "—"}         accent="blue"    onSave={v => onSave("round", v)}/>
      <HighlightCard icon={Briefcase}  label="Investor"     value={data.investor ?? data.investor_name ?? "—"}         accent="purple"  onSave={v => onSave("investor", v)}/>
      <HighlightCard icon={Calendar}   label="Date"         value={data.date ?? data.investment_date ?? "—"}           accent="slate"   onSave={v => onSave("date", v)}/>
      <HighlightCard icon={Percent}    label="IRR / Return" value={data.irr ?? data.return_rate ?? "—"}                accent="amber"   onSave={v => onSave("irr", v)}/>
      <HighlightCard icon={Building2}  label="Valuation"    value={data.valuation ?? "—"}                              accent="red"     onSave={v => onSave("valuation", v)} numeric/>
    </div>
  );
}

function ExpenseHighlights({ data, onSave }: { data: Record<string,unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <HighlightCard icon={DollarSign}  label="Amount"       value={data.amount ?? "—"}                              accent="red"     onSave={v => onSave("amount", v)} numeric/>
      <HighlightCard icon={Calendar}    label="Date"         value={data.date ?? data.expense_date ?? "—"}           accent="slate"   onSave={v => onSave("date", v)}/>
      <HighlightCard icon={Tag}         label="Category"     value={data.category ?? "—"}                            accent="blue"    onSave={v => onSave("category", v)}/>
      <HighlightCard icon={CreditCard}  label="Reimbursed"   value={data.reimbursed ? "Yes" : "Pending"}             accent="emerald"/>
      <HighlightCard icon={Users}       label="Submitted by" value={data.submitted_by ?? data.owner ?? "—"}          accent="purple"/>
      <HighlightCard icon={Building2}   label="Vendor"       value={data.vendor ?? data.merchant ?? "—"}             accent="amber"   onSave={v => onSave("vendor", v)}/>
    </div>
  );
}

function TaxHighlights({ data, onSave }: { data: Record<string,unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <HighlightCard icon={DollarSign} label="Amount"    value={data.amount ?? data.cost ?? "—"}             accent="red"     onSave={v => onSave("amount", v)} numeric/>
      <HighlightCard icon={Calendar}   label="Tax Year"  value={data.tax_year ?? data.year ?? "—"}           accent="slate"   onSave={v => onSave("tax_year", v)}/>
      <HighlightCard icon={Receipt}    label="Type"      value={data.type ?? data.entry_type ?? "—"}         accent="blue"    onSave={v => onSave("type", v)}/>
      <HighlightCard icon={Star}       label="Status"    value={data.status ?? "—"}                          accent="amber"   onSave={v => onSave("status", v)}/>
      <HighlightCard icon={Calendar}   label="Due Date"  value={data.due_date ?? "—"}                        accent="purple"  onSave={v => onSave("due_date", v)}/>
      <HighlightCard icon={Building2}  label="Entity"    value={data.entity ?? data.company ?? "—"}          accent="emerald" onSave={v => onSave("entity", v)}/>
    </div>
  );
}

function TaskHighlights({ data, onSave }: { data: Record<string,unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <HighlightCard icon={Calendar}   label="Due Date"  value={data.due_date ?? "—"}                                   accent="red"     onSave={v => onSave("due_date", v)}/>
      <HighlightCard icon={Star}       label="Priority"  value={data.priority ?? "Normal"}                              accent="amber"   onSave={v => onSave("priority", v)}/>
      <HighlightCard icon={CheckSquare} label="Status"   value={data.done ? "Done ✓" : (String(data.status ?? "Open"))} accent="emerald"/>
      <HighlightCard icon={Users}      label="Assignee"  value={data.assignee ?? data.assigned_to ?? "—"}               accent="blue"/>
      <HighlightCard icon={Building2}  label="Project"   value={data.project ?? "—"}                                    accent="purple"  onSave={v => onSave("project", v)}/>
      <HighlightCard icon={Clock}      label="Est. Time" value={data.estimated_time ?? "—"}                             accent="slate"   onSave={v => onSave("estimated_time", v)}/>
    </div>
  );
}

function VisitPaymentHighlights({ data, onSave }: { data: Record<string,unknown>; onSave: (f: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <HighlightCard icon={DollarSign} label="Amount"   value={data.amount ?? data.payment_amount ?? "—"}        accent="emerald" onSave={v => onSave("amount", v)} numeric/>
      <HighlightCard icon={Calendar}   label="Date"     value={data.date ?? data.visit_date ?? data.payment_date ?? "—"} accent="blue" onSave={v => onSave("date", v)}/>
      <HighlightCard icon={Star}       label="Status"   value={data.status ?? "—"}                               accent="amber"   onSave={v => onSave("status", v)}/>
      <HighlightCard icon={MapPin}     label="Location" value={data.location ?? "—"}                             accent="purple"  onSave={v => onSave("location", v)}/>
      <HighlightCard icon={Users}      label="Contact"  value={data.contact ?? data.customer ?? "—"}             accent="red"/>
      <HighlightCard icon={Tag}        label="Type"     value={data.type ?? data.visit_type ?? "—"}              accent="slate"   onSave={v => onSave("type", v)}/>
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
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Notes</p>
        <button
          onClick={() => createNote.mutate()}
          disabled={createNote.isPending}
          className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-stone-500 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <Plus size={10}/> New note
        </button>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-[var(--surface-hover)] animate-pulse"/>
      ) : notes.length === 0 && !createNote.isPending ? (
        <button
          onClick={() => createNote.mutate()}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-3 text-xs text-stone-600 hover:text-stone-400 hover:border-[var(--border-soft)] transition-colors"
        >
          <FileText size={13}/>
          Click to add a note…
        </button>
      ) : (
        <div className="space-y-1.5">
          {createNote.isPending && (
            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 animate-pulse">
              <div className="h-2.5 w-28 rounded bg-[var(--surface-hover)] mb-1.5"/>
              <div className="h-2 w-40 rounded bg-[var(--surface-hover)]"/>
            </div>
          )}
          {notes.slice(0, 3).map(note => (
            <div key={note.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 hover:border-[var(--border-soft)] cursor-pointer transition-colors">
              <p className="text-xs font-medium text-[var(--text-primary)]">{String(note.data.title || "Untitled note")}</p>
              <p className="text-[10px] text-stone-600 mt-0.5">
                {String(note.data.content || "This note has no content")} • {relativeTime(String(note.data.created_at || note.updated_at))}
              </p>
            </div>
          ))}
          {notes.length > 3 && (
            <p className="text-[10px] text-stone-600 text-center py-1">+{notes.length - 3} more notes</p>
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
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">
          Tasks {todo.length > 0 && <span className="ml-1 rounded-full bg-stone-500/20 text-stone-300 px-1.5 py-0.5 text-[9px] font-bold">{todo.length}</span>}
        </p>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-stone-500 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <Plus size={10}/> Add task
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-stone-500/20 bg-[var(--surface-hover)] px-2.5 py-2 mb-1.5">
          <Square size={13} className="text-stone-600 shrink-0"/>
          <input
            ref={inputRef} value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newTitle.trim()) createTask.mutate(newTitle.trim());
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
            placeholder="Task title… Enter to save"
            className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-stone-600 outline-none"
          />
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-stone-600 hover:text-stone-400"><X size={11}/></button>
        </div>
      )}

      {isLoading ? (
        <div className="h-10 rounded-lg bg-[var(--surface-hover)] animate-pulse"/>
      ) : tasks.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-3 text-xs text-stone-600 hover:text-stone-400 hover:border-[var(--border-soft)] transition-colors"
        >
          <CheckSquare size={13}/>
          Click to add a task…
        </button>
      ) : (
        <div className="space-y-0.5">
          {[...todo, ...done].slice(0, 5).map(task => {
            const isDone = Boolean(task.data.done);
            return (
              <div key={task.id} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-[var(--surface-hover)] transition-colors">
                <button onClick={() => toggleTask.mutate({ id: task.id, data: { ...task.data, done: !isDone } })} className="shrink-0">
                  {isDone
                    ? <CheckSquare size={13} className="text-emerald-400"/>
                    : <Square size={13} className="text-stone-600 hover:text-stone-400 transition-colors"/>}
                </button>
                <span className={`flex-1 text-xs ${isDone ? "line-through text-stone-600" : "text-stone-300"}`}>{String(task.data.title || "Untitled")}</span>
              </div>
            );
          })}
          {tasks.length > 5 && <p className="text-[10px] text-stone-600 text-center py-1">+{tasks.length - 5} more</p>}
        </div>
      )}
    </div>
  );
}

// ─── Note card (editable) ─────────────────────────────────────────────────────
function NoteCard({ note, onUpdate, onDelete }: {
  note: NoteRecord;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle]     = useState(String(note.data.title || ""));
  const [content, setContent] = useState(String(note.data.content || ""));
  const [hovered, setHovered] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTitle(String(note.data.title || "")); }, [note.data.title]);
  useEffect(() => { setContent(String(note.data.content || "")); }, [note.data.content]);

  function autoGrow() {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }
  useEffect(() => { autoGrow(); }, [content]);

  function saveTitle() { onUpdate(note.id, { ...note.data, title }); }
  function saveContent() { onUpdate(note.id, { ...note.data, content }); }

  return (
    <div
      className="group rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 hover:border-[var(--border-soft)] transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            placeholder="Note title…"
            className="w-full bg-transparent text-sm font-semibold text-[var(--text-primary)] placeholder-stone-700 outline-none border-b border-transparent focus:border-[var(--border-soft)] pb-1 mb-2 transition-colors"
          />
          <textarea
            ref={taRef}
            value={content}
            onChange={e => { setContent(e.target.value); autoGrow(); }}
            onBlur={saveContent}
            placeholder="Write something…"
            rows={2}
            className="w-full resize-none bg-transparent text-xs text-stone-400 placeholder-stone-700 outline-none leading-relaxed overflow-hidden"
          />
        </div>
        <button
          onClick={() => onDelete(note.id)}
          className={`shrink-0 rounded-md p-1.5 text-stone-700 hover:text-stone-400 hover:bg-stone-400/10 transition-all ${hovered ? "opacity-100" : "opacity-0"}`}
        >
          <Trash2 size={12}/>
        </button>
      </div>
      <p className="mt-2 text-[10px] text-stone-700">{relativeTime(String(note.data.created_at || note.updated_at))}</p>
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
      data: { parent_id: recordId, title: "", content: "", created_at: new Date().toISOString() },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", recordId] }),
  });
  const updateNote = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.patch(`/nodes/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", recordId] }),
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", recordId] }),
  });

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Notes</p>
        <button onClick={() => createNote.mutate()} disabled={createNote.isPending} className="flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50">
          <Plus size={12}/> New note
        </button>
      </div>
      {createNote.isPending && <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 animate-pulse"><div className="h-3 w-32 rounded bg-[var(--surface-hover)] mb-2"/><div className="h-2 w-48 rounded bg-[var(--surface-hover)]"/></div>}
      {notes.length === 0 && !isLoading && !createNote.isPending ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
          <FileText size={18} className="mb-2 text-stone-700"/>
          <p className="text-xs text-stone-600">No notes yet. Click "New note" to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={(id, data) => updateNote.mutate({ id, data })}
              onDelete={id => deleteNote.mutate(id)}
            />
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef  = useRef<HTMLInputElement>(null);

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
  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`/nodes/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", recordId] }),
  });
  const deleteTask = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", recordId] }),
  });

  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 30); }, [adding]);
  useEffect(() => { if (editingId) setTimeout(() => editRef.current?.focus(), 20); }, [editingId]);

  function startEdit(task: TaskRecord) {
    setEditingId(task.id);
    setEditTitle(String(task.data.title || ""));
  }
  function commitEdit(task: TaskRecord) {
    if (editTitle.trim() && editTitle.trim() !== String(task.data.title || "")) {
      updateTask.mutate({ id: task.id, data: { ...task.data, title: editTitle.trim() } });
    }
    setEditingId(null);
  }

  const sorted = [...tasks.filter(t => !t.data.done), ...tasks.filter(t => t.data.done)];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Tasks</p>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors">
          <Plus size={12}/> Add task
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2.5 rounded-lg border border-stone-500/20 bg-[var(--surface-hover)] px-3 py-2.5">
          <Square size={14} className="text-stone-600 shrink-0"/>
          <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) createTask.mutate(newTitle.trim()); if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
            placeholder="Task title… (Enter to save)" className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-stone-600 outline-none"/>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="text-stone-600 hover:text-stone-400"><X size={12}/></button>
        </div>
      )}
      {tasks.length === 0 && !adding ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
          <CheckSquare size={18} className="mb-2 text-stone-700"/>
          <p className="text-xs text-stone-600">No tasks yet. Click "Add task" to get started.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sorted.map(task => {
            const isDone = Boolean(task.data.done);
            const isEditing = editingId === task.id;
            return (
              <div key={task.id} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[var(--surface-hover)] transition-colors">
                <button onClick={() => updateTask.mutate({ id: task.id, data: { ...task.data, done: !isDone } })} className="shrink-0">
                  {isDone ? <CheckSquare size={15} className="text-emerald-400"/> : <Square size={15} className="text-stone-600 hover:text-stone-400 transition-colors"/>}
                </button>
                {isEditing ? (
                  <input
                    ref={editRef}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => commitEdit(task)}
                    onKeyDown={e => { if (e.key === "Enter") commitEdit(task); if (e.key === "Escape") setEditingId(null); }}
                    className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none border-b border-[var(--border-soft)]"
                  />
                ) : (
                  <span
                    onClick={() => !isDone && startEdit(task)}
                    className={`flex-1 text-sm cursor-text ${isDone ? "line-through text-stone-600" : "text-stone-300 hover:text-[var(--text-primary)]"}`}
                  >
                    {String(task.data.title || "Untitled task")}
                  </span>
                )}
                {task.data.assignee != null && !isEditing && (
                  <span className="text-[10px] text-stone-600 shrink-0 rounded bg-[var(--surface-hover)] px-1.5 py-0.5">{String(task.data.assignee)}</span>
                )}
                <button
                  onClick={() => deleteTask.mutate(task.id)}
                  className="shrink-0 rounded p-1 text-stone-700 hover:text-stone-400 hover:bg-stone-400/10 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={11}/>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Description field (C) ───────────────────────────────────────────────────
function DescriptionField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  function autoGrow() {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(72, el.scrollHeight) + "px";
  }
  useEffect(() => { autoGrow(); }, [draft]);
  return (
    <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <AlignLeft size={11} className="text-stone-600"/>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Description</p>
      </div>
      <textarea
        ref={taRef}
        value={draft}
        onChange={e => { setDraft(e.target.value); autoGrow(); }}
        onBlur={() => { if (draft !== value) onSave(draft); }}
        placeholder="Add a description…"
        className="w-full resize-none bg-transparent text-sm text-stone-300 placeholder-stone-700 outline-none leading-relaxed overflow-hidden"
        rows={3}
      />
    </div>
  );
}

// ─── Contact log tab (H) ─────────────────────────────────────────────────────
const CONTACT_LOG_TYPES = [
  { value: "call",    label: "Call",    icon: PhoneCall,     color: "text-emerald-400", bg: "bg-emerald-400/10" },
  { value: "email",   label: "Email",   icon: Mail,          color: "text-blue-400",    bg: "bg-blue-400/10" },
  { value: "meeting", label: "Meeting", icon: Video,         color: "text-stone-400",  bg: "bg-stone-400/10" },
  { value: "message", label: "Message", icon: MessageSquare, color: "text-amber-400",   bg: "bg-amber-400/10" },
] as const;

const CONTACT_OUTCOMES = ["Positive", "Neutral", "No answer", "Follow-up needed", "Closed"];

interface ContactLogRecord { id: string; data: Record<string, unknown>; updated_at: string }

function ContactLogTab({ recordId, vertical }: { recordId: string; vertical: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [logType, setLogType] = useState<string>("call");
  const [outcome, setOutcome] = useState(CONTACT_OUTCOMES[0]!);
  const [notes, setNotes]   = useState("");
  const [date, setDate]     = useState(() => new Date().toISOString().slice(0, 16));

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["contact-log", recordId],
    queryFn: async () => {
      const all = await apiClient.get<ContactLogRecord[]>("/nodes?object_type=contact_log&limit=200");
      return all.filter(n => n.data.parent_id === recordId)
        .sort((a, b) => new Date(b.data.logged_at as string || b.updated_at).getTime()
                      - new Date(a.data.logged_at as string || a.updated_at).getTime());
    },
  });

  const createLog = useMutation({
    mutationFn: () => apiClient.post("/nodes", {
      vertical: vertical || "shared",
      object_type: "contact_log",
      data: { parent_id: recordId, type: logType, outcome, notes, logged_at: date ? new Date(date).toISOString() : new Date().toISOString() },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-log", recordId] });
      setAdding(false); setNotes(""); setOutcome(CONTACT_OUTCOMES[0]!);
      setDate(new Date().toISOString().slice(0, 16));
    },
  });

  const deleteLog = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-log", recordId] }),
  });

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Contact Log</p>
        <button onClick={() => setAdding(o => !o)} className="flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors">
          <Plus size={12}/> Log contact
        </button>
      </div>

      {adding && (
        <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
          {/* Type picker */}
          <div className="flex gap-2">
            {CONTACT_LOG_TYPES.map(t => {
              const Icon = t.icon;
              const active = logType === t.value;
              return (
                <button key={t.value} onClick={() => setLogType(t.value)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors border ${active ? `${t.bg} ${t.color} border-current/20` : "border-[var(--border-soft)] text-stone-500 hover:text-stone-300 hover:bg-[var(--surface-hover)]"}`}>
                  <Icon size={12}/> {t.label}
                </button>
              );
            })}
          </div>
          {/* Date + outcome row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-stone-600 mb-1">Date & time</p>
              <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-soft)]"/>
            </div>
            <div>
              <p className="text-[10px] text-stone-600 mb-1">Outcome</p>
              <select value={outcome} onChange={e => setOutcome(e.target.value)}
                className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-soft)]">
                {CONTACT_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          {/* Notes */}
          <div>
            <p className="text-[10px] text-stone-600 mb-1">Notes</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="What was discussed?"
              className="w-full resize-none bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-lg px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-[var(--border-soft)] leading-relaxed"/>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">Cancel</button>
            <button onClick={() => createLog.mutate()} disabled={createLog.isPending}
              className="rounded-lg bg-stone-500/20 border border-stone-500/30 px-4 py-1.5 text-xs text-stone-300 hover:bg-stone-500/30 transition-colors disabled:opacity-50">
              {createLog.isPending ? "Saving…" : "Save log"}
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 rounded-sm bg-[var(--surface-hover)] animate-pulse"/>)}</div>}
      {!isLoading && logs.length === 0 && !adding && (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
          <PhoneCall size={18} className="mb-2 text-stone-700"/>
          <p className="text-xs text-stone-600">No contact logs yet.</p>
          <p className="mt-1 text-xs text-stone-700">Click "Log contact" to record a call, email, or meeting.</p>
        </div>
      )}
      <div className="space-y-2">
        {logs.map(log => {
          const typeDef = CONTACT_LOG_TYPES.find(t => t.value === log.data.type) ?? CONTACT_LOG_TYPES[0]!;
          const Icon = typeDef.icon;
          const loggedAt = log.data.logged_at ? relativeTime(String(log.data.logged_at)) : relativeTime(log.updated_at);
          return (
            <div key={log.id} className="group flex items-start gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-3.5 hover:border-[var(--border-soft)] transition-colors">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${typeDef.bg}`}>
                <Icon size={14} className={typeDef.color}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-medium ${typeDef.color}`}>{typeDef.label}</span>
                  <span className="text-[10px] text-stone-600">·</span>
                  <span className="text-[10px] text-stone-500">{String(log.data.outcome || "")}</span>
                  <span className="text-[10px] text-stone-700 ml-auto">{loggedAt}</span>
                </div>
                {!!log.data.notes && (
                  <p className="text-xs text-stone-400 leading-relaxed">{String(log.data.notes)}</p>
                )}
              </div>
              <button onClick={() => deleteLog.mutate(log.id)}
                className="shrink-0 rounded p-1 text-stone-700 hover:text-stone-400 hover:bg-stone-400/10 opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 size={11}/>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Finance tab ──────────────────────────────────────────────────────────────
interface InvoiceRecord { id: string; number: string; client_name: string; total: number; status: string; due_date?: string; currency: string }
interface CreditNoteRecord { id: string; amount_cents: number; currency: string; credit_reason: string; status: string }

const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft:     "text-stone-400 bg-stone-400/10",
  sent:      "text-blue-400 bg-blue-400/10",
  viewed:    "text-stone-400 bg-stone-400/10",
  paid:      "text-emerald-400 bg-emerald-400/10",
  overdue:   "text-stone-400 bg-stone-400/10",
  cancelled: "text-stone-600 bg-stone-600/10",
};
const CN_STATUS_COLORS: Record<string, string> = {
  draft:            "text-stone-400 bg-stone-400/10",
  pending_review:   "text-amber-400 bg-amber-400/10",
  manager_approved: "text-blue-400 bg-blue-400/10",
  executed:         "text-emerald-400 bg-emerald-400/10",
  void:             "text-stone-600 bg-stone-600/10",
};

function fmtCcy(amount: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function FinanceTab({ recordId, recordName, vertical }: { recordId: string; recordName: string; vertical: string }) {
  const qc = useQueryClient();
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [newInvAmount, setNewInvAmount] = useState("");
  const [newInvCurrency, setNewInvCurrency] = useState("GBP");
  const [newInvDueDate, setNewInvDueDate] = useState("");

  const { data: invoices = [], isLoading: invLoading } = useQuery<InvoiceRecord[]>({
    queryKey: ["record-invoices", recordId],
    queryFn: () => apiClient.get<InvoiceRecord[]>(`/invoices?linked_record_id=${recordId}`),
  });

  const { data: creditNotes = [], isLoading: cnLoading } = useQuery<CreditNoteRecord[]>({
    queryKey: ["record-credit-notes", recordId],
    queryFn: () => apiClient.get<CreditNoteRecord[]>(`/credit-notes?linked_record_id=${recordId}`),
  });

  const totalBilled = invoices.reduce((s, inv) => s + (inv.total ?? 0), 0);
  const creditsApplied = creditNotes
    .filter(cn => cn.status === "executed")
    .reduce((s, cn) => s + (cn.amount_cents ?? 0) / 100, 0);
  const netOwed = totalBilled - creditsApplied;
  const defaultCurrency = invoices[0]?.currency ?? "GBP";

  const createInvoice = useMutation({
    mutationFn: () => apiClient.post<InvoiceRecord>("/invoices", {
      client_name: recordName,
      line_items: [{ description: "Service", quantity: 1, unit_price: parseFloat(newInvAmount) || 0, tax_rate: 0 }],
      currency: newInvCurrency,
      due_date: newInvDueDate ? new Date(newInvDueDate).toISOString() : undefined,
      status: "draft",
      linked_record_id: recordId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-invoices", recordId] });
      setShowNewInvoice(false);
      setNewInvAmount("");
      setNewInvDueDate("");
    },
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Billed", value: fmtCcy(totalBilled, defaultCurrency), accent: "text-[var(--text-primary)]" },
          { label: "Credits Applied", value: fmtCcy(creditsApplied, defaultCurrency), accent: "text-stone-400" },
          { label: "Net Owed", value: fmtCcy(netOwed, defaultCurrency), accent: netOwed > 0 ? "text-stone-400" : "text-emerald-400" },
        ].map(card => (
          <div key={card.label} className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-1.5">{card.label}</p>
            <p className={`text-lg font-bold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Invoices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">Invoices</p>
          <button
            onClick={() => setShowNewInvoice(o => !o)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <Plus size={12}/> New Invoice
          </button>
        </div>

        {showNewInvoice && (
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 mb-3 space-y-3">
            <p className="text-xs font-medium text-[var(--text-primary)]">New Invoice for {recordName}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-stone-600 mb-1 block">Amount</label>
                <input
                  type="number"
                  value={newInvAmount}
                  onChange={e => setNewInvAmount(e.target.value)}
                  placeholder="0.00"
                  className="key-input w-full text-[12px]"
                />
              </div>
              <div>
                <label className="text-[10px] text-stone-600 mb-1 block">Currency</label>
                <select value={newInvCurrency} onChange={e => setNewInvCurrency(e.target.value)} className="key-input w-full text-[12px]">
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-stone-600 mb-1 block">Due date</label>
                <input
                  type="date"
                  value={newInvDueDate}
                  onChange={e => setNewInvDueDate(e.target.value)}
                  className="key-input w-full text-[12px]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewInvoice(false)} className="rounded-lg px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">Cancel</button>
              <button
                onClick={() => createInvoice.mutate()}
                disabled={createInvoice.isPending || !newInvAmount}
                className="rounded-lg bg-stone-500/20 border border-stone-500/30 px-4 py-1.5 text-xs text-stone-300 hover:bg-stone-500/30 transition-colors disabled:opacity-50"
              >
                {createInvoice.isPending ? "Creating…" : "Create Invoice"}
              </button>
            </div>
          </div>
        )}

        {invLoading ? (
          <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-10 rounded-lg bg-[var(--surface-hover)] animate-pulse"/>)}</div>
        ) : invoices.length === 0 ? (
          <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
            <Receipt size={16} className="mb-1.5 text-stone-700"/>
            <p className="text-xs text-stone-600">No invoices yet for this record.</p>
          </div>
        ) : (
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-soft)]">
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-stone-600">Number</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-stone-600">Amount</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-stone-600">Status</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-stone-600">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/finance/invoices/${inv.id}`} className="text-[12px] text-blue-400 hover:text-blue-300 transition-colors">{inv.number}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--text-primary)]">{fmtCcy(inv.total, inv.currency)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${INVOICE_STATUS_COLORS[inv.status] ?? "text-stone-400 bg-stone-400/10"}`}>
                        {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-stone-500">
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credit Notes */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600 mb-3">Credit Notes</p>
        {cnLoading ? (
          <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-10 rounded-lg bg-[var(--surface-hover)] animate-pulse"/>)}</div>
        ) : creditNotes.length === 0 ? (
          <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
            <CreditCard size={16} className="mb-1.5 text-stone-700"/>
            <p className="text-xs text-stone-600">No credit notes for this record.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {creditNotes.map(cn => (
              <Link key={cn.id} to={`/finance/credit-notes/${cn.id}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-2.5 hover:border-[var(--border-soft)] transition-colors">
                <CreditCard size={13} className="text-stone-400 shrink-0"/>
                <span className="flex-1 text-[12px] text-[var(--text-primary)]">{fmtCcy(cn.amount_cents / 100, cn.currency)}</span>
                <span className="text-[11px] text-stone-500 capitalize">{cn.credit_reason.replace(/_/g, " ")}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CN_STATUS_COLORS[cn.status] ?? "text-stone-400 bg-stone-400/10"}`}>
                  {cn.status.replace(/_/g, " ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
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
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600">{tabLabel}</p>
        <div ref={searchRef} className="relative">
          <button onClick={() => setSearchOpen(o => !o)} className="flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors">
            <Link2 size={12}/> Link record
          </button>
          {searchOpen && (
            <div className="dropdown-panel absolute right-0 top-full mt-1 w-72 z-50 p-2">
              <div className="flex items-center gap-2 border border-[var(--border-soft)] rounded-md px-2 py-1.5 mb-2 bg-[var(--surface-hover)]">
                <Search size={12} className="text-stone-600 shrink-0"/>
                <input ref={searchInput} value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search records…" className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-stone-600 outline-none"/>
              </div>
              {allLoading ? <p className="text-xs text-stone-600 px-2 py-2">Loading…</p> : searchResults.length === 0 ? (
                <p className="text-xs text-stone-600 px-2 py-2">{searchText ? "No matches" : "No records to link"}</p>
              ) : searchResults.map(r => (
                <button key={r.id} onClick={() => linkRecord.mutate(r.id)} disabled={linkRecord.isPending}
                  className="flex items-center gap-2.5 w-full rounded-md px-2 py-2 hover:bg-[var(--surface-hover)] transition-colors group">
                  <div className={`h-6 w-6 rounded-lg border bg-gradient-to-br flex items-center justify-center text-[9px] font-bold shrink-0 ${avatarColor(rname(r))}`}>{initials(rname(r))}</div>
                  <div className="min-w-0 text-left"><p className="text-xs text-stone-300 truncate">{rname(r)}</p><p className="text-[10px] text-stone-600 capitalize">{r.object_type}</p></div>
                  <Link2 size={11} className="text-stone-700 group-hover:text-stone-400 ml-auto shrink-0 transition-colors"/>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {relLoading ? <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 rounded-lg bg-[var(--surface-hover)] animate-pulse"/>)}</div>
       : related.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
          <Link2 size={18} className="mb-2 text-stone-700"/>
          <p className="text-xs text-stone-600">No linked records yet.</p>
          <p className="mt-1 text-xs text-stone-700">Click "Link record" to associate companies, people, or deals.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {related.map(r => {
            const n = rname(r);
            return (
              <Link key={r.id} to={`/objects/${r.object_type}/${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] p-3 hover:border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors group">
                <div className={`h-8 w-8 rounded-lg border bg-gradient-to-br flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(n)}`}>{initials(n)}</div>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--text-primary)] truncate">{n}</p><p className="text-xs text-stone-600 capitalize">{r.object_type}</p></div>
                <ChevronLeft size={13} className="text-stone-700 group-hover:text-stone-400 rotate-180 transition-colors shrink-0"/>
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
  const [tab, setTab]           = useState<string>("Overview");
  const [listOpen, setListOpen] = useState(false);
  const [tagOpen, setTagOpen]   = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [addedListIds, setAddedListIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Real lists from API
  const listsQuery = useQuery({
    queryKey: ["lists"],
    queryFn: () => apiClient.get<{ id: string; name: string }[]>("/lists"),
    enabled: listOpen,
  });
  const addToList = useMutation({
    mutationFn: (listId: string) => apiClient.post(`/lists/${listId}/entries`, { node_id: recordId }),
    onSuccess: (_, listId) => setAddedListIds(s => new Set([...s, listId])),
  });

  // Members for owner/assignee fields in Record Details
  const { data: members = [] } = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => apiClient.get<RecordData>(`/nodes/${recordId}`),
  });

  // While this record is open, the right-side Ask AI drawer should know
  // which node is in scope — same mechanism task-detail-panel.tsx uses.
  useEffect(() => {
    const name = (query.data?.data?.name ?? query.data?.data?.title ?? query.data?.data?.subject) as string | undefined;
    if (!query.data) return;
    useAskContextStore.getState().setContext({
      node_id: recordId,
      node_name: name,
      object_type: objectType,
      route: `/objects/${objectType}/${recordId}`,
      scope_label: `the record "${name ?? recordId}" (${objectType})`,
    });
    return () => useAskContextStore.getState().setContext(null);
  }, [recordId, objectType, query.data]);

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
  const type          = objectType.toLowerCase();
  const isCompany     = type === "companies"  || type.includes("compan");
  const isPeople      = type === "people"     || type.includes("person")  || type.includes("contact");
  const isDeals       = type === "deals"      || type.includes("deal");
  const isInvestment  = type.includes("invest");
  const isExpense     = type.includes("expense");
  const isTax         = type.includes("tax")  || type.includes("cost entr");
  const isTaskType    = type === "tasks"      || (type.includes("task") && !type.includes("tasks"));
  const isVisitPayment= type.includes("visit") || type.includes("payment");
  const tabs          = getTabsForType(objectType);

  const email      = String(data.email ?? "");
  const logoUrl    = data.logo_url ? String(data.logo_url) : undefined;
  const assignedTo = data.assigned_to ? String(data.assigned_to) : null;
  const categories: Category[] = Array.isArray(data.categories) ? (data.categories as Category[]) : [];
  const leftFields = Object.entries(data).filter(([k]) =>
    !["name","categories","assigned_to","logo_url","description"].includes(k)
  );

  // Custom column definitions from localStorage (same key the table uses)
  const customCols: { key: string; type: string }[] = (() => {
    try { return JSON.parse(localStorage.getItem(`mondaily_custom_cols_${objectType}`) ?? "[]"); } catch { return []; }
  })();

  function isStageKey(key: string) {
    const l = key.toLowerCase();
    return l.includes("stage") || l === "deal_status";
  }
  function isStatusKey(key: string) {
    return key === "status";
  }
  function isOwnerKey(key: string) {
    const l = key.toLowerCase();
    return l.includes("owner") || l.includes("assign");
  }
  const companyTabLabel = isCompany ? "People" : isPeople ? "Company" : "Related";

  // Last contacted — most recent human activity
  const lastContact = (record?.activities ?? [])
    .filter(a => a.actor_type === "human")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const lastContactLabel = lastContact ? relativeTime(lastContact.created_at) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-stone-800/50 px-6 py-3 shrink-0">
        <Link to={`/objects/${objectType}`} className="flex items-center gap-1 text-xs text-stone-500 hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft size={13}/>{objectType}
        </Link>
        <span className="text-xs text-stone-700">/</span>
        <span className="text-xs text-stone-400 truncate">{name}</span>
        {patch.isPending && <span className="ml-auto text-xs text-stone-600 animate-pulse">Saving…</span>}
      </div>

      {autoMsg && (
        <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/[.06] px-6 py-2 text-xs text-emerald-400 shrink-0">
          <LogoMark size={12} className="shrink-0"/>{autoMsg}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel ── */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-stone-800/50 overflow-y-auto">

          {/* ── Header block ── */}
          <div className="px-4 pt-5 pb-4 border-b border-stone-800/50 space-y-3">

            {/* Avatar + name */}
            <div className="flex items-center gap-3">
              <AvatarSection name={name} logoUrl={logoUrl} onSave={saveLogo} wrapClass="shrink-0"/>
              <div className="flex-1 min-w-0">
                <h1 className="text-[13px] font-bold text-[var(--text-primary)] tracking-wide leading-snug uppercase truncate">{name}</h1>
                <p className="text-[11px] text-stone-500 truncate mt-0.5">
                  {fmt((data.domain ?? data.website ?? "") as string) !== "—"
                    ? fmt((data.domain ?? data.website ?? "") as string)
                    : record.object_type}
                </p>
                {lastContactLabel && (
                  <p className="text-[10px] text-stone-600 mt-1 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"/>
                    {lastContactLabel}
                  </p>
                )}
              </div>
            </div>

            {/* Lead score */}
            {(record as unknown as Record<string,unknown>).lead_score != null && (
              <LeadScoreBadge score={(record as unknown as Record<string,unknown>).lead_score as number} size="md" signals={(record as unknown as Record<string,unknown>).lead_score_signals as Record<string, unknown> | null}/>
            )}

            {/* AI Intelligence layer — real fields written by relationship-health.ts
                and the enrichment job, with honest empty states when they
                haven't run for this record yet. */}
            <div className="space-y-2">
              <AIAgentOwnerChip objectType={record.object_type}/>
              <AIInsightBadge summary={record.ai_summary}/>
              <AIHealthScore
                score={(record as unknown as Record<string, unknown>).relationship_health as number | undefined ?? null}
                label="Relationship health"
                updatedAt={(record as unknown as Record<string, unknown>).health_updated_at as string | undefined}
              />
              <AISignalList signals={(record as unknown as Record<string, unknown>).health_signals as Record<string, number> | undefined}/>
            </div>

            {/* Action row: Email + Add to list */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={email ? `mailto:${email}` : undefined}
                onClick={e => { if (!email) e.preventDefault(); }}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${email ? "border-[var(--border-soft)] bg-[var(--surface-hover)] text-stone-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-stone-700 cursor-not-allowed"}`}
              >
                <Mail size={12}/> Email
              </a>
              <div ref={listRef} className="relative">
                <button
                  onClick={() => setListOpen(o => !o)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2 text-xs font-medium text-stone-400 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <List size={12}/> Lists
                  <ChevronDown size={10} className={`ml-auto transition-transform ${listOpen ? "rotate-180" : ""}`}/>
                </button>
                {listOpen && (
                  <div className="dropdown-panel absolute left-0 right-0 top-full mt-1 z-50">
                    {listsQuery.isLoading && <p className="px-3 py-3 text-xs text-stone-600 text-center">Loading…</p>}
                    {!listsQuery.isLoading && (listsQuery.data ?? []).length === 0 && (
                      <p className="px-3 py-3 text-xs text-stone-600 text-center">No lists yet</p>
                    )}
                    <div className="max-h-48 overflow-y-auto">
                      {(listsQuery.data ?? []).map(list => {
                        const added = addedListIds.has(list.id);
                        return (
                          <button key={list.id}
                            onClick={() => { if (!added) addToList.mutate(list.id); }}
                            className={`dropdown-item w-full flex items-center gap-2 ${added ? "text-emerald-400 cursor-default" : ""}`}>
                            <List size={11} className="shrink-0 opacity-50"/>
                            <span className="flex-1 text-left">{list.name}</span>
                            {added && <Check size={11} className="text-emerald-400 shrink-0"/>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Assignee — single inline row */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Assigned to</p>
              <MemberPickerField
                label=""
                currentName={(() => {
                  const m = members.find(m => m.id === assignedTo || m.name === assignedTo);
                  return m?.name ?? assignedTo ?? "";
                })()}
                members={members}
                onSelect={name => {
                  const m = members.find(m => m.name === name);
                  assignMember(m?.id ?? name ?? null);
                }}
              />
            </div>

            {/* Tags — inline chips, click opens picker */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Tags</p>
              <TagBadges nodeId={recordId} onOpenPicker={() => setTagOpen(true)}/>
            </div>

            {/* Categories — only relevant for Company / People */}
            {(isCompany || isPeople) && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Industry</p>
                <CategoryPills categories={categories} onUpdate={saveCategories}/>
              </div>
            )}
          </div>

          {/* ── Record Details ── */}
          <div className="flex-1 overflow-auto px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-stone-700">Record Details</p>
            {leftFields.map(([key, val]) => {
              const customDef = customCols.find(c => c.key === key);
              const customType = customDef?.type;

              if (customType === "stage" || customType === "status") {
                const defaults = customType === "stage" ? DEFAULT_STAGE_OPTIONS : DEFAULT_STATUS_OPTIONS;
                const shown = String(val ?? "");
                return (
                  <div key={key} className="mb-3">
                    <p className="mb-1 text-[10px] text-stone-600 capitalize">{key.replace(/_/g, " ")}</p>
                    {shown
                      ? <StagePill value={shown} options={defaults} onSelect={v => save(key, v)}/>
                      : <button onClick={() => save(key, defaults[0]!)} className="text-[11px] text-stone-600 hover:text-stone-400 transition-colors">— set {customType}</button>
                    }
                  </div>
                );
              }
              if (isStageKey(key)) {
                const shown = String(val ?? "");
                return (
                  <div key={key} className="mb-3">
                    <p className="mb-1 text-[10px] text-stone-600 capitalize">{key.replace(/_/g, " ")}</p>
                    {shown
                      ? <StagePill value={shown} options={DEFAULT_STAGE_OPTIONS} onSelect={v => save(key, v)}/>
                      : <button onClick={() => save(key, DEFAULT_STAGE_OPTIONS[0]!)} className="text-[11px] text-stone-600 hover:text-stone-400 transition-colors">— set stage</button>
                    }
                  </div>
                );
              }
              if (isStatusKey(key)) {
                const shown = String(val ?? "");
                return (
                  <div key={key} className="mb-3">
                    <p className="mb-1 text-[10px] text-stone-600 capitalize">{key.replace(/_/g, " ")}</p>
                    {shown
                      ? <StagePill value={shown} options={DEFAULT_STATUS_OPTIONS} onSelect={v => save(key, v)}/>
                      : <button onClick={() => save(key, DEFAULT_STATUS_OPTIONS[0]!)} className="text-[11px] text-stone-600 hover:text-stone-400 transition-colors">— set status</button>
                    }
                  </div>
                );
              }
              if (isOwnerKey(key) || customType === "owner" || customType === "assignee") {
                const currentVal = String(val ?? "");
                const matched = members.find(m => m.id === currentVal || m.name === currentVal);
                return (
                  <MemberPickerField key={key} label={key.replace(/_/g, " ")}
                    currentName={matched?.name ?? currentVal}
                    members={members}
                    onSelect={v => save(key, v)}/>
                );
              }
              return <InlineField key={key} label={key.replace(/_/g, " ")} value={val} numeric={typeof val === "number"} onSave={v => save(key, v)}/>;
            })}
            {leftFields.length === 0 && <p className="text-xs text-stone-600 py-2">No attributes yet</p>}
          </div>
        </aside>

        {/* ── Right panel ── */}
        <main className="flex flex-1 min-w-0 flex-col overflow-hidden">
          <div className="flex border-b border-stone-800/50 shrink-0 overflow-x-auto">
            {tabs.map(t => {
              const label = t === "Company" ? companyTabLabel : t;
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3.5 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap shrink-0 ${tab === t ? "text-[var(--text-primary)]" : "text-stone-500 hover:text-stone-300"}`}>
                  {label}
                  {tab === t && <span className="absolute bottom-0 left-0 right-0 h-px bg-stone-500"/>}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-auto p-6">

            {tab === "Overview" && (
              <div className="space-y-7 max-w-3xl">
                {/* Description — full-width editable */}
                {(data.description != null && data.description !== "") && (
                  <DescriptionField value={String(data.description)} onSave={v => save("description", v)}/>
                )}
                {/* Type-specific highlights */}
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-600">Highlights</p>
                  {isCompany     && <CompanyHighlights      data={data} onSave={save}/>}
                  {isPeople      && <PeopleHighlights       data={data} onSave={save}/>}
                  {isDeals       && <DealHighlights         data={data} onSave={save}/>}
                  {isInvestment  && <InvestmentHighlights   data={data} onSave={save}/>}
                  {isExpense     && <ExpenseHighlights      data={data} onSave={save}/>}
                  {isTax         && <TaxHighlights          data={data} onSave={save}/>}
                  {isTaskType    && <TaskHighlights         data={data} onSave={save}/>}
                  {isVisitPayment && <VisitPaymentHighlights data={data} onSave={save}/>}
                  {!isCompany && !isPeople && !isDeals && !isInvestment && !isExpense && !isTax && !isTaskType && !isVisitPayment && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <HighlightCard icon={Clock}  label="Updated"    value={new Date(record.updated_at).toLocaleDateString()} accent="slate"/>
                      <HighlightCard icon={Star}   label="Object"     value={record.object_type} accent="blue"/>
                      <HighlightCard icon={Users}  label="Vertical"   value={record.vertical}    accent="purple"/>
                    </div>
                  )}
                </div>

                {/* Notes + Tasks side-by-side */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 p-4">
                    <InlineNotesPanel recordId={recordId} vertical={record.vertical}/>
                  </div>
                  <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 p-4">
                    <InlineTasksPanel recordId={recordId} vertical={record.vertical}/>
                  </div>
                </div>

                {/* Activity feed */}
                <div>
                  <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-stone-600">Activity</p>
                  <ActivityFeed activities={record.activities} createdAt={record.updated_at}/>
                </div>
              </div>
            )}

            {tab === "Notes"       && <NotesTab       recordId={recordId} vertical={record.vertical}/>}
            {tab === "Tasks"       && <TasksTab       recordId={recordId} vertical={record.vertical}/>}
            {tab === "Contact Log" && <ContactLogTab  recordId={recordId} vertical={record.vertical}/>}
            {tab === "Finance"     && <FinanceTab     recordId={recordId} recordName={name} vertical={record.vertical}/>}
            {tab === "Files"   && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
                <FileText size={20} className="mb-2 text-stone-700"/>
                <p className="text-sm font-medium text-stone-400">Files</p>
                <p className="mt-1 text-xs text-stone-600">No files attached to this record yet.</p>
              </div>
            )}
            {tab === "Emails"  && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] text-center">
                <Mail size={20} className="mb-2 text-stone-700"/>
                <p className="text-sm font-medium text-stone-400">Emails</p>
                <p className="mt-1 text-xs text-stone-600">No emails linked yet.</p>
              </div>
            )}
            {/* Related / Company / People / Deals / Contact tabs all use RelatedTab */}
            {(tab === "Company" || tab === "People" || tab === "Deals" || tab === "Contact") && (
              <RelatedTab recordId={recordId} tabLabel={
                tab === "Company" ? companyTabLabel :
                tab === "People"  ? "People"  :
                tab === "Deals"   ? "Deals"   :
                "Contact"
              }/>
            )}
          </div>
        </main>
      </div>

      {tagOpen && <TagPicker nodeId={recordId} onClose={() => setTagOpen(false)} />}
      {timelineOpen && <ActivityTimeline nodeId={recordId} onClose={() => setTimelineOpen(false)} />}
    </div>
  );
}

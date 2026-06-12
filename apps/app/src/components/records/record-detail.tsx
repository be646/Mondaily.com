import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, Check, Building2, Users,
  Wifi, Calendar, DollarSign, Users2, Mail, Phone, Tag,
  Clock, Plus, ChevronDown, Sparkles,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { detectStageFromActivity } from "../../lib/ai-enrichment";
import { PageSkeleton, ErrorState } from "../ui/page-state";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Activity { id: string; action: string; diff?: Record<string, unknown> | null; ai_summary?: string | null; created_at: string; actor_type: string }
interface RecordData { id: string; object_type: string; vertical: string; data: Record<string, unknown>; ai_summary?: string; activities?: Activity[]; updated_at: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  return String(name).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

const AVATAR_COLORS = [
  "from-red-500/30 to-red-600/10 text-red-300 border-red-500/20",
  "from-blue-500/30 to-blue-600/10 text-blue-300 border-blue-500/20",
  "from-emerald-500/30 to-emerald-600/10 text-emerald-300 border-emerald-500/20",
  "from-purple-500/30 to-purple-600/10 text-purple-300 border-purple-500/20",
  "from-amber-500/30 to-amber-600/10 text-amber-300 border-amber-500/20",
];
function avatarColor(name: string) {
  return AVATAR_COLORS[(initials(name).charCodeAt(0) || 0) % AVATAR_COLORS.length];
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

const STAGE_STYLES: Record<string, string> = {
  "Lead":        "bg-slate-500/15 text-slate-300 border-slate-500/20",
  "Qualified":   "bg-blue-500/15 text-blue-300 border-blue-500/20",
  "In Progress": "bg-blue-500/15 text-blue-300 border-blue-500/20",
  "Proposal":    "bg-purple-500/15 text-purple-300 border-purple-500/20",
  "Negotiation": "bg-amber-500/15 text-amber-300 border-amber-500/20",
  "Closed Won":  "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  "Closed Lost": "bg-red-500/15 text-red-300 border-red-500/20",
};
const DEAL_STAGES = ["Lead","Qualified","In Progress","Proposal","Negotiation","Closed Won","Closed Lost"];

// ─── Inline editable field ────────────────────────────────────────────────────
function InlineField({
  label, value, onSave, numeric = false,
}: { label: string; value: unknown; onSave: (v: string) => void; numeric?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(value));
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(fmt(value)); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== fmt(value)) {
      onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  }

  return (
    <div className="group grid grid-cols-[110px_1fr] items-start gap-2 py-2.5 border-b border-white/[.04] last:border-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600 pt-0.5 select-none">{label}</span>
      <div className="min-w-0 flex items-center gap-1.5">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
            className="w-full rounded-md border border-red-500/30 bg-white/[.05] px-2 py-1 text-sm text-white outline-none"
            type={numeric ? "number" : "text"}
          />
        ) : (
          <button
            onClick={() => { setEditing(true); setDraft(fmt(value)); }}
            className="min-w-0 text-left text-sm text-slate-300 hover:text-white transition-colors truncate group-hover:underline group-hover:decoration-dotted group-hover:decoration-slate-600 underline-offset-2"
          >
            {fmt(value)}
          </button>
        )}
        {saved && <Check size={11} className="text-emerald-400 shrink-0"/>}
      </div>
    </div>
  );
}

// ─── Highlight card ───────────────────────────────────────────────────────────
function HighlightCard({
  icon: Icon, label, value, accent = "slate", onSave, numeric,
}: {
  icon: React.ElementType; label: string; value: unknown;
  accent?: "slate"|"red"|"blue"|"emerald"|"amber"|"purple";
  onSave?: (v: string) => void; numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(value));
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(fmt(value)); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const accentMap: Record<string, string> = {
    slate: "text-slate-400", red: "text-red-400", blue: "text-blue-400",
    emerald: "text-emerald-400", amber: "text-amber-400", purple: "text-purple-400",
  };

  function commit() {
    setEditing(false);
    if (onSave && draft !== fmt(value)) {
      onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  }

  return (
    <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 hover:border-white/[.09] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={13} className={accentMap[accent]}/>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</span>
        </div>
        {saved && <Check size={11} className="text-emerald-400"/>}
      </div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(fmt(value)); } }}
          className="w-full rounded border border-red-500/30 bg-white/[.05] px-2 py-1 text-sm text-white outline-none"
          type={numeric ? "number" : "text"}
        />
      ) : (
        <button
          onClick={() => onSave && setEditing(true)}
          className={`text-left text-base font-semibold text-white truncate w-full ${onSave ? "hover:text-red-300 transition-colors" : "cursor-default"}`}
        >
          {fmt(value)}
        </button>
      )}
    </div>
  );
}

// ─── Deal stage selector ──────────────────────────────────────────────────────
function DealStageCard({ stage, onSave }: { stage: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(s: string) {
    setOpen(false);
    if (s !== stage) { onSave(s); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  }

  return (
    <div className="rounded-lg border border-white/[.06] bg-white/[.02] p-4 hover:border-white/[.09] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Tag size={13} className="text-purple-400"/>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600">Deal Stage</span>
        </div>
        {saved && <Check size={11} className="text-emerald-400"/>}
      </div>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${STAGE_STYLES[stage] ?? STAGE_STYLES["Lead"]}`}
        >
          {stage || "Set stage"}
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
        </button>
        {open && (
          <div className="dropdown-panel absolute left-0 top-full mt-1.5 w-44 z-50">
            {DEAL_STAGES.map(s => (
              <button
                key={s}
                onClick={() => select(s)}
                className={`dropdown-item w-full ${s === stage ? "dropdown-item-active" : ""}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full mr-1 ${STAGE_STYLES[s]?.includes("emerald") ? "bg-emerald-400" : STAGE_STYLES[s]?.includes("red") ? "bg-red-400" : STAGE_STYLES[s]?.includes("amber") ? "bg-amber-400" : STAGE_STYLES[s]?.includes("purple") ? "bg-purple-400" : STAGE_STYLES[s]?.includes("blue") ? "bg-blue-400" : "bg-slate-400"}`}/>
                {s}
                {s === stage && <Check size={11} className="ml-auto text-red-400"/>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity timeline ────────────────────────────────────────────────────────
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

// ─── Type-specific highlights ─────────────────────────────────────────────────
function CompanyHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (field: string, val: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <HighlightCard icon={Wifi}      label="Connection strength" value={data.connection_strength ?? "Not set"} accent="emerald"/>
      <HighlightCard icon={Calendar}  label="Next interaction"    value={data.next_interaction    ?? "Not scheduled"} accent="blue"/>
      <HighlightCard icon={DollarSign}label="Estimated ARR"       value={data.arr                 ?? "—"} accent="amber" onSave={v => onSave("arr", v)} numeric/>
      <HighlightCard icon={Users2}    label="Employee range"      value={data.employee_range      ?? "—"} accent="slate" onSave={v => onSave("employee_range", v)}/>
    </div>
  );
}

function PeopleHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (field: string, val: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <HighlightCard icon={Wifi}     label="Connection strength" value={data.connection_strength ?? "Not set"} accent="emerald"/>
      <HighlightCard icon={Mail}     label="Email"               value={data.email               ?? "—"} accent="blue"   onSave={v => onSave("email", v)}/>
      <HighlightCard icon={Building2}label="Company"             value={data.company             ?? "—"} accent="purple" onSave={v => onSave("company", v)}/>
      <HighlightCard icon={Phone}    label="Phone"               value={data.phone               ?? "—"} accent="slate"  onSave={v => onSave("phone", v)}/>
    </div>
  );
}

function DealHighlights({ data, onSave }: { data: Record<string, unknown>; onSave: (field: string, val: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DealStageCard stage={String(data.deal_stage ?? "Lead")} onSave={v => onSave("deal_stage", v)}/>
      <HighlightCard icon={DollarSign} label="Deal value" value={data.deal_value ?? "—"} accent="emerald" onSave={v => onSave("deal_value", v)} numeric/>
      <HighlightCard icon={Users}      label="Deal owner" value={data.deal_owner ?? "—"} accent="blue"    onSave={v => onSave("deal_owner", v)}/>
      <HighlightCard icon={Clock}      label="Last updated" value={data.updated_at ?? "—"} accent="slate"/>
    </div>
  );
}

// ─── Sub-tab bar ──────────────────────────────────────────────────────────────
const TABS = ["Overview","Activity","Notes","Tasks","Emails","Calls"] as const;
type Tab = typeof TABS[number];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-1 border-b border-white/[.06] px-1">
      {TABS.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-2.5 text-xs font-medium transition-colors relative ${active === t ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
        >
          {t}
          {active === t && <span className="absolute bottom-0 left-0 right-0 h-px bg-red-500"/>}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function RecordDetail({ recordId, objectType }: { recordId: string; objectType: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");

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
    const isNum = typeof current[field] === "number" || field.includes("arr") || field.includes("value") || field.includes("followers");
    const val = isNum ? (parseFloat(rawVal) || rawVal) : rawVal;
    patch.mutate({ ...current, [field]: val });
  }, [query.data, patch]);

  // ── Auto-transition: scan activity text for deal stage signals ──
  const [autoTransitionMsg, setAutoTransitionMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const activities = query.data.activities ?? [];
    if (!activities.length) return;
    const type = objectType.toLowerCase();
    if (!type.includes("deal")) return;

    const currentStage = String(query.data.data.deal_stage ?? "");
    for (const act of activities) {
      const text = `${act.action} ${act.ai_summary ?? ""}`;
      const detected = detectStageFromActivity(text);
      if (detected && detected !== currentStage) {
        // Auto-apply after a short grace period so the user sees the prompt
        const timer = setTimeout(() => {
          patch.mutate({ ...query.data.data, deal_stage: detected });
          setAutoTransitionMsg(`AI moved stage to "${detected}" based on activity`);
          setTimeout(() => setAutoTransitionMsg(null), 5000);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [query.data?.activities, objectType]);

  if (query.isLoading) return <div className="p-8"><PageSkeleton/></div>;
  if (query.isError || !query.data) return (
    <div className="p-8"><ErrorState error={query.error as Error ?? new Error("Record not found")} onRetry={() => query.refetch()}/></div>
  );

  const record = query.data;
  const data = record.data;
  const name = fmt(data.name ?? data.title ?? record.id);
  const type = objectType.toLowerCase();
  const isCompany = type === "companies" || type.includes("compan");
  const isPeople  = type === "people"    || type.includes("person") || type.includes("contact");
  const isDeals   = type === "deals"     || type.includes("deal");

  // Left panel: all fields except ones shown in highlights (avoid duplication)
  const HIGHLIGHT_FIELDS = isCompany ? ["arr","employee_range","connection_strength","next_interaction"]
    : isPeople ? ["email","phone","company","connection_strength"]
    : ["deal_stage","deal_value","deal_owner"];
  const leftFields = Object.entries(data).filter(([k]) => k !== "name");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 border-b border-white/[.06] px-6 py-3">
        <Link
          to={`/objects/${objectType}`}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <ChevronLeft size={13}/>
          {objectType}
        </Link>
        <span className="text-xs text-slate-700">/</span>
        <span className="text-xs text-slate-400 truncate">{name}</span>
        {patch.isPending && <span className="ml-auto text-xs text-slate-600 animate-pulse">Saving…</span>}
      </div>

      {/* ── AI auto-transition banner ── */}
      {autoTransitionMsg && (
        <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/[.06] px-6 py-2 text-xs text-emerald-400">
          <Sparkles size={12} className="shrink-0"/>
          {autoTransitionMsg}
        </div>
      )}

      {/* ── Body: left + right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel ── */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/[.06] overflow-auto">
          {/* Avatar + name */}
          <div className="p-5 border-b border-white/[.06]">
            <div className={`mx-auto h-16 w-16 rounded-2xl border bg-gradient-to-br flex items-center justify-center text-2xl font-bold ${avatarColor(name)}`}>
              {initials(name)}
            </div>
            <div className="mt-3 text-center">
              <h1 className="text-[15px] font-semibold text-white tracking-tight leading-snug">{name}</h1>
              <span className="mt-1 inline-block rounded-md bg-white/[.04] border border-white/[.06] px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-wide capitalize">
                {record.object_type}
              </span>
            </div>
          </div>

          {/* All attributes */}
          <div className="flex-1 overflow-auto px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-700">Attributes</p>
            {leftFields.map(([key, val]) => (
              <InlineField
                key={key}
                label={key.replace(/_/g, " ")}
                value={val}
                numeric={typeof val === "number"}
                onSave={v => save(key, v)}
              />
            ))}
            {leftFields.length === 0 && (
              <p className="text-xs text-slate-600 py-2">No attributes</p>
            )}
          </div>
        </aside>

        {/* ── Right panel ── */}
        <main className="flex flex-1 min-w-0 flex-col overflow-auto">
          <TabBar active={tab} onChange={setTab}/>

          <div className="flex-1 overflow-auto p-6">
            {tab === "Overview" && (
              <div className="space-y-6 max-w-3xl">
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

                {/* Activity timeline */}
                <div>
                  <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-600">Activity</p>
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

            {(tab === "Notes" || tab === "Tasks" || tab === "Emails" || tab === "Calls") && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] text-center">
                <Plus size={20} className="mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">{tab}</p>
                <p className="mt-1 text-xs text-slate-600">No {tab.toLowerCase()} yet for this record.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

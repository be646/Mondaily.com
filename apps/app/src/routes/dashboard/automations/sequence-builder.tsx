import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Mail, CheckSquare, Clock, Trash2, GripVertical,
  Play, Pause, Settings, Users, ChevronDown, ChevronUp, Save, Sparkles
} from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { FieldSelect } from "../../../components/ui/controls";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Step {
  id: string;
  type: "email" | "task";
  label: string;
  position: number;
  delay_value: number;
  delay_unit: "minutes" | "hours" | "days";
  subject?: string;
  body?: string;
  task_title?: string;
  assignee_id?: string;
  from_account?: string;
  send_as?: "new" | "reply";
  sent_count?: number;
  opened_count?: number;
  clicked_count?: number;
}

interface Enrollment {
  id: string;
  node_id: string;
  contact_name: string;
  company?: string;
  status: "active" | "paused" | "unsubscribed" | "replied";
  current_step: number;
  enrolled_at: string;
  opened_at?: string;
  clicked_at?: string;
  replied_at?: string;
}

interface Sequence {
  id: string;
  name: string;
  status: string;
  steps: Step[];
  enrollments: Enrollment[];
  settings: {
    stop_on_reply: boolean;
    sending_days: string[];
    send_start: string;
    send_end: string;
    daily_limit: number;
    timezone: string;
    unsubscribe: boolean;
  };
  accounts: { id: string; email: string }[];
  members: { id: string; name: string; role: string }[];
}

// ── Inline helpers ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-stone-500" : "bg-[var(--surface-hover)]"}`}
    >
      <span className={`block h-3 w-3 rounded-full bg-[var(--surface-card)] shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}/>
    </button>
  );
}

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const STATUS_STYLES: Record<string, string> = {
  active:       "bg-[#5f8169]/10 text-[#5f8169] border-[#5f8169]/25",
  paused:       "bg-[#97824f]/10 text-[#97824f] border-[#97824f]/25",
  unsubscribed: "bg-stone-500/10 text-stone-400 border-stone-500/20",
};

// ── Step card ─────────────────────────────────────────────────────────────────
function StepCard({
  step, seq, onUpdate, onDelete, isLast,
}: {
  step: Step; seq: Sequence;
  onUpdate: (id: string, patch: Partial<Step>) => void;
  onDelete: (id: string) => void;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(step.type === "email" && !step.subject);

  return (
    <div className="relative">
      {/* connector */}
      {!isLast && (
        <div className="absolute left-[27px] top-full z-0 h-6 w-px bg-[var(--surface-hover)]"/>
      )}

      <div className="relative z-10 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
        {/* Step header */}
        <div
          className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[var(--surface-hover)] transition-colors"
          onClick={() => setOpen(o => !o)}
        >
          <GripVertical size={14} className="shrink-0 text-[var(--text-faint)]"/>
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${step.type === "email" ? "border-stone-500/30 bg-stone-600/[.08] text-stone-400" : "border-[#717784]/25 bg-[#717784]/10 text-[#717784]"}`}>
            {step.type === "email" ? <Mail size={12}/> : <CheckSquare size={12}/>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--text-primary)] truncate">
              {step.type === "email" ? (step.subject || "Email — no subject") : (step.task_title || "Task — no title")}
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--text-secondary)] flex items-center gap-1">
              <Clock size={9}/>
              {step.position === 1 ? "Immediately" : `+${step.delay_value} ${step.delay_unit}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
              className="rounded-md p-1 text-[var(--text-faint)] hover:bg-stone-500/10 hover:text-[var(--text-faint)] transition-colors"
            >
              <Trash2 size={12}/>
            </button>
            {open ? <ChevronUp size={13} className="text-[var(--text-secondary)]"/> : <ChevronDown size={13} className="text-[var(--text-secondary)]"/>}
          </div>
        </div>

        {/* Step editor */}
        {open && (
          <div className="border-t border-[var(--border-soft)] px-4 pb-4 pt-3 space-y-3">
            {/* Delay */}
            {step.position > 1 && (
              <div className="flex items-center gap-2">
                <Clock size={12} className="shrink-0 text-[var(--text-secondary)]"/>
                <span className="text-[11px] text-[var(--text-secondary)] w-16">Wait</span>
                <input
                  type="number" min={0}
                  value={step.delay_value}
                  onChange={e => onUpdate(step.id, { delay_value: Number(e.target.value) })}
                  className="w-16 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/30"
                />
                <FieldSelect
                  value={step.delay_unit}
                  onChange={v => onUpdate(step.id, { delay_unit: v as Step["delay_unit"] })}
                  ariaLabel="Delay unit"
                  className="w-auto"
                  options={[
                    { value: "minutes", label: "minutes" },
                    { value: "hours", label: "hours" },
                    { value: "days", label: "days" },
                  ]}
                />
              </div>
            )}

            {step.type === "email" ? (
              <>
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Subject</label>
                  <input
                    value={step.subject ?? ""}
                    onChange={e => onUpdate(step.id, { subject: e.target.value })}
                    placeholder="Email subject…"
                    className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30"
                  />
                </div>
                {seq.accounts.length > 0 && (
                  <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">From</label>
                    <FieldSelect
                      value={step.from_account ?? ""}
                      onChange={v => onUpdate(step.id, { from_account: v })}
                      ariaLabel="From account"
                      placeholder="Select account…"
                      options={seq.accounts.map(a => ({ value: a.id, label: a.email }))}
                    />
                  </div>
                )}
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Send as</label>
                  <FieldSelect
                    value={step.send_as ?? "new"}
                    onChange={v => onUpdate(step.id, { send_as: v as "new" | "reply" })}
                    ariaLabel="Send as"
                    options={[
                      { value: "new", label: "New email" },
                      { value: "reply", label: "Reply to previous" },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Body</label>
                  <textarea
                    value={step.body ?? ""}
                    onChange={e => onUpdate(step.id, { body: e.target.value })}
                    rows={5}
                    placeholder="Write your email…"
                    className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30 resize-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Task</label>
                  <input
                    value={step.task_title ?? ""}
                    onChange={e => onUpdate(step.id, { task_title: e.target.value })}
                    placeholder="Task title…"
                    className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30"
                  />
                </div>
                {seq.members.length > 0 && (
                  <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Assign to</label>
                    <FieldSelect
                      value={step.assignee_id ?? ""}
                      onChange={v => onUpdate(step.id, { assignee_id: v })}
                      ariaLabel="Assign to"
                      placeholder="Unassigned"
                      options={seq.members.map(m => ({ value: m.id, label: m.name }))}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "steps" | "enrollments" | "analytics" | "settings";

export function SequenceBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("steps");
  const [name, setName] = useState("");
  const [nameEdit, setNameEdit] = useState(false);
  const [dirty, setDirty] = useState(false);

  const query = useQuery({
    queryKey: ["sequence", id],
    queryFn: async () => {
      if (id === "new") {
        const seq = await apiClient.patch<Sequence>("/sequences/new", {
          name: "New Sequence",
          stop_on_reply: true,
          sending_days: ["Mon","Tue","Wed","Thu","Fri"],
          send_start: "09:00",
          send_end: "17:00",
          daily_limit: 50,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          unsubscribe: true,
        });
        navigate(`/automations/sequences/${seq.id}`, { replace: true });
        return seq;
      }
      return apiClient.get<Sequence>(`/sequences/${id}`);
    },
    enabled: !!id,
  });

  const seq = query.data;

  // Sync name once loaded
  if (seq && !name) setName(seq.name);

  const patchSeq = useMutation({
    mutationFn: (body: Partial<Sequence>) => apiClient.patch<Sequence>(`/sequences/${id}`, body),
    onSuccess: (data) => { qc.setQueryData(["sequence", id], data); setDirty(false); },
    onError: () => {},
  });

  const addStep = useMutation({
    mutationFn: (type: "email" | "task") => apiClient.post<Step>(`/sequences/${id}/steps`, {
      type,
      label: type === "email" ? "Send email" : "Create task",
      position: (seq?.steps.length ?? 0) + 1,
      delay_value: seq?.steps.length === 0 ? 0 : 1,
      delay_unit: "days",
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequence", id] }),
  });

  const updateStep = useCallback((sid: string, patch: Partial<Step>) => {
    if (!seq) return;
    const updated = seq.steps.map(s => s.id === sid ? { ...s, ...patch } : s);
    qc.setQueryData(["sequence", id], { ...seq, steps: updated });
    setDirty(true);
  }, [seq, id, qc]);

  const deleteStep = useMutation({
    mutationFn: (sid: string) => apiClient.delete(`/sequences/${id}/steps/${sid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequence", id] }),
  });

  const saveSteps = useCallback(() => {
    if (!seq || !dirty) return;
    patchSeq.mutate({ steps: seq.steps } as any);
  }, [seq, dirty, patchSeq]);

  const toggleStatus = () => {
    if (!seq) return;
    const next = seq.status === "active" ? "paused" : "active";
    patchSeq.mutate({ status: next } as any);
  };

  const saveName = () => {
    setNameEdit(false);
    if (seq && name !== seq.name) patchSeq.mutate({ name } as any);
  };

  if (query.isLoading || id === "new") return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-500/30 border-t-[#9c6b72]"/>
    </div>
  );

  if (!seq) return <div className="p-8 text-sm text-[var(--text-muted)]">Sequence not found.</div>;

  const enrollments = seq.enrollments;
  const totalEnrolled = enrollments.length;
  const totalOpened = enrollments.filter((e: Enrollment) => e.opened_at).length;
  const totalClicked = enrollments.filter((e: Enrollment) => e.clicked_at).length;
  const totalReplied = enrollments.filter((e: Enrollment) => e.status === "replied" || e.replied_at).length;
  const totalUnsubscribed = enrollments.filter((e: Enrollment) => e.status === "unsubscribed").length;
  const openRate = totalEnrolled > 0 ? Math.round((totalOpened / totalEnrolled) * 100) : 0;
  const clickRate = totalEnrolled > 0 ? Math.round((totalClicked / totalEnrolled) * 100) : 0;
  const replyRate = totalEnrolled > 0 ? Math.round((totalReplied / totalEnrolled) * 100) : 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "steps", label: "Steps", count: seq.steps.length },
    { key: "enrollments", label: "Enrolled", count: seq.enrollments.length },
    { key: "analytics", label: "Analytics" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-6 py-3">
        <Link to="/automations" className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">
          <ArrowLeft size={15}/>
        </Link>

        {nameEdit ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(seq.name); setNameEdit(false); } }}
            className="flex-1 bg-transparent text-[15px] font-semibold text-[var(--text-primary)] outline-none border-b border-stone-500/40 pb-0.5"
          />
        ) : (
          <h1
            className="flex-1 cursor-pointer text-[15px] font-semibold text-[var(--text-primary)] hover:text-[var(--text-faint)] transition-colors truncate"
            onClick={() => setNameEdit(true)}
          >
            {seq.name}
          </h1>
        )}

        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${seq.status === "active" ? "border-[#5f8169]/25 bg-[#5f8169]/10 text-[#5f8169]" : "border-stone-600/30 bg-stone-700/50 text-stone-400"}`}>
          {seq.status}
        </span>

        {dirty && (
          <button
            onClick={saveSteps}
            disabled={patchSeq.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <Save size={11}/> Save
          </button>
        )}

        <button
          onClick={toggleStatus}
          disabled={patchSeq.isPending}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${seq.status === "active" ? "border-[#97824f]/40 bg-[#97824f]/80 text-[var(--text-primary)] hover:bg-[#97824f]" : "border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)]"}`}
        >
          {seq.status === "active" ? <><Pause size={11}/> Pause</> : <><Play size={11}/> Activate</>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-soft)] px-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${tab === t.key ? "border-[var(--border-strong)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-faint)]"}`}
          >
            {t.label}
            {t.count != null && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${tab === t.key ? "bg-stone-500/20 text-[var(--text-faint)]" : "bg-[var(--surface-hover)] text-[var(--text-secondary)]"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-6">

        {/* ── Steps ── */}
        {tab === "steps" && (
          <div className="max-w-xl mx-auto">
            {seq.steps.length === 0 ? (
              <div className="mb-6 rounded-sm border border-dashed border-[var(--border-soft)] py-10 text-center">
                <Mail size={20} className="mx-auto mb-2 text-[var(--text-faint)]"/>
                <p className="text-sm font-medium text-[var(--text-faint)]">No steps yet</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Add an email or task step to build your sequence</p>
              </div>
            ) : (
              <div className="space-y-6 mb-6">
                {[...seq.steps].sort((a, b) => a.position - b.position).map((step, i) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    seq={seq}
                    onUpdate={updateStep}
                    onDelete={(sid) => deleteStep.mutate(sid)}
                    isLast={i === seq.steps.length - 1}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => addStep.mutate("email")}
                disabled={addStep.isPending}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-2.5 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Mail size={12} className="text-[var(--text-faint)]"/> Add email step
              </button>
              <button
                onClick={() => addStep.mutate("task")}
                disabled={addStep.isPending}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-2.5 text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <CheckSquare size={12} className="text-[#717784]"/> Add task step
              </button>
            </div>
          </div>
        )}

        {/* ── Enrollments ── */}
        {tab === "enrollments" && (
          <div className="max-w-2xl mx-auto">
            {seq.enrollments.length === 0 ? (
              <div className="rounded-sm border border-dashed border-[var(--border-soft)] py-10 text-center">
                <Users size={20} className="mx-auto mb-2 text-[var(--text-faint)]"/>
                <p className="text-sm font-medium text-[var(--text-faint)]">No contacts enrolled</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Go to a People or Company record and enroll them in this sequence</p>
              </div>
            ) : (
              <div className="minimal-sheet overflow-hidden">
          <table className="minimal-table text-xs">
                  <thead className="border-b border-[var(--border-soft)] bg-[var(--surface-hover)]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--text-muted)]">Contact</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--text-muted)]">Company</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--text-muted)]">Step</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--text-muted)]">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--text-muted)]">Enrolled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seq.enrollments.map((e, i) => (
                      <tr key={e.id} className={`border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] ${i === seq.enrollments.length - 1 ? "border-0" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{e.contact_name}</td>
                        <td className="px-4 py-2.5 text-[var(--text-muted)]">{e.company || "—"}</td>
                        <td className="px-4 py-2.5 text-[var(--text-faint)]">{e.current_step} / {seq.steps.length}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold capitalize ${STATUS_STYLES[e.status] ?? STATUS_STYLES.active}`}>
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                          {new Date(e.enrolled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Analytics ── */}
        {tab === "analytics" && (
          <div className="max-w-2xl mx-auto space-y-5">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Enrolled", value: totalEnrolled, color: "text-[var(--text-primary)]" },
                { label: "Open rate", value: `${openRate}%`, color: openRate >= 30 ? "text-[#5f8169]" : openRate >= 15 ? "text-[#97824f]" : "text-[var(--text-faint)]" },
                { label: "Click rate", value: `${clickRate}%`, color: clickRate >= 10 ? "text-[#5f8169]" : "text-[var(--text-faint)]" },
                { label: "Reply rate", value: `${replyRate}%`, color: replyRate >= 5 ? "text-[#5f8169]" : "text-[var(--text-faint)]" },
              ].map(({ label, value, color }) => (
                <div key={label} className="premium-panel px-4 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{label}</p>
                  <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Step-by-step funnel */}
            {seq.steps.length > 0 && (
              <div className="minimal-sheet overflow-hidden">
                <div className="border-b border-[var(--border-soft)] px-4 py-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Step performance</p>
                </div>
                <div className="divide-y divide-[var(--border-soft)]">
                  {seq.steps.map((step, i) => {
                    const sent = Number(step.sent_count ?? 0);
                    const opened = Number(step.opened_count ?? 0);
                    const clicked = Number(step.clicked_count ?? 0);
                    const pct = sent > 0 ? Math.round((opened / sent) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center gap-4 px-4 py-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[10px] font-bold text-[var(--text-faint)]">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{String(step.label ?? step.subject ?? `Step ${i + 1}`)}</p>
                          <p className="text-[10px] text-[var(--text-secondary)] capitalize">{String(step.type ?? "email")}</p>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <p className="text-xs text-[var(--text-faint)]">{sent > 0 ? `${sent} sent` : "Not sent yet"}</p>
                          {sent > 0 && <p className="text-[10px] text-[var(--text-secondary)]">{opened} opened · {clicked} clicked · {pct}%</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unsubscribes */}
            <div className="premium-panel px-4 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Unsubscribes</p>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Contacts who opted out</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-[var(--text-faint)]">{totalUnsubscribed}</p>
                <p className="text-[10px] text-[var(--text-secondary)]">{totalEnrolled > 0 ? Math.round((totalUnsubscribed / totalEnrolled) * 100) : 0}% rate</p>
              </div>
            </div>

            {totalEnrolled === 0 && (
              <p className="text-center text-xs text-[var(--text-secondary)] py-4">Enroll contacts to start tracking analytics</p>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        {tab === "settings" && (
          <div className="max-w-lg mx-auto space-y-4">
            {/* Sending window */}
            <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
              <div className="border-b border-[var(--border-soft)] px-4 py-3">
                <p className="text-xs font-semibold text-[var(--text-primary)]">Sending window</p>
              </div>
              <div className="space-y-4 px-4 py-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--text-faint)]">Sending days</label>
                  <div className="flex gap-1">
                    {DAYS.map(d => {
                      const active = seq.settings.sending_days.includes(d);
                      return (
                        <button
                          key={d}
                          onClick={() => {
                            const days = active
                              ? seq.settings.sending_days.filter(x => x !== d)
                              : [...seq.settings.sending_days, d];
                            patchSeq.mutate({ settings: { ...seq.settings, sending_days: days } } as any);
                          }}
                          className={`rounded-md px-2 py-1 text-[9px] font-semibold transition-colors ${active ? "bg-stone-500/20 text-[var(--text-faint)] border border-stone-500/20" : "bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border-soft)] hover:text-[var(--text-faint)]"}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--text-faint)]">Send window</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={seq.settings.send_start}
                      onChange={e => patchSeq.mutate({ settings: { ...seq.settings, send_start: e.target.value } } as any)}
                      className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/30"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">to</span>
                    <input
                      type="time"
                      value={seq.settings.send_end}
                      onChange={e => patchSeq.mutate({ settings: { ...seq.settings, send_end: e.target.value } } as any)}
                      className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/30"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--text-faint)]">Daily email limit</label>
                  <input
                    type="number" min={1} max={500}
                    value={seq.settings.daily_limit}
                    onChange={e => patchSeq.mutate({ settings: { ...seq.settings, daily_limit: Number(e.target.value) } } as any)}
                    className="w-20 rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/30 text-right"
                  />
                </div>
              </div>
            </div>

            {/* Behavior */}
            <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
              <div className="border-b border-[var(--border-soft)] px-4 py-3">
                <p className="text-xs font-semibold text-[var(--text-primary)]">Behavior</p>
              </div>
              <div className="divide-y divide-white/[.04] px-4">
                {[
                  { key: "stop_on_reply", label: "Stop sequence on reply", sub: "Unenroll contact when they reply" },
                  { key: "unsubscribe", label: "Include unsubscribe link", sub: "Append opt-out footer to all emails" },
                ].map(({ key, label, sub }) => (
                  <div key={key} className="flex items-center justify-between py-3.5">
                    <div>
                      <p className="text-xs font-medium text-[var(--text-primary)]">{label}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{sub}</p>
                    </div>
                    <Toggle
                      checked={!!(seq.settings as any)[key]}
                      onChange={v => patchSeq.mutate({ settings: { ...seq.settings, [key]: v } } as any)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

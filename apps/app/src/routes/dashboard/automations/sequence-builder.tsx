import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Mail, CheckSquare, Clock, Trash2, GripVertical,
  Play, Pause, Settings, Users, ChevronDown, ChevronUp, Save, Sparkles
} from "lucide-react";
import { apiClient } from "../../../lib/api-client";

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
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-indigo-500" : "bg-white/[.10]"}`}
    >
      <span className={`block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}/>
    </button>
  );
}

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const STATUS_STYLES: Record<string, string> = {
  active:       "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  paused:       "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  unsubscribed: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
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
        <div className="absolute left-[27px] top-full z-0 h-6 w-px bg-white/[.08]"/>
      )}

      <div className="relative z-10 rounded-xl border border-white/[.07] bg-[#0d0f13] overflow-hidden">
        {/* Step header */}
        <div
          className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[.02] transition-colors"
          onClick={() => setOpen(o => !o)}
        >
          <GripVertical size={14} className="shrink-0 text-slate-700"/>
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${step.type === "email" ? "border-purple-500/20 bg-purple-500/[.08] text-purple-400" : "border-blue-500/20 bg-blue-500/[.08] text-blue-400"}`}>
            {step.type === "email" ? <Mail size={12}/> : <CheckSquare size={12}/>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {step.type === "email" ? (step.subject || "Email — no subject") : (step.task_title || "Task — no title")}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-600 flex items-center gap-1">
              <Clock size={9}/>
              {step.position === 1 ? "Immediately" : `+${step.delay_value} ${step.delay_unit}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
              className="rounded-md p-1 text-slate-700 hover:bg-indigo-500/10 hover:text-indigo-400 transition-colors"
            >
              <Trash2 size={12}/>
            </button>
            {open ? <ChevronUp size={13} className="text-slate-600"/> : <ChevronDown size={13} className="text-slate-600"/>}
          </div>
        </div>

        {/* Step editor */}
        {open && (
          <div className="border-t border-white/[.06] px-4 pb-4 pt-3 space-y-3">
            {/* Delay */}
            {step.position > 1 && (
              <div className="flex items-center gap-2">
                <Clock size={12} className="shrink-0 text-slate-600"/>
                <span className="text-[11px] text-slate-600 w-16">Wait</span>
                <input
                  type="number" min={0}
                  value={step.delay_value}
                  onChange={e => onUpdate(step.id, { delay_value: Number(e.target.value) })}
                  className="w-16 rounded-md border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/30"
                />
                <select
                  value={step.delay_unit}
                  onChange={e => onUpdate(step.id, { delay_unit: e.target.value as Step["delay_unit"] })}
                  className="rounded-md border border-white/[.07] bg-[#0d0f13] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/30"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
            )}

            {step.type === "email" ? (
              <>
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-slate-600">Subject</label>
                  <input
                    value={step.subject ?? ""}
                    onChange={e => onUpdate(step.id, { subject: e.target.value })}
                    placeholder="Email subject…"
                    className="rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none focus:border-indigo-500/30"
                  />
                </div>
                {seq.accounts.length > 0 && (
                  <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-slate-600">From</label>
                    <select
                      value={step.from_account ?? ""}
                      onChange={e => onUpdate(step.id, { from_account: e.target.value })}
                      className="rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/30"
                    >
                      <option value="">Select account…</option>
                      {seq.accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-slate-600">Send as</label>
                  <select
                    value={step.send_as ?? "new"}
                    onChange={e => onUpdate(step.id, { send_as: e.target.value as "new" | "reply" })}
                    className="rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/30"
                  >
                    <option value="new">New email</option>
                    <option value="reply">Reply to previous</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-600">Body</label>
                  <textarea
                    value={step.body ?? ""}
                    onChange={e => onUpdate(step.id, { body: e.target.value })}
                    rows={5}
                    placeholder="Write your email…"
                    className="w-full rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-2 text-xs text-white placeholder-slate-700 outline-none focus:border-indigo-500/30 resize-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-slate-600">Task</label>
                  <input
                    value={step.task_title ?? ""}
                    onChange={e => onUpdate(step.id, { task_title: e.target.value })}
                    placeholder="Task title…"
                    className="rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none focus:border-indigo-500/30"
                  />
                </div>
                {seq.members.length > 0 && (
                  <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-slate-600">Assign to</label>
                    <select
                      value={step.assignee_id ?? ""}
                      onChange={e => onUpdate(step.id, { assignee_id: e.target.value })}
                      className="rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/30"
                    >
                      <option value="">Unassigned</option>
                      {seq.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
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
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500/30 border-t-red-500"/>
    </div>
  );

  if (!seq) return <div className="p-8 text-sm text-slate-500">Sequence not found.</div>;

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
      <div className="flex items-center gap-3 border-b border-neutral-200 dark:border-neutral-800 px-6 py-3">
        <Link to="/automations" className="text-slate-600 hover:text-slate-300 transition-colors">
          <ArrowLeft size={15}/>
        </Link>

        {nameEdit ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(seq.name); setNameEdit(false); } }}
            className="flex-1 bg-transparent text-[15px] font-semibold text-white outline-none border-b border-indigo-500/40 pb-0.5"
          />
        ) : (
          <h1
            className="flex-1 cursor-pointer text-[15px] font-semibold text-white hover:text-indigo-400 transition-colors truncate"
            onClick={() => setNameEdit(true)}
          >
            {seq.name}
          </h1>
        )}

        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${seq.status === "active" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-slate-600/30 bg-slate-700/50 text-slate-400"}`}>
          {seq.status}
        </span>

        {dirty && (
          <button
            onClick={saveSteps}
            disabled={patchSeq.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.04] px-3 py-1.5 text-xs text-white hover:bg-white/[.07] transition-colors"
          >
            <Save size={11}/> Save
          </button>
        )}

        <button
          onClick={toggleStatus}
          disabled={patchSeq.isPending}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${seq.status === "active" ? "border-yellow-400/40 bg-yellow-500/80 text-white hover:bg-yellow-400" : "border-indigo-400/40 bg-indigo-500 text-white hover:bg-indigo-400"}`}
        >
          {seq.status === "active" ? <><Pause size={11}/> Pause</> : <><Play size={11}/> Activate</>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 px-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${tab === t.key ? "border-indigo-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            {t.label}
            {t.count != null && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${tab === t.key ? "bg-indigo-500/20 text-indigo-300" : "bg-white/[.06] text-slate-600"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-6">

        {/* ── Steps ── */}
        {tab === "steps" && (
          <div className="max-w-xl mx-auto">
            {seq.steps.length === 0 ? (
              <div className="mb-6 rounded-xl border border-dashed border-white/[.08] py-10 text-center">
                <Mail size={20} className="mx-auto mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">No steps yet</p>
                <p className="mt-1 text-xs text-slate-600">Add an email or task step to build your sequence</p>
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
                className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.02] px-4 py-2.5 text-xs text-slate-400 hover:bg-white/[.05] hover:text-white transition-colors"
              >
                <Mail size={12} className="text-purple-400"/> Add email step
              </button>
              <button
                onClick={() => addStep.mutate("task")}
                disabled={addStep.isPending}
                className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.02] px-4 py-2.5 text-xs text-slate-400 hover:bg-white/[.05] hover:text-white transition-colors"
              >
                <CheckSquare size={12} className="text-blue-400"/> Add task step
              </button>
            </div>
          </div>
        )}

        {/* ── Enrollments ── */}
        {tab === "enrollments" && (
          <div className="max-w-2xl mx-auto">
            {seq.enrollments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[.08] py-10 text-center">
                <Users size={20} className="mx-auto mb-2 text-slate-700"/>
                <p className="text-sm font-medium text-slate-400">No contacts enrolled</p>
                <p className="mt-1 text-xs text-slate-600">Go to a People or Company record and enroll them in this sequence</p>
              </div>
            ) : (
              <div className="minimal-sheet overflow-hidden">
          <table className="minimal-table text-xs">
                  <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-white/[.02]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-slate-500">Contact</th>
                      <th className="px-4 py-2.5 text-left font-medium text-slate-500">Company</th>
                      <th className="px-4 py-2.5 text-left font-medium text-slate-500">Step</th>
                      <th className="px-4 py-2.5 text-left font-medium text-slate-500">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-slate-500">Enrolled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seq.enrollments.map((e, i) => (
                      <tr key={e.id} className={`border-b border-white/[.04] hover:bg-white/[.02] ${i === seq.enrollments.length - 1 ? "border-0" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-white">{e.contact_name}</td>
                        <td className="px-4 py-2.5 text-slate-500">{e.company || "—"}</td>
                        <td className="px-4 py-2.5 text-slate-400">{e.current_step} / {seq.steps.length}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold capitalize ${STATUS_STYLES[e.status] ?? STATUS_STYLES.active}`}>
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
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
                { label: "Enrolled", value: totalEnrolled, color: "text-white" },
                { label: "Open rate", value: `${openRate}%`, color: openRate >= 30 ? "text-emerald-400" : openRate >= 15 ? "text-amber-400" : "text-slate-400" },
                { label: "Click rate", value: `${clickRate}%`, color: clickRate >= 10 ? "text-emerald-400" : "text-slate-400" },
                { label: "Reply rate", value: `${replyRate}%`, color: replyRate >= 5 ? "text-emerald-400" : "text-slate-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="premium-panel px-4 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
                  <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Step-by-step funnel */}
            {seq.steps.length > 0 && (
              <div className="minimal-sheet overflow-hidden">
                <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
                  <p className="text-xs font-semibold text-white">Step performance</p>
                </div>
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {seq.steps.map((step, i) => {
                    const sent = Number(step.sent_count ?? 0);
                    const opened = Number(step.opened_count ?? 0);
                    const clicked = Number(step.clicked_count ?? 0);
                    const pct = sent > 0 ? Math.round((opened / sent) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center gap-4 px-4 py-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[.06] text-[10px] font-bold text-slate-400">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{String(step.label ?? step.subject ?? `Step ${i + 1}`)}</p>
                          <p className="text-[10px] text-slate-600 capitalize">{String(step.type ?? "email")}</p>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <p className="text-xs text-slate-400">{sent > 0 ? `${sent} sent` : "Not sent yet"}</p>
                          {sent > 0 && <p className="text-[10px] text-white/30">{opened} opened · {clicked} clicked · {pct}%</p>}
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
                <p className="text-xs font-semibold text-white">Unsubscribes</p>
                <p className="text-[11px] text-slate-600 mt-0.5">Contacts who opted out</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-indigo-400">{totalUnsubscribed}</p>
                <p className="text-[10px] text-slate-600">{totalEnrolled > 0 ? Math.round((totalUnsubscribed / totalEnrolled) * 100) : 0}% rate</p>
              </div>
            </div>

            {totalEnrolled === 0 && (
              <p className="text-center text-xs text-white/20 py-4">Enroll contacts to start tracking analytics</p>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        {tab === "settings" && (
          <div className="max-w-lg mx-auto space-y-4">
            {/* Sending window */}
            <div className="rounded-xl border border-white/[.07] bg-[#0d0f13] overflow-hidden">
              <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
                <p className="text-xs font-semibold text-white">Sending window</p>
              </div>
              <div className="space-y-4 px-4 py-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">Sending days</label>
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
                          className={`rounded-md px-2 py-1 text-[9px] font-semibold transition-colors ${active ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/20" : "bg-white/[.03] text-slate-600 border border-white/[.06] hover:text-slate-400"}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">Send window</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={seq.settings.send_start}
                      onChange={e => patchSeq.mutate({ settings: { ...seq.settings, send_start: e.target.value } } as any)}
                      className="rounded-md border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/30"
                    />
                    <span className="text-xs text-slate-600">to</span>
                    <input
                      type="time"
                      value={seq.settings.send_end}
                      onChange={e => patchSeq.mutate({ settings: { ...seq.settings, send_end: e.target.value } } as any)}
                      className="rounded-md border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/30"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">Daily email limit</label>
                  <input
                    type="number" min={1} max={500}
                    value={seq.settings.daily_limit}
                    onChange={e => patchSeq.mutate({ settings: { ...seq.settings, daily_limit: Number(e.target.value) } } as any)}
                    className="w-20 rounded-md border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/30 text-right"
                  />
                </div>
              </div>
            </div>

            {/* Behavior */}
            <div className="rounded-xl border border-white/[.07] bg-[#0d0f13] overflow-hidden">
              <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
                <p className="text-xs font-semibold text-white">Behavior</p>
              </div>
              <div className="divide-y divide-white/[.04] px-4">
                {[
                  { key: "stop_on_reply", label: "Stop sequence on reply", sub: "Unenroll contact when they reply" },
                  { key: "unsubscribe", label: "Include unsubscribe link", sub: "Append opt-out footer to all emails" },
                ].map(({ key, label, sub }) => (
                  <div key={key} className="flex items-center justify-between py-3.5">
                    <div>
                      <p className="text-xs font-medium text-white">{label}</p>
                      <p className="mt-0.5 text-[10px] text-slate-600">{sub}</p>
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

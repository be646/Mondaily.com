import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, Bot, Eye, GripVertical, Italic, List, ListOrdered, Mail, Plus, Save, Search, Settings, Settings2, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

type StepType = "email" | "task";
type DelayUnit = "minutes" | "hours" | "days";
type EnrollmentStatus = "active" | "completed" | "replied" | "bounced" | "unsubscribed" | "paused";

interface SequenceSettings {
  stop_on_reply: boolean;
  sending_days: string[];
  send_start: string;
  send_end: string;
  daily_limit: number;
  timezone: string;
  unsubscribe: boolean;
}
interface SequenceStep {
  id: string;
  type: StepType;
  label: string;
  position: number;
  delay_value: number;
  delay_unit: DelayUnit;
  subject?: string;
  from_account?: string;
  send_as?: "new" | "reply";
  body?: string;
  task_title?: string;
  assignee_id?: string;
}
interface Enrollment {
  id: string;
  node_id: string;
  contact_name: string;
  company?: string;
  status: EnrollmentStatus;
  current_step: number;
  enrolled_at: string;
  last_sent_at?: string;
}
interface Sequence {
  id: string;
  name: string;
  status: string;
  settings: SequenceSettings;
  steps: SequenceStep[];
  enrollments: Enrollment[];
  accounts: { id: string; email: string }[];
  members: { id: string; name: string }[];
}
interface ContactOption { id: string; object_type: string; data: Record<string, unknown> }

const mergeTags = ["{{first_name}}", "{{last_name}}", "{{company}}", "{{title}}", "{{sender_name}}"];
const statusStyles: Record<EnrollmentStatus, string> = {
  active: "bg-blue-500/10 text-blue-400", completed: "bg-emerald-500/10 text-emerald-400",
  replied: "bg-violet-500/10 text-violet-400", bounced: "bg-red-500/10 text-red-400",
  unsubscribed: "bg-slate-500/10 text-slate-400", paused: "bg-amber-500/10 text-amber-400"
};

function StepCard({ step, selected, onSelect, onDelete }: { step: SequenceStep; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const drag = useDraggable({ id: step.id });
  const drop = useDroppable({ id: step.id });
  return <div ref={(node) => { drag.setNodeRef(node); drop.setNodeRef(node); }} style={{ transform: drag.transform ? `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` : undefined }} className={`group flex items-center gap-2 rounded-lg border p-3 ${selected ? "border-red-500/40 bg-red-500/5" : drop.isOver ? "border-white/30" : "border-white/10"}`}>
    <button {...drag.listeners} {...drag.attributes} className="cursor-grab text-slate-600"><GripVertical size={14} /></button>
    <button onClick={onSelect} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded bg-white/[.05] text-[11px]">{step.position}</span><span className="text-xs font-medium capitalize">{step.type}</span></div><p className="mt-2 truncate text-xs text-slate-500">{step.delay_value === 0 ? "Immediately" : `${step.delay_unit === "days" ? "Day" : "After"} ${step.delay_value} ${step.delay_unit}`}</p></button>
    <button onClick={onDelete} title="Delete step" className="text-slate-600 opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 size={13} /></button>
  </div>;
}

function DelayFields({ step, update }: { step: SequenceStep; update: (updates: Partial<SequenceStep>) => void }) {
  return <div className="grid grid-cols-[1fr_1.2fr] gap-3"><label className="text-xs text-slate-500">Delay<input type="number" min="0" value={step.delay_value} onChange={(event) => update({ delay_value: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" /></label><label className="text-xs text-slate-500">Unit<select value={step.delay_unit} onChange={(event) => update({ delay_unit: event.target.value as DelayUnit })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label></div>;
}

function MergeTags({ insert }: { insert: (tag: string) => void }) {
  return <div className="flex flex-wrap gap-1">{mergeTags.map((tag) => <button key={tag} type="button" onClick={() => insert(tag)} className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-500 hover:text-white">{tag}</button>)}</div>;
}

function EmailEditor({ step, sequence, update }: { step: SequenceStep; sequence: Sequence; update: (updates: Partial<SequenceStep>) => void }) {
  const [preview, setPreview] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const editor = useEditor({ extensions: [StarterKit], content: step.body || "<p></p>", editorProps: { attributes: { class: "min-h-44 p-3 text-sm leading-6 outline-none" } }, onUpdate: ({ editor: current }) => update({ body: current.getHTML() }) });
  useEffect(() => { if (editor && editor.getHTML() !== (step.body || "<p></p>")) editor.commands.setContent(step.body || "<p></p>", false); }, [editor, step.body]);

  function streamDraft() {
    if (!editor || !aiPrompt.trim()) return;
    setWriting(true);
    setAiOpen(false);
    const draft = `Hi {{first_name}},\n\n${aiPrompt.trim()}\n\nI thought this could be useful for {{company}}. Would you be open to a short conversation this week?\n\nBest,\n{{sender_name}}`;
    editor.commands.clearContent();
    let index = 0;
    const timer = window.setInterval(() => {
      const next = draft.slice(index, index + 8);
      editor.commands.insertContent(next.replace(/\n/g, "<br>"));
      index += 8;
      if (index >= draft.length) { window.clearInterval(timer); setWriting(false); }
    }, 30);
  }
  const sample = (step.body || "").replaceAll("{{first_name}}", "Alex").replaceAll("{{last_name}}", "Morgan").replaceAll("{{company}}", "Northstar Labs").replaceAll("{{title}}", "VP Sales").replaceAll("{{sender_name}}", "Danny");
  return <div className="space-y-5">
    <DelayFields step={step} update={update} />
    <label className="block text-xs text-slate-500">Subject<input value={step.subject || ""} onChange={(event) => update({ subject: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" /></label>
    <MergeTags insert={(tag) => update({ subject: `${step.subject || ""}${tag}` })} />
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500">From<select value={step.from_account || ""} onChange={(event) => update({ from_account: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="">Select account</option>{sequence.accounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}</select></label><label className="text-xs text-slate-500">Send as<select value={step.send_as || "new"} onChange={(event) => update({ send_as: event.target.value as "new" | "reply" })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="new">New thread</option><option value="reply">Reply to previous</option></select></label></div>
    <div className="overflow-hidden rounded-md border border-white/10"><div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2"><button onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={14} /></button><button onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={14} /></button><button onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={14} /></button><button onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></button><button onClick={() => setAiOpen(true)} className="ml-2 flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400"><Bot size={12} /> {writing ? "Writing..." : "AI write"}</button><button onClick={() => setPreview(true)} className="ml-auto flex items-center gap-1 text-xs text-slate-400"><Eye size={12} /> Preview</button></div><EditorContent editor={editor} /></div>
    <MergeTags insert={(tag) => editor?.chain().focus().insertContent(tag).run()} />
    {aiOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-lg border border-white/10 bg-[#111419] p-5"><h3 className="font-medium">Describe the email goal</h3><textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={4} className="mt-4 w-full rounded-md border border-white/10 bg-transparent p-3 text-sm" placeholder="Re-engage a prospect who downloaded our pricing guide..." /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setAiOpen(false)} className="px-3 py-2 text-sm text-slate-500">Cancel</button><button onClick={streamDraft} className="rounded-md bg-red-600 px-3 py-2 text-sm">Write draft</button></div></div></div> : null}
    {preview ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-xl rounded-lg border border-white/10 bg-white p-6 text-slate-900"><div className="flex items-center justify-between border-b pb-4"><div><p className="text-xs text-slate-500">Subject</p><p className="font-medium">{(step.subject || "").replaceAll("{{first_name}}", "Alex").replaceAll("{{company}}", "Northstar Labs")}</p></div><button onClick={() => setPreview(false)}><X size={17} /></button></div><div className="mt-5 text-sm leading-6" dangerouslySetInnerHTML={{ __html: sample }} /></div></div> : null}
  </div>;
}

function TaskEditor({ step, sequence, update }: { step: SequenceStep; sequence: Sequence; update: (updates: Partial<SequenceStep>) => void }) {
  return <div className="space-y-5"><DelayFields step={step} update={update} /><label className="block text-xs text-slate-500">Task title<input value={step.task_title || ""} onChange={(event) => update({ task_title: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" /></label><MergeTags insert={(tag) => update({ task_title: `${step.task_title || ""}${tag}` })} /><label className="block text-xs text-slate-500">Assign to<select value={step.assignee_id || ""} onChange={(event) => update({ assignee_id: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm"><option value="">Unassigned</option>{sequence.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>;
}

export function SequenceBuilderPage() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [tab, setTab] = useState<"steps" | "enrollments">("steps");
  const [sequence, setSequence] = useState<Sequence>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const query = useQuery({ queryKey: ["sequence", id], queryFn: () => apiClient.get<Sequence>(`/sequences/${id}`) });
  const contacts = useQuery({ queryKey: ["sequence-contacts", contactSearch], queryFn: () => apiClient.get<ContactOption[]>(`/nodes?object_type=contact&limit=50`), enabled: enrollOpen });
  useEffect(() => { if (query.data) { setSequence(query.data); setSelectedStepId(query.data.steps[0]?.id); } }, [query.data]);
  const save = useMutation({ mutationFn: (value: Sequence) => apiClient.patch<Sequence>(`/sequences/${id}`, value), onSuccess: (saved) => { qc.setQueryData(["sequence", saved.id], saved); if (id === "new") navigate(`/automations/sequences/${saved.id}`, { replace: true }); } });
  const enroll = useMutation({ mutationFn: () => apiClient.post(`/sequences/${sequence?.id}/enroll`, { node_ids: selectedContacts }), onSuccess: () => { setEnrollOpen(false); setSelectedContacts([]); qc.invalidateQueries({ queryKey: ["sequence", sequence?.id] }); } });
  const enrollmentAction = useMutation({ mutationFn: ({ enrollmentId, action }: { enrollmentId: string; action: string }) => apiClient.patch(`/sequences/${sequence?.id}/enrollments/${enrollmentId}`, { action }), onSuccess: () => qc.invalidateQueries({ queryKey: ["sequence", sequence?.id] }) });
  if (query.isLoading || !sequence) return <div className="p-8"><PageSkeleton rows={8} /></div>;
  const currentSequence = sequence;
  const selectedStep = currentSequence.steps.find((step) => step.id === selectedStepId);

  function updateStep(updates: Partial<SequenceStep>) {
    if (!selectedStep) return;
    setSequence({ ...currentSequence, steps: currentSequence.steps.map((step) => step.id === selectedStep.id ? { ...step, ...updates } : step) });
  }
  function addStep(type: StepType) {
    const step: SequenceStep = { id: crypto.randomUUID(), type, label: type === "email" ? "Email" : "Task", position: currentSequence.steps.length + 1, delay_value: currentSequence.steps.length ? 1 : 0, delay_unit: "days", subject: "", body: "<p></p>", send_as: "new", task_title: "" };
    setSequence({ ...currentSequence, steps: [...currentSequence.steps, step] }); setSelectedStepId(step.id);
  }
  function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = currentSequence.steps.findIndex((step) => step.id === event.active.id);
    const to = currentSequence.steps.findIndex((step) => step.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const next = [...currentSequence.steps]; const [moved] = next.splice(from, 1); if (moved) next.splice(to, 0, moved);
    setSequence({ ...currentSequence, steps: next.map((step, index) => ({ ...step, position: index + 1 })) });
  }
  const stats = { total: currentSequence.enrollments.length, active: currentSequence.enrollments.filter((item) => item.status === "active").length, completed: currentSequence.enrollments.filter((item) => item.status === "completed").length, replied: currentSequence.enrollments.filter((item) => item.status === "replied").length };
  const visibleContacts = useMemo(() => (contacts.data ?? []).filter((contact) => `${contact.data.name ?? ""} ${contact.data.email ?? ""}`.toLowerCase().includes(contactSearch.toLowerCase())), [contacts.data, contactSearch]);
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-4 sm:px-6"><div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{currentSequence.name}</h1><p className="mt-1 text-xs text-slate-500">AI-personalized outreach with human-controlled sending.</p></div><button onClick={() => setSettingsOpen(true)} title="Sequence settings" className="grid h-9 w-9 place-items-center rounded-md border border-white/10"><Settings size={15} /></button><button onClick={() => save.mutate(currentSequence)} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm"><Save size={14} /> Save</button></header>
    <div className="flex gap-1 border-b border-white/10 px-4 sm:px-6">{(["steps", "enrollments"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-sm capitalize ${tab === item ? "border-red-500 text-white" : "border-transparent text-slate-500"}`}>{item}</button>)}</div>
    {tab === "steps" ? <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_1fr]">
      <aside className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r"><DndContext sensors={sensors} onDragEnd={reorder}><div className="space-y-2">{currentSequence.steps.map((step) => <StepCard key={step.id} step={step} selected={selectedStepId === step.id} onSelect={() => setSelectedStepId(step.id)} onDelete={() => { const remaining = currentSequence.steps.filter((item) => item.id !== step.id).map((item, index) => ({ ...item, position: index + 1 })); setSequence({ ...currentSequence, steps: remaining }); setSelectedStepId(remaining[0]?.id); }} />)}</div></DndContext><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => addStep("email")} className="flex items-center justify-center gap-1 rounded-md border border-dashed border-white/15 p-3 text-xs text-slate-400"><Mail size={13} /> Email</button><button onClick={() => addStep("task")} className="flex items-center justify-center gap-1 rounded-md border border-dashed border-white/15 p-3 text-xs text-slate-400"><Settings2 size={13} /> Task</button></div></aside>
      <main className="min-w-0 overflow-auto p-4 sm:p-6">{selectedStep ? <div className="mx-auto max-w-3xl"><div className="mb-6 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded bg-red-500/10 text-sm text-red-400">{selectedStep.position}</span><input value={selectedStep.label} onChange={(event) => updateStep({ label: event.target.value })} className="flex-1 bg-transparent text-lg font-semibold outline-none" /></div>{selectedStep.type === "email" ? <EmailEditor step={selectedStep} sequence={currentSequence} update={updateStep} /> : <TaskEditor step={selectedStep} sequence={currentSequence} update={updateStep} />}</div> : <EmptyState icon={Plus} title="No sequence steps" description="Add an email or task step to begin." />}</main>
    </div> : <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl"><div className="mb-5 flex justify-end"><button onClick={() => setEnrollOpen(true)} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm"><Users size={14} /> Enroll people</button></div><div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-6">{[["Total", stats.total], ["Active", stats.active], ["Completed", stats.completed], ["Replied", stats.replied], ["Open rate", "0%"], ["Click rate", "0%"]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/10 p-3"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}</div>{currentSequence.enrollments.length ? <div className="overflow-x-auto rounded-lg border border-white/10"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-white/[.025] text-xs text-slate-500"><tr><th className="p-3">Contact</th><th>Company</th><th>Status</th><th>Current step</th><th>Enrolled</th><th>Last sent</th><th>Actions</th></tr></thead><tbody>{currentSequence.enrollments.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="p-3"><Link to={`/objects/people/${item.node_id}`} className="font-medium hover:text-red-400">{item.contact_name}</Link></td><td className="text-slate-500">{item.company || "—"}</td><td><span className={`rounded-full px-2 py-1 text-[10px] capitalize ${statusStyles[item.status]}`}>{item.status}</span></td><td>{item.current_step}</td><td className="text-slate-500">{new Date(item.enrolled_at).toLocaleDateString()}</td><td className="text-slate-500">{item.last_sent_at ? new Date(item.last_sent_at).toLocaleDateString() : "—"}</td><td><div className="flex gap-2"><button onClick={() => enrollmentAction.mutate({ enrollmentId: item.id, action: item.status === "paused" ? "resume" : "pause" })} className="text-xs text-amber-400">{item.status === "paused" ? "Resume" : "Pause"}</button><button onClick={() => enrollmentAction.mutate({ enrollmentId: item.id, action: "unenroll" })} className="text-xs text-slate-400">Unenroll</button><button onClick={() => enrollmentAction.mutate({ enrollmentId: item.id, action: "remove" })} className="text-xs text-red-400">Remove</button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={Users} title="No contacts enrolled" description="Enroll people when this sequence is ready to run." />}</div></div>}
    {settingsOpen ? <SettingsPanel sequence={currentSequence} update={setSequence} close={() => setSettingsOpen(false)} /> : null}
    {enrollOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5"><div className="flex items-center justify-between"><h2 className="font-medium">Enroll people</h2><button onClick={() => setEnrollOpen(false)}><X size={16} /></button></div><label className="relative mt-4 block"><Search className="absolute left-3 top-2.5 text-slate-600" size={14} /><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm" placeholder="Search contacts" /></label><div className="mt-3 max-h-72 overflow-auto">{visibleContacts.map((contact) => <label key={contact.id} className="flex items-center gap-3 border-b border-white/10 p-3"><input type="checkbox" checked={selectedContacts.includes(contact.id)} onChange={() => setSelectedContacts((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} className="accent-red-500" /><div><p className="text-sm">{String(contact.data.name ?? "Untitled")}</p><p className="text-xs text-slate-600">{String(contact.data.email ?? contact.data.company ?? "")}</p></div></label>)}</div><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEnrollOpen(false)} className="px-3 py-2 text-sm text-slate-500">Cancel</button><button disabled={!selectedContacts.length || enroll.isPending} onClick={() => enroll.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm disabled:opacity-50">Enroll {selectedContacts.length || ""}</button></div></div></div> : null}
  </div>;
}

function SettingsPanel({ sequence, update, close }: { sequence: Sequence; update: (value: Sequence) => void; close: () => void }) {
  const settings = sequence.settings;
  const set = (changes: Partial<SequenceSettings>) => update({ ...sequence, settings: { ...settings, ...changes } });
  return <div className="fixed inset-0 z-50 bg-black/50" onClick={close}><aside onClick={(event) => event.stopPropagation()} className="ml-auto h-full w-full max-w-md overflow-auto border-l border-white/10 bg-[#111419] p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Settings size={15} /><h2 className="font-medium">Sequence settings</h2></div><button onClick={close}><X size={16} /></button></div><div className="mt-6 space-y-5"><label className="block text-xs text-slate-500">Sequence name<input value={sequence.name} onChange={(event) => update({ ...sequence, name: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm" /></label><Toggle label="Stop on reply" checked={settings.stop_on_reply} change={(checked) => set({ stop_on_reply: checked })} /><div><p className="mb-2 text-xs text-slate-500">Sending days</p><div className="flex flex-wrap gap-2">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <button key={day} onClick={() => set({ sending_days: settings.sending_days.includes(day) ? settings.sending_days.filter((item) => item !== day) : [...settings.sending_days, day] })} className={`rounded-md border px-2 py-1 text-xs ${settings.sending_days.includes(day) ? "border-red-500 bg-red-500/10 text-red-300" : "border-white/10 text-slate-500"}`}>{day}</button>)}</div></div><div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-500">From<input type="time" value={settings.send_start} onChange={(event) => set({ send_start: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-transparent px-2" /></label><label className="text-xs text-slate-500">To<input type="time" value={settings.send_end} onChange={(event) => set({ send_end: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-transparent px-2" /></label></div><label className="block text-xs text-slate-500">Daily send limit<input type="number" min="1" value={settings.daily_limit} onChange={(event) => set({ daily_limit: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-transparent px-3" /></label><label className="block text-xs text-slate-500">Timezone<select value={settings.timezone} onChange={(event) => set({ timezone: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3"><option>UTC</option><option>Europe/Warsaw</option><option>America/New_York</option><option>America/Los_Angeles</option><option>Europe/London</option></select></label><Toggle label="Append unsubscribe link" checked={settings.unsubscribe} change={(checked) => set({ unsubscribe: checked })} /></div></aside></div>;
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (value: boolean) => void }) {
  return <label className="flex items-center justify-between text-sm text-slate-300"><span>{label}</span><button type="button" onClick={() => change(!checked)} className={`relative h-5 w-10 rounded-full ${checked ? "bg-red-600" : "bg-white/10"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "left-5" : "left-0.5"}`} /></button></label>;
}

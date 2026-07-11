import { useState, useEffect, useRef } from "react";
import { X, Plus, Check, Trash2, Paperclip, Send, CheckCheck, ChevronDown, Link2, ExternalLink, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { apiClient, apiFetch, getAuthHeaders } from "../../lib/api-client";
import { TaskReviewTab } from "./task-review-tab";
import { friendlyAskError } from "../ai/ask-shared";
import { useAskContextStore } from "../../lib/ask-context-store";
import { AIAgentOwnerChip } from "../ai/ai-intelligence";
import { AIInspector } from "../ai/ai-inspector";
import { GraphContextButton } from "../graph/graph-context-drawer";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task {
  id: string; title: string; labels?: string[]; notes?: string; status?: string; priority?: string;
  assignee_id?: string; reviewer_id?: string; reviewer_name?: string; review_result?: string;
  record_id?: string; due_date?: string;
}
interface ChecklistItem { id: string; text: string; completed: boolean; added_by_name: string; created_at: string; }
interface Comment { id: string; content: string; user_name: string; user_id: string; created_at: string; }
interface Attachment { id: string; file_name: string; file_url: string; file_size: number; user_name: string; }
interface Assignee { id: string; user_id: string; name: string; email: string; permission: string; }
interface Reaction { id: string; emoji: string; user_id: string; user_name: string; }
interface TaskView { user_id: string; user_name: string; viewed_at: string; }
interface LinkedNode { id: string; object_type: string; data: Record<string, unknown>; }

const LABEL_COLORS: Record<string, string> = {
  "Help Needed": "text-[#717784] bg-[#717784]/10 border-[#717784]/25",
  "Blocked":     "text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-400/10 border-stone-200 dark:border-stone-400/30",
  "Waiting":     "text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-400/10 border-stone-200 dark:border-stone-400/30",
  "Bug":         "text-[#9c6b72] dark:text-[#9c6b72] bg-[#9c6b72]/10 dark:bg-[#9c6b72]/10 border-[#9c6b72]/25 dark:border-[#9c6b72]/30",
  "Feature":     "text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-400/10 border-stone-200 dark:border-stone-400/30",
  "Research":    "text-[var(--accent)] dark:text-[var(--accent)] bg-[var(--accent)] dark:bg-[var(--accent)]/10 border-[var(--accent)] dark:border-[var(--accent)]/30",
};
const LABELS = Object.keys(LABEL_COLORS);
const QUICK_EMOJIS = ["👍","❤️","😂","🎉","🔥","👀","😮","😢","🙏","✅","💯","🚀","⚡","🎯","💪","😎","🤔","👏","🥳","😅"];

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Avatar({ name, size = 6 }: { name: string; size?: number }) {
  const colors = ["bg-stone-500/20 text-stone-600 dark:text-stone-400","bg-[#717784]/15 text-[#717784]","bg-[#5f8169]/15 text-[#5f8169]","bg-stone-500/20 text-stone-600 dark:text-stone-400","bg-[#97824f]/15 text-[#97824f]","bg-[var(--accent)]/20 text-[var(--accent)] dark:text-[var(--accent)]"];
  const color = colors[(name.charCodeAt(0) ?? 0) % colors.length];
  const sz = `h-${size} w-${size}`;
  return <div className={`${sz} rounded-full ${color} flex items-center justify-center text-xs font-medium shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

// ── Comment bubble ─────────────────────────────────────────────────────────────
function CommentBubble({ comment, taskId, userId, userName, isLast, views }: {
  comment: Comment; taskId: string; userId: string; userName: string; isLast: boolean; views: TaskView[];
}) {
  const isMe = comment.user_id === userId;
  const [showEmojis, setShowEmojis] = useState(false);

  const reactionsQ = useQuery({
    queryKey: ["reactions", comment.id],
    queryFn: () => apiClient.get<Reaction[]>(`/tasks/${taskId}/comments/${comment.id}/reactions`)
  });
  const toggleReaction = useMutation({
    mutationFn: (emoji: string) => apiClient.post(`/tasks/${taskId}/comments/${comment.id}/reactions`, { emoji, user_name: userName }),
    onSuccess: () => reactionsQ.refetch()
  });

  const reactions = reactionsQ.data ?? [];
  const grouped: Record<string, Reaction[]> = {};
  reactions.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji]!.push(r); });

  const seenByOthers = isLast && isMe ? views.filter(v => v.user_id !== userId) : [];

  const renderContent = (text: string) =>
    text.split(/(@\w[\w\s]*)/g).map((part, i) =>
      part.startsWith("@") ? <span key={i} className="font-medium text-stone-600 dark:text-stone-400">{part}</span> : <span key={i}>{part}</span>
    );

  return (
    <div className={`flex gap-2.5 group ${isMe ? "flex-row-reverse" : ""}`}>
      <div className="shrink-0 mt-0.5">
        <Avatar name={comment.user_name} size={6}/>
      </div>
      <div className={`flex flex-col gap-1 max-w-[78%] ${isMe ? "items-end" : "items-start"}`}>
        {!isMe && <span className="text-[11px] ml-1" style={{ color: "var(--text-muted)" }}>{comment.user_name}</span>}

        <div className={`relative rounded-sm px-3.5 py-2.5 text-sm leading-relaxed border ${isMe ? "rounded-tr-sm" : "rounded-tl-sm"}`}
          style={{ background: isMe ? "var(--surface-hover)" : "var(--surface-card)", borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>
          <p className="whitespace-pre-wrap">{renderContent(comment.content)}</p>
          <span className="text-[10px] mt-0.5 block text-right" style={{ color: "var(--text-faint)" }}>{relTime(comment.created_at)}</span>

          {/* Emoji trigger */}
          <button onClick={() => setShowEmojis(o => !o)}
            className={`absolute top-1.5 ${isMe ? "-left-6" : "-right-6"} opacity-0 group-hover:opacity-100 transition-opacity text-sm`}
            style={{ color: "var(--text-faint)" }}>
            ＋
          </button>
        </div>

        {showEmojis && (
          <div className="dropdown-panel relative flex flex-wrap gap-1 p-2 w-fit max-w-[200px] z-10">
            {QUICK_EMOJIS.map(e => (
              <button key={e} onClick={() => { toggleReaction.mutate(e); setShowEmojis(false); }}
                className="text-sm hover:scale-125 transition-transform p-0.5">{e}</button>
            ))}
          </div>
        )}

        {Object.keys(grouped).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(grouped).map(([emoji, users]) => {
              const iMine = users.some(u => u.user_id === userId);
              return (
                <button key={emoji} onClick={() => toggleReaction.mutate(emoji)} title={users.map(u => u.user_name).join(", ")}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${iMine ? "bg-stone-500/10 border-stone-500/30 text-stone-600 dark:text-stone-400" : ""}`}
                  style={!iMine ? { background: "var(--surface-hover)", borderColor: "var(--border-soft)", color: "var(--text-muted)" } : undefined}>
                  <span>{emoji}</span><span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {seenByOthers.length > 0 && (
          <div className="flex items-center gap-1">
            <CheckCheck size={11} className="text-[#717784]"/>
            <div className="flex">
              {seenByOthers.slice(0, 3).map((v, i) => (
                <div key={v.user_id} title={v.user_name}
                  className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center text-[8px] ${i > 0 ? "-ml-1" : ""}`}
                  style={{ background: "var(--surface-hover)", borderColor: "var(--surface-modal)", color: "var(--text-secondary)" }}>
                  {v.user_name.charAt(0).toUpperCase()}
                </div>
              ))}
              {seenByOthers.length > 3 && <span className="text-[10px] ml-1" style={{ color: "var(--text-faint)" }}>+{seenByOthers.length - 3}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status/Priority pill ───────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; dot: string }> = {
  todo:        { label: "To Do",        dot: "bg-stone-500" },
  in_progress: { label: "In Progress",  dot: "bg-[#717784]" },
  review:      { label: "Review",       dot: "bg-[#97824f]" },
  done:        { label: "Done",         dot: "bg-[#5f8169]" },
};
const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  urgent: { label: "Urgent", dot: "bg-stone-500" },
  high:   { label: "High",   dot: "bg-[#97824f]" },
  medium: { label: "Medium", dot: "bg-[#97824f]" },
  low:    { label: "Low",    dot: "bg-stone-400" },
};

// ── Main panel ─────────────────────────────────────────────────────────────────
export function TaskDetailPanel({ task, members, onClose, onUpdate }: {
  task: Task; members: Member[]; onClose: () => void; onUpdate: () => void;
}) {
  const me = useCurrentUser();
  const userName = me.name || me.email || "Unknown";
  const userId = me.userId || "";

  const [activeTab, setActiveTab] = useState<"labels"|"assignees"|"review"|"checklist"|"comments"|"attachments">("comments");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [localLabels, setLocalLabels] = useState<string[]>(task.labels || []);
  const [localStatus, setLocalStatus] = useState(task.status || "todo");
  const [localPriority, setLocalPriority] = useState(task.priority || "medium");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(task.title);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(task.notes || "");
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const commentsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalLabels(task.labels || []);
    setLocalStatus(task.status || "todo");
    setLocalPriority(task.priority || "medium");
    setTitleVal(task.title);
    setNotesVal(task.notes || "");
    setAiSummary(null);
  }, [task.id]);

  useEffect(() => { apiClient.post(`/tasks/${task.id}/view`, { user_name: userName }).catch((e) => console.error("[bg-task] swallowed error:", e)); }, [task.id]);

  // While this task drawer is open, the right-side Ask AI drawer (rendered
  // once at the layout level) should know what task is in scope — same
  // mechanism every contextual Ask surface uses. Includes status, assignee,
  // and any linked record so "this task"/"create a follow-up from this"
  // resolve without the user restating any of it.
  useEffect(() => {
    const assigneeMember = members.find(m => m.user_id === task.assignee_id);
    useAskContextStore.getState().setContext({
      task_id: task.id,
      task_title: task.title,
      task_status: task.status,
      task_assignee: assigneeMember?.name || assigneeMember?.email,
      task_record_id: task.record_id,
      scope_label: `the task "${task.title}"`,
    });
    return () => useAskContextStore.getState().setContext(null);
  }, [task.id, task.title, task.status, task.assignee_id, task.record_id, members]);

  useEffect(() => {
    // Scroll the comments box itself to the bottom (never the page).
    const el = commentsScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeTab]);

  const checklistQ   = useQuery({ queryKey: ["task-checklist",  task.id], queryFn: () => apiClient.get<ChecklistItem[]>(`/tasks/${task.id}/checklist`) });
  const commentsQ    = useQuery({ queryKey: ["task-comments",   task.id], queryFn: () => apiClient.get<Comment[]>(`/tasks/${task.id}/comments`) });
  const attachmentsQ = useQuery({ queryKey: ["task-attachments",task.id], queryFn: () => apiClient.get<Attachment[]>(`/tasks/${task.id}/attachments`) });
  const assigneesQ   = useQuery({ queryKey: ["task-assignees",  task.id], queryFn: () => apiClient.get<Assignee[]>(`/tasks/${task.id}/assignees`) });
  const viewsQ       = useQuery({ queryKey: ["task-views",      task.id], queryFn: () => apiClient.get<TaskView[]>(`/tasks/${task.id}/views`) });
  const activityQ    = useQuery({ queryKey: ["task-activity",   task.id], queryFn: () => apiClient.get<{id:string;user_name:string;action:string;created_at:string}[]>(`/tasks/${task.id}/activity`) });
  // Linked graph object — only fetched when the task actually has a record_id (real field, not fabricated)
  const linkedNodeQ  = useQuery({
    queryKey: ["task-linked-node", task.record_id],
    queryFn: () => apiClient.get<LinkedNode>(`/nodes/${task.record_id}`),
    enabled: !!task.record_id,
    retry: false,
  });

  const updateLabels    = useMutation({ mutationFn: (labels: string[]) => apiClient.patch(`/tasks/${task.id}/labels`, { labels, _user_name: userName }), onSuccess: () => { onUpdate(); activityQ.refetch(); } });
  const updateTask      = useMutation({ mutationFn: (f: { status?: string; priority?: string; title?: string; notes?: string }) => apiClient.patch(`/tasks/${task.id}`, { ...f, _user_name: userName }), onSuccess: () => { onUpdate(); activityQ.refetch(); } });
  const addAssignee     = useMutation({ mutationFn: (m: Member) => apiClient.post(`/tasks/${task.id}/assignees`, { user_id: m.user_id, email: m.email, name: m.name, permission: "collaborator" }), onSuccess: () => { assigneesQ.refetch(); activityQ.refetch(); } });
  const removeAssignee  = useMutation({ mutationFn: (uid: string) => apiClient.delete(`/tasks/${task.id}/assignees/${uid}`), onSuccess: () => assigneesQ.refetch() });
  const addCheckItem    = useMutation({ mutationFn: () => apiClient.post(`/tasks/${task.id}/checklist`, { text: newCheckItem, added_by_name: userName }), onSuccess: () => { setNewCheckItem(""); checklistQ.refetch(); activityQ.refetch(); } });
  const toggleCheckItem = useMutation({ mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => apiClient.patch(`/tasks/${task.id}/checklist/${itemId}`, { completed, _user_name: userName }), onSuccess: () => { checklistQ.refetch(); activityQ.refetch(); } });
  const deleteCheckItem = useMutation({ mutationFn: (id: string) => apiClient.delete(`/tasks/${task.id}/checklist/${id}`), onSuccess: () => checklistQ.refetch() });
  const addComment      = useMutation({ mutationFn: () => apiClient.post(`/tasks/${task.id}/comments`, { content: newComment, user_name: userName }), onSuccess: () => { setNewComment(""); commentsQ.refetch(); activityQ.refetch(); } });

  const checklist   = checklistQ.data ?? [];
  const comments    = commentsQ.data ?? [];
  const activity    = activityQ.data ?? [];
  const attachments = attachmentsQ.data ?? [];
  const assignees   = assigneesQ.data ?? [];
  const views       = viewsQ.data ?? [];
  const linkedNode  = linkedNodeQ.data;

  const completedCount = checklist.filter(i => i.completed).length;
  const unassignedMembers = members.filter(m => !assignees.find(a => a.user_id === m.user_id));
  const isOwner = !task.assignee_id || task.assignee_id === userId;

  const toggleLabel = (label: string) => {
    const nl = localLabels.includes(label) ? localLabels.filter(l => l !== label) : [...localLabels, label];
    setLocalLabels(nl); updateLabels.mutate(nl);
  };

  const handleCommentInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value; setNewComment(val);
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && val.slice(lastAt).match(/^@\w*$/)) { setShowMentions(true); setMentionSearch(val.slice(lastAt + 1)); }
    else setShowMentions(false);
  };

  const insertMention = (name: string) => {
    const lastAt = newComment.lastIndexOf("@");
    setNewComment(newComment.slice(0, lastAt) + `@${name} `);
    setShowMentions(false); commentRef.current?.focus();
  };

  const mentionMembers = [...members, ...assignees.map(a => ({ user_id: a.user_id, name: a.name, email: a.email, id: a.id }))]
    .filter((m, i, arr) => arr.findIndex(x => x.user_id === m.user_id) === i)
    .filter(m => (m.name || m.email).toLowerCase().includes(mentionSearch.toLowerCase()));

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
      const authHeaders = await getAuthHeaders();
      // Remove Content-Type so browser sets multipart boundary automatically
      const { "Content-Type": _ct, ...uploadHeaders } = authHeaders;
      const fd = new FormData(); fd.append("file", file); fd.append("user_name", userName);
      const res = await apiFetch(`${apiUrl}/api/v1/tasks/${task.id}/upload`, { method: "POST", headers: uploadHeaders, body: fd });
      if (res.ok) attachmentsQ.refetch();
    } catch {} setUploading(false);
  };

  // Real LLM call — summarizes and suggests a next action from the task's
  // actual notes/checklist/comments. Not a fabricated insight: if the call
  // fails, we show the real error, not a fake summary.
  const runAiSummary = async () => {
    setAiSummaryLoading(true);
    setAiSummary(null);
    try {
      const checklistText = checklist.length ? `Checklist: ${checklist.map(c => `${c.completed ? "[x]" : "[ ]"} ${c.text}`).join("; ")}` : "";
      const commentsText = comments.length ? `Recent comments: ${comments.slice(-5).map(c => `${c.user_name}: ${c.content}`).join(" | ")}` : "";
      const prompt = `Summarize this task in 2-3 sentences and suggest one concrete next action. Task: "${task.title}". Notes: ${task.notes || "none"}. ${checklistText} ${commentsText}`;
      const data = await apiClient.post<{ reply?: string }>("/ask", { message: prompt });
      setAiSummary(data.reply || "No summary returned.");
    } catch (err: any) {
      setAiSummary(friendlyAskError(err));
    }
    setAiSummaryLoading(false);
  };

  const smeta = STATUS_META[localStatus] ?? STATUS_META["todo"]!;
  const pmeta = PRIORITY_META[localPriority] ?? PRIORITY_META["medium"]!;

  const tabs = [
    { key: "comments",    label: "Chat",       count: comments.length },
    { key: "checklist",   label: "Checklist",  count: checklist.length ? `${completedCount}/${checklist.length}` : 0 },
    { key: "assignees",   label: "Assignees",  count: assignees.length },
    { key: "labels",      label: "Labels",     count: localLabels.filter(l => LABEL_COLORS[l]).length || 0 },
    { key: "attachments", label: "Files",      count: attachments.length },
    { key: "review",      label: "Review",     count: 0 },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 dark:bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>

      {/* Panel */}
      <div className="surface-modal relative flex w-full max-w-lg flex-col overflow-hidden border-l">

        {/* ── Header ── */}
        <div className="shrink-0 border-b px-5 py-4" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* Title */}
              {editingTitle ? (
                <input autoFocus value={titleVal} onChange={e => setTitleVal(e.target.value)}
                  onBlur={() => { if (titleVal.trim() && titleVal !== task.title) updateTask.mutate({ title: titleVal }); setEditingTitle(false); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") { if (titleVal.trim()) updateTask.mutate({ title: titleVal }); setEditingTitle(false); }
                    if (e.key === "Escape") { setTitleVal(task.title); setEditingTitle(false); }
                  }}
                  className="w-full text-base font-semibold bg-transparent border-b outline-none pb-0.5"
                  style={{ color: "var(--text-primary)", borderColor: "var(--border-strong)" }}/>
              ) : (
                <h2 onClick={() => setEditingTitle(true)}
                  className="text-base font-semibold leading-snug cursor-text transition-colors" title="Click to edit"
                  style={{ color: "var(--text-primary)" }}>
                  {task.title}
                </h2>
              )}

              {/* Linked graph object — real record_id only, never fabricated */}
              {task.record_id && (
                linkedNode ? (
                  <a href={`/objects/${linkedNode.object_type}/${linkedNode.id}`}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors surface-hover"
                    style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                    <Link2 size={10} className="text-stone-500 dark:text-stone-400"/>
                    {String(linkedNode.data?.name ?? linkedNode.data?.title ?? "Linked object")}
                    <span className="text-[9px] uppercase" style={{ color: "var(--text-faint)" }}>{linkedNode.object_type}</span>
                    <ExternalLink size={9} style={{ color: "var(--text-faint)" }}/>
                  </a>
                ) : linkedNodeQ.isLoading ? (
                  <div className="skeleton-shimmer mt-2 h-5 w-32 rounded-full"/>
                ) : null
              )}

              {/* AI Inspector (interpretation) + Graph Context Drawer trigger (connected context) */}
              {(() => {
                const taskCtx = {
                  kind: "task" as const,
                  id: task.id,
                  title: task.title,
                  objectType: "task",
                  data: { status: localStatus, priority: localPriority, due_date: task.due_date, notes: notesVal },
                  updatedAt: task.due_date ?? null,
                  scopeLabel: `the task "${task.title}"`,
                };
                return (
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-end">
                      <GraphContextButton ctx={taskCtx} />
                    </div>
                    <AIInspector ctx={taskCtx} defaultOpen={false} />
                  </div>
                );
              })()}

              {/* Notes — first-class, not a hidden one-liner */}
              <div className="mt-3 rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Notes</p>
                {editingNotes ? (
                  <textarea autoFocus value={notesVal} onChange={e => setNotesVal(e.target.value)}
                    onBlur={() => { updateTask.mutate({ notes: notesVal }); setEditingNotes(false); }}
                    rows={3} className="w-full text-sm bg-transparent outline-none resize-none"
                    style={{ color: "var(--text-secondary)" }}/>
                ) : (
                  <p onClick={() => setEditingNotes(true)} className="text-sm min-h-[18px] cursor-text leading-relaxed"
                    style={{ color: task.notes ? "var(--text-secondary)" : "var(--text-faint)" }}>
                    {task.notes || "Add notes…"}
                  </p>
                )}
              </div>

              {/* AI summary — real LLM call against this task's actual content */}
              <div className="mt-3 rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(124,58,237,0.20)", background: "rgba(124,58,237,0.04)" }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-stone-600 dark:text-stone-400">
                    <LogoMark size={10}/> AI summary
                  </span>
                  <button onClick={runAiSummary} disabled={aiSummaryLoading} className="btn-ai px-2 py-0.5 text-[11px]">
                    {aiSummaryLoading ? <Loader2 size={11} className="animate-spin"/> : <LogoMark size={11}/>}
                    {aiSummary ? "Refresh" : "Summarize"}
                  </button>
                </div>
                <div className="mt-1.5"><AIAgentOwnerChip objectType="task"/></div>
                {aiSummary && (
                  <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{aiSummary}</p>
                )}
                {!aiSummary && !aiSummaryLoading && (
                  <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--text-faint)" }}>Get a summary and a suggested next action from the task's notes, checklist, and conversation.</p>
                )}
              </div>

              {/* Status + Priority pills */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {/* Status */}
                <div className="relative">
                  {statusOpen && <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)}/>}
                  <button onClick={() => { setStatusOpen(o => !o); setPriorityOpen(false); }}
                    className="flex items-center gap-1.5 h-6 rounded-sm border px-2.5 text-[11px] font-medium transition-colors"
                    style={{ borderColor: "var(--border-strong)", background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${smeta.dot}`}/>{smeta.label}
                    <ChevronDown size={10} style={{ color: "var(--text-faint)" }}/>
                  </button>
                  {statusOpen && (
                    <div className="dropdown-panel left-0 w-40 z-50">
                      {Object.entries(STATUS_META).map(([val, meta]) => (
                        <button key={val} onClick={() => { setLocalStatus(val); updateTask.mutate({ status: val }); setStatusOpen(false); }}
                          className={`dropdown-item ${localStatus === val ? "dropdown-item-active" : ""}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`}/>{meta.label}
                          {localStatus === val && <Check size={11} className="ml-auto text-stone-600 dark:text-stone-400"/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Priority */}
                <div className="relative">
                  {priorityOpen && <div className="fixed inset-0 z-40" onClick={() => setPriorityOpen(false)}/>}
                  <button onClick={() => { setPriorityOpen(o => !o); setStatusOpen(false); }}
                    className="flex items-center gap-1.5 h-6 rounded-sm border px-2.5 text-[11px] font-medium transition-colors"
                    style={{ borderColor: "var(--border-strong)", background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${pmeta.dot}`}/>{pmeta.label}
                    <ChevronDown size={10} style={{ color: "var(--text-faint)" }}/>
                  </button>
                  {priorityOpen && (
                    <div className="dropdown-panel left-0 w-36 z-50">
                      {Object.entries(PRIORITY_META).map(([val, meta]) => (
                        <button key={val} onClick={() => { setLocalPriority(val); updateTask.mutate({ priority: val }); setPriorityOpen(false); }}
                          className={`dropdown-item ${localPriority === val ? "dropdown-item-active" : ""}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`}/>{meta.label}
                          {localPriority === val && <Check size={11} className="ml-auto text-stone-600 dark:text-stone-400"/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Review shortcut */}
                <button onClick={() => setActiveTab("review")}
                  className="h-6 rounded-sm border px-2.5 text-[11px] font-medium transition-colors"
                  style={
                    task.review_result === "approved"          ? { borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#10b981" } :
                    task.review_result === "changes_requested" ? { borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#d97706" } :
                    localStatus === "review"                   ? { borderColor: "rgba(234,179,8,0.3)", background: "rgba(234,179,8,0.1)", color: "#ca8a04" } :
                    { borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-muted)" }
                  }>
                  {task.review_result === "approved" ? "✓ Approved" : task.review_result === "changes_requested" ? "↩ Changes" : localStatus === "review" ? "⏳ In Review" : "Send for review"}
                </button>

                {/* Labels preview */}
                {localLabels.filter(l => LABEL_COLORS[l]).length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {localLabels.filter(l => LABEL_COLORS[l]).map(l => (
                      <span key={l} className={`h-6 flex items-center rounded-full border px-2 text-[11px] font-medium ${LABEL_COLORS[l]}`}>{l}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Seen by */}
              {(() => {
                const others = views.filter(v => v.user_id !== userId);
                if (!others.length) return null;
                return (
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <div className="flex">
                      {others.slice(0, 5).map((v, i) => (
                        <div key={v.user_id} title={v.user_name}
                          className={`h-4 w-4 rounded-full border flex items-center justify-center text-[8px] font-medium ${i > 0 ? "-ml-1" : ""}`}
                          style={{ background: "var(--surface-hover)", borderColor: "var(--surface-modal)", color: "var(--text-secondary)" }}>
                          {v.user_name.charAt(0).toUpperCase()}
                        </div>
                      ))}
                      {others.length > 5 && <div className="-ml-1 h-4 w-4 rounded-full border flex items-center justify-center text-[8px]" style={{ background: "var(--surface-hover)", borderColor: "var(--surface-modal)", color: "var(--text-secondary)" }}>+{others.length-5}</div>}
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Seen by {others.length === 1 ? (others[0]?.user_name ?? "") : `${others.length} people`}</span>
                  </div>
                );
              })()}
            </div>
            <button onClick={onClose} className="btn-icon shrink-0 mt-0.5"><X size={16}/></button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="shrink-0 flex border-b overflow-x-auto px-1" style={{ borderColor: "var(--border-soft)", scrollbarWidth: "none" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium border-b-2 transition-colors"
              style={{
                borderColor: activeTab === t.key ? "var(--accent)" : "transparent",
                color: activeTab === t.key ? "var(--text-primary)" : "var(--text-faint)",
              }}>
              {t.label}
              {t.count ? <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{t.count}</span> : null}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-auto">

          {/* Comments */}
          {activeTab === "comments" && (
            <div className="flex flex-col h-full">
              <div ref={commentsScrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-4" style={{ overflowAnchor: "none" }}>
                {comments.length === 0 && activity.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>No messages yet</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>Start the conversation below.</p>
                  </div>
                )}
                {(() => {
                  const items = [
                    ...comments.map(c => ({ type: "comment" as const, date: c.created_at, data: c })),
                    ...activity.map(a => ({ type: "activity" as const, date: a.created_at, data: a }))
                  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                  return items.map((item, i) => {
                    if (item.type === "activity") {
                      return (
                        <div key={(item.data as any).id ?? i} className="flex items-center gap-2 py-0.5">
                          <div className="h-px flex-1" style={{ background: "var(--border-soft)" }}/>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--text-faint)" }}>
                            <span style={{ color: "var(--text-muted)" }}>{(item.data as any).user_name}</span> {(item.data as any).action} · {relTime((item.data as any).created_at)}
                          </span>
                          <div className="h-px flex-1" style={{ background: "var(--border-soft)" }}/>
                        </div>
                      );
                    }
                    const c = item.data as Comment;
                    const isLast = i === items.length - 1 || items.slice(i+1).every(x => x.type === "activity");
                    return <CommentBubble key={c.id} comment={c} taskId={task.id} userId={userId} userName={userName} isLast={isLast} views={views}/>;
                  });
                })()}
                <div ref={messagesEndRef}/>
              </div>

              {/* Input */}
              <div className="surface-modal shrink-0 border-t px-4 py-3 relative" style={{ borderColor: "var(--border-soft)" }}>
                {showMentions && mentionMembers.length > 0 && (
                  <div className="dropdown-panel absolute bottom-full left-4 right-4 mb-1 z-10">
                    {mentionMembers.slice(0, 5).map(m => (
                      <button key={m.user_id} onClick={() => insertMention(m.name || m.email)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors surface-hover"
                        style={{ color: "var(--text-secondary)" }}>
                        <Avatar name={m.name || m.email} size={6}/>{m.name || m.email}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea ref={commentRef} value={newComment} onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }}
                    placeholder="Message… @ to mention" rows={1}
                    className="key-input flex-1 rounded-sm px-4 py-2.5 text-sm resize-none max-h-32"/>
                  <button onClick={() => newComment.trim() && addComment.mutate()} disabled={!newComment.trim()}
                    className="btn-primary h-9 w-9 shrink-0 rounded-sm !px-0">
                    <Send size={13}/>
                  </button>
                </div>
                <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--text-faint)" }}>Enter to send · Shift+Enter new line · @ mention</p>
              </div>
            </div>
          )}

          {/* Checklist */}
          {activeTab === "checklist" && (
            <div className="px-4 py-4">
              {checklist.length > 0 && (
                <div className="surface-card mb-4 rounded-sm p-3">
                  <div className="flex justify-between mb-2 text-xs">
                    <span style={{ color: "var(--text-muted)" }}>{completedCount} of {checklist.length} done</span>
                    <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{Math.round(checklist.length ? (completedCount/checklist.length)*100 : 0)}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full" style={{ background: "var(--surface-hover)" }}>
                    <div className="h-1 rounded-full bg-[#5f8169] transition-all" style={{ width: `${checklist.length ? (completedCount/checklist.length)*100 : 0}%` }}/>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 mb-4">
                {checklist.length === 0 && <p className="text-sm text-center py-8" style={{ color: "var(--text-faint)" }}>No checklist items yet</p>}
                {checklist.map(item => (
                  <div key={item.id} className="flex items-start gap-3 group rounded-sm px-3 py-2.5 transition-colors border border-transparent surface-hover">
                    <button onClick={() => toggleCheckItem.mutate({ itemId: item.id, completed: !item.completed })}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors"
                      style={item.completed ? { borderColor: "#10b981", background: "#10b981" } : { borderColor: "var(--border-strong)" }}>
                      {item.completed && <Check size={9} className="text-[var(--text-primary)]"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: item.completed ? "var(--text-faint)" : "var(--text-secondary)", textDecoration: item.completed ? "line-through" : undefined }}>{item.text}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>{item.added_by_name} · {new Date(item.created_at).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => deleteCheckItem.mutate(item.id)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 transition-all hover:text-stone-600 dark:hover:text-stone-400"
                      style={{ color: "var(--text-faint)" }}>
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && newCheckItem.trim() && addCheckItem.mutate()}
                  placeholder="Add item… Enter to save"
                  className="key-input flex-1 h-9 px-3 text-sm"/>
                <button onClick={() => newCheckItem.trim() && addCheckItem.mutate()} disabled={!newCheckItem.trim()}
                  className="btn-primary h-9 w-9 shrink-0 rounded-sm !px-0">
                  <Plus size={14}/>
                </button>
              </div>
            </div>
          )}

          {/* Assignees */}
          {activeTab === "assignees" && (
            <div className="px-4 py-4 space-y-4">
              {assignees.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-faint)" }}>Assigned</p>
                  <div className="space-y-1.5">
                    {assignees.map(a => (
                      <div key={a.user_id} className="surface-card flex items-center gap-3 rounded-sm px-3 py-2.5">
                        <Avatar name={a.name || a.email}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{a.name || a.email}</p>
                          <p className="text-[11px] capitalize" style={{ color: "var(--text-muted)" }}>{a.permission}</p>
                        </div>
                        {isOwner && (
                          <button onClick={() => removeAssignee.mutate(a.user_id)}
                            className="transition-colors hover:text-stone-600 dark:hover:text-stone-400" style={{ color: "var(--text-faint)" }}><X size={13}/></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unassignedMembers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-faint)" }}>Add collaborator</p>
                  <div className="space-y-1">
                    {unassignedMembers.map(m => (
                      <div key={m.user_id} className="flex items-center gap-3 rounded-sm px-3 py-2 transition-colors surface-hover">
                        <Avatar name={m.name || m.email}/>
                        <span className="flex-1 text-sm truncate" style={{ color: "var(--text-secondary)" }}>{m.name || m.email}</span>
                        <button onClick={() => addAssignee.mutate(m)} className="btn-secondary px-2.5 py-1 text-xs">
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unassignedMembers.length === 0 && assignees.length === 0 && (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-faint)" }}>No workspace members yet.</p>
              )}
            </div>
          )}

          {/* Labels */}
          {activeTab === "labels" && (
            <div className="px-4 py-4">
              <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Click a label to toggle it on or off.</p>
              <div className="space-y-1.5">
                {LABELS.map(label => {
                  const active = localLabels.includes(label);
                  return (
                    <button key={label} onClick={() => toggleLabel(label)}
                      className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm transition-colors border ${active ? LABEL_COLORS[label] : ""}`}
                      style={!active ? { borderColor: "var(--border-soft)", color: "var(--text-muted)", background: "var(--surface-card)" } : undefined}>
                      <div className="h-4 w-4 rounded border flex items-center justify-center shrink-0" style={{ borderColor: active ? "currentColor" : "var(--border-strong)" }}>
                        {active && <Check size={10}/>}
                      </div>
                      <span className="flex-1 text-left">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attachments */}
          {activeTab === "attachments" && (
            <div className="px-4 py-4">
              {attachments.length === 0 && (
                <p className="text-sm text-center py-6" style={{ color: "var(--text-faint)" }}>No attachments yet</p>
              )}
              <div className="space-y-2 mb-4">
                {attachments.map(a => (
                  <div key={a.id} className="surface-card flex items-center gap-3 rounded-sm px-3 py-2.5 group">
                    <Paperclip size={13} className="shrink-0" style={{ color: "var(--text-muted)" }}/>
                    <div className="flex-1 min-w-0">
                      {/\.(jpg|jpeg|png|gif|webp)$/i.test(a.file_name) && (
                        <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                          <img src={a.file_url} alt={a.file_name} className="rounded-lg max-h-32 object-cover mb-1"/>
                        </a>
                      )}
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-[#717784] hover:underline truncate block transition-colors">{a.file_name}</a>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>{a.user_name} · {a.file_size > 0 ? `${(a.file_size/1024).toFixed(1)} KB` : "link"}</p>
                    </div>
                    <button onClick={() => apiClient.delete(`/tasks/${task.id}/attachments/${a.id}`).then(() => attachmentsQ.refetch())}
                      className="opacity-0 group-hover:opacity-100 transition-all shrink-0 hover:text-stone-600 dark:hover:text-stone-400"
                      style={{ color: "var(--text-faint)" }}>
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
              <label className="flex flex-col items-center justify-center rounded-sm border border-dashed px-4 py-8 cursor-pointer transition-colors"
                style={uploading ? { borderColor: "var(--border-soft)", opacity: 0.5 } : { borderColor: "var(--border-strong)" }}>
                <Paperclip size={18} className="mb-2" style={{ color: "var(--text-faint)" }}/>
                <p className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{uploading ? "Uploading…" : "Upload a file"}</p>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>Click to choose · images, PDFs, docs</p>
                <input type="file" className="hidden" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}/>
              </label>
            </div>
          )}

          {/* Review */}
          {activeTab === "review" && (
            <div className="px-4 py-4">
              <TaskReviewTab task={task} members={members} onUpdate={() => { onUpdate(); activityQ.refetch(); commentsQ.refetch(); }}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { X, Plus, Check, Trash2, Paperclip, Send, CheckCheck, ChevronDown } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { apiClient, getAuthHeaders } from "../../lib/api-client";
import { TaskReviewTab } from "./task-review-tab";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task { id: string; title: string; labels?: string[]; notes?: string; status?: string; priority?: string; assignee_id?: string; reviewer_id?: string; reviewer_name?: string; review_result?: string; }
interface ChecklistItem { id: string; text: string; completed: boolean; added_by_name: string; created_at: string; }
interface Comment { id: string; content: string; user_name: string; user_id: string; created_at: string; }
interface Attachment { id: string; file_name: string; file_url: string; file_size: number; user_name: string; }
interface Assignee { id: string; user_id: string; name: string; email: string; permission: string; }
interface Reaction { id: string; emoji: string; user_id: string; user_name: string; }
interface TaskView { user_id: string; user_name: string; viewed_at: string; }

const LABEL_COLORS: Record<string, string> = {
  "Help Needed": "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "Blocked":     "text-red-400 bg-red-400/10 border-red-400/30",
  "Waiting":     "text-slate-400 bg-slate-400/10 border-slate-400/30",
  "Bug":         "text-red-500 bg-red-500/10 border-red-500/30",
  "Feature":     "text-purple-400 bg-purple-400/10 border-purple-400/30",
  "Research":    "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
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
  const colors = ["bg-red-500/20 text-red-400","bg-blue-500/20 text-blue-400","bg-emerald-500/20 text-emerald-400","bg-purple-500/20 text-purple-400","bg-amber-500/20 text-amber-400","bg-cyan-500/20 text-cyan-400"];
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
      part.startsWith("@") ? <span key={i} className="font-medium text-red-400">{part}</span> : <span key={i}>{part}</span>
    );

  return (
    <div className={`flex gap-2.5 group ${isMe ? "flex-row-reverse" : ""}`}>
      <div className="shrink-0 mt-0.5">
        <Avatar name={comment.user_name} size={6}/>
      </div>
      <div className={`flex flex-col gap-1 max-w-[78%] ${isMe ? "items-end" : "items-start"}`}>
        {!isMe && <span className="text-[11px] text-slate-500 ml-1">{comment.user_name}</span>}

        <div className={`relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed border ${isMe ? "bg-white/[.05] border-white/[.09] text-slate-100 rounded-tr-sm" : "bg-white/[.03] border-white/[.06] text-slate-200 rounded-tl-sm"}`}>
          <p className="whitespace-pre-wrap">{renderContent(comment.content)}</p>
          <span className="text-[10px] text-slate-600 mt-0.5 block text-right">{relTime(comment.created_at)}</span>

          {/* Emoji trigger */}
          <button onClick={() => setShowEmojis(o => !o)}
            className={`absolute top-1.5 ${isMe ? "-left-6" : "-right-6"} opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-300 text-sm`}>
            ＋
          </button>
        </div>

        {showEmojis && (
          <div className="flex flex-wrap gap-1 p-2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-fit max-w-[200px] z-10">
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
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${iMine ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-white/[.04] border-white/10 text-slate-400 hover:border-white/20"}`}>
                  <span>{emoji}</span><span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {seenByOthers.length > 0 && (
          <div className="flex items-center gap-1">
            <CheckCheck size={11} className="text-blue-400"/>
            <div className="flex">
              {seenByOthers.slice(0, 3).map((v, i) => (
                <div key={v.user_id} title={v.user_name}
                  className={`h-3.5 w-3.5 rounded-full bg-slate-600 border border-[#0d0f13] flex items-center justify-center text-[8px] text-slate-300 ${i > 0 ? "-ml-1" : ""}`}>
                  {v.user_name.charAt(0).toUpperCase()}
                </div>
              ))}
              {seenByOthers.length > 3 && <span className="text-[10px] text-slate-600 ml-1">+{seenByOthers.length - 3}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status/Priority pill ───────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; dot: string }> = {
  todo:        { label: "To Do",        dot: "bg-slate-500" },
  in_progress: { label: "In Progress",  dot: "bg-blue-400" },
  review:      { label: "Review",       dot: "bg-yellow-400" },
  done:        { label: "Done",         dot: "bg-emerald-400" },
};
const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  urgent: { label: "Urgent", dot: "bg-red-500" },
  high:   { label: "High",   dot: "bg-orange-400" },
  medium: { label: "Medium", dot: "bg-yellow-400" },
  low:    { label: "Low",    dot: "bg-slate-400" },
};

// ── Main panel ─────────────────────────────────────────────────────────────────
export function TaskDetailPanel({ task, members, onClose, onUpdate }: {
  task: Task; members: Member[]; onClose: () => void; onUpdate: () => void;
}) {
  const { user } = useUser();
  const userName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Unknown";
  const userId = user?.id || "";

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
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalLabels(task.labels || []);
    setLocalStatus(task.status || "todo");
    setLocalPriority(task.priority || "medium");
    setTitleVal(task.title);
    setNotesVal(task.notes || "");
  }, [task.id]);

  useEffect(() => { apiClient.post(`/tasks/${task.id}/view`, { user_name: userName }).catch(() => {}); }, [task.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTab]);

  const checklistQ   = useQuery({ queryKey: ["task-checklist",  task.id], queryFn: () => apiClient.get<ChecklistItem[]>(`/tasks/${task.id}/checklist`) });
  const commentsQ    = useQuery({ queryKey: ["task-comments",   task.id], queryFn: () => apiClient.get<Comment[]>(`/tasks/${task.id}/comments`) });
  const attachmentsQ = useQuery({ queryKey: ["task-attachments",task.id], queryFn: () => apiClient.get<Attachment[]>(`/tasks/${task.id}/attachments`) });
  const assigneesQ   = useQuery({ queryKey: ["task-assignees",  task.id], queryFn: () => apiClient.get<Assignee[]>(`/tasks/${task.id}/assignees`) });
  const viewsQ       = useQuery({ queryKey: ["task-views",      task.id], queryFn: () => apiClient.get<TaskView[]>(`/tasks/${task.id}/views`) });
  const activityQ    = useQuery({ queryKey: ["task-activity",   task.id], queryFn: () => apiClient.get<{id:string;user_name:string;action:string;created_at:string}[]>(`/tasks/${task.id}/activity`) });

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
      const res = await fetch(`${apiUrl}/api/v1/tasks/${task.id}/upload`, { method: "POST", headers: uploadHeaders, body: fd });
      if (res.ok) attachmentsQ.refetch();
    } catch {} setUploading(false);
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
      <div className="flex-1 bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>

      {/* Panel */}
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden border-l border-white/[.08] bg-[#0d0f13]">

        {/* ── Header ── */}
        <div className="shrink-0 border-b border-white/[.06] px-5 py-4">
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
                  className="w-full text-base font-semibold text-white bg-transparent border-b border-white/20 outline-none pb-0.5"/>
              ) : (
                <h2 onClick={() => setEditingTitle(true)}
                  className="text-base font-semibold text-white leading-snug cursor-text hover:text-slate-200 transition-colors" title="Click to edit">
                  {task.title}
                </h2>
              )}

              {/* Notes */}
              {editingNotes ? (
                <textarea autoFocus value={notesVal} onChange={e => setNotesVal(e.target.value)}
                  onBlur={() => { updateTask.mutate({ notes: notesVal }); setEditingNotes(false); }}
                  rows={2} className="mt-1.5 w-full text-xs text-slate-400 bg-transparent border-b border-white/10 outline-none resize-none"/>
              ) : (
                <p onClick={() => setEditingNotes(true)} className="mt-1.5 text-xs min-h-[14px] cursor-text">
                  {task.notes ? <span className="text-slate-500">{task.notes}</span> : <span className="text-slate-700 hover:text-slate-500 transition-colors">Add notes…</span>}
                </p>
              )}

              {/* Status + Priority pills */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {/* Status */}
                <div className="relative">
                  {statusOpen && <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)}/>}
                  <button onClick={() => { setStatusOpen(o => !o); setPriorityOpen(false); }}
                    className="flex items-center gap-1.5 h-6 rounded-full border border-white/[.09] bg-white/[.04] px-2.5 text-[11px] font-medium text-slate-300 hover:border-white/[.16] transition-colors">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${smeta.dot}`}/>{smeta.label}
                    <ChevronDown size={10} className="text-slate-600"/>
                  </button>
                  {statusOpen && (
                    <div className="dropdown-panel left-0 w-40 z-50">
                      {Object.entries(STATUS_META).map(([val, meta]) => (
                        <button key={val} onClick={() => { setLocalStatus(val); updateTask.mutate({ status: val }); setStatusOpen(false); }}
                          className={`dropdown-item ${localStatus === val ? "dropdown-item-active" : ""}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`}/>{meta.label}
                          {localStatus === val && <Check size={11} className="ml-auto text-red-400"/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Priority */}
                <div className="relative">
                  {priorityOpen && <div className="fixed inset-0 z-40" onClick={() => setPriorityOpen(false)}/>}
                  <button onClick={() => { setPriorityOpen(o => !o); setStatusOpen(false); }}
                    className="flex items-center gap-1.5 h-6 rounded-full border border-white/[.09] bg-white/[.04] px-2.5 text-[11px] font-medium text-slate-300 hover:border-white/[.16] transition-colors">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${pmeta.dot}`}/>{pmeta.label}
                    <ChevronDown size={10} className="text-slate-600"/>
                  </button>
                  {priorityOpen && (
                    <div className="dropdown-panel left-0 w-36 z-50">
                      {Object.entries(PRIORITY_META).map(([val, meta]) => (
                        <button key={val} onClick={() => { setLocalPriority(val); updateTask.mutate({ priority: val }); setPriorityOpen(false); }}
                          className={`dropdown-item ${localPriority === val ? "dropdown-item-active" : ""}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`}/>{meta.label}
                          {localPriority === val && <Check size={11} className="ml-auto text-red-400"/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Review shortcut */}
                <button onClick={() => setActiveTab("review")}
                  className={`h-6 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                    task.review_result === "approved"          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                    task.review_result === "changes_requested" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" :
                    localStatus === "review"                   ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" :
                    "border-white/[.09] bg-white/[.03] text-slate-500 hover:text-slate-300 hover:border-white/[.16]"
                  }`}>
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
                          className={`h-4 w-4 rounded-full bg-slate-700 border border-[#0d0f13] flex items-center justify-center text-[8px] font-medium text-slate-300 ${i > 0 ? "-ml-1" : ""}`}>
                          {v.user_name.charAt(0).toUpperCase()}
                        </div>
                      ))}
                      {others.length > 5 && <div className="-ml-1 h-4 w-4 rounded-full bg-slate-600 border border-[#0d0f13] flex items-center justify-center text-[8px] text-slate-300">+{others.length-5}</div>}
                    </div>
                    <span className="text-[11px] text-slate-600">Seen by {others.length === 1 ? (others[0]?.user_name ?? "") : `${others.length} people`}</span>
                  </div>
                );
              })()}
            </div>
            <button onClick={onClose} className="shrink-0 mt-0.5 text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="shrink-0 flex border-b border-white/[.06] overflow-x-auto px-1" style={{ scrollbarWidth: "none" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === t.key ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
              {t.label}
              {t.count ? <span className="rounded-full bg-white/[.07] px-1.5 py-0.5 text-[10px] text-slate-500">{t.count}</span> : null}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-auto">

          {/* Comments */}
          {activeTab === "comments" && (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
                {comments.length === 0 && activity.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-slate-600">No messages yet</p>
                    <p className="text-xs text-slate-700 mt-1">Start the conversation below.</p>
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
                          <div className="h-px flex-1 bg-white/[.04]"/>
                          <span className="text-[10px] text-slate-700 shrink-0">
                            <span className="text-slate-600">{(item.data as any).user_name}</span> {(item.data as any).action} · {relTime((item.data as any).created_at)}
                          </span>
                          <div className="h-px flex-1 bg-white/[.04]"/>
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
              <div className="shrink-0 border-t border-white/[.06] px-4 py-3 bg-[#0d0f13] relative">
                {showMentions && mentionMembers.length > 0 && (
                  <div className="absolute bottom-full left-4 right-4 mb-1 rounded-xl border border-white/[.08] bg-[#13151a] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden z-10">
                    {mentionMembers.slice(0, 5).map(m => (
                      <button key={m.user_id} onClick={() => insertMention(m.name || m.email)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-white/[.05] transition-colors">
                        <Avatar name={m.name || m.email} size={6}/>{m.name || m.email}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea ref={commentRef} value={newComment} onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }}
                    placeholder="Message… @ to mention" rows={1}
                    className="flex-1 rounded-2xl border border-white/[.08] bg-white/[.03] px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/[.15] transition-colors max-h-32"/>
                  <button onClick={() => newComment.trim() && addComment.mutate()} disabled={!newComment.trim()}
                    className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all ${newComment.trim() ? "bg-red-600 text-white hover:bg-red-500" : "bg-white/[.04] text-slate-600"}`}>
                    <Send size={13}/>
                  </button>
                </div>
                <p className="text-[10px] text-slate-700 mt-1.5 text-center">Enter to send · Shift+Enter new line · @ mention</p>
              </div>
            </div>
          )}

          {/* Checklist */}
          {activeTab === "checklist" && (
            <div className="px-4 py-4">
              {checklist.length > 0 && (
                <div className="mb-4 rounded-xl border border-white/[.07] bg-white/[.02] p-3">
                  <div className="flex justify-between mb-2 text-xs">
                    <span className="text-slate-400">{completedCount} of {checklist.length} done</span>
                    <span className="text-slate-500 font-medium">{Math.round(checklist.length ? (completedCount/checklist.length)*100 : 0)}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[.06]">
                    <div className="h-1 rounded-full bg-emerald-500 transition-all" style={{ width: `${checklist.length ? (completedCount/checklist.length)*100 : 0}%` }}/>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 mb-4">
                {checklist.length === 0 && <p className="text-sm text-slate-600 text-center py-8">No checklist items yet</p>}
                {checklist.map(item => (
                  <div key={item.id} className="flex items-start gap-3 group rounded-xl px-3 py-2.5 hover:bg-white/[.02] transition-colors border border-transparent hover:border-white/[.05]">
                    <button onClick={() => toggleCheckItem.mutate({ itemId: item.id, completed: !item.completed })}
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${item.completed ? "border-emerald-500 bg-emerald-500" : "border-white/20 hover:border-white/40"}`}>
                      {item.completed && <Check size={9} className="text-white"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${item.completed ? "line-through text-slate-600" : "text-slate-200"}`}>{item.text}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{item.added_by_name} · {new Date(item.created_at).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => deleteCheckItem.mutate(item.id)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 text-slate-700 hover:text-red-400 transition-all">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && newCheckItem.trim() && addCheckItem.mutate()}
                  placeholder="Add item… Enter to save"
                  className="flex-1 h-9 rounded-xl border border-white/[.08] bg-white/[.03] px-3 text-sm text-white placeholder-slate-600 outline-none focus:border-white/[.15] transition-colors"/>
                <button onClick={() => newCheckItem.trim() && addCheckItem.mutate()} disabled={!newCheckItem.trim()}
                  className="h-9 w-9 rounded-xl bg-red-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-red-500 transition-colors shrink-0">
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-2">Assigned</p>
                  <div className="space-y-1.5">
                    {assignees.map(a => (
                      <div key={a.user_id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5">
                        <Avatar name={a.name || a.email}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{a.name || a.email}</p>
                          <p className="text-[11px] text-slate-500 capitalize">{a.permission}</p>
                        </div>
                        {isOwner && (
                          <button onClick={() => removeAssignee.mutate(a.user_id)}
                            className="text-slate-600 hover:text-red-400 transition-colors"><X size={13}/></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unassignedMembers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-2">Add collaborator</p>
                  <div className="space-y-1">
                    {unassignedMembers.map(m => (
                      <div key={m.user_id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[.02] transition-colors">
                        <Avatar name={m.name || m.email}/>
                        <span className="flex-1 text-sm text-slate-300 truncate">{m.name || m.email}</span>
                        <button onClick={() => addAssignee.mutate(m)}
                          className="rounded-lg border border-white/[.08] px-2.5 py-1 text-xs text-slate-400 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unassignedMembers.length === 0 && assignees.length === 0 && (
                <p className="text-sm text-slate-600 text-center py-8">No workspace members yet.</p>
              )}
            </div>
          )}

          {/* Labels */}
          {activeTab === "labels" && (
            <div className="px-4 py-4">
              <p className="text-xs text-slate-500 mb-4">Click a label to toggle it on or off.</p>
              <div className="space-y-1.5">
                {LABELS.map(label => {
                  const active = localLabels.includes(label);
                  return (
                    <button key={label} onClick={() => toggleLabel(label)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors border ${active ? LABEL_COLORS[label] : "border-white/[.06] text-slate-400 hover:border-white/[.10] hover:text-white bg-white/[.01]"}`}>
                      <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${active ? "border-current" : "border-white/20"}`}>
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
                <p className="text-sm text-slate-600 text-center py-6">No attachments yet</p>
              )}
              <div className="space-y-2 mb-4">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5 group">
                    <Paperclip size={13} className="text-slate-500 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      {/\.(jpg|jpeg|png|gif|webp)$/i.test(a.file_name) && (
                        <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                          <img src={a.file_url} alt={a.file_name} className="rounded-lg max-h-32 object-cover mb-1"/>
                        </a>
                      )}
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300 hover:underline truncate block transition-colors">{a.file_name}</a>
                      <p className="text-[11px] text-slate-600 mt-0.5">{a.user_name} · {a.file_size > 0 ? `${(a.file_size/1024).toFixed(1)} KB` : "link"}</p>
                    </div>
                    <button onClick={() => apiClient.delete(`/tasks/${task.id}/attachments/${a.id}`).then(() => attachmentsQ.refetch())}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all shrink-0">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
              <label className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 cursor-pointer transition-colors ${uploading ? "border-white/[.06] opacity-50" : "border-white/[.09] hover:border-white/[.18] hover:bg-white/[.02]"}`}>
                <Paperclip size={18} className="text-slate-600 mb-2"/>
                <p className="text-sm text-slate-400 mb-1">{uploading ? "Uploading…" : "Upload a file"}</p>
                <p className="text-xs text-slate-600">Click to choose · images, PDFs, docs</p>
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

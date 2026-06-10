import { useState, useEffect, useRef } from "react";
import { X, Plus, Check, Trash2, Paperclip, Send, CheckCheck } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { apiClient } from "../../lib/api-client";
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
  "Blocked": "text-red-400 bg-red-400/10 border-red-400/30",
  "Waiting": "text-slate-400 bg-slate-400/10 border-slate-400/30",
  "Bug": "text-red-500 bg-red-500/10 border-red-500/30",
  "Feature": "text-purple-400 bg-purple-400/10 border-purple-400/30",
  "Research": "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};
const LABELS = Object.keys(LABEL_COLORS);
const QUICK_EMOJIS = ["👍","❤️","😂","🎉","🔥","👀","😮","😢","🙏","✅","💯","🚀","⚡","🎯","💪","😎","🤔","👏","🥳","😅"];

function Avatar({ name, size = 7 }: { name: string; size?: number }) {
  const colors = ["bg-red-500/20 text-red-400","bg-blue-500/20 text-blue-400","bg-green-500/20 text-green-400","bg-purple-500/20 text-purple-400","bg-orange-500/20 text-orange-400","bg-cyan-500/20 text-cyan-400"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return <div className={`h-${size} w-${size} rounded-full ${color} flex items-center justify-center text-xs font-medium shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

function SeenBy({ views, currentUserId }: { views: TaskView[]; currentUserId: string }) {
  const others = views.filter(v => v.user_id !== currentUserId);
  if (others.length === 0) return null;
  const visible = others.slice(0, 5);
  const extra = others.length - 5;
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex items-center">
        {visible.map((v, i) => (
          <div key={v.user_id} title={v.user_name}
            className={`h-5 w-5 rounded-full bg-slate-700 border border-[#0f1116] flex items-center justify-center text-[9px] font-medium text-slate-300 ${i > 0 ? "-ml-1.5" : ""}`}>
            {v.user_name.charAt(0).toUpperCase()}
          </div>
        ))}
        {extra > 0 && <div className="-ml-1.5 h-5 w-5 rounded-full bg-slate-600 border border-[#0f1116] flex items-center justify-center text-[9px] font-medium text-slate-300">+{extra}</div>}
      </div>
      <span className="text-[11px] text-slate-600">Seen by {others.length === 1 ? (others[0]?.user_name ?? "") : `${others.length} people`}</span>
    </div>
  );
}

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
      part.startsWith("@") ? <span key={i} className={`font-medium ${isMe ? "text-white/80" : "text-red-400"}`}>{part}</span> : <span key={i}>{part}</span>
    );

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} group`}>
      {!isMe && <span className="text-[11px] text-slate-500 ml-2 mb-0.5">{comment.user_name}</span>}
      <div className={`relative max-w-[80%] ${isMe ? "ml-8" : "mr-8"}`}>
        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${isMe ? "bg-red-600 text-white rounded-br-sm" : "bg-white/[.07] text-slate-200 rounded-bl-sm"}`}>
          <p className="whitespace-pre-wrap">{renderContent(comment.content)}</p>
          <span className={`text-[10px] mt-0.5 block ${isMe ? "text-red-200/70 text-right" : "text-slate-600 text-right"}`}>
            {new Date(comment.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <button onClick={() => setShowEmojis(!showEmojis)}
          className={`absolute top-1 ${isMe ? "-left-7" : "-right-7"} opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-300 text-sm`}>
          😊
        </button>
      </div>
      {showEmojis && (
        <div className={`flex flex-wrap gap-1 mt-1 p-2 rounded-xl border border-white/10 bg-[#161820] shadow-xl w-fit max-w-[220px]`}>
          {QUICK_EMOJIS.map(e => (
            <button key={e} onClick={() => { toggleReaction.mutate(e); setShowEmojis(false); }}
              className="text-base hover:scale-125 transition-transform p-0.5">{e}</button>
          ))}
        </div>
      )}
      {Object.keys(grouped).length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
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
        <div className="flex items-center gap-1 mt-0.5 mr-1">
          <CheckCheck size={12} className="text-blue-400"/>
          <div className="flex">
            {seenByOthers.slice(0, 3).map((v, i) => (
              <div key={v.user_id} title={v.user_name}
                className={`h-3.5 w-3.5 rounded-full bg-slate-600 border border-[#0f1116] flex items-center justify-center text-[8px] text-slate-300 ${i > 0 ? "-ml-1" : ""}`}>
                {v.user_name.charAt(0).toUpperCase()}
              </div>
            ))}
            {seenByOthers.length > 3 && <span className="text-[10px] text-slate-600 ml-1">+{seenByOthers.length - 3}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskDetailPanel({ task, members, onClose, onUpdate }: {
  task: Task; members: Member[]; onClose: () => void; onUpdate: () => void;
}) {
  const { user } = useUser();
  const userName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Unknown";
  const userId = user?.id || "";
  const [activeTab, setActiveTab] = useState<"labels"|"assignees"|"review"|"checklist"|"comments"|"attachments">("labels");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [localLabels, setLocalLabels] = useState<string[]>(task.labels || []);
  const [localStatus, setLocalStatus] = useState(task.status || "todo");
  const [localPriority, setLocalPriority] = useState(task.priority || "medium");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalLabels(task.labels || []);
    setLocalStatus(task.status || "todo");
    setLocalPriority(task.priority || "medium");
  }, [task.id]);

  useEffect(() => { apiClient.post(`/tasks/${task.id}/view`, { user_name: userName }).catch(() => {}); }, [task.id]);

  const checklistQ = useQuery({ queryKey: ["task-checklist", task.id], queryFn: () => apiClient.get<ChecklistItem[]>(`/tasks/${task.id}/checklist`) });
  const commentsQ = useQuery({ queryKey: ["task-comments", task.id], queryFn: () => apiClient.get<Comment[]>(`/tasks/${task.id}/comments`) });
  const attachmentsQ = useQuery({ queryKey: ["task-attachments", task.id], queryFn: () => apiClient.get<Attachment[]>(`/tasks/${task.id}/attachments`) });
  const assigneesQ = useQuery({ queryKey: ["task-assignees", task.id], queryFn: () => apiClient.get<Assignee[]>(`/tasks/${task.id}/assignees`) });
  const viewsQ = useQuery({ queryKey: ["task-views", task.id], queryFn: () => apiClient.get<TaskView[]>(`/tasks/${task.id}/views`) });

  const updateLabels = useMutation({ mutationFn: (labels: string[]) => apiClient.patch(`/tasks/${task.id}/labels`, { labels }), onSuccess: onUpdate });
  const updateTask = useMutation({ mutationFn: (fields: { status?: string; priority?: string }) => apiClient.patch(`/tasks/${task.id}`, fields), onSuccess: onUpdate });
  const addAssignee = useMutation({ mutationFn: (m: Member) => apiClient.post(`/tasks/${task.id}/assignees`, { user_id: m.user_id, email: m.email, name: m.name, permission: "collaborator" }), onSuccess: () => assigneesQ.refetch() });
  const removeAssignee = useMutation({ mutationFn: (uid: string) => apiClient.delete(`/tasks/${task.id}/assignees/${uid}`), onSuccess: () => assigneesQ.refetch() });
  const addCheckItem = useMutation({ mutationFn: () => apiClient.post(`/tasks/${task.id}/checklist`, { text: newCheckItem, added_by_name: userName }), onSuccess: () => { setNewCheckItem(""); checklistQ.refetch(); } });
  const toggleCheckItem = useMutation({ mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => apiClient.patch(`/tasks/${task.id}/checklist/${itemId}`, { completed }), onSuccess: () => checklistQ.refetch() });
  const deleteCheckItem = useMutation({ mutationFn: (id: string) => apiClient.delete(`/tasks/${task.id}/checklist/${id}`), onSuccess: () => checklistQ.refetch() });
  const addComment = useMutation({ mutationFn: () => apiClient.post(`/tasks/${task.id}/comments`, { content: newComment, user_name: userName }), onSuccess: () => { setNewComment(""); commentsQ.refetch(); } });
  const deleteComment = useMutation({ mutationFn: (id: string) => apiClient.delete(`/tasks/${task.id}/comments/${id}`), onSuccess: () => commentsQ.refetch() });

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const fd = new FormData(); fd.append("file", file); fd.append("user_name", userName);
      const res = await fetch(`${apiUrl}/api/v1/tasks/${task.id}/upload`, { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}) }, body: fd });
      if (res.ok) attachmentsQ.refetch();
    } catch {} setUploading(false);
  };

  const checklist = checklistQ.data ?? [];
  const comments = commentsQ.data ?? [];
  const attachments = attachmentsQ.data ?? [];
  const assignees = assigneesQ.data ?? [];
  const views = viewsQ.data ?? [];
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

  const tabs = [
    { key: "labels", label: "Labels", count: localLabels.filter(l => LABEL_COLORS[l]).length || 0 },
    { key: "assignees", label: "Assignees", count: assignees.length },
    { key: "review", label: "Review", count: 0 },
    { key: "checklist", label: "Checklist", count: checklist.length ? `${completedCount}/${checklist.length}` : 0 },
    { key: "comments", label: "Comments", count: comments.length },
    { key: "attachments", label: "Files", count: attachments.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose}/>
      <div className="relative w-full max-w-lg bg-[#0f1116] border-l border-white/10 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b border-white/10">
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-white leading-snug">{task.title}</h2>
              <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0 mt-0.5"><X size={18}/></button>
            </div>
            {task.notes && <p className="text-xs text-slate-500 mt-1">{task.notes}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select value={localStatus} onChange={e => { setLocalStatus(e.target.value); updateTask.mutate({ status: e.target.value }); }}
                className="h-7 rounded-lg border border-white/10 bg-white/[.05] px-2 text-xs text-white outline-none cursor-pointer">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Needs Review</option>
                <option value="done">Done</option>
              </select>
              <select value={localPriority} onChange={e => { setLocalPriority(e.target.value); updateTask.mutate({ priority: e.target.value }); }}
                className="h-7 rounded-lg border border-white/10 bg-white/[.05] px-2 text-xs text-white outline-none cursor-pointer">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <button onClick={() => setActiveTab("review")}
                className="h-7 rounded-lg border border-white/10 bg-white/[.05] px-3 text-xs text-slate-400 hover:text-white hover:border-white/20 transition-colors">
                {localStatus === "review" ? "⏳ In Review" : task.review_result === "approved" ? "✅ Approved" : task.review_result === "changes_requested" ? "🔄 Changes" : "Send for Review →"}
              </button>
            </div>
            {localLabels.filter(l => LABEL_COLORS[l]).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {localLabels.filter(l => LABEL_COLORS[l]).map(l => <span key={l} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${LABEL_COLORS[l]}`}>{l}</span>)}
              </div>
            )}
            <SeenBy views={views} currentUserId={userId}/>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-2 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === t.key ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
              {t.label}{t.count ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">{t.count}</span> : null}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">

          {/* Labels */}
          {activeTab === "labels" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Add tags to this task.</p>
              {LABELS.map(label => {
                const active = localLabels.includes(label);
                return (
                  <button key={label} onClick={() => toggleLabel(label)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors border ${active ? LABEL_COLORS[label] : "border-white/[.06] text-slate-400 hover:border-white/10 hover:text-white"}`}>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${active ? "border-current" : "border-white/20"}`}>{active && <Check size={10}/>}</div>
                    <span className="flex-1 text-left">{label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Assignees */}
          {activeTab === "assignees" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-3">Assign members as collaborators.</p>
              {assignees.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-slate-600 uppercase tracking-wider">Assigned</p>
                  {assignees.map(a => (
                    <div key={a.user_id} className="flex items-center gap-3 rounded-lg border border-white/[.06] px-3 py-2.5">
                      <Avatar name={a.name || a.email}/>
                      <div className="flex-1 min-w-0"><p className="text-sm text-white truncate">{a.name || a.email}</p><p className="text-xs text-slate-500">Collaborator</p></div>
                      {isOwner && <button onClick={() => removeAssignee.mutate(a.user_id)} className="text-slate-600 hover:text-red-400"><X size={13}/></button>}
                    </div>
                  ))}
                </div>
              )}
              {unassignedMembers.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Add member</p>
                  {unassignedMembers.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 py-2 border-b border-white/[.04] last:border-0">
                      <Avatar name={m.name || m.email}/>
                      <span className="flex-1 text-sm text-slate-300 truncate">{m.name || m.email}</span>
                      <button onClick={() => addAssignee.mutate(m)} className="rounded-md px-3 py-1 text-xs border border-white/10 text-slate-400 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5 transition-colors">+ Add</button>
                    </div>
                  ))}
                </div>
              )}
              {unassignedMembers.length === 0 && assignees.length === 0 && <p className="text-sm text-slate-600 text-center py-4">No workspace members found.</p>}
            </div>
          )}

          {/* Review */}
          {activeTab === "review" && (
            <TaskReviewTab task={task} members={members} onUpdate={onUpdate}/>
          )}

          {/* Checklist */}
          {activeTab === "checklist" && (
            <div>
              {checklist.length > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between mb-1 text-xs text-slate-500"><span>{completedCount}/{checklist.length} completed</span><span>{Math.round(checklist.length ? (completedCount/checklist.length)*100 : 0)}%</span></div>
                  <div className="h-1.5 w-full rounded-full bg-white/10"><div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${checklist.length ? (completedCount/checklist.length)*100 : 0}%` }}/></div>
                </div>
              )}
              <div className="space-y-2 mb-3">
                {checklist.length === 0 && <p className="text-sm text-slate-600 text-center py-4">No checklist items yet</p>}
                {checklist.map(item => (
                  <div key={item.id} className="flex items-start gap-2.5 group">
                    <button onClick={() => toggleCheckItem.mutate({ itemId: item.id, completed: !item.completed })}
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${item.completed ? "border-emerald-500 bg-emerald-500" : "border-white/20 hover:border-white/40"}`}>
                      {item.completed && <Check size={9} className="text-white"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${item.completed ? "line-through text-slate-600" : "text-slate-200"}`}>{item.text}</p>
                      <p className="text-[11px] text-slate-600">{item.added_by_name} · {new Date(item.created_at).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => deleteCheckItem.mutate(item.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 shrink-0"><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => e.key === "Enter" && newCheckItem.trim() && addCheckItem.mutate()} placeholder="Add checklist item..." className="flex-1 h-9 rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white placeholder-slate-600 outline-none"/>
                <button onClick={() => newCheckItem.trim() && addCheckItem.mutate()} disabled={!newCheckItem.trim()} className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center text-white disabled:opacity-40"><Plus size={14}/></button>
              </div>
            </div>
          )}

          {/* Comments */}
          {activeTab === "comments" && (
            <div className="flex flex-col h-full">
              <div className="flex-1 space-y-3 pb-3">
                {comments.length === 0 && <p className="text-sm text-slate-600 text-center py-6">No comments yet</p>}
                {comments.map((c, i) => (
                  <CommentBubble key={c.id} comment={c} taskId={task.id} userId={userId} userName={userName} isLast={i === comments.length - 1} views={views}/>
                ))}
                <div ref={messagesEndRef}/>
              </div>
              <div className="border-t border-white/[.06] pt-3 relative sticky bottom-0 bg-[#0f1116]">
                {showMentions && mentionMembers.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-white/10 bg-[#161820] shadow-xl overflow-hidden z-10">
                    {mentionMembers.slice(0, 5).map(m => (
                      <button key={m.user_id} onClick={() => insertMention(m.name || m.email)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/[.06]">
                        <Avatar name={m.name || m.email} size={6}/>{m.name || m.email}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea ref={commentRef} value={newComment} onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }}
                    placeholder="Message... @ to mention" rows={1}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/[.05] px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/20 max-h-32"/>
                  <button onClick={() => newComment.trim() && addComment.mutate()} disabled={!newComment.trim()}
                    className="h-9 w-9 rounded-full bg-red-600 flex items-center justify-center text-white disabled:opacity-40 shrink-0">
                    <Send size={14}/>
                  </button>
                </div>
                <p className="text-[10px] text-slate-700 mt-1 text-center">Enter to send · Shift+Enter new line · @ mention</p>
              </div>
            </div>
          )}

          {/* Attachments */}
          {activeTab === "attachments" && (
            <div>
              <div className="space-y-2 mb-4">
                {attachments.length === 0 && <p className="text-sm text-slate-600 text-center py-6">No attachments yet</p>}
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-white/[.06] px-3 py-2.5 group">
                    <Paperclip size={14} className="text-slate-500 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline truncate block">{a.file_name}</a>
                      <p className="text-[11px] text-slate-600">{a.user_name} · {a.file_size > 0 ? `${(a.file_size/1024).toFixed(1)}KB` : "link"}</p>
                    </div>
                    <button onClick={() => apiClient.delete(`/tasks/${task.id}/attachments/${a.id}`).then(() => attachmentsQ.refetch())} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-dashed border-white/10 p-4 text-center">
                <Paperclip size={18} className="text-slate-600 mx-auto mb-2"/>
                <p className="text-xs text-slate-400 mb-3">Upload a file or image</p>
                <label className={`inline-block rounded-lg px-4 py-2 text-xs font-medium cursor-pointer ${uploading ? "bg-white/10 text-slate-500" : "bg-red-600 text-white hover:bg-red-500"}`}>
                  {uploading ? "Uploading..." : "Choose File"}
                  <input type="file" className="hidden" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}/>
                </label>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

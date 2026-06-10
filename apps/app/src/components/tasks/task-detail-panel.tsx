import { useState, useEffect, useRef } from "react";
import { X, Plus, Check, Trash2, Paperclip, Send, Eye } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { apiClient } from "../../lib/api-client";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task { id: string; title: string; labels?: string[]; notes?: string; status?: string; assignee_id?: string; }
interface ChecklistItem { id: string; text: string; completed: boolean; added_by_name: string; created_at: string; }
interface Comment { id: string; content: string; user_name: string; user_id: string; created_at: string; }
interface Attachment { id: string; file_name: string; file_url: string; file_size: number; user_name: string; }
interface Assignee { id: string; user_id: string; name: string; email: string; permission: string; }
interface Reaction { id: string; emoji: string; user_id: string; user_name: string; }
interface TaskView { user_id: string; user_name: string; viewed_at: string; }

const LABEL_COLORS: Record<string, string> = {
  "Need Review": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  "Help Needed": "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "Blocked": "text-red-400 bg-red-400/10 border-red-400/30",
  "Waiting": "text-slate-400 bg-slate-400/10 border-slate-400/30",
  "High Priority": "text-orange-400 bg-orange-400/10 border-orange-400/30",
  "Low Priority": "text-green-400 bg-green-400/10 border-green-400/30",
  "Bug": "text-red-500 bg-red-500/10 border-red-500/30",
  "Feature": "text-purple-400 bg-purple-400/10 border-purple-400/30",
  "Research": "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};
const LABELS = Object.keys(LABEL_COLORS);
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];

function CommentItem({ comment, taskId, userId, userName, assignees, onDelete }: {
  comment: Comment; taskId: string; userId: string; userName: string;
  assignees: Assignee[]; onDelete: (id: string) => void;
}) {
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
  const grouped = reactions.reduce<Record<string, Reaction[]>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = [];
    acc[r.emoji]!.push(r);
    return acc;
  }, {});

  const renderContent = (content: string) => {
    const parts = content.split(/(@\w+)/g);
    return parts.map((part, i) =>
      part.startsWith("@")
        ? <span key={i} className="text-red-400 font-medium">{part}</span>
        : <span key={i}>{part}</span>
    );
  };

  return (
    <div className="flex items-start gap-2.5 group">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400 font-medium">
        {comment.user_name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-medium text-white">{comment.user_name}</span>
          <span className="text-[11px] text-slate-600">{new Date(comment.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setShowEmojis(!showEmojis)} className="text-slate-600 hover:text-slate-300 text-xs px-1">😊</button>
            {comment.user_id === userId && (
              <button onClick={() => onDelete(comment.id)} className="text-slate-600 hover:text-red-400"><Trash2 size={11}/></button>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{renderContent(comment.content)}</p>

        {/* Emoji picker */}
        {showEmojis && (
          <div className="flex gap-1 mt-1.5 p-1.5 rounded-lg bg-white/[.05] border border-white/10 w-fit">
            {QUICK_EMOJIS.map(e => (
              <button key={e} onClick={() => { toggleReaction.mutate(e); setShowEmojis(false); }}
                className="text-base hover:scale-125 transition-transform">{e}</button>
            ))}
          </div>
        )}

        {/* Reactions */}
        {Object.keys(grouped).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(grouped).map(([emoji, users]) => {
              const iMine = users.some(u => u.user_id === userId);
              return (
                <button key={emoji} onClick={() => toggleReaction.mutate(emoji)}
                  title={users.map(u => u.user_name).join(", ")}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${iMine ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-white/[.04] border-white/10 text-slate-400 hover:border-white/20"}`}>
                  <span>{emoji}</span>
                  <span>{users.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskDetailPanel({ task, members, onClose, onUpdate }: {
  task: Task; members: Member[]; onClose: () => void; onUpdate: () => void;
}) {
  const { user } = useUser();
  const userName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Unknown";
  const userId = user?.id || "";
  const [activeTab, setActiveTab] = useState<"labels"|"assignees"|"checklist"|"comments"|"attachments">("labels");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [localLabels, setLocalLabels] = useState<string[]>(task.labels || []);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setLocalLabels(task.labels || []); }, [task.id]);

  // Track view
  useEffect(() => {
    apiClient.post(`/tasks/${task.id}/view`, { user_name: userName }).catch(() => {});
  }, [task.id]);

  const checklistQ = useQuery({ queryKey: ["task-checklist", task.id], queryFn: () => apiClient.get<ChecklistItem[]>(`/tasks/${task.id}/checklist`) });
  const commentsQ = useQuery({ queryKey: ["task-comments", task.id], queryFn: () => apiClient.get<Comment[]>(`/tasks/${task.id}/comments`) });
  const attachmentsQ = useQuery({ queryKey: ["task-attachments", task.id], queryFn: () => apiClient.get<Attachment[]>(`/tasks/${task.id}/attachments`) });
  const assigneesQ = useQuery({ queryKey: ["task-assignees", task.id], queryFn: () => apiClient.get<Assignee[]>(`/tasks/${task.id}/assignees`) });
  const viewsQ = useQuery({ queryKey: ["task-views", task.id], queryFn: () => apiClient.get<TaskView[]>(`/tasks/${task.id}/views`) });

  const updateLabels = useMutation({
    mutationFn: (labels: string[]) => apiClient.patch(`/tasks/${task.id}/labels`, { labels }),
    onSuccess: onUpdate
  });
  const addAssignee = useMutation({
    mutationFn: (member: Member) => apiClient.post(`/tasks/${task.id}/assignees`, { user_id: member.user_id, email: member.email, name: member.name, permission: "collaborator" }),
    onSuccess: () => assigneesQ.refetch()
  });
  const removeAssignee = useMutation({
    mutationFn: (uid: string) => apiClient.delete(`/tasks/${task.id}/assignees/${uid}`),
    onSuccess: () => assigneesQ.refetch()
  });
  const addCheckItem = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${task.id}/checklist`, { text: newCheckItem, added_by_name: userName }),
    onSuccess: () => { setNewCheckItem(""); checklistQ.refetch(); }
  });
  const toggleCheckItem = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => apiClient.patch(`/tasks/${task.id}/checklist/${itemId}`, { completed }),
    onSuccess: () => checklistQ.refetch()
  });
  const deleteCheckItem = useMutation({
    mutationFn: (itemId: string) => apiClient.delete(`/tasks/${task.id}/checklist/${itemId}`),
    onSuccess: () => checklistQ.refetch()
  });
  const addComment = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${task.id}/comments`, { content: newComment, user_name: userName }),
    onSuccess: () => { setNewComment(""); commentsQ.refetch(); }
  });
  const deleteComment = useMutation({
    mutationFn: (cid: string) => apiClient.delete(`/tasks/${task.id}/comments/${cid}`),
    onSuccess: () => commentsQ.refetch()
  });

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_name", userName);
      const res = await fetch(`${apiUrl}/api/v1/tasks/${task.id}/upload`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
        },
        body: formData
      });
      if (res.ok) attachmentsQ.refetch();
    } catch {}
    setUploading(false);
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
    const newLabels = localLabels.includes(label) ? localLabels.filter(l => l !== label) : [...localLabels, label];
    setLocalLabels(newLabels);
    updateLabels.mutate(newLabels);
  };

  const handleCommentInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewComment(val);
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && lastAt === val.length - 1) {
      setShowMentions(true);
      setMentionSearch("");
    } else if (lastAt !== -1 && val.slice(lastAt).match(/^@\w*$/)) {
      setShowMentions(true);
      setMentionSearch(val.slice(lastAt + 1));
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (name: string) => {
    const lastAt = newComment.lastIndexOf("@");
    const newVal = newComment.slice(0, lastAt) + `@${name} `;
    setNewComment(newVal);
    setShowMentions(false);
    commentRef.current?.focus();
  };

  const mentionMembers = [...members, ...assignees.map(a => ({ user_id: a.user_id, name: a.name, email: a.email, id: a.id }))]
    .filter((m, i, arr) => arr.findIndex(x => x.user_id === m.user_id) === i)
    .filter(m => (m.name || m.email).toLowerCase().includes(mentionSearch.toLowerCase()));

  const tabs = [
    { key: "labels", label: "Labels", count: localLabels.length || 0 },
    { key: "assignees", label: "Assignees", count: assignees.length },
    { key: "checklist", label: "Checklist", count: checklist.length ? `${completedCount}/${checklist.length}` : 0 },
    { key: "comments", label: "Comments", count: comments.length },
    { key: "attachments", label: "Files", count: attachments.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose}/>
      <div className="w-full max-w-lg bg-[#0f1116] border-l border-white/10 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white leading-snug">{task.title}</h2>
            {task.notes && <p className="text-xs text-slate-500 mt-1">{task.notes}</p>}
            {localLabels.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {localLabels.map(l => (
                  <span key={l} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${LABEL_COLORS[l] || "text-slate-400 bg-slate-400/10 border-slate-400/30"}`}>{l}</span>
                ))}
              </div>
            )}
            {/* Views */}
            {views.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2">
                <Eye size={11} className="text-slate-600"/>
                <span className="text-[11px] text-slate-600">Seen by </span>
                <span className="text-[11px] text-slate-500">{views.slice(0, 3).map(v => v.user_name).join(", ")}{views.length > 3 ? ` +${views.length - 3}` : ""}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0 mt-0.5"><X size={18}/></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-2 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === t.key ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
              {t.label}
              {t.count ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">{t.count}</span> : null}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">

          {activeTab === "labels" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Select labels. "Need Review" moves the task to the review queue.</p>
              {LABELS.map(label => {
                const active = localLabels.includes(label);
                return (
                  <button key={label} onClick={() => toggleLabel(label)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors border ${active ? LABEL_COLORS[label] : "border-white/[.06] text-slate-400 hover:border-white/10 hover:text-white"}`}>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${active ? "border-current" : "border-white/20"}`}>
                      {active && <Check size={10}/>}
                    </div>
                    <span className="flex-1 text-left">{label}</span>
                    {label === "Need Review" && <span className="text-[10px] opacity-60">→ Review queue</span>}
                  </button>
                );
              })}
            </div>
          )}

          {activeTab === "assignees" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-3">Assign members as collaborators.</p>
              {assignees.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-slate-600 uppercase tracking-wider">Assigned</p>
                  {assignees.map(a => (
                    <div key={a.user_id} className="flex items-center gap-3 rounded-lg border border-white/[.06] px-3 py-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400 font-medium shrink-0">
                        {(a.name || a.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{a.name || a.email}</p>
                        <p className="text-xs text-slate-500">Collaborator</p>
                      </div>
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
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs text-slate-400 shrink-0">
                        {(m.name || m.email).charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 text-sm text-slate-300 truncate">{m.name || m.email}</span>
                      <button onClick={() => addAssignee.mutate(m)}
                        className="rounded-md px-3 py-1 text-xs border border-white/10 text-slate-400 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {unassignedMembers.length === 0 && assignees.length === 0 && (
                <p className="text-sm text-slate-600 text-center py-4">No workspace members found.</p>
              )}
            </div>
          )}

          {activeTab === "checklist" && (
            <div>
              {checklist.length > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between mb-1 text-xs text-slate-500">
                    <span>{completedCount}/{checklist.length} completed</span>
                    <span>{Math.round(checklist.length ? (completedCount/checklist.length)*100 : 0)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10">
                    <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${checklist.length ? (completedCount/checklist.length)*100 : 0}%` }}/>
                  </div>
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
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && newCheckItem.trim() && addCheckItem.mutate()}
                  placeholder="Add checklist item..."
                  className="flex-1 h-9 rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white placeholder-slate-600 outline-none"/>
                <button onClick={() => newCheckItem.trim() && addCheckItem.mutate()} disabled={!newCheckItem.trim()}
                  className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center text-white disabled:opacity-40">
                  <Plus size={14}/>
                </button>
              </div>
            </div>
          )}

          {activeTab === "comments" && (
            <div>
              <div className="space-y-4 mb-4">
                {comments.length === 0 && <p className="text-sm text-slate-600 text-center py-6">No comments yet</p>}
                {comments.map(c => (
                  <CommentItem key={c.id} comment={c} taskId={task.id} userId={userId} userName={userName}
                    assignees={assignees} onDelete={id => deleteComment.mutate(id)}/>
                ))}
              </div>
              <div className="border-t border-white/[.06] pt-3 relative">
                {showMentions && mentionMembers.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-white/10 bg-[#161820] shadow-xl overflow-hidden z-10">
                    {mentionMembers.slice(0, 5).map(m => (
                      <button key={m.user_id} onClick={() => insertMention(m.name || m.email)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/[.06] transition-colors">
                        <div className="h-6 w-6 rounded-full bg-red-500/10 text-xs text-red-400 flex items-center justify-center shrink-0">
                          {(m.name || m.email).charAt(0).toUpperCase()}
                        </div>
                        {m.name || m.email}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <textarea ref={commentRef} value={newComment} onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }}
                    placeholder="Write a comment... Use @ to mention someone"
                    rows={2}
                    className="flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/20"/>
                  <button onClick={() => newComment.trim() && addComment.mutate()} disabled={!newComment.trim()}
                    className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center text-white disabled:opacity-40 self-end">
                    <Send size={13}/>
                  </button>
                </div>
                <p className="text-[11px] text-slate-700 mt-1">Enter to send · Shift+Enter for new line · @ to mention</p>
              </div>
            </div>
          )}

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
                    <button onClick={() => apiClient.delete(`/tasks/${task.id}/attachments/${a.id}`).then(() => attachmentsQ.refetch())}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-dashed border-white/10 p-4 text-center">
                <Paperclip size={18} className="text-slate-600 mx-auto mb-2"/>
                <p className="text-xs text-slate-400 mb-1">Upload a file or image</p>
                <p className="text-[11px] text-slate-600 mb-3">Images, PDFs, docs, spreadsheets</p>
                <label className={`inline-block rounded-lg px-4 py-2 text-xs font-medium cursor-pointer transition-colors ${uploading ? "bg-white/10 text-slate-500" : "bg-red-600 text-white hover:bg-red-500"}`}>
                  {uploading ? "Uploading..." : "Choose File"}
                  <input type="file" className="hidden" disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}/>
                </label>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

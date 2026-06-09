import { useState, useEffect } from "react";
import { X, Plus, Check, Trash2, Paperclip, Send, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { apiClient } from "../../lib/api-client";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task { id: string; title: string; labels?: string[]; notes?: string; status?: string; }
interface ChecklistItem { id: string; text: string; completed: boolean; added_by_name: string; created_at: string; }
interface Comment { id: string; content: string; user_name: string; user_id: string; created_at: string; }
interface Attachment { id: string; file_name: string; file_url: string; file_size: number; user_name: string; }
interface Assignee { id: string; user_id: string; name: string; email: string; permission: string; }

const LABELS = ["Need Review", "Help Needed", "Blocked", "Waiting", "High Priority", "Low Priority", "Bug", "Feature", "Research"];
const PERMISSIONS: Array<"edit"|"comment"|"view"> = ["edit", "comment", "view"];

export function TaskDetailPanel({ task, members, onClose, onUpdate }: {
  task: Task; members: Member[]; onClose: () => void; onUpdate: () => void;
}) {
  const { user } = useUser();
  const qc = useQueryClient();
  const userName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Unknown";
  const userId = user?.id || "";

  const [activeTab, setActiveTab] = useState<"labels"|"assignees"|"checklist"|"comments"|"attachments">("labels");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const [localLabels, setLocalLabels] = useState<string[]>(task.labels || []);

  // Sync localLabels when task prop changes
  useEffect(() => { setLocalLabels(task.labels || []); }, [task.id, task.labels]);

  const checklistQ = useQuery({ queryKey: ["task-checklist", task.id], queryFn: () => apiClient.get<ChecklistItem[]>(`/tasks/${task.id}/checklist`) });
  const commentsQ = useQuery({ queryKey: ["task-comments", task.id], queryFn: () => apiClient.get<Comment[]>(`/tasks/${task.id}/comments`) });
  const attachmentsQ = useQuery({ queryKey: ["task-attachments", task.id], queryFn: () => apiClient.get<Attachment[]>(`/tasks/${task.id}/attachments`) });
  const assigneesQ = useQuery({ queryKey: ["task-assignees", task.id], queryFn: () => apiClient.get<Assignee[]>(`/tasks/${task.id}/assignees`) });

  const updateLabels = useMutation({
    mutationFn: (labels: string[]) => apiClient.patch(`/tasks/${task.id}/labels`, { labels }),
    onSuccess: () => { onUpdate(); }
  });

  const addAssignee = useMutation({
    mutationFn: (vars: { member: Member; permission: string }) =>
      apiClient.post(`/tasks/${task.id}/assignees`, {
        user_id: vars.member.user_id, email: vars.member.email,
        name: vars.member.name, permission: vars.permission
      }),
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
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      apiClient.patch(`/tasks/${task.id}/checklist/${itemId}`, { completed }),
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

  const addAttachment = useMutation({
    mutationFn: () => {
      const name = attachUrl.split("/").pop()?.split("?")[0] || "file";
      return apiClient.post(`/tasks/${task.id}/attachments`, {
        file_name: name, file_url: attachUrl,
        file_type: "link", file_size: 0, user_name: userName
      });
    },
    onSuccess: () => { setAttachUrl(""); attachmentsQ.refetch(); }
  });

  const checklist = checklistQ.data ?? [];
  const comments = commentsQ.data ?? [];
  const attachments = attachmentsQ.data ?? [];
  const assignees = assigneesQ.data ?? [];
  const completedCount = checklist.filter(i => i.completed).length;
  const unassignedMembers = members.filter(m => !assignees.find(a => a.user_id === m.user_id));

  const toggleLabel = (label: string) => {
    const newLabels = localLabels.includes(label)
      ? localLabels.filter(l => l !== label)
      : [...localLabels, label];
    setLocalLabels(newLabels);
    updateLabels.mutate(newLabels);
  };

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
                  <span key={l} className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] text-red-400">{l}</span>
                ))}
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

          {/* Labels */}
          {activeTab === "labels" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Select labels. "Need Review" moves the task to the review queue.</p>
              {LABELS.map(label => {
                const active = localLabels.includes(label);
                return (
                  <button key={label} onClick={() => toggleLabel(label)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-red-500/10 border border-red-500/30 text-red-400" : "border border-white/[.06] text-slate-400 hover:border-white/10 hover:text-white"}`}>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${active ? "border-red-400 bg-red-400" : "border-white/20"}`}>
                      {active && <Check size={10} className="text-white"/>}
                    </div>
                    <span className="flex-1 text-left">{label}</span>
                    {label === "Need Review" && <span className="text-[10px] text-slate-600">→ Review queue</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Assignees */}
          {activeTab === "assignees" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-3">Assign members and set their permission level.</p>
              
              {/* Current assignees */}
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
                        <p className="text-xs text-slate-500 capitalize">{a.permission}</p>
                      </div>
                      <button onClick={() => removeAssignee.mutate(a.user_id)}
                        className="text-slate-600 hover:text-red-400 transition-colors"><X size={13}/></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add members */}
              {unassignedMembers.length > 0 ? (
                <div>
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Add member</p>
                  {unassignedMembers.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 py-2 border-b border-white/[.04] last:border-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs text-slate-400 shrink-0">
                        {(m.name || m.email).charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 text-sm text-slate-300 truncate">{m.name || m.email}</span>
                      <div className="flex gap-1">
                        {PERMISSIONS.map(p => (
                          <button key={p} onClick={() => addAssignee.mutate({ member: m, permission: p })}
                            className="rounded-md px-2 py-1 text-[11px] border border-white/10 text-slate-500 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5 capitalize transition-colors">
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : assignees.length === 0 ? (
                <p className="text-sm text-slate-600 text-center py-4">No workspace members found. Members appear after they log in.</p>
              ) : (
                <p className="text-xs text-slate-600 text-center py-2">All members assigned</p>
              )}
            </div>
          )}

          {/* Checklist */}
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
                    <button onClick={() => deleteCheckItem.mutate(item.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity shrink-0">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && newCheckItem.trim() && addCheckItem.mutate()}
                  placeholder="Add checklist item..."
                  className="flex-1 h-9 rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white placeholder-slate-600 outline-none focus:border-white/20"/>
                <button onClick={() => newCheckItem.trim() && addCheckItem.mutate()} disabled={!newCheckItem.trim()}
                  className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center text-white disabled:opacity-40">
                  <Plus size={14}/>
                </button>
              </div>
            </div>
          )}

          {/* Comments */}
          {activeTab === "comments" && (
            <div>
              <div className="space-y-4 mb-4">
                {comments.length === 0 && <p className="text-sm text-slate-600 text-center py-6">No comments yet</p>}
                {comments.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5 group">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-xs text-red-400 font-medium">
                      {c.user_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white">{c.user_name}</span>
                        <span className="text-[11px] text-slate-600">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        {c.user_id === userId && (
                          <button onClick={() => deleteComment.mutate(c.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity">
                            <Trash2 size={11}/>
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 border-t border-white/[.06] pt-3">
                <textarea value={newComment} onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }}
                  placeholder="Write a comment... (Enter to send)"
                  rows={2}
                  className="flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/20"/>
                <button onClick={() => newComment.trim() && addComment.mutate()} disabled={!newComment.trim()}
                  className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center text-white disabled:opacity-40 self-end">
                  <Send size={13}/>
                </button>
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
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:underline truncate block">{a.file_name}</a>
                      <p className="text-[11px] text-slate-600">{a.user_name}</p>
                    </div>
                    <button onClick={() => apiClient.delete(`/tasks/${task.id}/attachments/${a.id}`).then(() => attachmentsQ.refetch())}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-white/[.06] p-4">
                <p className="text-xs text-slate-500 mb-2">Add attachment URL</p>
                <div className="flex gap-2">
                  <input value={attachUrl} onChange={e => setAttachUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && attachUrl.trim() && addAttachment.mutate()}
                    placeholder="https://drive.google.com/... or any URL"
                    className="flex-1 h-9 rounded-lg border border-white/10 bg-transparent px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-white/20"/>
                  <button onClick={() => attachUrl.trim() && addAttachment.mutate()} disabled={!attachUrl.trim() || addAttachment.isPending}
                    className="h-9 px-3 rounded-lg bg-red-600 text-xs text-white disabled:opacity-40">
                    Add
                  </button>
                </div>
                <p className="text-[11px] text-slate-700 mt-2">Supports Google Drive, Dropbox, or any direct URL</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2, Filter, ShieldAlert } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

interface Notification {
  id: string; title: string; body: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  task_review: "Task review", mention: "Mention", approval: "Approval",
  system: "System", comment: "Comment", assignment: "Assignment",
  ai_risk: "AI Risk Alert",
};

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<Notification[]>("/notifications"),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const deleteOne = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const all = query.data ?? [];
  const unread = all.filter(n => !n.is_read).length;
  const types = ["all", ...Array.from(new Set(all.map(n => n.type).filter(Boolean)))];

  const visible = all
    .filter(n => filter === "unread" ? !n.is_read : true)
    .filter(n => typeFilter === "all" ? true : n.type === typeFilter);

  function handleClick(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.task_id) navigate("/tasks");
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <p className="text-sm text-slate-500 pt-1">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        {unread > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <CheckCheck size={13}/> Mark all read
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Read/unread toggle */}
        <div className="flex rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
          {(["all", "unread"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${filter === f ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {f === "all" ? "All" : `Unread (${unread})`}
            </button>
          ))}
        </div>

        {/* Type filter */}
        {types.length > 1 && (
          <div className="flex items-center gap-1.5">
            <Filter size={11} className="text-slate-600"/>
            <div className="flex gap-1 flex-wrap">
              {types.map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border transition-colors capitalize ${typeFilter === t ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/[.07] text-slate-600 hover:text-slate-400"}`}
                >
                  {t === "all" ? "All types" : (TYPE_LABELS[t] ?? t)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* List */}
      {query.isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[.03] animate-pulse"/>)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={32} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-slate-500 text-sm">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </p>
          <p className="text-slate-700 text-xs mt-1">Reviews, approvals, and mentions will appear here</p>
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map(n => {
            const isRisk = n.type === "ai_risk";
            return (
            <div
              key={n.id}
              className={`group flex w-full items-start gap-3 rounded-xl border p-4 transition-colors ${
                !n.is_read
                  ? isRisk ? "border-amber-500/20 bg-amber-500/[.05]" : "border-red-500/15 bg-red-500/5"
                  : "border-white/[.04] hover:bg-white/[.02]"
              }`}
            >
              {/* Unread indicator */}
              {isRisk && !n.is_read
                ? <ShieldAlert size={14} className="mt-1 shrink-0 text-amber-400"/>
                : <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${!n.is_read ? "bg-red-400" : "bg-transparent"}`}/>
              }

              {/* Content */}
              <button className="flex-1 min-w-0 text-left" onClick={() => handleClick(n)}>
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium truncate ${!n.is_read ? "text-white" : "text-slate-400"}`}>{n.title}</p>
                  {n.type && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] capitalize ${isRisk ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/[.06] bg-white/[.03] text-slate-600"}`}>
                      {TYPE_LABELS[n.type] ?? n.type}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                <p className="text-[11px] text-slate-700 mt-1">{relTime(n.created_at)}</p>
              </button>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {!n.is_read && (
                  <button
                    onClick={() => markRead.mutate(n.id)}
                    title="Mark read"
                    className="rounded-md p-1.5 text-slate-600 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                  >
                    <Check size={12}/>
                  </button>
                )}
                <button
                  onClick={() => deleteOne.mutate(n.id)}
                  title="Delete"
                  className="rounded-md p-1.5 text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12}/>
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

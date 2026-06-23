import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2, Filter, ShieldAlert, Sparkles } from "lucide-react";
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
    <div className="mx-auto max-w-3xl px-6 py-8 text-neutral-900 dark:text-neutral-50">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <p className="pt-1 text-sm text-neutral-500 dark:text-neutral-500">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        {unread > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="btn-secondary !px-2.5 !py-1.5 !text-xs disabled:opacity-50"
          >
            <CheckCheck size={13}/> Mark all read
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* Read/unread toggle */}
        <div className="today-scope-switch">
          {(["all", "unread"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="today-scope-option capitalize"
              data-active={filter === f}
            >
              {f === "all" ? "All" : `Unread (${unread})`}
            </button>
          ))}
        </div>

        {/* Type filter */}
        {types.length > 1 && (
          <div className="flex items-center gap-1.5">
            <Filter size={11} className="text-neutral-400 dark:text-neutral-600"/>
            <div className="flex gap-1 flex-wrap">
              {types.map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "border-neutral-900 bg-neutral-900 text-white dark:border-cyan-500/30 dark:bg-white dark:text-neutral-950" : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-500 dark:hover:border-neutral-700 dark:hover:text-neutral-200"}`}
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
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900"/>)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={32} className="mx-auto mb-3 text-neutral-300 dark:text-neutral-700"/>
          <p className="text-sm text-neutral-600 dark:text-neutral-500">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </p>
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-700">Reviews, approvals, and mentions will appear here</p>
          {filter !== "unread" && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
              <Sparkles size={11} className="shrink-0"/>
              Mondaily will start surfacing signals once more workspace activity is available.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {visible.map(n => {
            const isRisk = n.type === "ai_risk";
            return (
            <div
              key={n.id}
              className={`group flex w-full items-start gap-3 px-1 py-4 transition-colors ${
                !n.is_read
                  ? isRisk ? "bg-amber-500/[.04]" : "bg-indigo-500/[.04]"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
              }`}
            >
              {/* Unread indicator */}
              {isRisk && !n.is_read
                ? <ShieldAlert size={14} className="mt-1 shrink-0 text-amber-400"/>
                : <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${!n.is_read ? "bg-indigo-400" : "bg-transparent"}`}/>
              }

              {/* Content */}
              <button className="flex-1 min-w-0 text-left" onClick={() => handleClick(n)}>
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm font-medium ${!n.is_read ? "text-neutral-950 dark:text-neutral-50" : "text-neutral-600 dark:text-neutral-400"}`}>{n.title}</p>
                  {n.type && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] capitalize ${isRisk ? "border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400" : "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500"}`}>
                      {TYPE_LABELS[n.type] ?? n.type}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-500">{n.body}</p>
                <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-700">{relTime(n.created_at)}</p>
              </button>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {!n.is_read && (
                  <button
                    onClick={() => markRead.mutate(n.id)}
                    title="Mark read"
                    className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-500 dark:text-neutral-600 dark:hover:text-emerald-400"
                  >
                    <Check size={12}/>
                  </button>
                )}
                <button
                  onClick={() => deleteOne.mutate(n.id)}
                  title="Delete"
                  className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-indigo-500/10 hover:text-indigo-500 dark:text-neutral-600 dark:hover:text-indigo-400"
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

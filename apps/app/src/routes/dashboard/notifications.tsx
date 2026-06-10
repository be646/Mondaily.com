import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";

interface Notification {
  id: string; title: string; body: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiClient.get<Notification[]>("/notifications") });
  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });
  const markAll = useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });

  const notifications = query.data ?? [];
  const unread = notifications.filter(n => !n.is_read).length;

  const handleClick = (n: Notification) => {
    markRead.mutate(n.id);
    if (n.task_id) navigate("/tasks");
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        </div>
        {unread > 0 && (
          <button onClick={() => markAll.mutate()}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
            <CheckCheck size={14}/> Mark all read
          </button>
        )}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/[.03] animate-pulse"/>)}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={32} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-slate-500 text-sm">No notifications yet</p>
          <p className="text-slate-700 text-xs mt-1">Review requests, approvals, and mentions will appear here</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map(n => (
            <button key={n.id} onClick={() => handleClick(n)}
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-white/[.02] ${!n.is_read ? "border-red-500/15 bg-red-500/5" : "border-white/[.04]"}`}>
              <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${!n.is_read ? "bg-red-400" : "bg-transparent"}`}/>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${!n.is_read ? "text-white" : "text-slate-400"}`}>{n.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                <p className="text-[11px] text-slate-700 mt-1">{new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

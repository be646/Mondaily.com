import { useState, useEffect } from "react";
import { Bell, Check, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";

interface Notification {
  id: string; title: string; body: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const notifQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<Notification[]>("/notifications"),
    refetchInterval: 30000 // poll every 30s
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });

  const notifications = notifQ.data ?? [];
  const unread = notifications.filter(n => !n.is_read).length;

  const handleClick = (n: Notification) => {
    markRead.mutate(n.id);
    if (n.task_id) navigate("/tasks");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[.05] hover:text-white transition-colors">
        <Bell size={16}/>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-white/10 bg-[#161820] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm font-medium text-white">Notifications</span>
              {unread > 0 && (
                <button onClick={() => markAllRead.mutate()} className="text-xs text-slate-500 hover:text-white transition-colors">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-600">No notifications</div>
              ) : (
                notifications.map(n => (
                  <button key={n.id} onClick={() => handleClick(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 border-b border-white/[.04] last:border-0 hover:bg-white/[.04] transition-colors text-left ${!n.is_read ? "bg-white/[.02]" : ""}`}>
                    <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${!n.is_read ? "bg-red-400" : "bg-transparent"}`}/>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.is_read ? "text-white" : "text-slate-400"}`}>{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</p>
                      <p className="text-[11px] text-slate-700 mt-1">{new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

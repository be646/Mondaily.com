import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";

interface Notification {
  id: string; title: string; body: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const notifQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<Notification[]>("/notifications"),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = notifQ.data ?? [];
  const unread = notifications.filter(n => !n.is_read).length;

  function handleClick(n: Notification) {
    markRead.mutate(n.id);
    if (n.task_id) navigate("/tasks");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[.04] hover:text-slate-300 transition-colors"
      >
        <Bell size={15}/>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-indigo-500 text-[9px] font-semibold text-white flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 top-9 z-50 w-80 rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.06]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white">Notifications</span>
                {unread > 0 && (
                  <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">{unread}</span>
                )}
              </div>
              {unread > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-[11px] text-zinc-500 hover:text-white transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-72 overflow-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell size={20} className="mx-auto mb-2 text-zinc-700"/>
                  <p className="text-[12px] text-zinc-600">No notifications yet</p>
                </div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 border-b border-white/[.04] last:border-0 hover:bg-white/[.03] transition-colors text-left ${!n.is_read ? "bg-white/[.02]" : ""}`}
                  >
                    <div className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${!n.is_read ? "bg-indigo-400" : "bg-transparent"}`}/>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-medium leading-snug ${!n.is_read ? "text-white" : "text-zinc-400"}`}>{n.title}</p>
                      {n.body && <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{n.body}</p>}
                      <p className="text-[10px] text-zinc-700 mt-1">{fmtTime(n.created_at)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-white/[.06] px-4 py-2.5">
              <button
                onClick={() => { setOpen(false); navigate("/notifications"); }}
                className="w-full text-center text-[11px] text-zinc-600 hover:text-white transition-colors"
              >
                View all notifications →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

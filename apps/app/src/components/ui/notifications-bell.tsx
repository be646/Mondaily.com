import { useState } from "react";
import { Bell, ArrowUpRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";
import { resolveNotificationLink } from "../../lib/notification-link";
import { CATEGORY_META, actionLabel, actorLabel, type GroupableNotification } from "../../lib/notification-groups";

type Notification = GroupableNotification & { body: string };

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
    refetchInterval: 15_000, // live: poll every 15s
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
    navigate(resolveNotificationLink(n));
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        title="Notifications"
      >
        <Bell size={15}/>
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-semibold leading-none"
            style={{ background: "var(--section-accent)", color: "var(--surface-page)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 top-9 z-50 w-80 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">Notifications</span>
                {unread > 0 && (
                  <span className="rounded-full bg-stone-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-stone-400">{unread}</span>
                )}
              </div>
              {unread > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-[11px] text-stone-500 hover:text-[var(--text-primary)] transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List — grouped by category, each notification answers what/who/source/action */}
            <div className="max-h-96 overflow-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell size={20} className="mx-auto mb-2 text-stone-700"/>
                  <p className="text-[12px] text-stone-600">No notifications yet</p>
                </div>
              ) : (
                CATEGORY_META.map(cat => {
                  const items = notifications.filter(n => (n.category ?? "system") === cat.key);
                  if (items.length === 0) return null;
                  const groupUnread = items.filter(n => !n.is_read).length;
                  return (
                    <div key={cat.key}>
                      <div className="flex items-center gap-1.5 bg-[var(--surface-hover)]/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        <cat.Icon size={11}/> {cat.label}
                        {groupUnread > 0 && <span className="text-[var(--section-accent)]">· {groupUnread}</span>}
                      </div>
                      {items.map(n => {
                        const actor = actorLabel(n);
                        return (
                          <button
                            key={n.id}
                            onClick={() => handleClick(n)}
                            className={`flex w-full items-start gap-3 px-4 py-2.5 border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors text-left ${!n.is_read ? "bg-[var(--surface-hover)]" : ""}`}
                          >
                            <div className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${!n.is_read ? "bg-[color:var(--section-accent)]" : "bg-transparent"}`}/>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[12px] font-medium leading-snug ${!n.is_read ? "text-[var(--text-primary)]" : "text-stone-400"}`}>{n.title}</p>
                              {n.body && <p className="text-[11px] text-stone-600 mt-0.5 line-clamp-2">{n.body}</p>}
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-stone-700">
                                {actor && <span className="text-[var(--text-faint)]">by {actor}</span>}
                                <span>{fmtTime(n.created_at)}</span>
                                <span className="inline-flex items-center gap-0.5 text-[var(--section-accent)]">{actionLabel(n)} <ArrowUpRight size={9}/></span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-[var(--border-soft)] px-4 py-2.5">
              <button
                onClick={() => { setOpen(false); navigate("/notifications"); }}
                className="w-full text-center text-[11px] text-stone-600 hover:text-[var(--text-primary)] transition-colors"
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

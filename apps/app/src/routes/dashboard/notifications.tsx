import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2, ShieldAlert } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { resolveNotificationLink } from "../../lib/notification-link";

interface Notification {
  id: string; title: string; body: string; type: string;
  task_id?: string; is_read: boolean; created_at: string;
  metadata?: Record<string, unknown> | null;
}

const TYPE_LABELS: Record<string, string> = {
  task_review: "Task review", mention: "Mention", approval: "Approval",
  system: "System", comment: "Comment", assignment: "Assignment",
  ai_risk: "AI Risk Alert", email: "Email", agent: "Agent",
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
    refetchInterval: 15_000, // live: poll every 15s
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
    navigate(resolveNotificationLink(n));
  }

  return (
    <div className="min-h-full bg-[#09090b] font-mono text-zinc-300">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>// SIGNAL FEED</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-100">Notifications</h1>
            <p className="mt-0.5 text-[11px] text-zinc-600">{unread > 0 ? `${unread} unread · live` : "all caught up · live"}</p>
          </div>
          {unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-[12px] text-zinc-300 transition-colors hover:border-zinc-600 disabled:opacity-50"
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(["all", "unread"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-lg border px-3 py-1.5 text-[11px] uppercase tracking-wide transition-colors"
              style={filter === f
                ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
                : { borderColor: "#27272a", color: "#71717a" }}
            >
              {f === "all" ? "All" : `Unread · ${unread}`}
            </button>
          ))}
          {types.length > 1 && types.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors"
              style={typeFilter === t
                ? { borderColor: "#3f3f46", color: "#e4e4e7", background: "#18181b" }
                : { borderColor: "#27272a", color: "#52525b" }}
            >
              {t === "all" ? "All types" : (TYPE_LABELS[t] ?? t)}
            </button>
          ))}
        </div>

        {/* List */}
        {query.isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg border border-[#27272a] bg-[#18181b]" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-sm border border-[#27272a] bg-[#18181b] py-16 text-center">
            <Bell size={28} className="mx-auto mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-400">{filter === "unread" ? "No unread signals" : "No notifications yet"}</p>
            <p className="mt-1 text-xs text-zinc-700">Reviews, approvals, mentions, and agent events surface here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-[#27272a] bg-[#18181b]">
            {visible.map((n, i) => {
              const isRisk = n.type === "ai_risk";
              return (
                <div
                  key={n.id}
                  className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#202023]"
                  style={{
                    ...(i > 0 ? { borderTop: "1px solid #27272a" } : {}),
                    ...(!n.is_read ? { background: isRisk ? "rgba(251,191,36,0.05)" : "rgba(132,204,130,0.04)" } : {}),
                  }}
                >
                  {isRisk && !n.is_read
                    ? <ShieldAlert size={14} className="mt-1 shrink-0 text-amber-400" />
                    : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: !n.is_read ? "var(--accent)" : "transparent" }} />}

                  <button className="min-w-0 flex-1 text-left" onClick={() => handleClick(n)}>
                    <div className="flex items-center gap-2">
                      <p className={`truncate text-[13px] ${!n.is_read ? "text-zinc-100" : "text-zinc-500"}`}>{n.title}</p>
                      {n.type && (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                          style={isRisk
                            ? { border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.1)", color: "#fbbf24" }
                            : { border: "1px solid #27272a", background: "#0e0e10", color: "#71717a" }}
                        >
                          {TYPE_LABELS[n.type] ?? n.type}
                        </span>
                      )}
                    </div>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-zinc-600">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-zinc-700">{relTime(n.created_at)}</p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!n.is_read && (
                      <button onClick={() => markRead.mutate(n.id)} title="Mark read"
                        className="rounded-md p-1.5 text-zinc-600 transition-colors hover:text-emerald-400">
                        <Check size={12} />
                      </button>
                    )}
                    <button onClick={() => deleteOne.mutate(n.id)} title="Delete"
                      className="rounded-md p-1.5 text-zinc-600 transition-colors hover:text-rose-400">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

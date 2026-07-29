import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2, ShieldAlert, ArrowUpRight } from "lucide-react";
import { CommandPageHeader } from "../../components/ui/controls";
import { apiClient } from "../../lib/api-client";
import { useLanguage } from "../../hooks/useLanguage";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { resolveNotificationLink } from "../../lib/notification-link";
import { groupByCategory, actorLabel, actionLabel, type GroupableNotification } from "../../lib/notification-groups";

type Notification = GroupableNotification & { body: string };

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
  const { t } = useLanguage();
  const [filter, setFilter] = useState<"all" | "unread">("all");

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

  const visible = all.filter(n => filter === "unread" ? !n.is_read : true);
  const groups = groupByCategory(visible);

  function handleClick(n: Notification) {
    if (!n.is_read) markRead.mutate(n.id);
    navigate(resolveNotificationLink(n));
  }

  return (
    <div className="min-h-full bg-[var(--surface-page)] text-[var(--text-faint)]">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Header */}
        <CommandPageHeader
          icon={Bell}
          callsign="SIGNAL FEED"
          title={t("nav.notifications")}
          status={[unread > 0
            ? { label: `${unread} unread`, kind: "monitoring" as const }
            : { label: t("notifications.caught_up"), kind: "complete" as const }]}
          primaryAction={unread > 0 ? (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2 text-[12px] text-[var(--text-faint)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              <CheckCheck size={13} /> {t("notifications.mark_all")}
            </button>
          ) : undefined}
        />

        {/* Filter bar */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(["all", "unread"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-lg border px-3 py-1.5 text-[11px] uppercase tracking-wide transition-colors"
              style={filter === f
                ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 10%, transparent)" }
                : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
            >
              {f === "all" ? "All" : `Unread · ${unread}`}
            </button>
          ))}
        </div>

        {/* List */}
        {query.isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)]" />)}
          </div>
        ) : query.isError ? (
          // A failed fetch used to fall through to the empty state, telling the user they had no
          // notifications when the request had simply failed.
          <div role="alert" className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] py-16 text-center">
            <Bell size={28} className="mx-auto mb-3 text-[var(--text-secondary)]" />
            <p className="text-sm text-[var(--text-faint)]">Couldn&rsquo;t load notifications</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">This is a loading problem, not an empty inbox. It retries automatically.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] py-16 text-center">
            <Bell size={28} className="mx-auto mb-3 text-[var(--text-secondary)]" />
            <p className="text-sm text-[var(--text-faint)]">{filter === "unread" ? "No unread signals" : "No notifications yet"}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Reviews, approvals, mentions, and agent events surface here.</p>
          </div>
        ) : (
          // Grouped by the same five categories as the bell. Read/unread, mark-read, delete, and
          // click-to-navigate are all unchanged — only the layout groups.
          <div className="space-y-5">
            {groups.map(group => (
              <section key={group.key}>
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  <group.Icon size={12} /> {group.label}
                  <span className="text-[var(--text-secondary)]">· {group.items.length}</span>
                </div>
                <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
                  {group.items.map((n, i) => {
                    const isRisk = n.type === "ai_risk";
                    const actor = actorLabel(n);
                    return (
                      <div
                        key={n.id}
                        className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-selected)]"
                        style={{
                          ...(i > 0 ? { borderTop: "1px solid var(--border-soft)" } : {}),
                          ...(!n.is_read ? { background: isRisk ? "rgba(251,191,36,0.05)" : "rgba(132,204,130,0.04)" } : {}),
                        }}
                      >
                        {isRisk && !n.is_read
                          ? <ShieldAlert size={14} className="mt-1 shrink-0 text-[#c6892e]" />
                          : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: !n.is_read ? "var(--section-accent)" : "transparent" }} />}

                        <button className="min-w-0 flex-1 text-left" onClick={() => handleClick(n)}>
                          <p className={`truncate text-[13px] ${!n.is_read ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>{n.title}</p>
                          {n.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--text-secondary)]">{n.body}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-secondary)]">
                            {actor && <span>by {actor}</span>}
                            <span>{relTime(n.created_at)}</span>
                            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--section-accent)" }}>{actionLabel(n)} <ArrowUpRight size={9} /></span>
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          {!n.is_read && (
                            <button onClick={() => markRead.mutate(n.id)} title="Mark read"
                              className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:text-[#2f9e6b]">
                              <Check size={12} />
                            </button>
                          )}
                          <button onClick={() => deleteOne.mutate(n.id)} title="Delete"
                            className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:text-[#d1524a]">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

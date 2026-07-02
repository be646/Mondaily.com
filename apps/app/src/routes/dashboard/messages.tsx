import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, User as UserIcon, Inbox as InboxIcon, Archive } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useTableRealtime } from "../../hooks/useTableRealtime";

/**
 * Mondaily Inbox — internal, workspace-scoped member-to-member messaging.
 * Real data only: /messages/inbox (conversation list + unread) and /messages/thread/:id
 * (full 1:1 conversation). Replaces the old `mailto:` action. A `?to=<memberId>` query
 * opens (or starts) that conversation directly — used by Team Intelligence "Message".
 */
interface InboxThread { thread_key: string; other_id: string; name: string; email: string | null; avatar_url: string | null; last: string; last_at: string; unread: number; outgoing: boolean }
interface ThreadMsg { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; mine: boolean }
interface ThreadResp { other: { user_id: string; name: string; email: string | null; avatar_url: string | null }; messages: ThreadMsg[] }

const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  if (url) return <img src={url} alt={name} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
  return (
    <span style={{ width: size, height: size, background: "var(--surface-hover)", color: "var(--text-secondary)" }} className="flex shrink-0 items-center justify-center rounded-full text-[12px] font-semibold">
      {name?.trim()?.[0]?.toUpperCase() || <UserIcon size={14} />}
    </span>
  );
}

export function MessagesPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const active = params.get("to");

  // Live updates on any message change in this workspace; invalidate inbox + the open thread.
  const live = useTableRealtime("internal_messages", () => {
    qc.invalidateQueries({ queryKey: ["messages-inbox"] });
    if (active) qc.invalidateQueries({ queryKey: ["messages-thread", active] });
  });

  const inboxQ = useQuery<{ inbox: InboxThread[]; unread_total: number }>({
    queryKey: ["messages-inbox"],
    queryFn: () => apiClient.get("/messages/inbox"),
    // Realtime carries updates when live; poll only as a slow fallback when it isn't configured.
    refetchInterval: live.current ? false : 20_000,
  });
  const inbox = inboxQ.data?.inbox ?? [];

  const setActive = (id: string) => { setParams(id ? { to: id } : {}, { replace: true }); };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>Inbox</h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>Private messages with your workspace members.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* conversation list */}
        <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {inboxQ.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : inbox.length === 0 && !active ? (
            <div className="px-4 py-12 text-center">
              <InboxIcon size={18} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>No conversations yet.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {inbox.map((t) => (
                <button key={t.thread_key} onClick={() => setActive(t.other_id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ background: active === t.other_id ? "var(--surface-selected)" : undefined }}>
                  <Avatar name={t.name} url={t.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{t.name}</span>
                      {t.unread > 0 && <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: "var(--section-accent)" }}>{t.unread}</span>}
                    </div>
                    <span className="truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>{t.outgoing ? "You: " : ""}{t.last}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* thread */}
        {active ? <Thread otherId={active} live={live.current} onSent={() => { qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onArchived={() => { setActive(""); qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} />
          : <div className="hidden items-center justify-center rounded-sm border lg:flex" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", minHeight: 320 }}>
              <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>Select a conversation</p>
            </div>}
      </div>
    </div>
  );
}

function Thread({ otherId, live, onSent, onArchived }: { otherId: string; live: boolean; onSent: () => void; onArchived: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadQ = useQuery<ThreadResp>({
    queryKey: ["messages-thread", otherId],
    queryFn: () => apiClient.get(`/messages/thread/${encodeURIComponent(otherId)}`),
    // Parent invalidates this query on realtime events; poll only as a fallback when not live.
    refetchInterval: live ? false : 12_000,
  });
  const messages = useMemo(() => threadQ.data?.messages ?? [], [threadQ.data]);
  const other = threadQ.data?.other;

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => apiClient.post("/messages", { recipient_id: otherId, body }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: ["messages-thread", otherId] }); onSent(); },
  });
  const archive = useMutation({
    mutationFn: () => apiClient.patch(`/messages/thread/${encodeURIComponent(otherId)}/archive`),
    onSuccess: onArchived,
  });

  const submit = () => { const b = draft.trim(); if (b) send.mutate(b); };

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", minHeight: 320, maxHeight: 560 }}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={other?.name ?? "Member"} url={other?.avatar_url ?? null} size={28} />
          <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{other?.name ?? "…"}</span>
        </div>
        {messages.length > 0 && (
          <button onClick={() => archive.mutate()} disabled={archive.isPending} className="inline-flex items-center gap-1 text-[11.5px] hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>
            <Archive size={12} /> Archive
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {threadQ.isLoading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>No messages yet — say hello.</p>
        ) : messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[78%] rounded-lg px-3 py-2" style={{ background: m.mine ? "var(--section-accent)" : "var(--surface-hover)", color: m.mine ? "#fff" : "var(--text-primary)" }}>
              <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug">{m.body}</p>
              <p className="mt-1 text-[10px]" style={{ color: m.mine ? "rgba(255,255,255,0.7)" : "var(--text-faint)" }}>{when(m.created_at)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Write a message…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 resize-none bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)", maxHeight: 120 }} />
        <button onClick={submit} disabled={!draft.trim() || send.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
          {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
      </div>
      {send.isError && <p className="px-4 pb-2 text-[11.5px]" style={{ color: "#e11d48" }}>Couldn't send — {(send.error as Error)?.message ?? "try again"}.</p>}
    </div>
  );
}

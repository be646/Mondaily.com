import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, User as UserIcon, Inbox as InboxIcon, Archive, Plus, X, Search, Copy, Trash2, Sparkles, ArrowLeft, Check, CheckCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import { useLanguage } from "../../hooks/useLanguage";
import { useCurrentUser } from "../../hooks/useCurrentUser";

/**
 * Mondaily Inbox — internal, workspace-scoped member-to-member messaging.
 * Real data only: /messages/inbox (conversation list + unread) and /messages/thread/:id
 * (full 1:1 conversation). Replaces the old `mailto:` action. A `?to=<memberId>` query
 * opens (or starts) that conversation directly — used by Team Intelligence "Message".
 */
interface InboxThread { thread_key: string; other_id: string; name: string; email: string | null; avatar_url: string | null; last: string; last_at: string; unread: number; outgoing: boolean }
interface ThreadMsg { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null; mine: boolean }
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
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const active = params.get("to");
  const [pickerOpen, setPickerOpen] = useState(false);

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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("inbox.title")}</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>{t("inbox.subtitle")}</p>
        </div>
        <button onClick={() => setPickerOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "var(--section-accent)" }}>
          <Plus size={13} /> {t("inbox.new_message")}
        </button>
      </div>

      {pickerOpen && <NewMessageModal onClose={() => setPickerOpen(false)} onPick={(id) => { setPickerOpen(false); setActive(id); }} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* conversation list — on mobile it hides once a thread is open (single-pane) */}
        <div className={`overflow-hidden rounded-sm border ${active ? "hidden lg:block" : "block"}`} style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {inboxQ.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
          ) : inboxQ.isError ? (
            <div className="px-4 py-10 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>Couldn't load your inbox. <button onClick={() => inboxQ.refetch()} className="underline">Retry</button></div>
          ) : inbox.length === 0 && !active ? (
            <div className="px-4 py-12 text-center">
              <InboxIcon size={20} className="mx-auto mb-2.5" style={{ color: "var(--text-faint)" }} />
              <p className="mb-3 text-[12.5px]" style={{ color: "var(--text-muted)" }}>{t("inbox.empty_title")}</p>
              <button onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
                style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}>
                <Plus size={13} /> {t("inbox.message_teammate")}
              </button>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {inbox.map((th) => (
                <button key={th.thread_key} onClick={() => setActive(th.other_id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ background: active === th.other_id ? "var(--surface-selected)" : undefined }}>
                  <Avatar name={th.name} url={th.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{th.name}</span>
                      {th.unread > 0 && <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: "var(--section-accent)" }}>{th.unread}</span>}
                    </div>
                    <span className="truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>{th.outgoing ? "You: " : ""}{th.last}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* thread */}
        {active ? <Thread otherId={active} live={live.current} onSent={() => { qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onArchived={() => { setActive(""); qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onBack={() => setActive("")} />
          : <div className="hidden flex-col items-center justify-center gap-3 rounded-sm border lg:flex" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", minHeight: 320 }}>
              <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>{t("inbox.select_conversation")}</p>
              <button onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
                style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)" }}>
                <Plus size={13} /> {t("inbox.new_message")}
              </button>
            </div>}
      </div>
    </div>
  );
}

function Thread({ otherId, live, onSent, onArchived, onBack }: { otherId: string; live: boolean; onSent: () => void; onArchived: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadQ = useQuery<ThreadResp>({
    queryKey: ["messages-thread", otherId],
    queryFn: () => apiClient.get(`/messages/thread/${encodeURIComponent(otherId)}`),
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
  const del = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/messages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages-thread", otherId] }),
  });

  const submit = () => { const b = draft.trim(); if (b) send.mutate(b); };
  function copyMsg(m: ThreadMsg) { navigator.clipboard?.writeText(m.body).then(() => { setCopied(m.id); setTimeout(() => setCopied(null), 1200); }, () => {}); }

  // AI draft — fills the compose box; the user reviews and sends. NEVER auto-sends.
  async function aiDraft() {
    const p = aiPrompt.trim(); if (!p || aiBusy) return;
    setAiBusy(true); setAiError("");
    try {
      const r = await apiClient.post<{ draft?: string; error?: string }>("/messages/draft", { prompt: p, existing: draft.trim() || undefined });
      if (r.draft) { setDraft(r.draft); setAiOpen(false); setAiPrompt(""); }
      else setAiError(r.error || "Couldn't draft that.");
    } catch { setAiError("Couldn't draft that — please try again."); }
    finally { setAiBusy(false); }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", minHeight: 320, maxHeight: 560 }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <button onClick={onBack} className="btn-icon h-7 w-7 lg:hidden" aria-label="Back"><ArrowLeft size={15} /></button>
          <Avatar name={other?.name ?? "Member"} url={other?.avatar_url ?? null} size={30} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{other?.name ?? "…"}</div>
            {other?.email && <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{other.email}</div>}
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => archive.mutate()} disabled={archive.isPending} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>
            <Archive size={12} /> Archive
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {threadQ.isLoading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
        ) : threadQ.isError ? (
          <div className="py-8 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>Couldn't load this conversation. <button onClick={() => threadQ.refetch()} className="underline">Retry</button></div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>{t("inbox.no_messages")}</p>
        ) : messages.map((m) => (
          <div key={m.id} className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
            {/* hover actions on the left of my bubbles / right of theirs */}
            {m.mine && (
              <div className="mr-1 flex items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
                <button onClick={() => copyMsg(m)} title="Copy" className="rounded p-1" style={{ color: "var(--text-faint)" }}>{copied === m.id ? <Check size={12} /> : <Copy size={12} />}</button>
                <button onClick={() => del.mutate(m.id)} title="Delete" className="rounded p-1" style={{ color: "var(--text-faint)" }}><Trash2 size={12} /></button>
              </div>
            )}
            <div className="max-w-[78%] rounded-lg px-3 py-2" style={{ background: m.mine ? "var(--section-accent)" : "var(--surface-hover)", color: m.mine ? "#fff" : "var(--text-primary)" }}>
              <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug">{m.body}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: m.mine ? "rgba(255,255,255,0.72)" : "var(--text-faint)" }}>
                {when(m.created_at)}
                {/* Read/Sent state from the real read_at — never faked. */}
                {m.mine && (m.read_at ? <><CheckCheck size={11} /> Read</> : <><Check size={11} /> Sent</>)}
              </p>
            </div>
            {!m.mine && (
              <div className="ml-1 flex items-center self-center opacity-0 transition-opacity group-hover:opacity-100">
                <button onClick={() => copyMsg(m)} title="Copy" className="rounded p-1" style={{ color: "var(--text-faint)" }}>{copied === m.id ? <Check size={12} /> : <Copy size={12} />}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI draft prompt (opens above the compose box) — drafts into the box, never sends. */}
      {aiOpen && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}><Sparkles size={12} /> Draft with AI · you review &amp; send</div>
          <div className="flex items-end gap-2">
            <input autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aiDraft(); } }}
              placeholder={draft.trim() ? "How should I rewrite it?" : "What do you want to say?"}
              className="flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={aiDraft} disabled={!aiPrompt.trim() || aiBusy} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>{aiBusy ? <Loader2 size={13} className="animate-spin" /> : "Draft"}</button>
            <button onClick={() => { setAiOpen(false); setAiError(""); }} className="btn-icon h-8 w-8"><X size={14} /></button>
          </div>
          {aiError && <p className="mt-1 text-[11px]" style={{ color: "#e11d48" }}>{aiError}</p>}
        </div>
      )}

      <div className="flex items-end gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <button onClick={() => setAiOpen(o => !o)} title="Draft with AI" className="btn-icon h-8 w-8 shrink-0" style={{ color: aiOpen ? "var(--section-accent)" : "var(--text-faint)" }}><Sparkles size={15} /></button>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder={t("inbox.write_message")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 resize-none bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)", maxHeight: 120 }} />
        <button onClick={submit} disabled={!draft.trim() || send.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--section-accent)" }}>
          {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("inbox.send")}
        </button>
      </div>
      {send.isError && <p className="px-4 pb-2 text-[11.5px]" style={{ color: "#e11d48" }}>Couldn't send — {(send.error as Error)?.message ?? "try again"}.</p>}
    </div>
  );
}

// ── New-message member picker ─────────────────────────────────────────────────
interface MemberRow { id: string; name?: string; email: string; role: string }
function NewMessageModal({ onClose, onPick }: { onClose: () => void; onPick: (userId: string) => void }) {
  const { t } = useLanguage();
  const me = useCurrentUser();
  const [q, setQ] = useState("");
  const membersQ = useQuery<{ members: MemberRow[] }>({
    queryKey: ["workspace-members-full"],
    queryFn: () => apiClient.get("/workspace/members-full"),
    staleTime: 60_000,
  });
  const list = (membersQ.data?.members ?? [])
    .filter((m) => m.id !== me.userId)   // can't DM yourself
    .filter((m) => { const s = q.trim().toLowerCase(); return !s || (m.name ?? "").toLowerCase().includes(s) || m.email.toLowerCase().includes(s); });

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[201] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border shadow-2xl" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("inbox.new_message")}</span>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15} /></button>
        </div>
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>
            <Search size={13} style={{ color: "var(--text-faint)" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("inbox.search_members")}
              className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)" }} />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {membersQ.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> {t("state.loading")}</div>
          ) : list.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>{t("state.empty")}</p>
          ) : list.map((m) => (
            <button key={m.id} onClick={() => onPick(m.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]">
              <Avatar name={m.name || m.email} url={null} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{m.name || m.email}</div>
                <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{m.email} · {m.role}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, User as UserIcon, Inbox as InboxIcon, Archive, Plus, X, Search, Copy, Trash2, Sparkles, ArrowLeft, Check, CheckCheck, Paperclip, FileText, Download, UsersRound, Lock, MessagesSquare, CornerDownLeft } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import { useLanguage } from "../../hooks/useLanguage";
import { CommandPageHeader } from "../../components/ui/controls";
import { EmptyState, ErrorState } from "../../components/ui/page-state";
import { useCurrentUser } from "../../hooks/useCurrentUser";



/** Upload attachments DIRECTLY to storage using short-lived signed URLs.
 *  The old path base64'd the bytes into a JSON body — ~33% larger than the file, so 5 x 10 MB
 *  became a ~67 MB request that the platform's body cap rejected before the handler ever ran,
 *  surfacing as a generic "Upload failed". The API now only handles metadata. */
async function uploadAttachments(files: File[]): Promise<MsgAttachment[]> {
  const prepared = await apiClient.post<{ attachments: (MsgAttachment & { upload_url: string })[] }>(
    "/messages/attachments/upload-url",
    { files: files.map((f) => ({ name: f.name, content_type: f.type || "application/octet-stream", size: f.size })) },
  );
  await Promise.all(prepared.attachments.map(async (a, i) => {
    const file = files[i];
    if (!file) return;
    const res = await fetch(a.upload_url, {
      method: "PUT",
      headers: { "Content-Type": a.content_type },
      body: file,
    });
    if (!res.ok) throw new Error(`Couldn't upload "${file.name}" (${res.status}).`);
  }));
  // Strip the signed URL — only the metadata travels on with the message.
  return prepared.attachments.map(({ path, name, content_type, size }) => ({ path, name, content_type, size }));
}

/**
 * Mondaily Inbox — internal, workspace-scoped member-to-member messaging.
 * Real data only: /messages/inbox (conversation list + unread) and /messages/thread/:id
 * (full 1:1 conversation). Replaces the old `mailto:` action. A `?to=<memberId>` query
 * opens (or starts) that conversation directly — used by Team Intelligence "Message".
 */
interface InboxThread { thread_key: string; other_id: string; name: string; email: string | null; avatar_url: string | null; last: string; last_at: string; unread: number; outgoing: boolean }
interface MsgAttachment { path: string; name: string; content_type: string; size: number }
interface ThreadMsg { id: string; sender_id: string; recipient_id: string; body: string; attachments?: MsgAttachment[]; created_at: string; read_at: string | null; mine: boolean }
interface InboxGroup { group_id: string; name: string; last: string; last_at: string; unread: number; members: number }
interface GroupMsg { id: string; sender_id: string; sender_name: string; body: string; attachments?: MsgAttachment[]; created_at: string; mine: boolean }
interface GroupResp { group: { id: string; name: string; created_by: string }; members: { user_id: string; name: string; avatar_url: string | null }[]; messages: GroupMsg[] }
interface ThreadResp { other: { user_id: string; name: string; email: string | null; avatar_url: string | null }; messages: ThreadMsg[] }
interface SearchHit { id: string; other_id: string; name: string; avatar_url: string | null; body: string; created_at: string; mine: boolean }

const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const timeOnly = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };
// Human day label for thread separators — Today / Yesterday / date.
function dayLabel(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

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
  const activeGroup = params.get("g");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Real message search across the caller's own conversations (server-side, participant-scoped).
  const [search, setSearch] = useState("");
  const searchQ = useQuery<{ results: SearchHit[] }>({
    queryKey: ["messages-search", search],
    queryFn: () => apiClient.get(`/messages/search?q=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
    staleTime: 10_000,
  });
  const searching = search.trim().length >= 2;

  // Live updates on any message change in this workspace; invalidate inbox + the open thread.
  const live = useTableRealtime("internal_messages", () => {
    qc.invalidateQueries({ queryKey: ["messages-inbox"] });
    if (active) qc.invalidateQueries({ queryKey: ["messages-thread", active] });
    if (activeGroup) qc.invalidateQueries({ queryKey: ["messages-group", activeGroup] });
  });

  const inboxQ = useQuery<{ inbox: InboxThread[]; groups?: InboxGroup[]; unread_total: number }>({
    queryKey: ["messages-inbox"],
    queryFn: () => apiClient.get("/messages/inbox"),
    // Realtime carries updates when live; poll only as a slow fallback when it isn't configured.
    refetchInterval: live.current ? false : 20_000,
  });
  const inbox = inboxQ.data?.inbox ?? [];

  const setActive = (id: string) => { setParams(id ? { to: id } : {}, { replace: true }); };
  const setActiveGroup = (id: string) => { setParams(id ? { g: id } : {}, { replace: true }); };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Shared command header — same pattern as the rest of the app. New-message stays primary. */}
      <CommandPageHeader
        icon={InboxIcon}
        callsign="INBOX"
        title={t("inbox.title")}
        subtitle={t("inbox.subtitle")}
        primaryAction={
          <button onClick={() => setPickerOpen(true)} aria-label={t("inbox.new_message")}
            className="flex shrink-0 items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" style={{ borderColor: "var(--border-strong)", background: "var(--surface-card-2)", color: "var(--text-primary)" }}>
            <Plus size={13} /> {t("inbox.new_message")}
          </button>
        }
      />

      {pickerOpen && <NewMessageModal onClose={() => setPickerOpen(false)} onPick={(id) => { setPickerOpen(false); setActive(id); }} onGroupCreated={(id) => { setPickerOpen(false); setActiveGroup(id); }} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]" style={{ height: "calc(100vh - 12.5rem)", minHeight: 380 }}>
        {/* conversation list — on mobile it hides once a thread is open (single-pane) */}
        <div className={`flex flex-col overflow-hidden rounded-sm border ${(active || activeGroup) ? "hidden lg:flex" : "flex"}`} style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {/* search — real server-side lookup across your own conversations */}
          <div className="border-b px-2.5 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
              <Search size={13} style={{ color: "var(--text-faint)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages…"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" style={{ color: "var(--text-primary)" }} />
              {search && <button onClick={() => setSearch("")} className="shrink-0" style={{ color: "var(--text-faint)" }}><X size={13} /></button>}
            </div>
          </div>
          {searching ? (
            <div className="flex-1 overflow-y-auto">
              {searchQ.isLoading ? (
                <div className="flex items-center gap-2 px-4 py-8 text-[12.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Searching…</div>
              ) : (searchQ.data?.results ?? []).length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>No messages match "{search.trim()}".</p>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                  {(searchQ.data?.results ?? []).map((hit) => (
                    <button key={hit.id} onClick={() => { setSearch(""); setActive(hit.other_id); }}
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
                      <Avatar name={hit.name} url={hit.avatar_url} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{hit.mine ? `You → ${hit.name}` : hit.name}</span>
                          <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>{when(hit.created_at)}</span>
                        </div>
                        <span className="line-clamp-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{hit.body}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : inboxQ.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
          ) : inboxQ.isError ? (
            <ErrorState error={new Error("Couldn't load your inbox right now.")} onRetry={() => inboxQ.refetch()} />
          ) : inbox.length === 0 && !active ? (
            // Guided empty list — real starting points, honest about what each does. No fake threads.
            <div className="px-3 py-8">
              <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-sm" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>
                <MessagesSquare size={20} />
              </span>
              <p className="mb-1 text-center text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("inbox.empty_title")}</p>
              <p className="mb-1.5 text-center text-[11.5px] leading-snug" style={{ color: "var(--text-muted)" }}>Smart, private team messaging — direct threads and groups, all inside Mondaily.</p>
              <p className="mb-4 flex items-center justify-center gap-1 text-center text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                <Lock size={9} className="shrink-0" /> Workspace-only. No outside inboxes, no fake presence.
              </p>
              <div className="space-y-1.5">
                {[
                  { icon: Plus, label: t("inbox.message_teammate"), hint: "Start a direct message with anyone in this workspace." },
                  { icon: UsersRound, label: "Create a group", hint: "A shared thread for a team or project — members only." },
                ].map((s, i) => (
                  <button key={i} onClick={() => setPickerOpen(true)}
                    className="group/cta flex w-full items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors hover:border-[var(--section-accent)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
                    style={{ borderColor: "var(--border-soft)" }}>
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>
                      <s.icon size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{s.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{s.hint}</span>
                    </span>
                    <CornerDownLeft size={12} className="mt-1 shrink-0 opacity-0 transition-opacity group-hover/cta:opacity-60" style={{ color: "var(--section-accent)" }} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {(inboxQ.data?.groups ?? []).length > 0 && (
                <div className="divide-y border-b" style={{ borderColor: "var(--border-soft)" }}>
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    <UsersRound size={11} /> Groups
                    <span className="ml-auto tabular-nums" style={{ color: "var(--text-faint)" }}>{(inboxQ.data?.groups ?? []).length}</span>
                  </div>
                  {(inboxQ.data?.groups ?? []).map((g) => (
                    <button key={g.group_id} onClick={() => setActiveGroup(g.group_id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ background: activeGroup === g.group_id ? "var(--surface-selected)" : undefined, boxShadow: activeGroup === g.group_id ? "inset 3px 0 0 var(--section-accent)" : undefined }}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>{g.name.trim()[0]?.toUpperCase() ?? "G"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{g.name}</span>
                          {g.unread > 0 && <span className="shrink-0 rounded-sm px-1.5 py-px text-[10px] font-semibold" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>{g.unread}</span>}
                        </div>
                        <span className="truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>{g.members} member{g.members !== 1 ? "s" : ""} · {g.last}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {/* Only label the direct list when groups are also present, so a groups-less inbox
                  stays clean — clear separation between team groups and 1:1s. */}
              {(inboxQ.data?.groups ?? []).length > 0 && inbox.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                  <MessagesSquare size={11} /> Direct messages
                  <span className="ml-auto tabular-nums" style={{ color: "var(--text-faint)" }}>{inbox.length}</span>
                </div>
              )}
              {inbox.map((th) => (
                <button key={th.thread_key} onClick={() => setActive(th.other_id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ background: active === th.other_id ? "var(--surface-selected)" : undefined, boxShadow: active === th.other_id ? "inset 3px 0 0 var(--section-accent)" : undefined }}>
                  <Avatar name={th.name} url={th.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{th.name}</span>
                      {th.unread > 0 && <span className="shrink-0 rounded-sm px-1.5 py-px text-[10px] font-semibold" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>{th.unread}</span>}
                    </div>
                    <span className="truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>{th.outgoing ? "You: " : ""}{th.last}</span>
                  </div>
                </button>
              ))}
            </div>
            </div>
          )}
        </div>

        {/* thread */}
        {activeGroup ? <GroupThread groupId={activeGroup} live={live.current} onSent={() => { qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onLeft={() => { setActiveGroup(""); qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onBack={() => setActiveGroup("")} />
          : active ? <Thread otherId={active} live={live.current} onSent={() => { qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onArchived={() => { setActive(""); qc.invalidateQueries({ queryKey: ["messages-inbox"] }); }} onBack={() => setActive("")} />
          : <div className="hidden flex-col overflow-hidden rounded-sm border lg:flex" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              {/* Centered guided empty state — real CTAs, honest AI line. Fills the panel with intent, not a dead void. */}
              <div className="flex flex-1 items-center justify-center px-4">
                <EmptyState icon={InboxIcon} title={t("inbox.select_conversation")} description={t("inbox.subtitle")}
                  aiHint="Once you're chatting, the ✦ button drafts a message with AI — you always review before it sends."
                  steps={[
                    { icon: Plus, label: t("inbox.new_message"), hint: "Direct message any workspace member.", onClick: () => setPickerOpen(true) },
                    { icon: UsersRound, label: "Create a group", hint: "A membership-guarded thread for a team or project.", onClick: () => setPickerOpen(true) },
                  ]} />
              </div>
              {/* Honest capability rail — describes what this messenger actually does. No metrics, no fake state. */}
              <div className="grid shrink-0 grid-cols-3 gap-px border-t" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
                {[
                  { icon: MessagesSquare, label: "Direct & groups", hint: "1:1 and team threads" },
                  { icon: Paperclip, label: "Share files", hint: "Up to 5 × 10 MB" },
                  { icon: Sparkles, label: "AI draft", hint: "You review, you send" },
                ].map((f, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 px-3 py-3.5 text-center" style={{ background: "var(--surface-card)" }}>
                    <f.icon size={14} style={{ color: "var(--section-accent)" }} />
                    <span className="text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>{f.label}</span>
                    <span className="text-[10px] leading-tight" style={{ color: "var(--text-faint)" }}>{f.hint}</span>
                  </div>
                ))}
              </div>
            </div>}
      </div>
    </div>
  );
}

function Thread({ otherId, live, onSent, onArchived, onBack }: { otherId: string; live: boolean; onSent: () => void; onArchived: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MsgAttachment[]>([]);   // uploaded, not yet sent
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  // True only while the compose box holds an AI-generated draft the user hasn't touched yet — drives
  // an honest "AI draft · review before sending" marker. Cleared the moment they edit or send.
  const [aiDrafted, setAiDrafted] = useState(false);
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
    mutationFn: (body: string) => apiClient.post("/messages", { recipient_id: otherId, body, ...(pending.length ? { attachments: pending } : {}) }),
    onSuccess: () => { setDraft(""); setPending([]); setAiDrafted(false); qc.invalidateQueries({ queryKey: ["messages-thread", otherId] }); onSent(); },
  });

  // Upload files to the private bucket first; the metadata rides on the message when sent.
  async function pickFiles(list: FileList | null) {
    if (!list?.length || uploading) return;
    setAttachError("");
    const files = [...list].slice(0, 5 - pending.length);
    const tooBig = files.find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) { setAttachError(`"${tooBig.name}" is over the 10 MB limit.`); return; }
    setUploading(true);
    try {
      const uploaded = await uploadAttachments(files);
      setPending((p) => [...p, ...uploaded]);
    } catch (e) {
      try { setAttachError(JSON.parse((e as Error).message)?.error ?? "Upload failed — try again."); }
      catch { setAttachError("Upload failed — try again."); }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Open an attachment via a short-lived signed URL (participant-verified server-side).
  async function openAttachment(a: MsgAttachment) {
    try {
      const r = await apiClient.get<{ url: string }>(`/messages/attachment?path=${encodeURIComponent(a.path)}`);
      if (r.url) window.open(r.url, "_blank", "noopener");
    } catch { /* signed-url fetch failed — nothing to open */ }
  }

  const fmtSize = (n: number) => n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const archive = useMutation({
    mutationFn: () => apiClient.patch(`/messages/thread/${encodeURIComponent(otherId)}/archive`),
    onSuccess: onArchived,
  });
  const del = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/messages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages-thread", otherId] }),
  });

  const submit = () => { const b = draft.trim(); if ((b || pending.length) && !uploading) send.mutate(b || "(attachment)"); };
  function copyMsg(m: ThreadMsg) { navigator.clipboard?.writeText(m.body).then(() => { setCopied(m.id); setTimeout(() => setCopied(null), 1200); }, () => {}); }

  // AI draft — fills the compose box; the user reviews and sends. NEVER auto-sends.
  async function aiDraft() {
    const p = aiPrompt.trim(); if (!p || aiBusy) return;
    setAiBusy(true); setAiError("");
    try {
      const r = await apiClient.post<{ draft?: string; error?: string }>("/messages/draft", { prompt: p, existing: draft.trim() || undefined });
      if (r.draft) { setDraft(r.draft); setAiDrafted(true); setAiOpen(false); setAiPrompt(""); }
      else setAiError(r.error || "Couldn't draft that.");
    } catch { setAiError("Couldn't draft that — please try again."); }
    finally { setAiBusy(false); }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
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
        ) : messages.map((m, i) => (
          <div key={m.id}>
            {/* Day separator — a thin centered label whenever the calendar day changes. */}
            {(i === 0 || dayLabel(messages[i - 1]!.created_at) !== dayLabel(m.created_at)) && (
              <div className="my-3 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
                <span className="text-caption font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{dayLabel(m.created_at)}</span>
                <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
              </div>
            )}
          <div className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
            {/* hover actions on the left of my bubbles / right of theirs */}
            {m.mine && (
              <div className="mr-1 flex items-center gap-0.5 self-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button onClick={() => copyMsg(m)} title="Copy" className="rounded p-1" style={{ color: "var(--text-faint)" }}>{copied === m.id ? <Check size={12} /> : <Copy size={12} />}</button>
                <button onClick={() => del.mutate(m.id)} title="Delete" className="rounded p-1" style={{ color: "var(--text-faint)" }}><Trash2 size={12} /></button>
              </div>
            )}
            <div className="max-w-[78%] rounded-sm px-3.5 py-2" style={{ background: m.mine ? "var(--section-accent)" : "var(--surface-hover)", color: m.mine ? "#fff" : "var(--text-primary)" }}>
              {m.body !== "(attachment)" && <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug">{m.body}</p>}
              {(m.attachments ?? []).length > 0 && (
                <div className={`${m.body !== "(attachment)" ? "mt-1.5" : ""} space-y-1`}>
                  {(m.attachments ?? []).map((a) => (
                    <button key={a.path} onClick={() => openAttachment(a)} title={`Download ${a.name}`}
                      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left transition-opacity hover:opacity-85"
                      style={{ background: m.mine ? "rgba(255,255,255,0.14)" : "var(--surface-card-2)", border: m.mine ? "none" : "1px solid var(--border-soft)" }}>
                      <FileText size={13} className="shrink-0" style={{ color: m.mine ? "rgba(255,255,255,0.85)" : "var(--section-accent)" }} />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{a.name}</span>
                      <span className="shrink-0 text-[10px]" style={{ color: m.mine ? "rgba(255,255,255,0.7)" : "var(--text-faint)" }}>{fmtSize(a.size)}</span>
                      <Download size={11} className="shrink-0" style={{ color: m.mine ? "rgba(255,255,255,0.7)" : "var(--text-faint)" }} />
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: m.mine ? "rgba(255,255,255,0.72)" : "var(--text-faint)" }}>
                {timeOnly(m.created_at)}
                {/* Read/Sent state from the real read_at — never faked. */}
                {m.mine && (m.read_at ? <><CheckCheck size={11} /> Read</> : <><Check size={11} /> Sent</>)}
              </p>
            </div>
            {!m.mine && (
              <div className="ml-1 flex items-center self-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button onClick={() => copyMsg(m)} title="Copy" className="rounded p-1" style={{ color: "var(--text-faint)" }}>{copied === m.id ? <Check size={12} /> : <Copy size={12} />}</button>
              </div>
            )}
          </div>
          </div>
        ))}
      </div>

      {/* AI draft prompt (opens above the compose box) — drafts into the box, never sends. */}
      {aiOpen && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}><Sparkles size={12} /> Draft with AI · you review &amp; send</div>
          {/* Honest scope — the draft endpoint only sees your prompt (+ current draft), never the conversation. */}
          <p className="mb-2 text-[10.5px] leading-snug" style={{ color: "var(--text-faint)" }}>
            {draft.trim()
              ? "Rewrites your current draft from the instruction below. It doesn't read the conversation."
              : "Writes from your instruction below only — it doesn't read the conversation. You send manually."}
          </p>
          <div className="flex items-end gap-2">
            <input autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aiDraft(); } }}
              placeholder={draft.trim() ? "How should I rewrite it?" : "What do you want to say?"}
              className="flex-1 rounded-sm border bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={aiDraft} disabled={!aiPrompt.trim() || aiBusy} className="btn-primary px-3 py-1.5 text-[12px] font-semibold">{aiBusy ? <Loader2 size={13} className="animate-spin" /> : "Draft"}</button>
            <button onClick={() => { setAiOpen(false); setAiError(""); }} className="btn-icon h-8 w-8"><X size={14} /></button>
          </div>
          {aiError && <p className="mt-1 text-[11px]" style={{ color: "#d1524a" }}>{aiError}</p>}
        </div>
      )}

      {/* pending attachments — uploaded, riding on the next send */}
      {(pending.length > 0 || attachError) && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pending.map((a) => (
                <span key={a.path} className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                  <FileText size={11} style={{ color: "var(--section-accent)" }} /> {a.name} <span style={{ color: "var(--text-faint)" }}>{fmtSize(a.size)}</span>
                  <button onClick={() => setPending((p) => p.filter((x) => x.path !== a.path))} aria-label={`Remove ${a.name}`} style={{ color: "var(--text-faint)" }}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          {attachError && <p className="mt-1 text-[11px]" style={{ color: "#d1524a" }}>{attachError}</p>}
        </div>
      )}

      {/* Honest AI-draft marker — shown only while the box holds an untouched AI draft. Makes it
          unmistakable this text was AI-generated and still needs a human review before it sends. */}
      {aiDrafted && draft.trim() && (
        <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[11px] font-medium" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--section-accent) 7%, transparent)", color: "var(--section-accent)" }}>
          <Sparkles size={11} className="shrink-0" /> AI draft · review before sending
          <span className="font-normal" style={{ color: "var(--text-muted)" }}>— nothing sends until you press Send</span>
          <button onClick={() => { setDraft(""); setAiDrafted(false); }} className="ml-auto shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" title="Clear draft" aria-label="Clear AI draft" style={{ color: "var(--text-faint)" }}><X size={12} /></button>
        </div>
      )}

      <div className="flex items-end gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        {/* AI draft — the one clearly-marked assist control (always accent-tinted so it reads as AI,
            highlighted when its panel is open). Drafts into the box; never auto-sends. */}
        <button onClick={() => setAiOpen(o => !o)} title="Draft with AI" aria-pressed={aiOpen}
          className="btn-icon h-8 w-8 shrink-0" style={{ color: "var(--section-accent)", background: aiOpen ? "color-mix(in srgb, var(--section-accent) 12%, transparent)" : undefined }}><Sparkles size={15} /></button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading || pending.length >= 5} title="Attach files (max 5 × 10 MB)"
          className="btn-icon h-8 w-8 shrink-0 disabled:opacity-40" style={{ color: pending.length ? "var(--section-accent)" : "var(--text-faint)" }}>
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        </button>
        <textarea value={draft} onChange={(e) => { setDraft(e.target.value); if (aiDrafted) setAiDrafted(false); }} rows={1} placeholder={t("inbox.write_message")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 resize-none bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)", maxHeight: 120 }} />
        <button onClick={submit} disabled={(!draft.trim() && pending.length === 0) || send.isPending || uploading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" style={{ background: "var(--section-accent)" }}>
          {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("inbox.send")}
        </button>
      </div>
      {send.isError && <p className="px-4 pb-2 text-[11.5px]" style={{ color: "#d1524a" }}>Couldn't send — {(send.error as Error)?.message ?? "try again"}.</p>}
    </div>
  );
}


// ── Group thread — membership-guarded conversation with sender names ──────────
function GroupThread({ groupId, live, onSent, onLeft, onBack }: { groupId: string; live: boolean; onSent: () => void; onLeft: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MsgAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const groupQ = useQuery<GroupResp>({
    queryKey: ["messages-group", groupId],
    queryFn: () => apiClient.get(`/messages/group/${encodeURIComponent(groupId)}`),
    refetchInterval: live ? false : 12_000,
  });
  const messages = useMemo(() => groupQ.data?.messages ?? [], [groupQ.data]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => apiClient.post("/messages", { group_id: groupId, body, ...(pending.length ? { attachments: pending } : {}) }),
    onSuccess: () => { setDraft(""); setPending([]); qc.invalidateQueries({ queryKey: ["messages-group", groupId] }); onSent(); },
  });
  const leave = useMutation({
    mutationFn: () => apiClient.delete(`/messages/group/${encodeURIComponent(groupId)}/members/me`),
    onSuccess: onLeft,
  });
  const del = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/messages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages-group", groupId] }),
  });

  async function pickFiles(list: FileList | null) {
    if (!list?.length || uploading) return;
    setAttachError("");
    const files = [...list].slice(0, 5 - pending.length);
    const tooBig = files.find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) { setAttachError(`"${tooBig.name}" is over the 10 MB limit.`); return; }
    setUploading(true);
    try {
      const uploaded = await uploadAttachments(files);
      setPending((p) => [...p, ...uploaded]);
    } catch (e) {
      try { setAttachError(JSON.parse((e as Error).message)?.error ?? "Upload failed — try again."); }
      catch { setAttachError("Upload failed — try again."); }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function openAttachment(a: MsgAttachment) {
    try {
      const r = await apiClient.get<{ url: string }>(`/messages/attachment?path=${encodeURIComponent(a.path)}`);
      if (r.url) window.open(r.url, "_blank", "noopener");
    } catch { /* nothing to open */ }
  }
  const fmtSize = (n: number) => n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const submit = () => { const b = draft.trim(); if ((b || pending.length) && !uploading) send.mutate(b || "(attachment)"); };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <button onClick={onBack} className="btn-icon h-7 w-7 lg:hidden" aria-label="Back"><ArrowLeft size={15} /></button>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>{(groupQ.data?.group.name ?? "G").trim()[0]?.toUpperCase()}</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{groupQ.data?.group.name ?? "…"}</div>
            <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
              {(groupQ.data?.members ?? []).map((m) => m.name.split(" ")[0]).slice(0, 6).join(", ")}{(groupQ.data?.members ?? []).length > 6 ? "…" : ""}
            </div>
          </div>
        </div>
        <button onClick={() => leave.mutate()} disabled={leave.isPending} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>
          Leave
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {groupQ.isLoading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> {t("state.loading")}</div>
        ) : groupQ.isError ? (
          <div className="py-8 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>Couldn't load this group. <button onClick={() => groupQ.refetch()} className="underline">Retry</button></div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[12.5px]" style={{ color: "var(--text-faint)" }}>{t("inbox.no_messages")}</p>
        ) : messages.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || dayLabel(messages[i - 1]!.created_at) !== dayLabel(m.created_at)) && (
              <div className="my-3 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
                <span className="text-caption font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{dayLabel(m.created_at)}</span>
                <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
              </div>
            )}
            <div className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
              {m.mine && (
                <div className="mr-1 flex items-center gap-0.5 self-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button onClick={() => del.mutate(m.id)} title="Delete" className="rounded p-1" style={{ color: "var(--text-faint)" }}><Trash2 size={12} /></button>
                </div>
              )}
              <div className="max-w-[78%] rounded-sm px-3.5 py-2" style={{ background: m.mine ? "var(--section-accent)" : "var(--surface-hover)", color: m.mine ? "#fff" : "var(--text-primary)" }}>
                {!m.mine && (i === 0 || messages[i - 1]!.sender_id !== m.sender_id) && (
                  <p className="mb-0.5 text-label font-semibold" style={{ color: "var(--section-accent)" }}>{m.sender_name}</p>
                )}
                {m.body !== "(attachment)" && <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug">{m.body}</p>}
                {(m.attachments ?? []).length > 0 && (
                  <div className={`${m.body !== "(attachment)" ? "mt-1.5" : ""} space-y-1`}>
                    {(m.attachments ?? []).map((a) => (
                      <button key={a.path} onClick={() => openAttachment(a)} title={`Download ${a.name}`}
                        className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left transition-opacity hover:opacity-85"
                        style={{ background: m.mine ? "rgba(255,255,255,0.14)" : "var(--surface-card-2)", border: m.mine ? "none" : "1px solid var(--border-soft)" }}>
                        <FileText size={13} className="shrink-0" style={{ color: m.mine ? "rgba(255,255,255,0.85)" : "var(--section-accent)" }} />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{a.name}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: m.mine ? "rgba(255,255,255,0.7)" : "var(--text-faint)" }}>{fmtSize(a.size)}</span>
                        <Download size={11} className="shrink-0" style={{ color: m.mine ? "rgba(255,255,255,0.7)" : "var(--text-faint)" }} />
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-caption" style={{ color: m.mine ? "rgba(255,255,255,0.72)" : "var(--text-faint)" }}>{timeOnly(m.created_at)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(pending.length > 0 || attachError) && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pending.map((a) => (
                <span key={a.path} className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                  <FileText size={11} style={{ color: "var(--section-accent)" }} /> {a.name} <span style={{ color: "var(--text-faint)" }}>{fmtSize(a.size)}</span>
                  <button onClick={() => setPending((p) => p.filter((x) => x.path !== a.path))} aria-label={`Remove ${a.name}`} style={{ color: "var(--text-faint)" }}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          {attachError && <p className="mt-1 text-[11px]" style={{ color: "#d1524a" }}>{attachError}</p>}
        </div>
      )}

      <div className="flex items-end gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading || pending.length >= 5} title="Attach files (max 5 × 10 MB)"
          className="btn-icon h-8 w-8 shrink-0 disabled:opacity-40" style={{ color: pending.length ? "var(--section-accent)" : "var(--text-faint)" }}>
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        </button>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder={t("inbox.write_message")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 resize-none bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)", maxHeight: 120 }} />
        <button onClick={submit} disabled={(!draft.trim() && pending.length === 0) || send.isPending || uploading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" style={{ background: "var(--section-accent)" }}>
          {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("inbox.send")}
        </button>
      </div>
      {send.isError && <p className="px-4 pb-2 text-[11.5px]" style={{ color: "#d1524a" }}>Couldn't send — {(send.error as Error)?.message ?? "try again"}.</p>}
    </div>
  );
}

// ── New-message member picker ─────────────────────────────────────────────────
interface MemberRow { id: string; name?: string; email: string; role: string }
function NewMessageModal({ onClose, onPick, onGroupCreated }: { onClose: () => void; onPick: (userId: string) => void; onGroupCreated?: (groupId: string) => void }) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  async function createGroup() {
    const name = groupName.trim();
    if (!name || selected.size === 0 || creating) return;
    setCreating(true); setCreateError("");
    try {
      const r = await apiClient.post<{ id: string }>("/messages/groups", { name, member_ids: [...selected] });
      onGroupCreated?.(r.id);
    } catch (e) {
      try { setCreateError(JSON.parse((e as Error).message)?.error ?? "Couldn't create the group."); }
      catch { setCreateError("Couldn't create the group."); }
      setCreating(false);
    }
  }
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

  // Keyboard-friendly: Esc closes the modal from anywhere inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t("inbox.new_message")}
        className="fixed left-1/2 top-1/2 z-[201] flex max-h-[85vh] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-sm border" style={{ background: "var(--surface-page)", borderColor: "var(--border-soft)" }}>
        {/* Premium header — accent glyph tile + honest subtitle. */}
        <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>
            {mode === "dm" ? <MessagesSquare size={15} /> : <UsersRound size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("inbox.new_message")}</span>
            <span className="block text-[11px]" style={{ color: "var(--text-faint)" }}>{mode === "dm" ? "Open a private 1:1 thread" : "A members-only team thread"}</span>
          </div>
          <button onClick={onClose} className="btn-icon h-7 w-7 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" aria-label="Close"><X size={15} /></button>
        </div>
        {/* Segmented, squared tab control — full-width, clear active state. */}
        <div role="tablist" aria-label="New conversation type" className="grid grid-cols-2 gap-1 border-b p-2" style={{ borderColor: "var(--border-soft)" }}>
          {(["dm", "group"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className="flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
              style={mode === m ? { background: "var(--section-accent-soft)", color: "var(--section-accent)" } : { color: "var(--text-muted)" }}>
              {m === "dm" ? <MessagesSquare size={13} /> : <UsersRound size={13} />}
              {m === "dm" ? "Direct message" : "New group"}
            </button>
          ))}
        </div>
        {mode === "group" && (
          <div className="border-b px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name…" aria-label="Group name"
              className="w-full rounded-sm border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
          </div>
        )}
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-[var(--section-accent)]" style={{ borderColor: "var(--border-soft)" }}>
            <Search size={13} style={{ color: "var(--text-faint)" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("inbox.search_members")} aria-label={t("inbox.search_members")}
              className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)" }} />
          </div>
        </div>
        <div className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1.5">
          {membersQ.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> {t("state.loading")}</div>
          ) : list.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>{t("state.empty")}</p>
          ) : list.map((m) => (
            <button key={m.id} aria-pressed={mode === "group" ? selected.has(m.id) : undefined}
              onClick={() => { if (mode === "dm") { onPick(m.id); } else { setSelected((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; }); } }}
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
              style={mode === "group" && selected.has(m.id) ? { background: "var(--surface-selected)" } : undefined}>
              {mode === "group" && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border" style={{ borderColor: selected.has(m.id) ? "var(--section-accent)" : "var(--border-strong)", background: selected.has(m.id) ? "var(--section-accent)" : "transparent" }}>
                  {selected.has(m.id) && <Check size={11} color="#fff" />}
                </span>
              )}
              <Avatar name={m.name || m.email} url={null} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{m.name || m.email}</div>
                <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{m.email} · {m.role}</div>
              </div>
            </button>
          ))}
        </div>
        {mode === "dm" ? (
          <div className="shrink-0 border-t px-3 py-2 text-center text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
            Pick a member to open a private thread.
          </div>
        ) : (
          <div className="shrink-0 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
            {createError && <p className="mb-1.5 text-[11px]" style={{ color: "#d1524a" }}>{createError}</p>}
            <button onClick={createGroup} disabled={!groupName.trim() || selected.size === 0 || creating}
              className="w-full rounded-sm px-3 py-2 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" style={{ background: "var(--section-accent)" }}>
              {creating ? "Creating…" : `Create group${selected.size ? ` · ${selected.size} member${selected.size !== 1 ? "s" : ""}` : ""}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

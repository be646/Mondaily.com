import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronLeft, ChevronUp, Link2, Mail, MousePointerClick, Eye, Paperclip, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiClient, BASE_URL } from "../../lib/api-client";
import { PageSkeleton, EmptyState } from "../../components/ui/page-state";
import { AIButton } from "../../components/ui/ai-button";

type EmailFilter = "all" | "inbox" | "sent" | "unread";

interface Participant {
  name?: string;
  email: string;
}

interface EmailMessage {
  id: string;
  from: Participant[];
  to: Participant[];
  cc: Participant[];
  date: number;
  body: string;
  attachments: { id?: string; filename: string; size: number; url?: string; path?: string; content_type?: string }[];
}

interface EmailThread {
  id: string;
  subject: string;
  snippet: string;
  participants: Participant[];
  latest_message_received_date: number;
  unread: boolean;
  folders: string[];
  contact?: { id: string; name: string; object_type: string };
  linked_records?: { id: string; name: string; object_type: string }[];
  messages?: EmailMessage[];
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function relativeDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const difference = now.getTime() - date.getTime();
  if (difference < 60 * 60 * 1000) return `${Math.max(1, Math.floor(difference / 60_000))}m`;
  if (difference < 24 * 60 * 60 * 1000) return `${Math.floor(difference / 3_600_000)}h`;
  if (difference < 48 * 60 * 60 * 1000) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function safeHtml(value: string) {
  const documentNode = new DOMParser().parseFromString(value, "text/html");
  documentNode.querySelectorAll("script,style,iframe,object,embed,form").forEach((node) => node.remove());
  documentNode.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.startsWith("on") || attribute.name === "style") node.removeAttribute(attribute.name);
      if (attribute.name === "href" && attribute.value.trim().toLowerCase().startsWith("javascript:")) node.removeAttribute("href");
    });
  });
  return documentNode.body.innerHTML;
}

/** One email attachment. Native mail attachments carry a storage `path`; clicking fetches a short-
 *  lived signed URL and opens it (the browser renders PDFs/images inline, downloads the rest). Gmail
 *  attachments that already have a `url` open directly. */
function AttachmentChip({ attachment }: { attachment: { filename: string; size: number; url?: string; path?: string } }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (attachment.url) { window.open(attachment.url, "_blank", "noopener"); return; }
    if (!attachment.path || busy) return;
    setBusy(true);
    try {
      const { url } = await apiClient.get<{ url: string }>(`/emails/attachment?path=${encodeURIComponent(attachment.path)}`);
      if (url) window.open(url, "_blank", "noopener");
    } catch { /* ignore */ } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={open} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
      <Paperclip size={12} /> {attachment.filename} · {Math.ceil(attachment.size / 1024)} KB
    </button>
  );
}

function ThreadSkeletons() {
  return (
    <div role="status" aria-label="Loading threads" className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex gap-3 p-4">
          <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton-shimmer h-3 w-2/3 rounded" />
            <div className="skeleton-shimmer h-3 w-full rounded" />
            <div className="skeleton-shimmer h-3 w-4/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplyComposer({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [improving, setImproving] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editorProps: { attributes: { class: "min-h-28 px-3 py-3 text-sm leading-6 outline-none text-[var(--text-primary)]" } }
  });
  const reply = useMutation({
    mutationFn: () => apiClient.post(`/emails/threads/${threadId}/reply`, { body: editor?.getHTML() ?? "" }),
    onSuccess: () => {
      editor?.commands.clearContent();
      qc.invalidateQueries({ queryKey: ["email-thread", threadId] });
      qc.invalidateQueries({ queryKey: ["email-threads"] });
    }
  });

  async function improveDraft() {
    if (!editor || editor.isEmpty || improving) return;
    setImproving(true);
    try {
      const res = await apiClient.post<{ html?: string; error?: string }>("/emails/improve-draft", { body: editor.getHTML() });
      if (res.html) editor.commands.setContent(res.html);
    } catch { /* leave the draft as-is on failure */ }
    finally { setImproving(false); }
  }

  if (!editor) return <div className="skeleton-shimmer h-40 rounded-lg" />;
  return (
    <div className="border-t p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
      <div className="surface-input overflow-hidden rounded-lg">
        <EditorContent editor={editor} />
        <div className="flex flex-wrap items-center gap-2 border-t p-2" style={{ borderColor: "var(--border-soft)" }}>
          <button type="button" title="Attach file" className="btn-icon"><Paperclip size={14} /></button>
          <AIButton variant="subtle" size="sm" onClick={improveDraft} disabled={editor.isEmpty} loading={improving}>{improving ? "Improving…" : "AI improve"}</AIButton>
          <button type="button" onClick={() => reply.mutate()} disabled={reply.isPending || editor.isEmpty} className="btn-primary ml-auto h-8 px-3 text-xs"><Send size={13} /> {reply.isPending ? "Sending..." : "Send reply"}</button>
        </div>
      </div>
      {reply.isError ? <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">{reply.error.message}</p> : null}
    </div>
  );
}

function MessageCard({ message, expanded, onToggle }: { message: EmailMessage; expanded: boolean; onToggle: () => void }) {
  const sender = message.from?.[0]; // sender array can be empty — guard against crash
  return (
    <article className="surface-card overflow-hidden rounded-lg">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}>{initials(sender?.name || sender?.email || "?")}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{sender?.name || sender?.email}</p>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>to {message.to.map((person) => person.name || person.email).join(", ")}</p>
        </div>
        <span className="shrink-0 text-xs" style={{ color: "var(--text-faint)" }}>{new Date(message.date * 1000).toLocaleString()}</span>
        {expanded ? <ChevronUp className="shrink-0" size={15} style={{ color: "var(--text-faint)" }} /> : <ChevronDown className="shrink-0" size={15} style={{ color: "var(--text-faint)" }} />}
      </button>
      {expanded ? <div className="border-t px-4 pb-5 pt-4" style={{ borderColor: "var(--border-soft)" }}>
        {message.cc.length ? <p className="mb-4 text-xs" style={{ color: "var(--text-faint)" }}>CC: {message.cc.map((person) => person.email).join(", ")}</p> : null}
        <div className="email-body text-sm leading-6" style={{ color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: safeHtml(message.body) }} />
        {message.attachments.length ? <div className="mt-5 flex flex-wrap gap-2">{message.attachments.map((attachment, ai) => <AttachmentChip key={attachment.id ?? attachment.path ?? ai} attachment={attachment} />)}</div> : null}
      </div> : null}
    </article>
  );
}

// ─── Email tracking panel ──────────────────────────────────────────────────────
interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  status: string;
  sent_at?: string;
  requested_at?: string;
  open_count: number;
  click_count: number;
  last_opened_at?: string;
  last_clicked_at?: string;
}

function SentTracker() {
  const { data: emails = [], isLoading } = useQuery({
    queryKey: ["email-outbox"],
    queryFn: () => apiClient.get<OutboxEmail[]>("/emails/outbox"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="p-6"><PageSkeleton rows={5} label="Loading sent emails…"/></div>;

  if (emails.length === 0) return (
    <EmptyState icon={Eye} title="No sent emails yet" description="Emails you send will appear here with open and click tracking."/>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-2xl space-y-2">
        {emails.map(email => {
          const opened = email.open_count > 0;
          const clicked = email.click_count > 0;
          const date = email.sent_at || email.requested_at;
          return (
            <div key={email.id} className="surface-card rounded-sm px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{email.subject || "(no subject)"}</p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>To: {email.to}</p>
                  {date && <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>{new Date(date).toLocaleString()}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {/* Open indicator */}
                  <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border ${opened ? "bg-[#5f8169]/10 text-[#5f8169] border-emerald-500/20" : "border-transparent"}`} style={!opened ? { background: "var(--surface-hover)", color: "var(--text-faint)" } : undefined}>
                    <Eye size={11}/>
                    <span>{email.open_count > 0 ? `Opened ${email.open_count}×` : "Not opened"}</span>
                  </div>
                  {/* Click indicator */}
                  <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border ${clicked ? "bg-[#717784]/10 text-[#717784] border-blue-500/20" : "border-transparent"}`} style={!clicked ? { background: "var(--surface-hover)", color: "var(--text-faint)" } : undefined}>
                    <MousePointerClick size={11}/>
                    <span>{email.click_count > 0 ? `${email.click_count} click${email.click_count !== 1 ? "s" : ""}` : "No clicks"}</span>
                  </div>
                </div>
              </div>
              {(email.last_opened_at || email.last_clicked_at) && (
                <div className="mt-2 flex gap-4 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {email.last_opened_at && <span>Last opened: {new Date(email.last_opened_at).toLocaleString()}</span>}
                  {email.last_clicked_at && <span>Last clicked: {new Date(email.last_clicked_at).toLocaleString()}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmailsPage() {
  const [tab, setTab] = useState<"inbox" | "tracking">("inbox");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [expandedMessages, setExpandedMessages] = useState<string[]>([]);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);

  const threadsQuery = useQuery({
    queryKey: ["email-threads", filter, search],
    queryFn: () => apiClient.get<{ threads: EmailThread[]; connected: boolean }>(`/emails/threads?filter=${filter}&search=${encodeURIComponent(search)}`)
  });
  const threadQuery = useQuery({
    queryKey: ["email-thread", selectedId],
    queryFn: () => apiClient.get<EmailThread>(`/emails/threads/${selectedId}`),
    enabled: Boolean(selectedId)
  });
  const threads = threadsQuery.data?.threads ?? [];
  const selected = threadQuery.data;

  useEffect(() => {
    if (!selectedId && threads[0]) setSelectedId(threads[0].id);
  }, [selectedId, threads]);
  useEffect(() => {
    const latest = selected?.messages?.at(-1);
    if (latest) setExpandedMessages([latest.id]);
  }, [selected?.id, selected?.messages]);

  const selectedContact = selected?.contact?.name || selected?.participants[0]?.name || selected?.participants[0]?.email || "Conversation";
  const filters = useMemo(() => ["all", "inbox", "sent", "unread"] as const, []);

  async function connectGmail() {
    try {
      const { auth_url } = await apiClient.post<{ auth_url: string }>("/integrations/connect", { provider: "google" });
      window.open(auth_url, "_blank", "width=520,height=680");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start email connection.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 py-3 sm:px-6 flex items-center gap-4" style={{ borderColor: "var(--border-soft)" }}>
        <p className="text-sm flex-1" style={{ color: "var(--text-muted)" }}>Synced Gmail and Outlook conversations.</p>
        <div className="flex gap-1">
          <button onClick={() => setTab("inbox")} className="btn-tab" data-active={tab === "inbox"}>
            <Mail size={12}/> Inbox
          </button>
          <button onClick={() => setTab("tracking")} className="btn-tab" data-active={tab === "tracking"}>
            <Eye size={12}/> Tracking
          </button>
        </div>
      </header>
      {tab === "tracking" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>Open and click events for emails you've sent from Mondaily.</p>
          </div>
          <SentTracker/>
        </div>
      ) : null}
      <div className={`flex min-h-0 flex-1 overflow-hidden ${tab !== "inbox" ? "hidden" : ""}`}>
        <section className={`${mobileThreadOpen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r md:w-80`} style={{ borderColor: "var(--border-soft)" }}>
          <div className="space-y-3 border-b p-3" style={{ borderColor: "var(--border-soft)" }}>
            <label className="relative block">
              <Search className="absolute left-3 top-2.5" size={14} style={{ color: "var(--text-faint)" }} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email" className="key-input h-9 w-full pl-9 pr-3 text-sm" />
            </label>
            <div className="flex gap-1 overflow-x-auto">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className="btn-tab shrink-0 capitalize" data-active={filter === item}>{item}</button>)}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {threadsQuery.isLoading ? <ThreadSkeletons /> : threads.length === 0 ? (
              <EmptyState icon={Mail} title="Connect your email to see threads here" description="Sync Gmail or Outlook to start seeing conversations alongside your records." action={<button onClick={connectGmail} className="btn-primary text-sm">Connect Gmail</button>}/>
            ) : threads.map((thread) => {
              const contactName = thread.contact?.name || thread.participants[0]?.name || thread.participants[0]?.email || "Unknown";
              const active = selectedId === thread.id;
              return <button key={thread.id} onClick={() => { setSelectedId(thread.id); setMobileThreadOpen(true); }}
                className="relative flex w-full gap-3 border-b p-4 text-left transition-colors"
                style={{ borderColor: "var(--border-soft)", background: active ? "var(--surface-selected)" : undefined }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--surface-hover)"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}>{initials(contactName)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)", fontWeight: thread.unread ? 600 : 400 }}>{contactName}</p>
                    <span className="shrink-0 text-[11px]" style={{ color: "var(--text-faint)" }}>{relativeDate(thread.latest_message_received_date)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs" style={{ color: thread.unread ? "var(--text-secondary)" : "var(--text-muted)", fontWeight: thread.unread ? 500 : 400 }}>{thread.subject || "(no subject)"}</p>
                  <p className="mt-1 truncate text-xs" style={{ color: "var(--text-faint)" }}>{thread.snippet}</p>
                  {thread.linked_records?.[0] ? <span className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}><Link2 size={9} /> {thread.linked_records[0].name}</span> : null}
                </div>
                {thread.unread ? <span className="absolute right-3 top-10 h-2 w-2 rounded-full bg-[#717784]" /> : null}
              </button>;
            })}
          </div>
        </section>
        <section className={`${mobileThreadOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`} style={{ background: "var(--surface-card-2)" }}>
          {!selectedId ? (
            <div className="grid h-full place-items-center text-center">
              <div><Mail className="mx-auto mb-3" size={30} style={{ color: "var(--text-faint)" }} /><p className="text-sm" style={{ color: "var(--text-muted)" }}>Select an email thread</p></div>
            </div>
          ) : threadQuery.isLoading ? <div className="p-6"><ThreadSkeletons /></div> : selected ? <>
            <div className="flex items-start gap-3 border-b px-4 py-4 sm:px-6" style={{ borderColor: "var(--border-soft)" }}>
              <button onClick={() => setMobileThreadOpen(false)} className="btn-icon md:hidden"><ChevronLeft size={17} /></button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{selected.subject || "(no subject)"}</h2>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{selectedContact} · {selected.messages?.length ?? 0} messages</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-4xl space-y-3">{selected.messages?.map((message) => <MessageCard key={message.id} message={message} expanded={expandedMessages.includes(message.id)} onToggle={() => setExpandedMessages((current) => current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id])} />)}</div></div>
            <ReplyComposer threadId={selected.id} />
          </> : <div className="grid h-full place-items-center text-sm" style={{ color: "var(--text-muted)" }}>Thread unavailable.</div>}
        </section>
      </div>
    </div>
  );
}

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronLeft, ChevronUp, Link2, Mail, Paperclip, Search, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../lib/api-client";

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
  attachments: { id: string; filename: string; size: number; url?: string }[];
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

function ThreadSkeletons() {
  return <div className="divide-y divide-white/10">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="flex gap-3 p-4"><div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[.05]" /><div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-2/3 animate-pulse rounded bg-white/[.05]" /><div className="h-3 w-full animate-pulse rounded bg-white/[.035]" /><div className="h-3 w-4/5 animate-pulse rounded bg-white/[.035]" /></div></div>)}</div>;
}

function ReplyComposer({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [improving, setImproving] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editorProps: { attributes: { class: "min-h-28 px-3 py-3 text-sm leading-6 text-slate-200 outline-none" } }
  });
  const reply = useMutation({
    mutationFn: () => apiClient.post(`/emails/threads/${threadId}/reply`, { body: editor?.getHTML() ?? "" }),
    onSuccess: () => {
      editor?.commands.clearContent();
      qc.invalidateQueries({ queryKey: ["email-thread", threadId] });
      qc.invalidateQueries({ queryKey: ["email-threads"] });
    }
  });

  function improveDraft() {
    if (!editor || editor.isEmpty) return;
    setImproving(true);
    const text = editor.getText().trim();
    const polished = text
      .replace(/\bi want\b/gi, "I'd like")
      .replace(/\bcan you\b/gi, "could you")
      .replace(/\bthanks\b[.!]?$/i, "Thanks,")
      .replace(/\s+/g, " ");
    editor.commands.setContent(`<p>${polished}</p>`);
    window.setTimeout(() => setImproving(false), 350);
  }

  if (!editor) return <div className="h-40 animate-pulse rounded-lg bg-white/[.035]" />;
  return (
    <div className="border-t border-white/10 bg-[#0d1014] p-4">
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0b0d10]">
        <EditorContent editor={editor} />
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-2">
          <button type="button" title="Attach file" className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-white/[.05] hover:text-white"><Paperclip size={14} /></button>
          <button type="button" onClick={improveDraft} disabled={improving || editor.isEmpty} className="flex h-8 items-center gap-2 rounded px-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"><Sparkles size={13} /> {improving ? "Improving..." : "AI improve"}</button>
          <button type="button" onClick={() => reply.mutate()} disabled={reply.isPending || editor.isEmpty} className="ml-auto flex h-8 items-center gap-2 rounded bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-50"><Send size={13} /> {reply.isPending ? "Sending..." : "Send reply"}</button>
        </div>
      </div>
      {reply.isError ? <p className="mt-2 text-xs text-red-400">{reply.error.message}</p> : null}
    </div>
  );
}

function MessageCard({ message, expanded, onToggle }: { message: EmailMessage; expanded: boolean; onToggle: () => void }) {
  const sender = message.from[0];
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[.015]">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(sender?.name || sender?.email || "?")}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sender?.name || sender?.email}</p><p className="mt-0.5 truncate text-xs text-slate-500">to {message.to.map((person) => person.name || person.email).join(", ")}</p></div>
        <span className="shrink-0 text-xs text-slate-600">{new Date(message.date * 1000).toLocaleString()}</span>
        {expanded ? <ChevronUp className="shrink-0 text-slate-600" size={15} /> : <ChevronDown className="shrink-0 text-slate-600" size={15} />}
      </button>
      {expanded ? <div className="border-t border-white/10 px-4 pb-5 pt-4">
        {message.cc.length ? <p className="mb-4 text-xs text-slate-600">CC: {message.cc.map((person) => person.email).join(", ")}</p> : null}
        <div className="email-body text-sm leading-6 text-slate-300" dangerouslySetInnerHTML={{ __html: safeHtml(message.body) }} />
        {message.attachments.length ? <div className="mt-5 flex flex-wrap gap-2">{message.attachments.map((attachment) => <a key={attachment.id} href={attachment.url || "#"} className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white"><Paperclip size={12} /> {attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</a>)}</div> : null}
      </div> : null}
    </article>
  );
}

export function EmailsPage() {
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

  function connectGmail() {
    window.open("/api/v1/integrations/gmail/connect", "_blank", "width=520,height=680");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-white/10 px-4 py-4 sm:px-6"><h1 className="text-xl font-semibold">Emails</h1><p className="mt-1 text-sm text-slate-500">Synced Gmail and Outlook conversations.</p></header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className={`${mobileThreadOpen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-white/10 md:w-80`}>
          <div className="space-y-3 border-b border-white/10 p-3">
            <label className="relative block"><Search className="absolute left-3 top-2.5 text-slate-600" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email" className="h-9 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm outline-none focus:border-white/20" /></label>
            <div className="flex gap-1 overflow-x-auto">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs capitalize ${filter === item ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>{item}</button>)}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {threadsQuery.isLoading ? <ThreadSkeletons /> : threads.length === 0 ? <div className="flex h-full min-h-80 flex-col items-center justify-center px-6 text-center"><div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-white/[.04] text-slate-600"><Mail size={22} /></div><h2 className="text-sm font-medium">Connect your email to see threads here</h2><button onClick={connectGmail} className="mt-4 rounded-md bg-red-600 px-3 py-2 text-sm font-medium">Connect Gmail</button></div> : threads.map((thread) => {
              const contactName = thread.contact?.name || thread.participants[0]?.name || thread.participants[0]?.email || "Unknown";
              return <button key={thread.id} onClick={() => { setSelectedId(thread.id); setMobileThreadOpen(true); }} className={`relative flex w-full gap-3 border-b border-white/10 p-4 text-left hover:bg-white/[.025] ${selectedId === thread.id ? "bg-white/[.04]" : ""}`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(contactName)}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-sm ${thread.unread ? "font-semibold text-white" : "text-slate-300"}`}>{contactName}</p><span className="shrink-0 text-[11px] text-slate-600">{relativeDate(thread.latest_message_received_date)}</span></div><p className={`mt-1 truncate text-xs ${thread.unread ? "font-medium text-slate-300" : "text-slate-500"}`}>{thread.subject || "(no subject)"}</p><p className="mt-1 truncate text-xs text-slate-600">{thread.snippet}</p>{thread.linked_records?.[0] ? <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-500"><Link2 size={9} /> {thread.linked_records[0].name}</span> : null}</div>
                {thread.unread ? <span className="absolute right-3 top-10 h-2 w-2 rounded-full bg-blue-500" /> : null}
              </button>;
            })}
          </div>
        </section>
        <section className={`${mobileThreadOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-[#0b0d10]`}>
          {!selectedId ? <div className="grid h-full place-items-center text-center"><div><Mail className="mx-auto mb-3 text-slate-700" size={30} /><p className="text-sm text-slate-500">Select an email thread</p></div></div> : threadQuery.isLoading ? <div className="space-y-3 p-6"><ThreadSkeletons /></div> : selected ? <>
            <div className="flex items-start gap-3 border-b border-white/10 px-4 py-4 sm:px-6"><button onClick={() => setMobileThreadOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded hover:bg-white/[.05] md:hidden"><ChevronLeft size={17} /></button><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{selected.subject || "(no subject)"}</h2><p className="mt-1 text-xs text-slate-500">{selectedContact} · {selected.messages?.length ?? 0} messages</p></div></div>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-4xl space-y-3">{selected.messages?.map((message) => <MessageCard key={message.id} message={message} expanded={expandedMessages.includes(message.id)} onToggle={() => setExpandedMessages((current) => current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id])} />)}</div></div>
            <ReplyComposer threadId={selected.id} />
          </> : <div className="grid h-full place-items-center text-sm text-slate-500">Thread unavailable.</div>}
        </section>
      </div>
    </div>
  );
}

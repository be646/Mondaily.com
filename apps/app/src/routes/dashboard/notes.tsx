import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, Link2, MessageCircle, Pencil, Plus, Search, SmilePlus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NoteEditor } from "../../components/notes/note-editor";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

interface Note {
  id: string;
  node_id: string;
  content: string;
  author_id: string | null;
  author_name: string;
  actor_type: string;
  created_at: string;
  updated_at: string;
  reactions: Record<string, number>;
  reply_count: number;
  record: { id: string; object_type: string; name: string };
}

interface RecordOption {
  id: string;
  object_type: string;
  data: Record<string, unknown>;
}

function cleanHtml(html: string) {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
  documentNode.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.startsWith("on") || attribute.name === "style") node.removeAttribute(attribute.name);
    });
  });
  return documentNode.body.innerHTML;
}

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function NotesPage() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "mine" | "following">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "updated">("newest");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [content, setContent] = useState("<p></p>");
  const [recordSearch, setRecordSearch] = useState("");
  const [linkedRecord, setLinkedRecord] = useState<RecordOption>();
  const [editing, setEditing] = useState<Note>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, number>>>({});

  const notesQuery = useQuery({
    queryKey: ["notes", filter, sort, search],
    queryFn: () => apiClient.get<Note[]>(`/notes?filter=${filter}&sort=${sort}&search=${encodeURIComponent(search)}`)
  });
  const recordsQuery = useQuery({
    queryKey: ["note-records"],
    queryFn: () => apiClient.get<RecordOption[]>("/nodes?limit=50"),
    enabled: modalOpen
  });
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<{ name: string }[]>("/members"),
    enabled: modalOpen
  });
  const createNote = useMutation({
    mutationFn: () => apiClient.post("/notes", { content, node_id: linkedRecord?.id }),
    onSuccess: () => {
      closeModal();
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });
  const updateNote = useMutation({
    mutationFn: () => apiClient.patch(`/notes/${editing?.id}`, { content }),
    onSuccess: () => {
      closeModal();
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] })
  });

  const recordOptions = useMemo(() => {
    const term = recordSearch.toLowerCase();
    return (recordsQuery.data ?? []).filter((record) => `${record.data.name ?? ""} ${record.data.email ?? ""} ${record.data.company ?? ""}`.toLowerCase().includes(term)).slice(0, 8);
  }, [recordSearch, recordsQuery.data]);

  function closeModal() {
    setModalOpen(false);
    setEditing(undefined);
    setContent("<p></p>");
    setLinkedRecord(undefined);
    setRecordSearch("");
  }

  function openEdit(note: Note) {
    setEditing(note);
    setContent(note.content);
    setLinkedRecord({ id: note.record.id, object_type: note.record.object_type, data: { name: note.record.name } });
    setModalOpen(true);
  }

  const notes = notesQuery.data ?? [];
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Notes" description="Context written by your team and Mondaily agents." action={<button onClick={() => setModalOpen(true)} className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium"><Plus size={14} /> New note</button>} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg border border-white/10 p-1">
          {(["all", "mine", "following"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${filter === item ? "bg-white/10 text-white" : "text-slate-500"}`}>{item}</button>)}
        </div>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-3 top-2.5 text-slate-600" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="h-9 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm outline-none focus:border-white/20" /></label>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-white/10 bg-[#0b0d10] px-3 text-sm text-slate-400"><option value="newest">Newest first</option><option value="oldest">Oldest</option><option value="updated">Recently updated</option></select>
        </div>
      </div>
      {notesQuery.isLoading ? <PageSkeleton rows={5} /> : notesQuery.isError ? <ErrorState error={notesQuery.error as Error} onRetry={() => notesQuery.refetch()} /> : notes.length === 0 ? <EmptyState icon={FileText} title="No notes yet" description="Add one to any record." action={<button onClick={() => setModalOpen(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm">Add a note</button>} /> : (
        <div className="space-y-3">
          {notes.map((note) => {
            const isExpanded = expanded.includes(note.id);
            const reactions = localReactions[note.id] ?? note.reactions;
            return <article key={note.id} className="rounded-lg border border-white/10 bg-white/[.015] p-4">
              <div className="flex items-start gap-3">
                {note.actor_type === "ai_agent" ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-400"><Bot size={16} /></div> : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{note.author_name.slice(0, 2).toUpperCase()}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{note.author_name}</span>{note.actor_type === "ai_agent" ? <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">AI</span> : null}<span className="text-xs text-slate-600">{relativeTime(note.updated_at)}</span></div>
                  <div className={`prose prose-invert mt-3 max-w-none text-sm leading-6 text-slate-300 ${isExpanded ? "" : "max-h-[4.5rem] overflow-hidden"}`} dangerouslySetInnerHTML={{ __html: cleanHtml(note.content) }} />
                  {note.content.length > 180 ? <button onClick={() => setExpanded((current) => current.includes(note.id) ? current.filter((id) => id !== note.id) : [...current, note.id])} className="mt-1 text-xs text-red-400">{isExpanded ? "Show less" : "Show more"}</button> : null}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Link to={`/objects/${note.record.object_type}/${note.record.id}`} className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:text-white"><Link2 size={11} /> {note.record.name}</Link>
                    {["👍", "❤️", "🎉"].map((emoji) => <button key={emoji} onClick={() => setLocalReactions((current) => ({ ...current, [note.id]: { ...reactions, [emoji]: (reactions[emoji] ?? 0) + 1 } }))} className="rounded-full border border-white/10 px-2 py-1 text-xs">{emoji} {reactions[emoji] || ""}</button>)}
                    <button title="Add reaction" className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-slate-500"><SmilePlus size={12} /></button>
                    {note.reply_count ? <span className="flex items-center gap-1 text-xs text-slate-500"><MessageCircle size={12} /> {note.reply_count}</span> : null}
                    {note.author_id === userId ? <button onClick={() => openEdit(note)} className="ml-auto grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-white/[.05] hover:text-white"><Pencil size={13} /></button> : null}
                    {note.author_id === userId ? <button onClick={() => deleteNote.mutate(note.id)} className="grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={13} /></button> : null}
                  </div>
                </div>
              </div>
            </article>;
          })}
        </div>
      )}
      {modalOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-white/10 bg-[#111419] p-5">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-medium">{editing ? "Edit note" : "New note"}</h2><p className="mt-1 text-xs text-slate-500">Link the note to a record so the context stays useful.</p></div><button onClick={closeModal} className="grid h-8 w-8 place-items-center rounded hover:bg-white/[.05]"><X size={16} /></button></div>
          {!editing ? <div className="relative mb-4"><input value={recordSearch} onChange={(event) => { setRecordSearch(event.target.value); setLinkedRecord(undefined); }} placeholder="Search records by name, email, or company" className="h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm outline-none" />{recordSearch && !linkedRecord ? <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/[.08] bg-[#13151a] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">{recordOptions.map((record) => <button key={record.id} onClick={() => { setLinkedRecord(record); setRecordSearch(String(record.data.name ?? record.data.title ?? record.id)); }} className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-white/[.05]"><span>{String(record.data.name ?? record.data.title ?? "Untitled")}</span><span className="text-xs text-slate-600">{record.object_type}</span></button>)}</div> : null}</div> : <div className="mb-4 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-400">Linked to {linkedRecord?.data.name as string}</div>}
          <NoteEditor value={content} onChange={setContent} onSave={() => editing ? updateNote.mutate() : linkedRecord ? createNote.mutate() : undefined} saving={createNote.isPending || updateNote.isPending} mentions={(membersQuery.data ?? []).map((member) => member.name)} />
          {!linkedRecord && !editing ? <p className="mt-2 text-xs text-amber-400">Choose a record before saving.</p> : null}
        </div>
      </div> : null}
    </div>
  );
}

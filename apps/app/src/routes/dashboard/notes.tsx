import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, FileText, Link2, Pencil, Pin, Plus, Search, SmilePlus, Trash2, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NoteEditor } from "../../components/notes/note-editor";
import { EmptyState, ErrorState, PageSkeleton } from "../../components/ui/page-state";
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
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (a.name.startsWith("on") || a.name === "style") n.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}

function relativeTime(value: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const OBJECT_COLORS: Record<string, string> = {
  contacts:  "text-blue-400 bg-blue-500/10 border-blue-500/20",
  companies: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  deals:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

const REACTIONS = ["👍", "❤️", "🎉", "🔥", "👀"];

export function NotesPage() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<"all" | "mine" | "ai">("all");
  const [sort,   setSort]   = useState<"newest" | "oldest" | "updated">("newest");
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const [modalOpen,    setModalOpen]    = useState(false);
  const [content,      setContent]      = useState("<p></p>");
  const [recordSearch, setRecordSearch] = useState("");
  const [linkedRecord, setLinkedRecord] = useState<RecordOption>();
  const [editing,      setEditing]      = useState<Note>();
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, number>>>({});
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);

  const notesQ = useQuery({
    queryKey: ["notes", filter, sort, search],
    queryFn:  () => apiClient.get<Note[]>(`/notes?filter=${filter}&sort=${sort}&search=${encodeURIComponent(search)}`),
  });
  const recordsQ = useQuery({
    queryKey: ["note-records"],
    queryFn:  () => apiClient.get<RecordOption[]>("/nodes?limit=50"),
    enabled:  modalOpen,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn:  () => apiClient.get<{ name: string }[]>("/members"),
    enabled:  modalOpen,
  });

  const createNote = useMutation({
    mutationFn: () => apiClient.post("/notes", { content, node_id: linkedRecord?.id }),
    onSuccess:  () => { closeModal(); qc.invalidateQueries({ queryKey: ["notes"] }); },
  });
  const updateNote = useMutation({
    mutationFn: () => apiClient.patch(`/notes/${editing?.id}`, { content }),
    onSuccess:  () => { closeModal(); qc.invalidateQueries({ queryKey: ["notes"] }); },
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notes/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const recordOptions = useMemo(() => {
    const term = recordSearch.toLowerCase();
    return (recordsQ.data ?? [])
      .filter((r) => `${r.data.name ?? ""} ${r.data.email ?? ""} ${r.data.company ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [recordSearch, recordsQ.data]);

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

  function togglePin(id: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function react(noteId: string, emoji: string) {
    setLocalReactions((prev) => ({
      ...prev,
      [noteId]: { ...(prev[noteId] ?? {}), [emoji]: ((prev[noteId] ?? {})[emoji] ?? 0) + 1 },
    }));
    setEmojiPickerFor(null);
  }

  const allNotes   = notesQ.data ?? [];
  const pinnedIds  = pinned;
  const notesSorted = [
    ...allNotes.filter((n) => pinnedIds.has(n.id)),
    ...allNotes.filter((n) => !pinnedIds.has(n.id)),
  ];
  const aiCount    = allNotes.filter((n) => n.actor_type === "ai_agent").length;
  const humanCount = allNotes.length - aiCount;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">

      {/* Header */}
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Notes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Context written by your team and Mondaily agents.
            {allNotes.length > 0 && (
              <span className="ml-2 text-slate-600">
                {humanCount} human · {aiCount} AI
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 flex items-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all"
        >
          <Plus size={14} /> New note
        </button>
      </div>

      {/* Filter + search bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
          {([
            { key: "all",  label: "All"   },
            { key: "mine", label: "Mine"  },
            { key: "ai",   label: "AI"    },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                filter === key ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <label className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-600" size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="key-input h-9 w-full pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-lg border border-white/[.06] bg-[#0d0f13] px-3 text-sm text-slate-400 outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
      </div>

      {/* Note list */}
      {notesQ.isLoading ? (
        <PageSkeleton rows={4} />
      ) : notesQ.isError ? (
        <ErrorState error={notesQ.error as Error} onRetry={() => notesQ.refetch()} />
      ) : notesSorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          description="Capture meeting context, call summaries, and decisions linked to any record."
          action={
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all"
            >
              <Plus size={14} /> Add first note
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {notesSorted.map((note) => {
            const isAI       = note.actor_type === "ai_agent";
            const isPinned   = pinnedIds.has(note.id);
            const isExpanded = expanded.has(note.id);
            const reactions  = { ...note.reactions, ...(localReactions[note.id] ?? {}) };
            const activeReactions = Object.entries(reactions).filter(([, c]) => (c as number) > 0);
            const objColor   = OBJECT_COLORS[note.record.object_type] ?? "text-slate-400 bg-white/[.04] border-white/[.08]";
            const isOwner    = note.author_id === userId;

            return (
              <article
                key={note.id}
                className={`relative rounded-xl border transition-colors ${
                  isAI
                    ? "border-red-500/20 bg-red-500/[.02] hover:border-red-500/30"
                    : "border-white/[.07] bg-white/[.02] hover:border-white/[.10]"
                } ${isPinned ? "ring-1 ring-orange-500/20" : ""}`}
              >
                {/* AI accent strip */}
                {isAI && (
                  <div className="absolute inset-y-0 left-0 w-0.5 rounded-l-xl bg-gradient-to-b from-red-500/60 to-red-500/10" />
                )}

                <div className="p-4 pl-5">
                  {/* Top row: author + meta */}
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      {isAI ? (
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
                          <Bot size={14} />
                        </div>
                      ) : (
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.05] text-[11px] font-bold text-white">
                          {initials(note.author_name)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{note.author_name}</span>
                          {isAI && (
                            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              AI
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-600">{relativeTime(note.updated_at)}</span>
                      </div>
                    </div>

                    {/* Right: record chip + pin */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        to={`/objects/${note.record.object_type}/${note.record.id}`}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 ${objColor}`}
                      >
                        <Link2 size={10} />
                        {note.record.name}
                        <span className="opacity-50">· {note.record.object_type}</span>
                      </Link>
                      <button
                        onClick={() => togglePin(note.id)}
                        title={isPinned ? "Unpin" : "Pin note"}
                        className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                          isPinned
                            ? "bg-orange-500/10 text-orange-400"
                            : "text-slate-600 hover:bg-white/[.05] hover:text-slate-400"
                        }`}
                      >
                        <Pin size={12} className={isPinned ? "fill-orange-400" : ""} />
                      </button>
                    </div>
                  </div>

                  {/* Content */}
                  <div
                    className={`prose prose-invert prose-sm max-w-none text-sm leading-7 text-slate-300 transition-all
                      [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-0 [&_h2]:mb-1
                      [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_blockquote]:not-italic
                      [&_code]:rounded [&_code]:bg-white/[.05] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:text-red-300
                      [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                      [&_hr]:border-white/[.07] [&_hr]:my-2
                      ${isExpanded ? "" : "max-h-[5.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"}`}
                    dangerouslySetInnerHTML={{ __html: cleanHtml(note.content) }}
                  />
                  {note.content.length > 220 && (
                    <button
                      onClick={() => toggleExpand(note.id)}
                      className="mt-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                    >
                      {isExpanded ? "Show less ↑" : "Show more ↓"}
                    </button>
                  )}

                  {/* Bottom row: reactions + actions */}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {/* Active reactions */}
                    {activeReactions.map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => react(note.id, emoji)}
                        className="flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-xs hover:border-white/[.12] hover:bg-white/[.06] transition-colors"
                      >
                        {emoji} <span className="text-slate-400">{count as number}</span>
                      </button>
                    ))}

                    {/* Emoji picker trigger */}
                    <div className="relative">
                      <button
                        onClick={() => setEmojiPickerFor(emojiPickerFor === note.id ? null : note.id)}
                        title="React"
                        className="grid h-7 w-7 place-items-center rounded-full border border-white/[.07] bg-white/[.02] text-slate-500 hover:border-white/[.12] hover:text-slate-300 transition-colors"
                      >
                        <SmilePlus size={12} />
                      </button>
                      {emojiPickerFor === note.id && (
                        <div className="absolute bottom-9 left-0 z-20 flex gap-1 rounded-xl border border-white/[.09] bg-[#0d0f13] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
                          {REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => react(note.id, emoji)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-base hover:bg-white/[.08] transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Owner actions */}
                    {isOwner && (
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => openEdit(note)}
                          title="Edit"
                          className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => deleteNote.mutate(note.id)}
                          title="Delete"
                          className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* New / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/[.09] bg-[#0d0f13] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            {/* Modal header */}
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">{editing ? "Edit note" : "New note"}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {editing ? "Update the content below." : "Link to a record so context stays findable."}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Record search / linked chip */}
            {!editing ? (
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-600" size={13} />
                <input
                  value={recordSearch}
                  onChange={(e) => { setRecordSearch(e.target.value); setLinkedRecord(undefined); }}
                  placeholder="Link to a contact, company, deal…"
                  className="key-input h-10 w-full pl-9"
                />
                {recordSearch && !linkedRecord && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-white/[.09] bg-[#0d0f13] p-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
                    {recordOptions.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-slate-600">No records found</p>
                    ) : recordOptions.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => { setLinkedRecord(r); setRecordSearch(String(r.data.name ?? r.data.title ?? r.id)); }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/[.05] hover:text-white transition-colors"
                      >
                        <span>{String(r.data.name ?? r.data.title ?? "Untitled")}</span>
                        <span className="text-xs text-slate-600">{r.object_type}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/[.07] px-3 py-2">
                <Link2 size={12} className="text-slate-500" />
                <span className="text-sm text-slate-400">Linked to</span>
                <span className="text-sm text-white">{linkedRecord?.data.name as string}</span>
              </div>
            )}

            <NoteEditor
              value={content}
              onChange={setContent}
              onSave={() => editing ? updateNote.mutate() : linkedRecord ? createNote.mutate() : undefined}
              saving={createNote.isPending || updateNote.isPending}
              mentions={(membersQ.data ?? []).map((m) => m.name)}
            />

            {!linkedRecord && !editing && (
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Choose a record before saving.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, FileText, GitCommitHorizontal, Kanban, LayoutGrid,
  Link2, Pencil, Pin, Plus, Search, Trash2, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NoteEditor } from "../../components/notes/note-editor";
import { EmptyState, ErrorState, PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

/* ── types ──────────────────────────────────────────────────── */

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

type ViewMode = "list" | "board" | "timeline";

/* ── constants ──────────────────────────────────────────────── */

const OBJECT_COLORS: Record<string, string> = {
  contacts:  "text-blue-400 bg-blue-500/10 border-blue-500/20",
  companies: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  deals:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

const NOTE_COLORS: Record<string, { ring: string; bg: string; dot: string }> = {
  default: { ring: "ring-white/[.07]",     bg: "bg-white/[.02]",        dot: "bg-stone-600"   },
  amber:   { ring: "ring-amber-500/25",    bg: "bg-amber-500/[.04]",    dot: "bg-amber-400"   },
  red:     { ring: "ring-red-500/25",      bg: "bg-stone-500/[.04]",      dot: "bg-stone-400"     },
  emerald: { ring: "ring-emerald-500/25",  bg: "bg-emerald-500/[.04]",  dot: "bg-emerald-400" },
  blue:    { ring: "ring-blue-500/25",     bg: "bg-blue-500/[.04]",     dot: "bg-blue-400"    },
  violet:  { ring: "ring-violet-500/25",   bg: "bg-violet-500/[.04]",   dot: "bg-violet-400"  },
};
const COLOR_KEYS = Object.keys(NOTE_COLORS) as (keyof typeof NOTE_COLORS)[];

const BOARD_COLUMNS = [
  { key: "contacts",  label: "Contacts",  icon: "👤" },
  { key: "companies", label: "Companies", icon: "🏢" },
  { key: "deals",     label: "Deals",     icon: "💼" },
  { key: "general",   label: "General",   icon: "📝" },
];

/* ── helpers ────────────────────────────────────────────────── */

function useNoteColors() {
  const [colors, setColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("mondaily:note-colors") ?? "{}"); } catch { return {}; }
  });
  function setColor(id: string, color: string) {
    setColors(prev => {
      const next = { ...prev, [id]: color };
      localStorage.setItem("mondaily:note-colors", JSON.stringify(next));
      return next;
    });
  }
  return { colors, setColor };
}

function usePinned() {
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("mondaily:note-pins") ?? "[]")); } catch { return new Set(); }
  });
  function toggle(id: string) {
    setPinned(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("mondaily:note-pins", JSON.stringify([...next]));
      return next;
    });
  }
  return { pinned, toggle };
}

function plainText(html: string) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() ?? "";
  } catch { return html; }
}

function relTime(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── NoteCard (used in list + board + timeline) ─────────────── */

function NoteCard({
  note,
  colorKey = "default",
  isPinned = false,
  isOwner = false,
  compact = false,
  onPin,
  onEdit,
  onDelete,
  onColorChange,
}: {
  note: Note;
  colorKey?: string;
  isPinned?: boolean;
  isOwner?: boolean;
  compact?: boolean;
  onPin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onColorChange?: (c: string) => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const isAI = note.actor_type === "ai_agent";
  const scheme = NOTE_COLORS[colorKey] ?? NOTE_COLORS["default"]!;
  const objColor = OBJECT_COLORS[note.record.object_type] ?? "text-stone-400 bg-white/[.04] border-white/[.08]";
  const preview = plainText(note.content);

  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-2xl border p-4 ring-1 transition-all
        ${scheme.bg} ${scheme.ring}
        ${isPinned ? "border-orange-500/30" : "border-white/[.07] hover:border-white/[.12]"}
        ${isAI ? "border-stone-500/20" : ""}`}
    >
      {/* AI accent */}
      {isAI && (
        <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-2xl bg-gradient-to-b from-red-500/60 to-transparent" />
      )}

      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isAI ? (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-stone-500/25 bg-stone-500/10 text-stone-400">
              <Bot size={12} />
            </div>
          ) : (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[.08] bg-white/[.05] text-[10px] font-bold text-stone-300">
              {initials(note.author_name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white leading-tight">
              {note.author_name}
              {isAI && <span className="ml-1.5 rounded-full border border-stone-500/20 bg-stone-500/10 px-1.5 py-px text-[9px] font-semibold text-stone-400">AI</span>}
            </p>
            <p className="text-[10px] text-stone-600">{relTime(note.updated_at)}</p>
          </div>
        </div>

        {/* Actions — always visible on mobile, hover on desktop */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onColorChange && (
            <div className="relative">
              <button
                onClick={() => setColorOpen(v => !v)}
                className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/[.07] transition-colors"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${scheme.dot}`} />
              </button>
              {colorOpen && (
                <div className="absolute right-0 top-8 z-30 flex gap-1.5 rounded-xl border border-white/[.09] bg-[#141414] p-2 shadow-2xl">
                  {COLOR_KEYS.map(c => (
                    <button
                      key={c}
                      onClick={() => { onColorChange(c); setColorOpen(false); }}
                      className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${colorKey === c ? "border-white/70" : "border-transparent"} ${NOTE_COLORS[c]?.dot ?? "bg-stone-600"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {onPin && (
            <button onClick={onPin} title={isPinned ? "Unpin" : "Pin"}
              className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/[.07] transition-colors">
              <Pin size={11} className={isPinned ? "fill-orange-400 text-orange-400" : "text-stone-500"} />
            </button>
          )}
          {isOwner && onEdit && (
            <button onClick={onEdit} title="Edit"
              className="grid h-6 w-6 place-items-center rounded-lg text-stone-500 hover:bg-white/[.07] hover:text-white transition-colors">
              <Pencil size={11} />
            </button>
          )}
          {isOwner && onDelete && (
            <button onClick={onDelete} title="Delete"
              className="grid h-6 w-6 place-items-center rounded-lg text-stone-500 hover:bg-stone-500/10 hover:text-stone-400 transition-colors">
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content preview */}
      <p className={`text-sm leading-relaxed text-stone-300 ${compact ? "line-clamp-3" : "line-clamp-4"} ${isPinned ? "" : ""}`}>
        {preview || <span className="italic text-stone-600">Empty note</span>}
      </p>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <Link
          to={`/objects/${note.record.object_type}/${note.record.id}`}
          onClick={e => e.stopPropagation()}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium hover:opacity-80 transition-opacity ${objColor}`}
        >
          <Link2 size={8} />
          <span className="max-w-[100px] truncate">{note.record.name}</span>
        </Link>
        {isPinned && (
          <span className="flex items-center gap-1 text-[10px] text-orange-400">
            <Pin size={9} className="fill-orange-400" /> Pinned
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Board view ─────────────────────────────────────────────── */

function DroppableCol({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`min-h-[100px] space-y-3 rounded-2xl border-2 border-dashed p-2 transition-colors ${isOver ? "border-stone-500/40 bg-stone-500/[.03]" : "border-transparent"}`}>
      {children}
    </div>
  );
}

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab", touchAction: "none" }}>
      {children}
    </div>
  );
}

function BoardView({ notes, colors, pinned, userId, onColorChange, onEdit, onDelete, onPin }: {
  notes: Note[]; colors: Record<string, string>; pinned: Set<string>;
  userId: string | null | undefined;
  onColorChange: (id: string, c: string) => void;
  onEdit: (n: Note) => void; onDelete: (id: string) => void; onPin: (id: string) => void;
}) {
  const [colOverride, setColOverride] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function getCol(note: Note) {
    return colOverride[note.id] ?? (BOARD_COLUMNS.some(c => c.key === note.record.object_type) ? note.record.object_type : "general");
  }
  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    setColOverride(prev => ({ ...prev, [String(active.id)]: String(over.id) }));
  }

  const activeNote = activeId ? notes.find(n => n.id === activeId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={({ active }: DragStartEvent) => setActiveId(String(active.id))} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {BOARD_COLUMNS.map(col => {
          const colNotes = notes.filter(n => getCol(n) === col.key);
          return (
            <div key={col.key} className="flex w-72 shrink-0 flex-col gap-3">
              <div className="flex items-center gap-2 px-1">
                <span className="text-base">{col.icon}</span>
                <span className="text-sm font-semibold text-white">{col.label}</span>
                <span className="ml-auto rounded-full border border-white/[.06] bg-white/[.03] px-2 py-px text-[10px] text-stone-500">{colNotes.length}</span>
              </div>
              <DroppableCol id={col.key}>
                {colNotes.map(note => (
                  <DraggableCard key={note.id} id={note.id}>
                    <NoteCard note={note} colorKey={colors[note.id] ?? "default"} compact isPinned={pinned.has(note.id)} isOwner={note.author_id === userId}
                      onColorChange={c => onColorChange(note.id, c)} onEdit={() => onEdit(note)} onDelete={() => onDelete(note.id)} onPin={() => onPin(note.id)} />
                  </DraggableCard>
                ))}
                {colNotes.length === 0 && <p className="py-8 text-center text-xs text-stone-700">Drop notes here</p>}
              </DroppableCol>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeNote && <div className="w-72 rotate-2 opacity-90"><NoteCard note={activeNote} colorKey={colors[activeNote.id] ?? "default"} compact /></div>}
      </DragOverlay>
    </DndContext>
  );
}

/* ── Timeline view ──────────────────────────────────────────── */

function TimelineView({ notes, colors, pinned, userId, onColorChange, onEdit, onDelete, onPin }: {
  notes: Note[]; colors: Record<string, string>; pinned: Set<string>;
  userId: string | null | undefined;
  onColorChange: (id: string, c: string) => void;
  onEdit: (n: Note) => void; onDelete: (id: string) => void; onPin: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<"week" | "month" | "quarter">("month");
  const DAY_PX = zoom === "week" ? 120 : zoom === "month" ? 40 : 14;

  const sorted = useMemo(() => [...notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [notes]);

  const minDate = useMemo(() => {
    const d = sorted.length ? new Date(sorted[0]!.created_at) : new Date();
    d.setDate(d.getDate() - 3); return d;
  }, [sorted]);
  const maxDate = useMemo(() => {
    const d = sorted.length ? new Date(sorted[sorted.length - 1]!.created_at) : new Date();
    d.setDate(d.getDate() + 7); return d;
  }, [sorted]);

  const totalDays = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000));
  const totalWidth = totalDays * DAY_PX + 180;
  const todayX = Math.max(0, (new Date().getTime() - minDate.getTime()) / 86400000) * DAY_PX + 180;

  function dayOffset(iso: string) {
    return Math.max(0, (new Date(iso).getTime() - minDate.getTime()) / 86400000) * DAY_PX + 180;
  }

  const markers: { label: string; x: number }[] = [];
  const cur = new Date(minDate);
  while (cur <= maxDate) {
    markers.push({ label: zoom === "week" ? cur.toLocaleDateString([], { weekday: "short", day: "numeric" }) : zoom === "month" ? cur.toLocaleDateString([], { month: "short", day: "numeric" }) : cur.toLocaleDateString([], { month: "short", year: "2-digit" }), x: (cur.getTime() - minDate.getTime()) / 86400000 * DAY_PX + 180 });
    if (zoom === "week") cur.setDate(cur.getDate() + 1);
    else if (zoom === "month") cur.setDate(cur.getDate() + 7);
    else cur.setMonth(cur.getMonth() + 1);
  }

  const CARD_W = 200, LANE_H = 180, LANE_HEADER = 44;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{sorted.length} notes across timeline</p>
        <div className="flex gap-0.5 rounded-xl border border-white/[.07] bg-white/[.02] p-0.5">
          {(["week", "month", "quarter"] as const).map(z => (
            <button key={z} onClick={() => setZoom(z)}
              className={`rounded-lg px-3 py-1.5 text-xs capitalize transition-colors ${zoom === z ? "bg-white/[.08] text-white" : "text-stone-500 hover:text-stone-300"}`}>
              {z}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/[.07] bg-[#141414]">
        {BOARD_COLUMNS.map((col, laneIdx) => {
          const laneNotes = sorted.filter(n => (BOARD_COLUMNS.some(c => c.key === n.record.object_type) ? n.record.object_type : "general") === col.key);
          return (
            <div key={col.key} className={laneIdx < BOARD_COLUMNS.length - 1 ? "border-b border-white/[.05]" : ""}>
              <div className="relative" style={{ width: totalWidth, height: LANE_H }}>
                <div className="absolute inset-y-0 left-0 z-10 flex w-[170px] flex-col justify-center gap-0.5 bg-[#141414] px-4 shadow-[2px_0_12px_rgba(0,0,0,0.5)]">
                  <p className="text-base">{col.icon}</p>
                  <p className="text-xs font-semibold text-white">{col.label}</p>
                  <p className="text-[10px] text-stone-600">{laneNotes.length} notes</p>
                </div>
                {laneIdx === 0 && markers.map(m => (
                  <div key={m.label + m.x} className="absolute top-2 z-[5] -translate-x-1/2" style={{ left: m.x }}>
                    <span className="text-[9px] text-stone-700 whitespace-nowrap">{m.label}</span>
                    <div className="mx-auto mt-1 w-px bg-white/[.04]" style={{ height: LANE_H - 20 }} />
                  </div>
                ))}
                <div className="absolute top-0 z-[6] w-px bg-stone-500/40" style={{ left: todayX, height: LANE_H }}>
                  {laneIdx === 0 && <span className="absolute top-1 left-1 whitespace-nowrap rounded bg-stone-500/20 px-1 py-px text-[9px] font-semibold text-stone-400">Today</span>}
                </div>
                {laneNotes.map(note => (
                  <div key={note.id} className="absolute" style={{ left: dayOffset(note.created_at), top: LANE_HEADER, width: CARD_W }}>
                    <NoteCard note={note} colorKey={colors[note.id] ?? "default"} compact isPinned={pinned.has(note.id)} isOwner={note.author_id === userId}
                      onColorChange={c => onColorChange(note.id, c)} onEdit={() => onEdit(note)} onDelete={() => onDelete(note.id)} onPin={() => onPin(note.id)} />
                  </div>
                ))}
                {laneNotes.map(note => (
                  <div key={`dot-${note.id}`} className="absolute z-[5] h-2 w-2 -translate-x-1/2 rounded-full bg-stone-600 ring-1 ring-[#141414]"
                    style={{ left: dayOffset(note.created_at), top: LANE_HEADER - 6 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Modal shell ────────────────────────────────────────────── */

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl overflow-auto rounded-2xl border border-white/[.09] bg-[#141414] shadow-2xl max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-stone-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */

export function NotesPage() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const [view, _setView] = useState<ViewMode>("list");
  const [filter, setFilter] = useState<"all" | "mine" | "ai">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "updated">("newest");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [content, setContent] = useState("<p></p>");
  const [recordSearch, setRecordSearch] = useState("");
  const [linkedRecord, setLinkedRecord] = useState<RecordOption>();
  const [editing, setEditing] = useState<Note>();

  const { colors, setColor } = useNoteColors();
  const { pinned, toggle: togglePin } = usePinned();

  /* queries */
  const notesQ = useQuery({
    queryKey: ["notes", filter, sort, search],
    queryFn: () => apiClient.get<Note[]>(`/notes?filter=${filter === "ai" ? "all" : filter}&sort=${sort}&search=${encodeURIComponent(search)}`),
  });
  const recordsQ = useQuery({
    queryKey: ["note-records"],
    queryFn: () => apiClient.get<RecordOption[]>("/nodes?limit=50"),
    enabled: modalOpen,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<{ name: string }[]>("/members"),
    enabled: modalOpen,
  });

  /* mutations */
  const createNote = useMutation({
    mutationFn: () => apiClient.post("/notes", { content, node_id: linkedRecord?.id }),
    onSuccess: () => { closeModal(); qc.invalidateQueries({ queryKey: ["notes"] }); },
  });
  const updateNote = useMutation({
    mutationFn: () => apiClient.patch(`/notes/${editing?.id}`, { content }),
    onSuccess: () => { closeModal(); qc.invalidateQueries({ queryKey: ["notes"] }); },
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const recordOptions = useMemo(() => {
    const term = recordSearch.toLowerCase();
    return (recordsQ.data ?? [])
      .filter(r => `${r.data.name ?? ""} ${r.data.email ?? ""} ${r.data.company ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [recordSearch, recordsQ.data]);

  function closeModal() {
    setModalOpen(false); setEditing(undefined);
    setContent("<p></p>"); setLinkedRecord(undefined); setRecordSearch("");
  }
  function openEdit(note: Note) {
    setEditing(note); setContent(note.content);
    setLinkedRecord({ id: note.record.id, object_type: note.record.object_type, data: { name: note.record.name } });
    setModalOpen(true);
  }

  /* derived data */
  const allNotes = useMemo(() => {
    const base = notesQ.data ?? [];
    return filter === "ai" ? base.filter(n => n.actor_type === "ai_agent") : base;
  }, [notesQ.data, filter]);

  const pinnedNotes = allNotes.filter(n => pinned.has(n.id));
  const unpinnedNotes = allNotes.filter(n => !pinned.has(n.id));
  const aiCount = (notesQ.data ?? []).filter(n => n.actor_type === "ai_agent").length;

  return (
    <div className={`mx-auto px-6 py-8 ${view === "list" ? "max-w-6xl" : "max-w-full"}`}>

      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-stone-500">
          Notes linked to your contacts, companies, and deals.
          {(notesQ.data ?? []).length > 0 && (
            <span className="ml-2 text-stone-700">{(notesQ.data ?? []).length - aiCount} human · {aiCount} AI</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-stone-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-500 transition-colors">
            <Plus size={13} /> New Note
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 rounded-xl border border-white/[.07] bg-white/[.02] p-0.5">
          {([
            { key: "all",  label: "All"  },
            { key: "mine", label: "Mine" },
            { key: "ai",   label: "AI"   },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${filter === key ? "bg-white/[.08] text-white" : "text-stone-500 hover:text-stone-300"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-white/[.07]" />

        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" size={12} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="h-8 w-48 rounded-xl border border-white/[.07] bg-white/[.02] pl-8 pr-3 text-xs text-white placeholder-stone-600 outline-none focus:border-white/[.14] transition-colors" />
        </label>

        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          className="h-8 rounded-xl border border-white/[.07] bg-[#141414] px-3 text-xs text-stone-400 outline-none">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="updated">Updated</option>
        </select>

        {pinned.size > 0 && (
          <span className="flex items-center gap-1 rounded-xl border border-orange-500/20 bg-orange-500/[.06] px-2.5 py-1 text-[11px] text-orange-400">
            <Pin size={10} className="fill-orange-400" /> {pinned.size} pinned
          </span>
        )}
      </div>

      {/* ── Content ── */}
      {notesQ.isLoading ? (
        <PageSkeleton rows={6} />
      ) : notesQ.isError ? (
        <ErrorState error={notesQ.error as Error} onRetry={() => notesQ.refetch()} />
      ) : allNotes.length === 0 && view === "list" ? (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          description="Capture meeting context, call summaries, and decisions linked to any record."
          action={
            <button onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-stone-600 px-4 py-2 text-sm font-medium text-white hover:bg-stone-500 transition-colors">
              <Plus size={14} /> Add first note
            </button>
          }
        />
      ) : view === "board" ? (
        <BoardView notes={allNotes} colors={colors} pinned={pinned} userId={userId}
          onColorChange={setColor} onEdit={openEdit} onDelete={id => deleteNote.mutate(id)} onPin={togglePin} />
      ) : view === "timeline" ? (
        <TimelineView notes={allNotes} colors={colors} pinned={pinned} userId={userId}
          onColorChange={setColor} onEdit={openEdit} onDelete={id => deleteNote.mutate(id)} onPin={togglePin} />
      ) : (
        /* ── Cards list view ── */
        <div className="space-y-6">

          {/* Pinned section */}
          {pinnedNotes.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Pin size={11} className="fill-orange-400 text-orange-400" />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-400/70">Pinned</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pinnedNotes.map(note => (
                  <NoteCard key={note.id} note={note}
                    colorKey={colors[note.id] ?? "default"} isPinned isOwner={note.author_id === userId}
                    onColorChange={c => setColor(note.id, c)} onEdit={() => openEdit(note)}
                    onDelete={() => deleteNote.mutate(note.id)} onPin={() => togglePin(note.id)} />
                ))}
              </div>
            </section>
          )}

          {/* All notes */}
          {unpinnedNotes.length > 0 && (
            <section>
              {pinnedNotes.length > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">All notes</span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {unpinnedNotes.map(note => (
                  <NoteCard key={note.id} note={note}
                    colorKey={colors[note.id] ?? "default"} isPinned={false} isOwner={note.author_id === userId}
                    onColorChange={c => setColor(note.id, c)} onEdit={() => openEdit(note)}
                    onDelete={() => deleteNote.mutate(note.id)} onPin={() => togglePin(note.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── New / Edit modal ── */}
      {modalOpen && (
        <ModalShell
          title={editing ? "Edit note" : "New note"}
          subtitle={editing ? "Update the content below." : "Link to a record so context stays findable."}
          onClose={closeModal}
        >
          {/* Record picker */}
          {!editing ? (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" size={12} />
              <input value={recordSearch}
                onChange={e => { setRecordSearch(e.target.value); setLinkedRecord(undefined); }}
                placeholder="Link to a contact, company, deal…"
                className="h-10 w-full rounded-xl border border-white/[.08] bg-white/[.03] pl-9 pr-3 text-sm text-white placeholder-stone-600 outline-none focus:border-white/[.15] transition-colors" />
              {recordSearch && !linkedRecord && (
                <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-white/[.09] bg-[#141414] p-1 shadow-2xl">
                  {recordOptions.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-stone-600">No records found</p>
                  ) : recordOptions.map(r => (
                    <button key={r.id}
                      onClick={() => { setLinkedRecord(r); setRecordSearch(String(r.data.name ?? r.data.title ?? r.id)); }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-stone-300 hover:bg-white/[.05] hover:text-white transition-colors">
                      <span>{String(r.data.name ?? r.data.title ?? "Untitled")}</span>
                      <span className="text-xs text-stone-600">{r.object_type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5">
              <Link2 size={12} className="text-stone-500" />
              <span className="text-xs text-stone-400">Linked to</span>
              <span className="text-xs font-medium text-white">{linkedRecord?.data.name as string}</span>
            </div>
          )}

          <NoteEditor
            value={content}
            onChange={setContent}
            onSave={() => editing ? updateNote.mutate() : linkedRecord ? createNote.mutate() : undefined}
            saving={createNote.isPending || updateNote.isPending}
            mentions={(membersQ.data ?? []).map(m => m.name)}
          />

          {!linkedRecord && !editing && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Choose a record before saving.
            </p>
          )}
        </ModalShell>
      )}
    </div>
  );
}

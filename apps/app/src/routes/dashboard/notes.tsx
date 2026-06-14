import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, FileText, Kanban, LayoutList, Link2, Pencil, Pin,
  Plus, Search, SmilePlus, Trash2, X, GitCommitHorizontal,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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

type ViewMode = "list" | "board" | "timeline";

const NOTE_COLORS: Record<string, { card: string; dot: string }> = {
  default: { card: "bg-white/[.025] border-white/[.07]",   dot: "bg-slate-600" },
  amber:   { card: "bg-amber-500/[.06] border-amber-500/20", dot: "bg-amber-400" },
  red:     { card: "bg-red-500/[.06] border-red-500/20",     dot: "bg-red-400" },
  emerald: { card: "bg-emerald-500/[.06] border-emerald-500/20", dot: "bg-emerald-400" },
  blue:    { card: "bg-blue-500/[.06] border-blue-500/20",   dot: "bg-blue-400" },
  violet:  { card: "bg-violet-500/[.06] border-violet-500/20", dot: "bg-violet-400" },
};
const COLOR_KEYS = Object.keys(NOTE_COLORS) as (keyof typeof NOTE_COLORS)[];

const OBJECT_COLORS: Record<string, string> = {
  contacts:  "text-blue-400 bg-blue-500/10 border-blue-500/20",
  companies: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  deals:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

const BOARD_COLUMNS = [
  { key: "contacts",  label: "Contacts",  icon: "👤" },
  { key: "companies", label: "Companies", icon: "🏢" },
  { key: "deals",     label: "Deals",     icon: "💼" },
  { key: "general",   label: "General",   icon: "📝" },
];

const REACTIONS = ["👍", "❤️", "🎉", "🔥", "👀"];

/* ── local helpers ─────────────────────────────────────────── */

function useNoteColors() {
  const [colors, setColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("mondaily:note-colors") ?? "{}"); } catch { return {}; }
  });
  function setColor(id: string, color: string) {
    setColors((prev) => {
      const next = { ...prev, [id]: color };
      localStorage.setItem("mondaily:note-colors", JSON.stringify(next));
      return next;
    });
  }
  return { colors, setColor };
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

function textContent(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
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

/* ── sticky card (shared across board & timeline) ──────────── */

function StickyCard({
  note,
  colorKey,
  compact = false,
  onColorChange,
  onEdit,
  onDelete,
  onPin,
  isPinned,
  isOwner,
}: {
  note: Note;
  colorKey: string;
  compact?: boolean;
  onColorChange?: (color: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  isOwner?: boolean;
}) {
  const [showColors, setShowColors] = useState(false);
  const isAI = note.actor_type === "ai_agent";
  const scheme = NOTE_COLORS[colorKey] ?? NOTE_COLORS["default"]!;
  const objColor = OBJECT_COLORS[note.record.object_type] ?? "text-slate-400 bg-white/[.04] border-white/[.08]";

  return (
    <div
      className={`relative rounded-xl border p-3 transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] ${scheme?.card ?? ""} ${isPinned ? "ring-1 ring-orange-500/30" : ""}`}
    >
      {isAI && (
        <div className="absolute inset-y-0 left-0 w-0.5 rounded-l-xl bg-gradient-to-b from-red-500/70 to-red-500/10" />
      )}

      {/* Author row */}
      <div className="mb-2 flex items-center gap-2">
        {isAI ? (
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
            <Bot size={11} />
          </div>
        ) : (
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.05] text-[10px] font-bold text-white">
            {initials(note.author_name)}
          </div>
        )}
        <span className="min-w-0 truncate text-xs font-medium text-slate-300">{note.author_name}</span>
        {isAI && (
          <span className="shrink-0 rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">AI</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-slate-600">{relativeTime(note.created_at)}</span>
      </div>

      {/* Content preview */}
      <p className={`text-xs leading-relaxed text-slate-300 ${compact ? "line-clamp-3" : "line-clamp-5"}`}>
        {textContent(note.content)}
      </p>

      {/* Record chip */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
        <Link
          to={`/objects/${note.record.object_type}/${note.record.id}`}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium hover:opacity-80 transition-opacity ${objColor}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Link2 size={8} />
          <span className="max-w-[90px] truncate">{note.record.name}</span>
        </Link>

        {/* Color + pin + actions */}
        <div className="flex items-center gap-1">
          {onColorChange && (
            <div className="relative">
              <button
                onClick={() => setShowColors((v) => !v)}
                title="Color"
                className="h-4 w-4 rounded-full border border-white/10"
                style={{ background: (scheme?.dot ?? "bg-slate-600").replace("bg-", "") }}
              >
                <span className={`block h-full w-full rounded-full ${scheme.dot}`} />
              </button>
              {showColors && (
                <div className="absolute bottom-6 right-0 z-30 flex gap-1 rounded-xl border border-white/[.09] bg-[#0d0f13] p-2 shadow-xl">
                  {COLOR_KEYS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { onColorChange(c); setShowColors(false); }}
                      title={c}
                      className={`h-5 w-5 rounded-full border-2 ${colorKey === c ? "border-white/60" : "border-transparent"} ${NOTE_COLORS[c]?.dot ?? ""}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {onPin && (
            <button onClick={onPin} title={isPinned ? "Unpin" : "Pin"} className="grid h-5 w-5 place-items-center rounded-md text-slate-600 hover:text-orange-400 transition-colors">
              <Pin size={10} className={isPinned ? "fill-orange-400 text-orange-400" : ""} />
            </button>
          )}
          {isOwner && onEdit && (
            <button onClick={onEdit} title="Edit" className="grid h-5 w-5 place-items-center rounded-md text-slate-600 hover:text-white transition-colors">
              <Pencil size={10} />
            </button>
          )}
          {isOwner && onDelete && (
            <button onClick={onDelete} title="Delete" className="grid h-5 w-5 place-items-center rounded-md text-slate-600 hover:text-red-400 transition-colors">
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── DnD wrappers ───────────────────────────────────────────── */

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[120px] space-y-3 rounded-xl border-2 border-dashed p-2 transition-colors ${
        isOver ? "border-red-500/40 bg-red-500/[.04]" : "border-transparent"
      }`}
    >
      {children}
    </div>
  );
}

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab", touchAction: "none" }}
    >
      {children}
    </div>
  );
}

/* ── Board view ─────────────────────────────────────────────── */

function BoardView({
  notes,
  colors,
  pinned,
  userId,
  onColorChange,
  onEdit,
  onDelete,
  onPin,
  onColumnChange,
}: {
  notes: Note[];
  colors: Record<string, string>;
  pinned: Set<string>;
  userId: string | null | undefined;
  onColorChange: (id: string, c: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onColumnChange: (noteId: string, col: string) => void;
}) {
  const [colOverride, setColOverride] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function getCol(note: Note) {
    return colOverride[note.id] ?? (BOARD_COLUMNS.some((c) => c.key === note.record.object_type) ? note.record.object_type : "general");
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
  }
  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const noteId = String(active.id);
    const col = String(over.id);
    setColOverride((prev) => ({ ...prev, [noteId]: col }));
    onColumnChange(noteId, col);
  }

  const activeNote = activeId ? notes.find((n) => n.id === activeId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
        {BOARD_COLUMNS.map((col) => {
          const colNotes = notes.filter((n) => getCol(n) === col.key);
          return (
            <div key={col.key} className="flex w-72 shrink-0 flex-col gap-3">
              {/* Column header */}
              <div className="flex items-center gap-2 px-1">
                <span className="text-base">{col.icon}</span>
                <span className="text-sm font-semibold text-white">{col.label}</span>
                <span className="ml-auto rounded-full border border-white/[.06] bg-white/[.03] px-2 py-0.5 text-[11px] text-slate-500">
                  {colNotes.length}
                </span>
              </div>

              <DroppableColumn id={col.key}>
                {colNotes.map((note) => (
                  <DraggableCard key={note.id} id={note.id}>
                    <StickyCard
                      note={note}
                      colorKey={colors[note.id] ?? "default"}
                      compact
                      onColorChange={(c) => onColorChange(note.id, c)}
                      onEdit={() => onEdit(note)}
                      onDelete={() => onDelete(note.id)}
                      onPin={() => onPin(note.id)}
                      isPinned={pinned.has(note.id)}
                      isOwner={note.author_id === userId}
                    />
                  </DraggableCard>
                ))}
                {colNotes.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-700">Drop notes here</p>
                )}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeNote && (
          <div className="w-72 rotate-2 opacity-90">
            <StickyCard note={activeNote} colorKey={colors[activeNote.id] ?? "default"} compact />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/* ── Timeline view ──────────────────────────────────────────── */

function TimelineView({
  notes,
  colors,
  pinned,
  userId,
  onColorChange,
  onEdit,
  onDelete,
  onPin,
}: {
  notes: Note[];
  colors: Record<string, string>;
  pinned: Set<string>;
  userId: string | null | undefined;
  onColorChange: (id: string, c: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<"week" | "month" | "quarter">("month");
  const scrollRef = useRef<HTMLDivElement>(null);

  const DAY_PX = zoom === "week" ? 120 : zoom === "month" ? 40 : 14;

  const sorted = useMemo(() => [...notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [notes]);
  const swimlanes = BOARD_COLUMNS.map((c) => c.key);

  const minDate = useMemo(() => {
    if (!sorted.length) return new Date();
    const d = new Date(sorted[0]!.created_at);
    d.setDate(d.getDate() - 3);
    return d;
  }, [sorted]);

  const maxDate = useMemo(() => {
    const d = sorted.length ? new Date(sorted[sorted.length - 1]!.created_at) : new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }, [sorted]);

  const totalDays = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000));
  const totalWidth = totalDays * DAY_PX + 160;

  function dayOffset(dateStr: string) {
    const diff = (new Date(dateStr).getTime() - minDate.getTime()) / 86400000;
    return Math.max(0, diff) * DAY_PX + 160;
  }

  // Build date markers
  const markers: { label: string; x: number }[] = [];
  const cur = new Date(minDate);
  while (cur <= maxDate) {
    const label = zoom === "week"
      ? cur.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : zoom === "month"
      ? cur.toLocaleDateString([], { month: "short", day: "numeric" })
      : cur.toLocaleDateString([], { month: "short", year: "2-digit" });
    markers.push({ label, x: (cur.getTime() - minDate.getTime()) / 86400000 * DAY_PX + 160 });
    if (zoom === "week") cur.setDate(cur.getDate() + 1);
    else if (zoom === "month") cur.setDate(cur.getDate() + 7);
    else cur.setMonth(cur.getMonth() + 1);
  }

  const todayX = dayOffset(new Date().toISOString());

  // Assign row offsets per swimlane to avoid overlap
  function laneNotes(laneKey: string) {
    return sorted.filter((n) => {
      const col = BOARD_COLUMNS.some((c) => c.key === n.record.object_type) ? n.record.object_type : "general";
      return col === laneKey;
    });
  }

  const CARD_W = 200;
  const CARD_H = 130;
  const LANE_HEADER = 40;

  return (
    <div className="space-y-3">
      {/* Zoom controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{sorted.length} notes across timeline</p>
        <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
          {(["week", "month", "quarter"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${
                zoom === z ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden rounded-xl border border-white/[.07] bg-[#0d0f13]"
      >
        {swimlanes.map((laneKey, laneIdx) => {
          const col = BOARD_COLUMNS.find((c) => c.key === laneKey) ?? { key: laneKey, label: laneKey, icon: "📝" };
          const laneItems = laneNotes(laneKey);
          const laneH = Math.max(LANE_HEADER + CARD_H + 24, LANE_HEADER + 24);

          return (
            <div key={laneKey} className={laneIdx < swimlanes.length - 1 ? "border-b border-white/[.05]" : ""}>
              <div className="relative" style={{ width: totalWidth, height: laneH }}>
                {/* Lane label */}
                <div className="sticky left-0 z-10 flex items-center gap-2 bg-[#0d0f13] px-4 py-2.5 shadow-[2px_0_8px_rgba(0,0,0,0.4)]" style={{ position: "absolute", top: 0, left: 0, width: 150, height: laneH }}>
                  <span className="text-base">{col.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-white">{col.label}</p>
                    <p className="text-[10px] text-slate-600">{laneItems.length} notes</p>
                  </div>
                </div>

                {/* Date markers (only on first lane) */}
                {laneIdx === 0 && markers.map((m) => (
                  <div key={m.label + m.x} className="absolute top-2 z-[5] -translate-x-1/2" style={{ left: m.x }}>
                    <span className="text-[10px] text-slate-600 whitespace-nowrap">{m.label}</span>
                    <div className="mx-auto mt-1 w-px bg-white/[.05]" style={{ height: laneH - 20 }} />
                  </div>
                ))}

                {/* Today marker */}
                <div
                  className="absolute top-0 z-[6] w-px bg-red-500/40"
                  style={{ left: todayX, height: laneH }}
                >
                  {laneIdx === 0 && (
                    <span className="absolute -top-0 left-1 whitespace-nowrap rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-semibold text-red-400">Today</span>
                  )}
                </div>

                {/* Note cards */}
                {laneItems.map((note) => (
                  <div
                    key={note.id}
                    className="absolute"
                    style={{ left: dayOffset(note.created_at), top: LANE_HEADER, width: CARD_W }}
                  >
                    <StickyCard
                      note={note}
                      colorKey={colors[note.id] ?? "default"}
                      compact
                      onColorChange={(c) => onColorChange(note.id, c)}
                      onEdit={() => onEdit(note)}
                      onDelete={() => onDelete(note.id)}
                      onPin={() => onPin(note.id)}
                      isPinned={pinned.has(note.id)}
                      isOwner={note.author_id === userId}
                    />
                  </div>
                ))}

                {/* Connector dots on x-axis */}
                {laneItems.map((note) => (
                  <div
                    key={`dot-${note.id}`}
                    className="absolute z-[5] h-2 w-2 -translate-x-1/2 rounded-full bg-slate-600 ring-1 ring-[#0d0f13]"
                    style={{ left: dayOffset(note.created_at), top: LANE_HEADER - 6 }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */

export function NotesPage() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const [view,   setView]   = useState<ViewMode>("list");
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

  const { colors, setColor } = useNoteColors();

  const notesQ = useQuery({
    queryKey: ["notes", filter, sort, search],
    queryFn:  () => apiClient.get<Note[]>(`/notes?filter=${filter === "ai" ? "all" : filter}&sort=${sort}&search=${encodeURIComponent(search)}`),
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
    setPinned((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function react(noteId: string, emoji: string) {
    setLocalReactions((prev) => ({
      ...prev,
      [noteId]: { ...(prev[noteId] ?? {}), [emoji]: ((prev[noteId] ?? {})[emoji] ?? 0) + 1 },
    }));
    setEmojiPickerFor(null);
  }

  const allNotes = useMemo(() => {
    const base = notesQ.data ?? [];
    const filtered = filter === "ai" ? base.filter((n) => n.actor_type === "ai_agent") : base;
    return [
      ...filtered.filter((n) => pinned.has(n.id)),
      ...filtered.filter((n) => !pinned.has(n.id)),
    ];
  }, [notesQ.data, filter, pinned]);

  const aiCount    = (notesQ.data ?? []).filter((n) => n.actor_type === "ai_agent").length;
  const humanCount = (notesQ.data ?? []).length - aiCount;

  return (
    <div className={`px-4 py-6 sm:px-6 sm:py-8 ${view === "list" ? "mx-auto max-w-3xl" : "mx-auto max-w-[1400px]"}`}>

      {/* Header */}
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Notes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Context written by your team and Mondaily agents.
            {(notesQ.data ?? []).length > 0 && (
              <span className="ml-2 text-slate-600">{humanCount} human · {aiCount} AI</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
            <button
              onClick={() => setView("list")}
              title="List"
              className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${view === "list" ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <LayoutList size={14} />
            </button>
            <button
              onClick={() => setView("board")}
              title="Board"
              className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${view === "board" ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <Kanban size={14} />
            </button>
            <button
              onClick={() => setView("timeline")}
              title="Timeline"
              className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${view === "timeline" ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <GitCommitHorizontal size={14} />
            </button>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="shrink-0 flex items-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all"
          >
            <Plus size={14} /> New note
          </button>
        </div>
      </div>

      {/* Filter + search bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
          {([
            { key: "all",  label: "All"  },
            { key: "mine", label: "Mine" },
            { key: "ai",   label: "AI"   },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${filter === key ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}
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

      {/* Content */}
      {notesQ.isLoading ? (
        <PageSkeleton rows={4} />
      ) : notesQ.isError ? (
        <ErrorState error={notesQ.error as Error} onRetry={() => notesQ.refetch()} />
      ) : allNotes.length === 0 && view === "list" ? (
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
      ) : view === "board" ? (
        <BoardView
          notes={allNotes}
          colors={colors}
          pinned={pinned}
          userId={userId}
          onColorChange={setColor}
          onEdit={openEdit}
          onDelete={(id) => deleteNote.mutate(id)}
          onPin={togglePin}
          onColumnChange={() => {}}
        />
      ) : view === "timeline" ? (
        <TimelineView
          notes={allNotes}
          colors={colors}
          pinned={pinned}
          userId={userId}
          onColorChange={setColor}
          onEdit={openEdit}
          onDelete={(id) => deleteNote.mutate(id)}
          onPin={togglePin}
        />
      ) : (
        /* List view */
        <div className="space-y-3">
          {allNotes.map((note) => {
            const isAI       = note.actor_type === "ai_agent";
            const isPinned   = pinned.has(note.id);
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
                {isAI && (
                  <div className="absolute inset-y-0 left-0 w-0.5 rounded-l-xl bg-gradient-to-b from-red-500/60 to-red-500/10" />
                )}

                <div className="p-4 pl-5">
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
                            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">AI</span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-600">{relativeTime(note.updated_at)}</span>
                      </div>
                    </div>

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
                          isPinned ? "bg-orange-500/10 text-orange-400" : "text-slate-600 hover:bg-white/[.05] hover:text-slate-400"
                        }`}
                      >
                        <Pin size={12} className={isPinned ? "fill-orange-400" : ""} />
                      </button>
                    </div>
                  </div>

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

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {activeReactions.map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => react(note.id, emoji)}
                        className="flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-xs hover:border-white/[.12] hover:bg-white/[.06] transition-colors"
                      >
                        {emoji} <span className="text-slate-400">{count as number}</span>
                      </button>
                    ))}

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

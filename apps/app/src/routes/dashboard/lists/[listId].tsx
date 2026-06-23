import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Download, Globe, Grid2X2, ListPlus, Loader2,
  MoreHorizontal, Plus, Search, Sparkles, Table2, Trash2, UserCheck, Users, X, Mail, Wand2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";
import { ProspectingModal } from "../../../components/ai/prospecting-modal";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }
interface ListData { id: string; name: string; object_type: string; access_level: string; entry_count: number; assignee_id: string | null; shared_with: string[] | null | undefined; visibility?: string }
interface Member { id: string; user_id: string; name: string; email: string; role?: string }

function display(value: unknown) {
  return value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Modal shell ──────────────────────────────────────────────────────────────
function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="surface-modal fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl px-5 py-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        {children}
      </div>
    </>
  );
}

function memberInitials(m: Member) {
  return (m.name || m.email).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function memberLabel(m: Member) { return m.name || m.email; }

export function ListPage() {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userId } = useAuth();

  const [view, setView] = useState<"table" | "board">("table");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [prospectOpen, setProspectOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [enrichAllDone, setEnrichAllDone] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<"pick" | "confirm" | "done">("pick");
  const [enrollSeqId, setEnrollSeqId] = useState("");
  const [enrollSeqName, setEnrollSeqName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const assignRef = useRef<HTMLDivElement>(null);

  // AI modal state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMatched, setAiMatched] = useState<NodeRecord[] | null>(null);
  const [aiSelected, setAiSelected] = useState<Set<string>>(new Set());
  const [aiReason, setAiReason] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────────
  const list = useQuery({
    queryKey: ["list", listId],
    queryFn: () => apiClient.get<ListData>(`/lists/${listId}`),
  });
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    enabled: assignOpen,
  });
  const members = membersQuery.data ?? [];
  const entries = useQuery({
    queryKey: ["list-entries", listId],
    queryFn: () => apiClient.get<NodeRecord[]>(`/lists/${listId}/entries`),
  });
  const candidates = useQuery({
    queryKey: ["list-candidates", list.data?.object_type],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${list.data?.object_type}&limit=100`),
    enabled: (addOpen || aiOpen) && Boolean(list.data),
  });
  const sequencesQuery = useQuery({
    queryKey: ["sequences-list"],
    queryFn: () => apiClient.get<{ id: string; name: string; status: string }[]>("/sequences"),
    enabled: enrollOpen,
  });
  const sequences = sequencesQuery.data ?? [];

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.patch(`/lists/${listId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
  const removeList = useMutation({
    mutationFn: () => apiClient.delete(`/lists/${listId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lists"] }); navigate("/home"); },
  });
  const addEntry = useMutation({
    mutationFn: (nodeId: string) => apiClient.post(`/lists/${listId}/entries`, { node_id: nodeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-entries", listId] });
      qc.invalidateQueries({ queryKey: ["list", listId] });
    },
  });
  const removeEntry = useMutation({
    mutationFn: (nodeId: string) => apiClient.delete(`/lists/${listId}/entries/${nodeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-entries", listId] });
      qc.invalidateQueries({ queryKey: ["list", listId] });
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────────
  const records = entries.data ?? [];
  const columns = useMemo(
    () => Array.from(new Set(records.flatMap(r => Object.keys(r.data)))).slice(0, 7),
    [records],
  );
  const entryIds = new Set(records.map(r => r.id));
  const available = (candidates.data ?? []).filter(r =>
    !entryIds.has(r.id) &&
    `${r.data.name ?? ""} ${r.data.email ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function exportCsv() {
    const rows = [columns, ...records.map(r => columns.map(c => String(r.data[c] ?? "")))];
    const csv = rows.map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${list.data?.name || "list"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function enrichAll() {
    setEnrichingAll(true);
    try {
      await apiClient.post(`/lists/${listId}/enrich`, {});
      setEnrichAllDone(true);
      setTimeout(() => setEnrichAllDone(false), 4000);
    } finally {
      setEnrichingAll(false);
    }
  }

  async function enrollInSequence() {
    if (!enrollSeqId) return;
    setEnrolling(true);
    try {
      const nodeIds = records.map(r => r.id);
      await apiClient.post(`/sequences/${enrollSeqId}/enroll`, { node_ids: nodeIds });
      setEnrollStep("done");
    } catch {
      // continue
    } finally {
      setEnrolling(false);
    }
  }

  async function runAiMatch() {
    if (!aiPrompt.trim() || !list.data) return;
    setAiLoading(true);
    setAiMatched(null);
    try {
      const pool = candidates.data ?? [];
      const res = await apiClient.post<{ selectedIds: string[]; reason: string }>("/generate/list-entries", {
        prompt: aiPrompt,
        objectType: list.data.object_type,
        records: pool.filter(r => !entryIds.has(r.id)).map(r => ({ id: r.id, data: r.data })),
      });
      const matchedRecords = (candidates.data ?? []).filter(r => res.selectedIds.includes(r.id));
      setAiMatched(matchedRecords);
      setAiSelected(new Set(matchedRecords.map(r => r.id)));
      setAiReason(res.reason ?? "");
    } catch {
      setAiMatched([]);
    } finally {
      setAiLoading(false);
    }
  }

  async function addAiSelected() {
    for (const id of aiSelected) {
      await addEntry.mutateAsync(id);
    }
    setAiOpen(false);
    setAiPrompt("");
    setAiMatched(null);
    setAiSelected(new Set());
  }

  function setAssignee(uid: string | null) {
    update.mutate({ assignee_id: uid });
  }
  function toggleShared(uid: string) {
    const current = list.data?.shared_with ?? [];
    const next = current.includes(uid) ? current.filter(x => x !== uid) : [...current, uid];
    update.mutate({ shared_with: next });
  }

  function openAi() {
    setAiMatched(null);
    setAiPrompt("");
    setAiSelected(new Set());
    setAiOpen(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (list.isLoading) return <div className="p-8"><PageSkeleton rows={7} /></div>;
  if (!list.data) return <div className="grid h-full place-items-center text-sm text-slate-500">List not found.</div>;

  const isEmpty = entries.isSuccess && records.length === 0;

  return (
    <div className="list-workspace flex h-full flex-col">
      {/* ── Header ── */}
      <header className="list-header shrink-0 px-6 py-5">
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--text-faint)" }}>List sheet</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
              <input
                value={list.data.name}
                onChange={e => qc.setQueryData(["list", listId], { ...list.data, name: e.target.value })}
                onBlur={e => update.mutate({ name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder-neutral-400 dark:placeholder-neutral-600"
                style={{ color: "var(--text-primary)" }}
              />
              <span className="rounded-full border px-2.5 py-1 text-[11px] capitalize" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                {list.data.object_type}
              </span>
            </div>
          </div>
          <div className="list-toolbar flex items-center gap-2 overflow-x-auto pb-1">

        {/* ── Assignment chip + popover ── */}
        <div className="relative" ref={assignRef}>
          <button
            onClick={() => setAssignOpen(o => !o)}
            className="btn-secondary !px-2.5 !py-1.5 !text-[11px]"
          >
            {list.data.assignee_id ? <UserCheck size={11} /> : <Users size={11} />}
            {list.data.assignee_id
              ? (members.find(m => m.user_id === list.data!.assignee_id)?.name?.split(" ")[0]
                  ?? (list.data.assignee_id === userId ? "Me" : "Assigned"))
              : "Assign"}
            {(list.data.shared_with ?? []).length > 0 && (
              <span className="ml-0.5 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-400">
                +{(list.data.shared_with ?? []).length}
              </span>
            )}
          </button>

          {assignOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setAssignOpen(false)} />
              <div className="surface-modal absolute left-0 top-full z-30 mt-1 w-64 rounded-2xl p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.7)]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Assign to</p>
                {membersQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin" style={{ color: "var(--text-faint)" }} /></div>
                ) : (
                  <div className="space-y-1">
                    {/* "Unassigned" option */}
                    <button
                      onClick={() => setAssignee(null)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${!list.data!.assignee_id ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[9px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>—</span>
                      Unassigned
                    </button>
                    {/* Me first */}
                    {userId && (() => {
                      const me = members.find(m => m.user_id === userId);
                      const isAssigned = list.data!.assignee_id === userId;
                      return (
                        <button
                          onClick={() => setAssignee(isAssigned ? null : userId)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isAssigned ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold" style={{ background: "var(--surface-hover)" }}>
                            {me ? memberInitials(me) : "Me"}
                          </span>
                          {me ? memberLabel(me) : "Me"} <span className="ml-auto text-[10px]" style={{ color: "var(--text-faint)" }}>me</span>
                        </button>
                      );
                    })()}
                    {members.filter(m => m.user_id !== userId).map(m => {
                      const isAssigned = list.data!.assignee_id === m.user_id;
                      return (
                        <button key={m.user_id}
                          onClick={() => setAssignee(isAssigned ? null : m.user_id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isAssigned ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold" style={{ background: "var(--surface-hover)" }}>
                            {memberInitials(m)}
                          </span>
                          {memberLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Visibility */}
                <div className="my-2 border-t" style={{ borderColor: "var(--border-soft)" }} />
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Visibility</p>
                <div className="flex gap-1 mb-2">
                  {(["workspace", "shared", "private"] as const).map(v => (
                    <button key={v} onClick={() => apiClient.patch(`/lists/${list.data!.id}`, { visibility: v }).then(() => list.refetch())}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium capitalize transition-colors ${(list.data!.visibility ?? "workspace") === v ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}>
                      {v}
                    </button>
                  ))}
                </div>

                {members.length > 0 && (
                  <>
                    <div className="my-2 border-t" style={{ borderColor: "var(--border-soft)" }} />
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Share with</p>
                    <div className="space-y-1">
                      {members.filter(m => m.user_id !== list.data!.assignee_id).map(m => {
                        const isShared = (list.data!.shared_with ?? []).includes(m.user_id);
                        return (
                          <button key={m.user_id}
                            onClick={() => toggleShared(m.user_id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isShared ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}
                          >
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold transition-colors" style={{ background: "var(--surface-hover)" }}>
                              {memberInitials(m)}
                            </span>
                            <span className="truncate">{memberLabel(m)}</span>
                            {m.role && <span className="text-[9px] capitalize" style={{ color: "var(--text-faint)" }}>{m.role}</span>}
                            {isShared && <span className="ml-auto text-[10px]" style={{ color: "var(--accent)" }}>shared</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border p-0.5 gap-0.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
          <button
            title="Table"
            onClick={() => setView("table")}
            className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === "table" ? "surface-card text-token-primary" : "text-token-muted"}`}
          >
            <Table2 size={12} />
          </button>
          <button
            title="Board"
            onClick={() => setView("board")}
            className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === "board" ? "surface-card text-token-primary" : "text-token-muted"}`}
          >
            <Grid2X2 size={12} />
          </button>
        </div>
        {/* Actions */}
        {records.length > 0 && (
          <>
            <button
              onClick={enrichAll}
              disabled={enrichingAll}
              className="btn-ai !px-3 !py-1.5 !text-xs"
            >
              {enrichingAll ? <Loader2 size={13} className="animate-spin"/> : enrichAllDone ? <Sparkles size={13}/> : <Wand2 size={13}/>}
              {enrichAllDone ? "Enriching…" : "Enrich All"}
            </button>
            <button
              onClick={() => { setEnrollOpen(true); setEnrollStep("pick"); setEnrollSeqId(""); setEnrollSeqName(""); }}
              className="btn-secondary !px-3 !py-1.5 !text-xs"
            >
              <Mail size={13}/> Enroll in Sequence
            </button>
          </>
        )}
        <button
          onClick={() => setAddOpen(true)}
          className="btn-primary !px-3 !py-1.5 !text-xs"
        >
          <Plus size={13}/> Add record
        </button>
        <button
          onClick={openAi}
          className="btn-ai !px-3 !py-1.5 !text-xs"
        >
          <Sparkles size={13}/> Add with AI
        </button>
        <button
          onClick={() => setProspectOpen(true)}
          className="btn-secondary !px-3 !py-1.5 !text-xs"
        >
          <Globe size={13}/> Find from web
        </button>
        {/* Menu */}
        <div className="relative ml-auto">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="btn-ghost grid !h-7 !w-7 !px-0 !py-0"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="dropdown-panel absolute right-0 mt-1 w-44 z-30">
              <button
                onClick={() => { setMenuOpen(false); const n = window.prompt("Rename list", list.data?.name); if (n) update.mutate({ name: n }); }}
                className="dropdown-item w-full"
              >
                <ListPlus size={12}/> Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); exportCsv(); }}
                className="dropdown-item w-full"
              >
                <Download size={12}/> Export CSV
              </button>
              <div className="mx-2 my-1 border-t border-white/[.06]"/>
              <button
                onClick={() => { setMenuOpen(false); setDeleteConfirm(true); }}
                className="dropdown-item w-full text-indigo-400 hover:text-indigo-300"
              >
                <Trash2 size={12}/> Delete list
              </button>
            </div>
          )}
        </div>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {entries.isLoading ? (
          <PageSkeleton rows={6} />
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-6 border-y py-24 text-center" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--surface-hover)", color: "var(--accent)" }}>
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>No records in this list yet</h2>
              <p className="mt-1.5 max-w-sm text-xs" style={{ color: "var(--text-muted)" }}>
                Describe what you're looking for and AI will pick the matching {list.data.object_type} — or add them manually.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openAi}
                className="btn-ai !px-4 !py-2 !text-xs"
              >
                <Sparkles size={13} /> Add with AI
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="btn-secondary !px-4 !py-2 !text-xs"
              >
                <Plus size={13} /> Add manually
              </button>
            </div>
          </div>
        ) : view === "table" ? (
          /* ── Table ── */
          <div className="list-sheet minimal-sheet overflow-auto">
            <table className="minimal-table min-w-full text-left text-[12px]">
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c} className="whitespace-nowrap">
                      {c.replaceAll("_", " ")}
                    </th>
                  ))}
                  <th className="whitespace-nowrap">Updated</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.id} className="group transition-colors">
                    {columns.map((c, i) => (
                      <td key={c} className="max-w-[240px] truncate text-neutral-700 dark:text-neutral-300">
                        {i === 0
                          ? (
                            <Link
                              to={`/objects/${record.object_type}/${record.id}`}
                              className="font-medium text-neutral-950 transition-colors hover:text-neutral-600 dark:text-neutral-50 dark:hover:text-neutral-300"
                            >
                              {display(record.data[c])}
                            </Link>
                          )
                          : display(record.data[c])}
                      </td>
                    ))}
                    <td className="text-[11px] tabular-nums text-neutral-400 dark:text-neutral-600">
                      {fmtDate(record.updated_at)}
                    </td>
                    <td className="w-8 px-2">
                      <button
                        onClick={() => removeEntry.mutate(record.id)}
                        title="Remove from list"
                        className="grid h-6 w-6 place-items-center rounded opacity-0 transition-all group-hover:opacity-100 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                        style={{ color: "var(--text-faint)" }}
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Board ── */
          <div className="grid gap-3 md:grid-cols-3">
            {["Unassigned", "Active", "Complete"].map(stage => (
              <section key={stage} className="border-y p-3" style={{ borderColor: "var(--border-soft)" }}>
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>{stage}</h2>
                <div className="space-y-2">
                  {records
                    .filter(r => stage === "Unassigned"
                      ? !r.data.stage
                      : String(r.data.stage ?? "").toLowerCase().includes(stage.toLowerCase()))
                    .map(r => (
                      <Link
                        key={r.id}
                        to={`/objects/${r.object_type}/${r.id}`}
                        className="block border-b p-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                        style={{ borderColor: "var(--border-soft)" }}
                      >
                        <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                        <p className="mt-1.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{String(r.data.company ?? r.data.email ?? "")}</p>
                      </Link>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* ── Add manually modal ── */}
      {addOpen && (
        <ModalShell onClose={() => { setAddOpen(false); setSearch(""); }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Add record</h2>
            <button
              onClick={() => { setAddOpen(false); setSearch(""); }}
              className="btn-ghost !p-1"
            >
              <X size={14} />
            </button>
          </div>
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={13} style={{ color: "var(--text-faint)" }} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="key-input w-full pl-9 pr-3 py-2 text-xs"
              placeholder={`Search ${list.data.object_type}…`}
            />
          </label>
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border" style={{ borderColor: "var(--border-soft)" }}>
            {candidates.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: "var(--text-faint)" }} /></div>
            ) : available.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>No matching records found.</p>
            ) : (
              available.map(r => (
                <button
                  key={r.id}
                  onClick={() => addEntry.mutate(r.id)}
                  className="flex w-full items-center justify-between border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  style={{ borderColor: "var(--border-soft)" }}
                >
                  <div>
                    <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{String(r.data.email ?? r.data.company ?? "")}</p>
                  </div>
                  <Plus size={13} className="shrink-0" style={{ color: "var(--text-faint)" }}/>
                </button>
              ))
            )}
          </div>
          <Link
            to={`/objects/${list.data.object_type}`}
            className="mt-3 block text-[11px] transition-colors hover:text-indigo-400"
            style={{ color: "var(--text-muted)" }}
          >
            Go to {list.data.object_type} sheet →
          </Link>
        </ModalShell>
      )}

      {/* ── AI add modal ── */}
      {aiOpen && (
        <ModalShell onClose={() => setAiOpen(false)}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-violet-400" />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Add with AI</h2>
            </div>
            <button
              onClick={() => setAiOpen(false)}
              className="btn-ghost !p-1"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mb-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Describe which {list.data.object_type} you want to add. AI will search your existing records and suggest the best matches.
          </p>
          <textarea
            autoFocus
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAiMatch(); }}
            rows={3}
            placeholder={`e.g. "Companies in the US with ARR above $1M"`}
            className="surface-input w-full resize-none rounded-xl p-3 text-[12px] outline-none transition-colors placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
            style={{ color: "var(--text-primary)" }}
          />
          {aiMatched === null ? (
            <button
              onClick={runAiMatch}
              disabled={aiLoading || !aiPrompt.trim() || candidates.isLoading}
              className="btn-ai mt-3 flex w-full !py-2.5 !text-xs"
            >
              {aiLoading || candidates.isLoading
                ? <><Loader2 size={13} className="animate-spin" /> {candidates.isLoading ? "Loading records…" : "Finding matches…"}</>
                : <><Sparkles size={13} /> Find matching records</>}
            </button>
          ) : (
            <>
              {aiReason && (
                <p className="mt-3 text-[11px] italic" style={{ color: "var(--text-muted)" }}>"{aiReason}"</p>
              )}
              <div className="mt-3 max-h-56 overflow-auto rounded-xl border" style={{ borderColor: "var(--border-soft)" }}>
                {aiMatched.length === 0 ? (
                  <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>No matching records found. Try a different description.</p>
                ) : (
                  aiMatched.map(r => {
                    const sel = aiSelected.has(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setAiSelected(prev => { const n = new Set(prev); sel ? n.delete(r.id) : n.add(r.id); return n; })}
                        className={`flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900/60 ${sel ? "surface-selected" : ""}`}
                        style={{ borderColor: "var(--border-soft)" }}
                      >
                        <div className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${sel ? "bg-violet-600 border-violet-600" : ""}`} style={sel ? undefined : { borderColor: "var(--border-strong)" }}>
                          {sel && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-white"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[12px]" style={{ color: "var(--text-primary)" }}>{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                          <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{String(r.data.email ?? r.data.company ?? r.data.status ?? "")}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  onClick={() => { setAiMatched(null); setAiPrompt(""); }}
                  className="text-[11px] transition-colors hover:text-indigo-400"
                  style={{ color: "var(--text-muted)" }}
                >
                  Try again
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{aiSelected.size} selected</span>
                  <button
                    onClick={addAiSelected}
                    disabled={aiSelected.size === 0 || addEntry.isPending}
                    className="btn-ai !px-4 !py-1.5 !text-xs"
                  >
                    {addEntry.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                    Add {aiSelected.size > 0 ? aiSelected.size : ""} to list
                  </button>
                </div>
              </div>
            </>
          )}
        </ModalShell>
      )}

      {prospectOpen && (
        <ProspectingModal
          onClose={() => setProspectOpen(false)}
          defaultObjectType={list.data?.object_type ?? "company"}
          destinationListId={listId}
          onCreated={() => qc.invalidateQueries({ queryKey: ["list-entries", listId] })}
        />
      )}

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteConfirm(false)}/>
          <div className="surface-modal fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl px-5 py-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Delete "{list.data.name}"?</h2>
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>The records themselves will not be deleted — only this list.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="btn-secondary !px-3 !py-1.5 !text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => removeList.mutate()}
                className="btn-primary !px-3 !py-1.5 !text-xs"
              >
                Delete list
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Enroll in Sequence ── */}
      {enrollOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[.08] bg-[#0f1117] shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[.06]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Mail size={13} className="text-emerald-400" />
                </div>
                <span className="text-sm font-semibold text-white">Enroll in Sequence</span>
              </div>
              <button onClick={() => setEnrollOpen(false)} className="text-white/30 hover:text-white/70 transition-colors"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {enrollStep === "done" ? (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Mail size={22} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-1">Enrollment complete</p>
                    <p className="text-xs text-white/40">{records.length} records enrolled in "{enrollSeqName}"</p>
                  </div>
                </div>
              ) : enrollStep === "confirm" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-4">
                    <p className="text-xs text-white/40 mb-1">Enrolling into</p>
                    <p className="text-sm font-semibold text-white">{enrollSeqName}</p>
                  </div>
                  <div className="rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-white/40">Records to enroll</span>
                    <span className="text-sm font-semibold text-emerald-400">{records.length}</span>
                  </div>
                  <p className="text-[11px] text-white/30">Records already enrolled in this sequence will be skipped automatically.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/40 mb-3">Choose a sequence to enroll {records.length} record{records.length !== 1 ? "s" : ""} from this list:</p>
                  {sequencesQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-white/30 py-4"><Loader2 size={13} className="animate-spin" /> Loading sequences…</div>
                  ) : sequences.length === 0 ? (
                    <p className="text-xs text-white/30 py-4 text-center">No sequences found. Create one first under Sequences.</p>
                  ) : (
                    sequences.map(seq => (
                      <button
                        key={seq.id}
                        onClick={() => { setEnrollSeqId(seq.id); setEnrollSeqName(seq.name); setEnrollStep("confirm"); }}
                        className="w-full flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-colors text-left"
                      >
                        <span className="text-sm text-white">{seq.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${seq.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[.06] text-white/30"}`}>{seq.status}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-white/[.06]">
              <button
                onClick={() => enrollStep === "confirm" ? setEnrollStep("pick") : setEnrollOpen(false)}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                {enrollStep === "done" ? "Close" : enrollStep === "confirm" ? "Back" : "Cancel"}
              </button>
              {enrollStep === "confirm" && (
                <button
                  onClick={enrollInSequence}
                  disabled={enrolling}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-40"
                >
                  {enrolling ? <><Loader2 size={12} className="animate-spin" /> Enrolling…</> : <><Mail size={12} /> Enroll {records.length} records</>}
                </button>
              )}
              {enrollStep === "done" && (
                <button
                  onClick={() => setEnrollOpen(false)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

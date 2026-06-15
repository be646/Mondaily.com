import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  Download, Grid2X2, ListPlus, Loader2,
  MoreHorizontal, Plus, Search, Sparkles, Table2, Trash2, UserCheck, Users, X, Mail,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }
interface ListData { id: string; name: string; object_type: string; access_level: string; entry_count: number; assignee_id: string | null; shared_with: string[] | null | undefined }
interface Member { id: string; user_id: string; name: string; email: string }

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
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_64px_rgba(0,0,0,0.7)] px-5 py-5">
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
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
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
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <header className="px-6 py-4 flex flex-wrap items-center gap-3 border-b border-white/[.06] shrink-0">
        <input
          value={list.data.name}
          onChange={e => qc.setQueryData(["list", listId], { ...list.data, name: e.target.value })}
          onBlur={e => update.mutate({ name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none text-white placeholder-zinc-700"
        />
        <span className="rounded-full border border-white/[.08] bg-white/[.03] px-2.5 py-1 text-[11px] capitalize text-slate-500">
          {list.data.object_type}
        </span>

        {/* ── Assignment chip + popover ── */}
        <div className="relative" ref={assignRef}>
          <button
            onClick={() => setAssignOpen(o => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
              list.data.assignee_id
                ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15"
                : "border-white/[.08] bg-white/[.02] text-slate-500 hover:text-white hover:border-white/[.15]"
            }`}
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
              <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-2xl border border-white/[.09] bg-[#0d0f13] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.7)]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-700">Assign to</p>
                {membersQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-slate-600" /></div>
                ) : (
                  <div className="space-y-1">
                    {/* "Unassigned" option */}
                    <button
                      onClick={() => setAssignee(null)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${!list.data!.assignee_id ? "bg-white/[.06] text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/[.10] bg-white/[.04] text-[9px] text-slate-600">—</span>
                      Unassigned
                    </button>
                    {/* Me first */}
                    {userId && (() => {
                      const me = members.find(m => m.user_id === userId);
                      const isAssigned = list.data!.assignee_id === userId;
                      return (
                        <button
                          onClick={() => setAssignee(isAssigned ? null : userId)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isAssigned ? "bg-red-500/10 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[.10] text-[9px] font-bold">
                            {me ? memberInitials(me) : "Me"}
                          </span>
                          {me ? memberLabel(me) : "Me"} <span className="ml-auto text-[10px] text-slate-700">me</span>
                        </button>
                      );
                    })()}
                    {members.filter(m => m.user_id !== userId).map(m => {
                      const isAssigned = list.data!.assignee_id === m.user_id;
                      return (
                        <button key={m.user_id}
                          onClick={() => setAssignee(isAssigned ? null : m.user_id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isAssigned ? "bg-red-500/10 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[.10] text-[9px] font-bold">
                            {memberInitials(m)}
                          </span>
                          {memberLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Visibility */}
                <div className="my-2 border-t border-white/[.06]" />
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-700">Visibility</p>
                <div className="flex gap-1 mb-2">
                  {(["workspace", "shared", "private"] as const).map(v => (
                    <button key={v} onClick={() => apiClient.patch(`/lists/${list.data!.id}`, { visibility: v }).then(() => list.refetch())}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium capitalize transition-colors ${(list.data!.visibility ?? "workspace") === v ? "bg-red-500/20 text-red-300" : "bg-white/[.04] text-slate-500 hover:text-slate-300"}`}>
                      {v}
                    </button>
                  ))}
                </div>

                {members.length > 0 && (
                  <>
                    <div className="my-2 border-t border-white/[.06]" />
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-700">Share with</p>
                    <div className="space-y-1">
                      {members.filter(m => m.user_id !== list.data!.assignee_id).map(m => {
                        const isShared = (list.data!.shared_with ?? []).includes(m.user_id);
                        return (
                          <button key={m.user_id}
                            onClick={() => toggleShared(m.user_id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${isShared ? "bg-blue-500/10 text-blue-300" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}
                          >
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold transition-colors ${isShared ? "bg-blue-500/20" : "bg-white/[.10]"}`}>
                              {memberInitials(m)}
                            </span>
                            <span className="truncate">{memberLabel(m)}</span>
                            {m.role && <span className="text-[9px] text-slate-500 capitalize">{m.role}</span>}
                            {isShared && <span className="ml-auto text-[10px] text-blue-500">shared</span>}
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
        <div className="flex items-center rounded-lg border border-white/[.08] bg-white/[.02] p-0.5 gap-0.5">
          <button
            title="Table"
            onClick={() => setView("table")}
            className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === "table" ? "bg-white/[.08] text-white" : "text-slate-600 hover:text-slate-400"}`}
          >
            <Table2 size={12} />
          </button>
          <button
            title="Board"
            onClick={() => setView("board")}
            className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === "board" ? "bg-white/[.08] text-white" : "text-slate-600 hover:text-slate-400"}`}
          >
            <Grid2X2 size={12} />
          </button>
        </div>
        {/* Actions */}
        {records.length > 0 && (
          <button
            onClick={() => { setEnrollOpen(true); setEnrollStep("pick"); setEnrollSeqId(""); setEnrollSeqName(""); }}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-600/20 transition-colors"
          >
            <Mail size={13}/> Enroll in Sequence
          </button>
        )}
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border-x border-t border-white/[.08] border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition-colors"
        >
          <Plus size={13}/> Add record
        </button>
        <button
          onClick={openAi}
          className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-600/15 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-600/25 transition-colors"
        >
          <Sparkles size={13}/> Add with AI
        </button>
        {/* Menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/[.08] bg-white/[.02] text-slate-500 hover:text-white hover:bg-white/[.05] transition-colors"
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
                className="dropdown-item w-full text-red-400 hover:text-red-300"
              >
                <Trash2 size={12}/> Delete list
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {entries.isLoading ? (
          <PageSkeleton rows={6} />
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-400">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">No records in this list yet</h2>
              <p className="mt-1.5 text-xs text-slate-500 max-w-sm">
                Describe what you're looking for and AI will pick the matching {list.data.object_type} — or add them manually.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openAi}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium hover:bg-violet-500 transition-colors"
              >
                <Sparkles size={13} /> Add with AI
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-white/[.09] px-4 py-2 text-xs font-medium hover:bg-white/[.04] transition-colors"
              >
                <Plus size={13} /> Add manually
              </button>
            </div>
          </div>
        ) : view === "table" ? (
          /* ── Table ── */
          <div className="overflow-auto rounded-xl border border-white/[.07]">
            <table className="min-w-full border-separate border-spacing-0 text-left text-[12px]">
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c} className="px-4 py-2.5 bg-white/[.02] border-b border-white/[.06] text-[10px] font-semibold uppercase tracking-widest text-zinc-600 whitespace-nowrap">
                      {c.replaceAll("_", " ")}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 bg-white/[.02] border-b border-white/[.06] text-[10px] font-semibold uppercase tracking-widest text-zinc-600 whitespace-nowrap">Updated</th>
                  <th className="w-8 bg-white/[.02] border-b border-white/[.06]" />
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.id} className="group hover:bg-white/[.025] transition-colors">
                    {columns.map((c, i) => (
                      <td key={c} className="max-w-[240px] truncate px-4 py-2.5 text-zinc-300 border-b border-white/[.04]">
                        {i === 0
                          ? (
                            <Link
                              to={`/objects/${record.object_type}/${record.id}`}
                              className="font-medium text-zinc-100 hover:text-red-400 transition-colors"
                            >
                              {display(record.data[c])}
                            </Link>
                          )
                          : display(record.data[c])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-[11px] text-zinc-600 tabular-nums border-b border-white/[.04]">
                      {fmtDate(record.updated_at)}
                    </td>
                    <td className="px-2 w-8 border-b border-white/[.04]">
                      <button
                        onClick={() => removeEntry.mutate(record.id)}
                        title="Remove from list"
                        className="opacity-0 group-hover:opacity-100 grid h-6 w-6 place-items-center rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
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
              <section key={stage} className="rounded-xl border border-white/[.07] bg-white/[.015] p-3">
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{stage}</h2>
                <div className="space-y-2">
                  {records
                    .filter(r => stage === "Unassigned"
                      ? !r.data.stage
                      : String(r.data.stage ?? "").toLowerCase().includes(stage.toLowerCase()))
                    .map(r => (
                      <Link
                        key={r.id}
                        to={`/objects/${r.object_type}/${r.id}`}
                        className="block rounded-lg border border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/60 hover:bg-zinc-900/70 p-3 transition-all"
                      >
                        <p className="truncate text-[12px] font-medium text-zinc-100">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                        <p className="mt-1.5 truncate text-[11px] text-zinc-600">{String(r.data.company ?? r.data.email ?? "")}</p>
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
            <h2 className="text-sm font-semibold text-white">Add record</h2>
            <button
              onClick={() => { setAddOpen(false); setSearch(""); }}
              className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={13} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="key-input w-full pl-9 pr-3 py-2 text-xs"
              placeholder={`Search ${list.data.object_type}…`}
            />
          </label>
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-white/[.06]">
            {candidates.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-slate-600" /></div>
            ) : available.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-600">No matching records found.</p>
            ) : (
              available.map(r => (
                <button
                  key={r.id}
                  onClick={() => addEntry.mutate(r.id)}
                  className="flex w-full items-center justify-between border-b border-white/[.05] last:border-0 px-3 py-2.5 text-left hover:bg-white/[.03] transition-colors"
                >
                  <div>
                    <p className="text-[12px] text-zinc-200">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                    <p className="text-[11px] text-zinc-600">{String(r.data.email ?? r.data.company ?? "")}</p>
                  </div>
                  <Plus size={13} className="text-zinc-600 shrink-0"/>
                </button>
              ))
            )}
          </div>
          <Link
            to={`/objects/${list.data.object_type}`}
            className="mt-3 block text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
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
              <h2 className="text-sm font-semibold text-white">Add with AI</h2>
            </div>
            <button
              onClick={() => setAiOpen(false)}
              className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            Describe which {list.data.object_type} you want to add. AI will search your existing records and suggest the best matches.
          </p>
          <textarea
            autoFocus
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAiMatch(); }}
            rows={3}
            placeholder={`e.g. "Companies in the US with ARR above $1M"`}
            className="w-full rounded-xl border border-white/[.08] bg-white/[.03] p-3 text-[12px] text-white placeholder-zinc-700 resize-none outline-none focus:border-violet-500/40 transition-colors"
          />
          {aiMatched === null ? (
            <button
              onClick={runAiMatch}
              disabled={aiLoading || !aiPrompt.trim() || candidates.isLoading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-xs font-medium disabled:opacity-50 hover:bg-violet-500 transition-colors"
            >
              {aiLoading || candidates.isLoading
                ? <><Loader2 size={13} className="animate-spin" /> {candidates.isLoading ? "Loading records…" : "Finding matches…"}</>
                : <><Sparkles size={13} /> Find matching records</>}
            </button>
          ) : (
            <>
              {aiReason && (
                <p className="mt-3 text-[11px] text-slate-500 italic">"{aiReason}"</p>
              )}
              <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/[.07]">
                {aiMatched.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-600">No matching records found. Try a different description.</p>
                ) : (
                  aiMatched.map(r => {
                    const sel = aiSelected.has(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setAiSelected(prev => { const n = new Set(prev); sel ? n.delete(r.id) : n.add(r.id); return n; })}
                        className={`flex w-full items-center gap-3 border-b border-white/[.05] last:border-0 px-3 py-2.5 text-left hover:bg-white/[.03] transition-colors ${sel ? "bg-violet-500/[.05]" : ""}`}
                      >
                        <div className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${sel ? "bg-violet-600 border-violet-600" : "border-white/20"}`}>
                          {sel && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-white"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] text-zinc-200">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                          <p className="truncate text-[11px] text-zinc-600">{String(r.data.email ?? r.data.company ?? r.data.status ?? "")}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  onClick={() => { setAiMatched(null); setAiPrompt(""); }}
                  className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Try again
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-600">{aiSelected.size} selected</span>
                  <button
                    onClick={addAiSelected}
                    disabled={aiSelected.size === 0 || addEntry.isPending}
                    className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-medium disabled:opacity-50 hover:bg-violet-500 transition-colors"
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

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setDeleteConfirm(false)}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_64px_rgba(0,0,0,0.7)] px-5 py-5">
            <h2 className="text-sm font-semibold text-white mb-2">Delete "{list.data.name}"?</h2>
            <p className="text-[12px] text-slate-500">The records themselves will not be deleted — only this list.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="rounded-lg border border-white/[.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => removeList.mutate()}
                className="rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-800 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
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

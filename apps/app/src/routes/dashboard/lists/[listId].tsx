import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download, Grid2X2, ListPlus, Loader2,
  MoreHorizontal, Plus, Search, Sparkles, Table2, Trash2, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }
interface ListData { id: string; name: string; object_type: string; access_level: string; entry_count: number }

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

export function ListPage() {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [view, setView] = useState<"table" | "board">("table");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

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
  const entries = useQuery({
    queryKey: ["list-entries", listId],
    queryFn: () => apiClient.get<NodeRecord[]>(`/lists/${listId}/entries`),
  });
  const candidates = useQuery({
    queryKey: ["list-candidates", list.data?.object_type],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${list.data?.object_type}&limit=100`),
    enabled: (addOpen || aiOpen) && Boolean(list.data),
  });

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
    </div>
  );
}

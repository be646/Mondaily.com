import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Columns3, Download, Filter, Grid2X2, ListPlus, Loader2,
  MoreHorizontal, Plus, Search, Share2, SlidersHorizontal,
  SortAsc, Sparkles, Table2, Trash2, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState, PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }
interface ListData { id: string; name: string; object_type: string; access_level: string; entry_count: number }

function display(value: unknown) {
  return value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
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
      <header className="px-4 py-5 sm:px-6 flex flex-wrap items-center gap-3 border-b border-white/[.06]">
        <input
          value={list.data.name}
          onChange={e => qc.setQueryData(["list", listId], { ...list.data, name: e.target.value })}
          onBlur={e => update.mutate({ name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none"
        />
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs capitalize text-slate-500">
          {list.data.object_type}
        </span>
        <div className="flex rounded-md border border-white/10 p-1">
          <button title="Table" onClick={() => setView("table")} className={`grid h-7 w-7 place-items-center rounded ${view === "table" ? "bg-white/10" : "text-slate-600"}`}><Table2 size={13} /></button>
          <button title="Board" onClick={() => setView("board")} className={`grid h-7 w-7 place-items-center rounded ${view === "board" ? "bg-white/10" : "text-slate-600"}`}><Grid2X2 size={13} /></button>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="px-4 py-3 sm:px-6 flex flex-wrap items-center gap-2 border-b border-white/[.06]">
        <button onClick={() => setAddOpen(true)} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[.04]">
          <Plus size={14} /> Add record
        </button>
        <button onClick={openAi} className="flex h-9 items-center gap-2 rounded-md bg-violet-600/20 border border-violet-500/30 px-3 text-sm text-violet-300 hover:bg-violet-600/30 transition-colors">
          <Sparkles size={14} /> Add with AI
        </button>
        {([
          [Filter, "Filter"], [SortAsc, "Sort"], [Columns3, "Group by"],
          [SlidersHorizontal, "Fields"], [Share2, "Share"],
        ] as const).map(([Icon, label]) => (
          <button key={label} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-400">
            <Icon size={13} /> {label}
          </button>
        ))}
        <div className="relative ml-auto">
          <button onClick={() => setMenuOpen(!menuOpen)} className="grid h-9 w-9 place-items-center rounded-md border border-white/10">
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-white/10 bg-[#15181d] p-1 shadow-xl">
              <button onClick={() => { const n = window.prompt("Rename list", list.data?.name); if (n) update.mutate({ name: n }); }} className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/[.05]">Rename</button>
              <button onClick={() => apiClient.post("/lists", { name: `${list.data?.name} copy`, object_type: list.data?.object_type })} className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/[.05]">Duplicate</button>
              <button onClick={exportCsv} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-white/[.05]"><Download size={13} /> Export CSV</button>
              <button onClick={() => setDeleteConfirm(true)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"><Trash2 size={13} /> Delete list</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
        {entries.isLoading ? (
          <PageSkeleton rows={6} />
        ) : isEmpty ? (
          /* ── AI empty state ── */
          <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-400">
              <Sparkles size={28} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No records in this list yet</h2>
              <p className="mt-1.5 text-sm text-slate-500 max-w-sm">
                Describe what you're looking for and AI will pick the matching {list.data.object_type} from your database — or add them manually.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openAi}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium hover:bg-violet-500 transition-colors"
              >
                <Sparkles size={15} /> Add with AI
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium hover:bg-white/[.04] transition-colors"
              >
                <Plus size={15} /> Add manually
              </button>
            </div>
          </div>
        ) : view === "table" ? (
          /* ── Table ── */
          <div className="overflow-auto rounded-lg border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/[.025] text-xs capitalize text-slate-500">
                <tr>
                  {columns.map(c => <th key={c} className="px-4 py-3">{c.replaceAll("_", " ")}</th>)}
                  <th className="px-4">Updated</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.id} className="group border-t border-white/10 hover:bg-white/[.025]">
                    {columns.map((c, i) => (
                      <td key={c} className="max-w-72 truncate px-4 py-3">
                        {i === 0
                          ? <Link to={`/objects/${record.object_type}/${record.id}`} className="font-medium hover:text-red-400">{display(record.data[c])}</Link>
                          : display(record.data[c])}
                      </td>
                    ))}
                    <td className="px-4 text-xs text-slate-600">{new Date(record.updated_at).toLocaleDateString()}</td>
                    <td className="px-2 w-8">
                      <button
                        onClick={() => removeEntry.mutate(record.id)}
                        title="Remove from list"
                        className="opacity-0 group-hover:opacity-100 grid h-6 w-6 place-items-center rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
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
          <div className="grid gap-4 md:grid-cols-3">
            {["Unassigned", "Active", "Complete"].map(stage => (
              <section key={stage} className="rounded-lg bg-white/[.02] p-3">
                <h2 className="mb-3 text-xs font-semibold uppercase text-slate-600">{stage}</h2>
                <div className="space-y-2">
                  {records
                    .filter(r => stage === "Unassigned"
                      ? !r.data.stage
                      : String(r.data.stage ?? "").toLowerCase().includes(stage.toLowerCase()))
                    .map(r => (
                      <Link key={r.id} to={`/objects/${r.object_type}/${r.id}`} className="block rounded-md border border-white/10 bg-[#0d1014] p-3">
                        <p className="truncate text-sm font-medium">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                        <p className="mt-2 truncate text-xs text-slate-600">{String(r.data.company ?? r.data.email ?? "")}</p>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Add record</h2>
              <button onClick={() => { setAddOpen(false); setSearch(""); }}><X size={16} /></button>
            </div>
            <label className="relative mt-4 block">
              <Search className="absolute left-3 top-2.5 text-slate-600" size={14} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm" placeholder={`Search ${list.data.object_type}…`} />
            </label>
            <div className="mt-3 max-h-72 overflow-auto">
              {candidates.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-slate-500" /></div>
              ) : available.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No matching records found.</p>
              ) : (
                available.map(r => (
                  <button key={r.id} onClick={() => addEntry.mutate(r.id)} className="flex w-full items-center justify-between border-b border-white/10 p-3 text-left hover:bg-white/[.03]">
                    <div>
                      <p className="text-sm">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                      <p className="text-xs text-slate-600">{String(r.data.email ?? r.data.company ?? "")}</p>
                    </div>
                    <Plus size={14} />
                  </button>
                ))
              )}
            </div>
            <Link to={`/objects/${list.data.object_type}`} className="mt-4 block border-t border-white/10 pt-4 text-sm text-red-400">
              Go to {list.data.object_type} sheet →
            </Link>
          </div>
        </div>
      )}

      {/* ── AI add modal ── */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-violet-400" />
                <h2 className="font-medium">Add with AI</h2>
              </div>
              <button onClick={() => setAiOpen(false)}><X size={16} /></button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Describe which {list.data.object_type} you want to add. AI will search your existing records and suggest the best matches.
            </p>

            <textarea
              autoFocus
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAiMatch(); }}
              rows={3}
              placeholder={`e.g. "Companies in the US with ARR above $1M" or "Leads that came from a referral"`}
              className="mt-4 w-full rounded-md border border-white/10 bg-transparent p-3 text-sm resize-none outline-none focus:border-violet-500/50 transition-colors"
            />

            {aiMatched === null ? (
              <button
                onClick={runAiMatch}
                disabled={aiLoading || !aiPrompt.trim() || candidates.isLoading}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-violet-500 transition-colors"
              >
                {aiLoading || candidates.isLoading ? <><Loader2 size={14} className="animate-spin" /> {candidates.isLoading ? "Loading records…" : "Finding matches…"}</> : <><Sparkles size={14} /> Find matching records</>}
              </button>
            ) : (
              <>
                {aiReason && (
                  <p className="mt-3 text-xs text-slate-500 italic">"{aiReason}"</p>
                )}
                <div className="mt-3 max-h-64 overflow-auto rounded-md border border-white/10">
                  {aiMatched.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">No matching records found. Try a different description.</p>
                  ) : (
                    aiMatched.map(r => {
                      const sel = aiSelected.has(r.id);
                      return (
                        <button
                          key={r.id}
                          onClick={() => setAiSelected(prev => { const n = new Set(prev); sel ? n.delete(r.id) : n.add(r.id); return n; })}
                          className={`flex w-full items-center gap-3 border-b border-white/10 p-3 text-left hover:bg-white/[.03] transition-colors ${sel ? "bg-violet-500/5" : ""}`}
                        >
                          <div className={`h-4 w-4 shrink-0 rounded border ${sel ? "bg-violet-600 border-violet-600" : "border-white/20"} flex items-center justify-center`}>
                            {sel && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-white"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm">{String(r.data.name ?? r.data.title ?? "Untitled")}</p>
                            <p className="truncate text-xs text-slate-600">{String(r.data.email ?? r.data.company ?? r.data.status ?? "")}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <button onClick={() => { setAiMatched(null); setAiPrompt(""); }} className="text-sm text-slate-500 hover:text-slate-300">
                    Try again
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">{aiSelected.size} selected</span>
                    <button
                      onClick={addAiSelected}
                      disabled={aiSelected.size === 0 || addEntry.isPending}
                      className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-violet-500 transition-colors"
                    >
                      {addEntry.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                      Add {aiSelected.size > 0 ? aiSelected.size : ""} to list
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#111419] p-5">
            <h2 className="font-medium">Delete "{list.data.name}"?</h2>
            <p className="mt-2 text-sm text-slate-500">The records themselves will not be deleted — only this list.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => removeList.mutate()} className="rounded-md bg-red-600 px-3 py-2 text-sm">Delete list</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

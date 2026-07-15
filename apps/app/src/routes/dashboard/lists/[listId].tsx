import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { AIButton } from "@/components/ui/ai-button";
import { LogoMark } from "@/components/logo";
import { LeadScoreBadge } from "@/components/records/lead-score-badge";
import {
  Download, Globe, Loader2,
  Plus, Search, Trash2, UserCheck, Users, X, Mail,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";
import { ProspectingModal } from "../../../components/ai/prospecting-modal";
import { AIInspector } from "../../../components/ai/ai-inspector";
import { GraphContextButton } from "../../../components/graph/graph-context-drawer";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; lead_score?: number | null; created_by?: string | null }

// Long-text fields belong at the END of a list row (read on the profile, not the list).
const LONG_FIELD_KEYS = new Set(["bio", "notes", "description", "summary", "about", "content", "details", "body", "background"]);
function isLongField(key: string, recs: NodeRecord[]): boolean {
  if (LONG_FIELD_KEYS.has(key.toLowerCase())) return true;
  return recs.some(r => typeof r.data[key] === "string" && (r.data[key] as string).length > 120);
}

/** Real provenance from created_by / source_url — never fabricated. */
function recordProvenance(r: NodeRecord): { kind: "web" | "ai" | "manual" | "system"; url?: string } | null {
  const cb = String(r.created_by ?? "");
  const url = typeof r.data.source_url === "string" ? r.data.source_url : undefined;
  if (url || cb.startsWith("agent:prospect")) return { kind: "web", url };
  if (cb.startsWith("agent:")) return { kind: "ai" };
  if (cb === "system") return { kind: "system" };
  if (cb.startsWith("user_")) return { kind: "manual" };
  return null;
}
interface ListData { id: string; name: string; object_type: string; access_level: string; entry_count: number; owner_id: string | null; shared_with: string[] | null | undefined; visibility?: string }
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
      <div className="surface-modal fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sm px-5 py-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
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
  const { userId } = useCurrentUser();

  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [prospectOpen, setProspectOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [enrichAllDone, setEnrichAllDone] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
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
  // Load members eagerly + cache them — the assign/share dropdowns were only
  // fetching on open, so the menu sat empty for a round-trip. Now it's instant.
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    staleTime: 5 * 60_000,
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
    // Optimistic: reflect assign/visibility/share immediately, roll back on error.
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["list", listId] });
      const prev = qc.getQueryData<ListData>(["list", listId]);
      if (prev) qc.setQueryData<ListData>(["list", listId], { ...prev, ...body });
      return { prev };
    },
    onError: (_e, _body, ctx) => { if (ctx?.prev) qc.setQueryData(["list", listId], ctx.prev); },
    onSettled: () => {
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
  // Inline filter — substring match across each record's data (records-sheet style).
  const shownRecords = filterText.trim()
    ? records.filter(r => JSON.stringify(r.data ?? {}).toLowerCase().includes(filterText.trim().toLowerCase()))
    : records;
  const columns = useMemo(() => {
    const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
    const nameKey = allKeys.find(k => k.toLowerCase() === "name");
    const longKeys = allKeys.filter(k => k !== nameKey && isLongField(k, records));
    const restKeys = allKeys.filter(k => k !== nameKey && !longKeys.includes(k));
    // Order: Name → normal fields → long-text fields last (the ID is its own
    // leading column, rendered separately).
    const ordered = [...(nameKey ? [nameKey] : []), ...restKeys, ...longKeys].slice(0, 8);
    if (records.some(r => r.lead_score != null) && !ordered.includes("lead_score")) ordered.push("lead_score");
    return ordered;
  }, [records]);
  const entryIds = new Set(records.map(r => r.id));
  const available = (candidates.data ?? []).filter(r =>
    !entryIds.has(r.id) &&
    `${r.data.name ?? ""} ${r.data.email ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  // Click-to-sort (records-sheet style): numeric where possible, else alpha.
  const sortedRecords = useMemo(() => {
    if (!sortCol) return shownRecords;
    const val = (r: NodeRecord): unknown => sortCol === "__id" ? r.id : sortCol === "__updated" ? r.updated_at : sortCol === "lead_score" ? (r.lead_score ?? -1) : r.data[sortCol];
    return [...shownRecords].sort((a, b) => {
      const av = val(a), bv = val(b);
      const an = typeof av === "number" ? av : parseFloat(String(av ?? "").replace(/[^0-9.\-]/g, ""));
      const bn = typeof bv === "number" ? bv : parseFloat(String(bv ?? "").replace(/[^0-9.\-]/g, ""));
      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [shownRecords, sortCol, sortDir]);
  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }
  function toggleSelect(id: string) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  const allShownSelected = sortedRecords.length > 0 && sortedRecords.every(r => selected.has(r.id));
  function removeSelected() { selected.forEach(id => removeEntry.mutate(id)); setSelected(new Set()); }
  const sortArrow = (col: string) => sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

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
    setEnrichMsg(null);
    try {
      const res = await apiClient.post<{ ok: boolean; queued: number }>(`/lists/${listId}/enrich`, {});
      setEnrichAllDone(true);
      setEnrichMsg(`Queued ${res.queued} record${res.queued === 1 ? "" : "s"} — enriched details land shortly.`);
      // Enrichment runs async in the background; pull fresh entries after a beat.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["list-entries", listId] }), 6000);
      setTimeout(() => { setEnrichAllDone(false); setEnrichMsg(null); }, 8000);
    } catch (e) {
      // Surface the real reason (e.g. "This list type is not enrichable") instead
      // of silently swallowing it — the button used to just flicker and reset.
      let msg = e instanceof Error ? e.message : "Couldn't start enrichment.";
      try { const p = JSON.parse(msg); if (p?.error) msg = p.error; } catch { /* plain message */ }
      setEnrichMsg(msg);
      setTimeout(() => setEnrichMsg(null), 6000);
    } finally {
      setEnrichingAll(false);
    }
  }
  // Only contact/person/company-style lists can be enriched (web/AI lookup of a
  // person or company). Other list types have nothing to enrich.
  const isEnrichable = useMemo(() => {
    const t = (list.data?.object_type ?? "").toLowerCase();
    return ["contact", "person", "people", "lead", "company", "account", "organization"].some(k => t.includes(k));
  }, [list.data?.object_type]);

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
    update.mutate({ owner_id: uid });
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
  if (!list.data) return <div className="grid h-full place-items-center text-sm text-stone-500">List not found.</div>;

  const isEmpty = entries.isSuccess && records.length === 0;

  return (
    <div className="list-workspace flex h-full flex-col">
      {/* ── Header ── */}
      <header className="list-header shrink-0 border-b px-6 py-3" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-col gap-3">
          {/* Title row — matches the records sheet's small uppercase tracked label */}
          <div className="flex min-w-0 items-center gap-3">
            <input
              value={list.data.name}
              onChange={e => qc.setQueryData(["list", listId], { ...list.data, name: e.target.value })}
              onBlur={e => update.mutate({ name: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-500 outline-none placeholder-stone-400 dark:placeholder-stone-600"
            />
            <span className="rounded-full border px-2.5 py-1 text-[11px] capitalize" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              {list.data.object_type}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>
              {records.length} record{records.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="list-toolbar flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">

        {/* ── Assignment chip + popover ── */}
        <div className="relative" ref={assignRef}>
          <button
            onClick={() => setAssignOpen(o => !o)}
            className="btn-secondary !px-2.5 !py-1.5 !text-[11px]"
          >
            {list.data.owner_id ? <UserCheck size={11} /> : <Users size={11} />}
            {list.data.owner_id
              ? (members.find(m => m.user_id === list.data!.owner_id)?.name?.split(" ")[0]
                  ?? (list.data.owner_id === userId ? "Me" : "Assigned"))
              : "Assign"}
          </button>

          {assignOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setAssignOpen(false)} />
              <div className="surface-modal absolute left-0 top-full z-30 mt-1 w-64 rounded-sm p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.7)]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Assign to</p>
                {membersQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin" style={{ color: "var(--text-faint)" }} /></div>
                ) : (
                  <div className="space-y-1">
                    {/* "Unassigned" option */}
                    <button
                      onClick={() => setAssignee(null)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${!list.data!.owner_id ? "surface-selected text-token-primary" : "text-token-muted surface-hover"}`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[9px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>—</span>
                      Unassigned
                    </button>
                    {/* Me first */}
                    {userId && (() => {
                      const me = members.find(m => m.user_id === userId);
                      const isAssigned = list.data!.owner_id === userId;
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
                      const isAssigned = list.data!.owner_id === m.user_id;
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

              </div>
            </>
          )}
        </div>

        {/* ── Share + visibility (split out from Assign for clarity) ── */}
        <div className="relative">
          <button
            onClick={() => setShareOpen(o => !o)}
            className="btn-secondary !px-2.5 !py-1.5 !text-[11px]"
          >
            <Globe size={11} />
            {(list.data.visibility ?? "workspace") === "private" ? "Private" : (list.data.visibility ?? "workspace") === "shared" ? "Shared" : "Workspace"}
            {(list.data.shared_with ?? []).length > 0 && (
              <span className="ml-0.5 rounded-full bg-[#717784]/20 px-1.5 py-0.5 text-[9px] text-[#717784]">
                +{(list.data.shared_with ?? []).length}
              </span>
            )}
          </button>
          {shareOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShareOpen(false)} />
              <div className="surface-modal absolute left-0 top-full z-30 mt-1 w-64 rounded-sm p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.7)]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Visibility</p>
                <div className="flex gap-1 mb-2">
                  {(["workspace", "shared", "private"] as const).map(v => (
                    <button key={v} onClick={() => update.mutate({ visibility: v })}
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
                      {members.filter(m => m.user_id !== list.data!.owner_id).map(m => {
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
                            {isShared && <span className="ml-auto text-[10px]" style={{ color: "var(--section-accent)" }}>shared</span>}
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

        {/* Filter / search — records-sheet style */}
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }}/>
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Filter…"
            className="w-44 rounded-md border border-stone-200 bg-stone-50 pl-7 pr-2.5 py-1.5 text-[11px] outline-none placeholder-stone-400 dark:border-[var(--border-soft)] dark:bg-[var(--surface-hover)] dark:placeholder-stone-600"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
            </div>
        {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2">
        {records.length > 0 && (
          <>
            <AIButton
              size="sm"
              variant="subtle"
              onClick={enrichAll}
              disabled={enrichingAll || !isEnrichable}
              loading={enrichingAll}
              title={isEnrichable ? "Enrich every record with web/AI lookup" : "This list type can't be enriched"}
            >
              {enrichAllDone ? "Enriching…" : "Enrich All"}
            </AIButton>
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
        <AIButton size="sm" variant="subtle" onClick={openAi}>Add</AIButton>
        <button
          onClick={() => setProspectOpen(true)}
          className="btn-secondary !px-3 !py-1.5 !text-xs"
        >
          <Globe size={13}/> Find from web
        </button>
        {/* Export + Delete — unified with the token-based btn-secondary like every other header
            action (were hardcoded stone, which read as a different button style). */}
        <button onClick={exportCsv} title="Export CSV" className="btn-secondary !px-2.5 !py-1.5 !text-[11px]">
          <Download size={11}/> Export
        </button>
        <button
          onClick={() => setDeleteConfirm(true)}
          title="Delete list"
          className="btn-secondary !px-2.5 !py-1.5 !text-[11px] hover:!border-[#d1524a] hover:!text-[#d1524a]"
        >
          <Trash2 size={11}/>
        </button>
            </div>
            {enrichMsg && (
              <div className="mt-2 text-right text-[11px]" style={{ color: "var(--text-secondary)" }}>{enrichMsg}</div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {/* AI Inspector (interpretation) + Graph Context Drawer trigger (connected context). */}
        {list.data && (() => {
          const listCtx = {
            kind: "list" as const,
            id: list.data.id,
            title: list.data.name,
            objectType: list.data.object_type,
            data: { record_count: records.length },
            scopeLabel: `the ${list.data.object_type} list "${list.data.name}" (${records.length} records)`,
          };
          return (
            <div className="mb-5 space-y-2">
              <div className="flex justify-end">
                <GraphContextButton ctx={listCtx} />
              </div>
              <AIInspector ctx={listCtx} defaultOpen={false} />
            </div>
          );
        })()}
        {entries.isLoading ? (
          <PageSkeleton rows={6} />
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-6 border-y py-24 text-center" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-sm" style={{ background: "var(--surface-hover)", color: "var(--section-accent)" }}>
              <LogoMark size={24} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>No records in this list yet</h2>
              <p className="mt-1.5 max-w-sm text-xs" style={{ color: "var(--text-muted)" }}>
                Describe what you're looking for and AI will pick the matching {list.data.object_type} — or add them manually.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <AIButton onClick={openAi}>Add</AIButton>
              <button
                onClick={() => setAddOpen(true)}
                className="btn-secondary !px-4 !py-2 !text-xs"
              >
                <Plus size={13} /> Add manually
              </button>
            </div>
          </div>
        ) : (
          /* ── Table ── */
          <>
            {selected.size > 0 && (
              <div className="mb-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
                <span style={{ color: "var(--text-secondary)" }}>{selected.size} selected</span>
                <button onClick={removeSelected} className="flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-[#d1524a] transition-colors hover:bg-[#d1524a]/[.06] dark:border-[var(--border-soft)]">
                  <X size={11}/> Remove from list
                </button>
                <button onClick={() => setSelected(new Set())} className="text-[11px]" style={{ color: "var(--text-faint)" }}>Clear</button>
              </div>
            )}
            <div className="list-sheet minimal-sheet overflow-auto">
            <table className="minimal-table min-w-full text-left text-[12px]">
              <thead>
                <tr>
                  <th className="w-8 px-2">
                    <input type="checkbox" checked={allShownSelected} onChange={() => setSelected(allShownSelected ? new Set() : new Set(sortedRecords.map(r => r.id)))} className="cursor-pointer align-middle"/>
                  </th>
                  <th className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("__id")}>ID{sortArrow("__id")}</th>
                  {columns.map(c => (
                    <th key={c} className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(c)}>
                      {c.replaceAll("_", " ")}{sortArrow(c)}
                    </th>
                  ))}
                  <th className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("__updated")}>Updated{sortArrow("__updated")}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map(record => {
                  const prov = recordProvenance(record);
                  return (
                  <tr key={record.id} className={`group transition-colors ${selected.has(record.id) ? "bg-stone-50 dark:bg-[var(--surface-hover)]" : ""}`}>
                    <td className="w-8 px-2">
                      <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelect(record.id)} className="cursor-pointer align-middle"/>
                    </td>
                    {/* Unique ID — links to the record's profile page */}
                    <td className="whitespace-nowrap">
                      <Link
                        to={`/objects/${record.object_type}/${record.id}`}
                        title={record.id}
                        className="font-mono text-[11px] text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-300"
                      >
                        {record.id.slice(0, 8)}
                      </Link>
                    </td>
                    {columns.map((c, i) => (
                      <td key={c} className="max-w-[240px] truncate text-stone-700 dark:text-stone-300">
                        {c === "lead_score"
                          ? (record.lead_score != null ? <LeadScoreBadge score={record.lead_score} size="sm"/> : null)
                          : i === 0
                          ? (
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              <Link
                                to={`/objects/${record.object_type}/${record.id}`}
                                className="truncate font-medium text-stone-950 transition-colors hover:text-stone-600 dark:text-stone-50 dark:hover:text-stone-300"
                              >
                                {display(record.data[c])}
                              </Link>
                              {prov && prov.kind === "web" && (
                                <span title={prov.url ? `Found on the web — ${prov.url}` : "Discovered from the web"} className="shrink-0" style={{ color: "var(--text-faint)" }}><Globe size={11}/></span>
                              )}
                              {prov && prov.kind === "ai" && (
                                <span title="Added by an AI agent" className="shrink-0" style={{ color: "var(--text-faint)" }}><LogoMark size={10}/></span>
                              )}
                            </span>
                          )
                          : display(record.data[c])}
                      </td>
                    ))}
                    <td className="text-[11px] tabular-nums text-stone-400 dark:text-stone-600">
                      {fmtDate(record.updated_at)}
                    </td>
                    <td className="w-8 px-2">
                      <button
                        onClick={() => removeEntry.mutate(record.id)}
                        title="Remove from list"
                        className="grid h-6 w-6 place-items-center rounded opacity-0 transition-all group-hover:opacity-100 hover:bg-stone-100 dark:hover:bg-stone-900"
                        style={{ color: "var(--text-faint)" }}
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
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
                  className="flex w-full items-center justify-between border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-stone-50 dark:hover:bg-stone-900/60"
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
            className="mt-3 block text-[11px] transition-colors hover:text-stone-400"
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
              <LogoMark size={14} className="text-stone-400" />
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
            className="surface-input w-full resize-none rounded-sm p-3 text-[12px] outline-none transition-colors placeholder:text-stone-400 dark:placeholder:text-stone-600"
            style={{ color: "var(--text-primary)" }}
          />
          {aiMatched === null ? (
            <AIButton
              onClick={runAiMatch}
              disabled={aiLoading || !aiPrompt.trim() || candidates.isLoading}
              loading={aiLoading || candidates.isLoading}
              className="mt-3 w-full"
            >
              {aiLoading || candidates.isLoading
                ? (candidates.isLoading ? "Loading records…" : "Finding matches…")
                : "Find matching records"}
            </AIButton>
          ) : (
            <>
              {aiReason && (
                <p className="mt-3 text-[11px] italic" style={{ color: "var(--text-muted)" }}>"{aiReason}"</p>
              )}
              <div className="mt-3 max-h-56 overflow-auto rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
                {aiMatched.length === 0 ? (
                  <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>No matching records found. Try a different description.</p>
                ) : (
                  aiMatched.map(r => {
                    const sel = aiSelected.has(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setAiSelected(prev => { const n = new Set(prev); sel ? n.delete(r.id) : n.add(r.id); return n; })}
                        className={`flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-stone-50 dark:hover:bg-stone-900/60 ${sel ? "surface-selected" : ""}`}
                        style={{ borderColor: "var(--border-soft)" }}
                      >
                        <div className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${sel ? "bg-stone-600 border-stone-600" : ""}`} style={sel ? undefined : { borderColor: "var(--border-strong)" }}>
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
                  className="text-[11px] transition-colors hover:text-stone-400"
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
          <div className="surface-modal fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-sm px-5 py-5 shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
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
          <div className="w-full max-w-md rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2f9e6b]/10 border border-[#2f9e6b]/25">
                  <Mail size={13} className="text-[#2f9e6b]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Enroll in Sequence</span>
              </div>
              <button onClick={() => setEnrollOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {enrollStep === "done" ? (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="h-12 w-12 rounded-sm bg-[#2f9e6b]/10 border border-[#2f9e6b]/25 flex items-center justify-center">
                    <Mail size={22} className="text-[#2f9e6b]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Enrollment complete</p>
                    <p className="text-xs text-[var(--text-secondary)]">{records.length} records enrolled in "{enrollSeqName}"</p>
                  </div>
                </div>
              ) : enrollStep === "confirm" ? (
                <div className="space-y-4">
                  <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-4">
                    <p className="text-xs text-[var(--text-secondary)] mb-1">Enrolling into</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{enrollSeqName}</p>
                  </div>
                  <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-[var(--text-secondary)]">Records to enroll</span>
                    <span className="text-sm font-semibold text-[#2f9e6b]">{records.length}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)]">Records already enrolled in this sequence will be skipped automatically.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-secondary)] mb-3">Choose a sequence to enroll {records.length} record{records.length !== 1 ? "s" : ""} from this list:</p>
                  {sequencesQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-4"><Loader2 size={13} className="animate-spin" /> Loading sequences…</div>
                  ) : sequences.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] py-4 text-center">No sequences found. Create one first under Sequences.</p>
                  ) : (
                    sequences.map(seq => (
                      <button
                        key={seq.id}
                        onClick={() => { setEnrollSeqId(seq.id); setEnrollSeqName(seq.name); setEnrollStep("confirm"); }}
                        className="w-full flex items-center justify-between rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3 hover:border-[#2f9e6b]/30 hover:bg-[#2f9e6b]/5 transition-colors text-left"
                      >
                        <span className="text-sm text-[var(--text-primary)]">{seq.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${seq.status === "active" ? "bg-[#2f9e6b]/15 text-[#2f9e6b]" : "bg-[var(--surface-hover)] text-[var(--text-secondary)]"}`}>{seq.status}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-soft)]">
              <button
                onClick={() => enrollStep === "confirm" ? setEnrollStep("pick") : setEnrollOpen(false)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {enrollStep === "done" ? "Close" : enrollStep === "confirm" ? "Back" : "Cancel"}
              </button>
              {enrollStep === "confirm" && (
                <button
                  onClick={enrollInSequence}
                  disabled={enrolling}
                  className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] transition-colors disabled:opacity-40"
                >
                  {enrolling ? <><Loader2 size={12} className="animate-spin" /> Enrolling…</> : <><Mail size={12} /> Enroll {records.length} records</>}
                </button>
              )}
              {enrollStep === "done" && (
                <button
                  onClick={() => setEnrollOpen(false)}
                  className="rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] transition-colors"
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

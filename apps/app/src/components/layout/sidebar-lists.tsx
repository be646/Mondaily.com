import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Plus, Sparkles, UserCheck, Users, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { apiClient } from "../../lib/api-client";

interface ListItem {
  id: string;
  name: string;
  object_type: string;
  entry_count: number;
  owner_id: string;
  assignee_id: string | null;
  shared_with: string[] | null | undefined;
}
interface Member { id: string; user_id: string; name: string; email: string }
interface NodeRecord { id: string; object_type: string; data: Record<string, unknown> }

function memberInitials(m: Member) {
  return (m.name || m.email).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function memberLabel(m: Member) { return m.name || m.email; }

export function SidebarLists() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { userId } = useAuth();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"manual" | "ai">("manual");
  const [myOpen, setMyOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);

  // Manual form
  const [name, setName] = useState("");
  const [objectType, setObjectType] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [sharedWith, setSharedWith] = useState<string[]>([]);

  // AI form
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const objectsQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    enabled: open,
  });
  const objectTypes = objectsQuery.data ?? [];
  const defaultObjectType = objectTypes[0]?.slug ?? "contacts";
  const members = membersQuery.data ?? [];

  const query = useQuery({ queryKey: ["lists"], queryFn: () => apiClient.get<ListItem[]>("/lists") });

  const create = useMutation({
    mutationFn: () => apiClient.post<ListItem>("/lists", {
      name,
      object_type: objectType || defaultObjectType,
      assignee_id: assigneeId || userId || null,
      shared_with: sharedWith,
    }),
    onSuccess: (data) => {
      resetModal();
      qc.invalidateQueries({ queryKey: ["lists"] });
      navigate(`/lists/${data.id}`);
    },
  });

  function resetModal() {
    setOpen(false); setName(""); setAiPrompt(""); setAiError("");
    setTab("manual"); setAssigneeId(""); setSharedWith([]);
  }

  function toggleShared(uid: string) {
    setSharedWith(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  }

  async function createWithAI() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setAiError("");
    try {
      const namingRes = await apiClient.post<{ name: string; object_type: string; reason: string }>("/generate/list-name", {
        prompt: aiPrompt, objectTypes: objectTypes.map(o => o.slug),
      });
      const newList = await apiClient.post<ListItem>("/lists", {
        name: namingRes.name,
        object_type: namingRes.object_type || defaultObjectType,
        assignee_id: userId || null,
        shared_with: [],
      });
      qc.invalidateQueries({ queryKey: ["lists"] });

      const records = await apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(newList.object_type)}&limit=100`);
      if (records.length > 0) {
        const selRes = await apiClient.post<{ selectedIds: string[] }>("/generate/list-entries", {
          prompt: aiPrompt, objectType: newList.object_type,
          records: records.map(r => ({ id: r.id, data: r.data })),
        });
        for (const id of selRes.selectedIds.slice(0, 30)) {
          await apiClient.post(`/lists/${newList.id}/entries`, { node_id: id }).catch(() => {});
        }
        qc.invalidateQueries({ queryKey: ["lists"] });
      }

      resetModal();
      navigate(`/lists/${newList.id}`);
    } catch (e: any) {
      setAiError(e.message || "Failed to create list");
    } finally {
      setAiLoading(false);
    }
  }

  const lists = query.data ?? [];

  // My lists: assigned to me (assignee_id === userId) or owned by me with no assignee
  const myLists = lists.filter(l =>
    l.assignee_id === userId || (!l.assignee_id && l.owner_id === userId)
  );
  // Team lists: shared with me but not assigned to me, or workspace lists
  const teamLists = lists.filter(l =>
    l.assignee_id !== userId && ((l.shared_with ?? []).includes(userId ?? "") || (!l.assignee_id && l.owner_id !== userId))
  );

  function renderList(list: ListItem) {
    const assignee = members.find(m => m.user_id === list.assignee_id);
    const sharedCount = (list.shared_with ?? []).length;
    const active = location.pathname === `/lists/${list.id}`;
    return (
      <div key={list.id} className="group flex items-center">
        <Link
          to={`/lists/${list.id}`}
          className={`relative flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
            active
              ? "font-medium text-stone-950 dark:text-stone-50"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
          }`}
        >
          {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-stone-950 dark:bg-stone-50" />}
          <span className="min-w-0 flex-1 truncate">{list.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {assignee && (
              <span title={`Assigned to ${memberLabel(assignee)}`}
                className="grid h-4 w-4 place-items-center rounded-full border border-stone-200 bg-stone-50 text-[8px] font-bold text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                {memberInitials(assignee)}
              </span>
            )}
            {sharedCount > 0 && (
              <span className="text-[9px] text-stone-400 dark:text-stone-600">{sharedCount > 1 ? `+${sharedCount}` : ""}</span>
            )}
            <span className="text-[10px] text-stone-400 dark:text-stone-600">{list.entry_count}</span>
          </span>
        </Link>
        <button title="List menu" className="mr-1 shrink-0 text-stone-400 opacity-0 transition-opacity hover:text-stone-950 group-hover:opacity-100 dark:text-stone-600 dark:hover:text-stone-200">
          <MoreHorizontal size={12} />
        </button>
      </div>
    );
  }

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between px-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-faint)" }}>Lists</p>
        <button onClick={() => setOpen(true)} title="New list" className="transition-colors hover:text-stone-950 dark:hover:text-stone-50" style={{ color: "var(--text-faint)" }}>
          <Plus size={13} />
        </button>
      </div>

      {/* My Lists */}
      {myLists.length > 0 && (
        <div className="mb-1">
          <button onClick={() => setMyOpen(v => !v)}
            className="flex w-full items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-600 dark:hover:text-stone-300">
            {myOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <UserCheck size={9} /> Mine
          </button>
          {myOpen && myLists.map(renderList)}
        </div>
      )}

      {/* Team Lists */}
      {teamLists.length > 0 && (
        <div className="mb-1">
          <button onClick={() => setTeamOpen(v => !v)}
            className="flex w-full items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-600 dark:hover:text-stone-300">
            {teamOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Users size={9} /> Shared
          </button>
          {teamOpen && teamLists.map(renderList)}
        </div>
      )}

      {query.isError && (
        <div className="px-3 py-2">
          <p className="text-[11px] text-rose-400">Couldn't load lists.</p>
          <button onClick={() => query.refetch()} className="text-[11px] text-stone-400 hover:text-stone-300 transition-colors">Retry</button>
        </div>
      )}

      {!myLists.length && !teamLists.length && lists.length === 0 && !query.isLoading && !query.isError && (
        <button onClick={() => setOpen(true)} className="w-full px-2.5 py-2 text-left text-xs transition-colors hover:text-stone-950 dark:hover:text-stone-50" style={{ color: "var(--text-faint)" }}>
          Create your first list
        </button>
      )}

      {/* ── Create modal ── */}
      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={resetModal} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#141414] shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            {/* Tabs */}
            <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
              <div className="flex items-center gap-0.5 rounded-lg border border-white/[.07] bg-white/[.02] p-0.5">
                <button onClick={() => setTab("manual")}
                  className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${tab === "manual" ? "bg-white/[.08] text-white" : "text-stone-500 hover:text-stone-300"}`}>
                  Manual
                </button>
                <button onClick={() => setTab("ai")}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${tab === "ai" ? "bg-stone-500/20 text-stone-300" : "text-stone-500 hover:text-stone-300"}`}>
                  <Sparkles size={10} /> AI
                </button>
              </div>
              <button onClick={resetModal} className="rounded-md p-1 text-stone-500 hover:bg-white/[.05] hover:text-white transition-colors">
                <X size={13} />
              </button>
            </div>

            {tab === "manual" ? (
              <form onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="space-y-4 p-5">
                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-stone-600">Name</label>
                  <input autoFocus value={name} onChange={e => setName(e.target.value)} className="key-input w-full" placeholder="e.g. Hot Leads Q3" />
                </div>

                {/* Object type */}
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-stone-600">Object type</label>
                  <select value={objectType || defaultObjectType} onChange={e => setObjectType(e.target.value)} className="key-input w-full">
                    {objectTypes.length > 0
                      ? objectTypes.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
                      : <>
                          <option value="contacts">Contacts</option>
                          <option value="companies">Companies</option>
                          <option value="deals">Deals</option>
                        </>}
                  </select>
                </div>

                {/* Assign to member */}
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-stone-600">Assign to</label>
                  {membersQuery.isLoading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2">
                      <Loader2 size={12} className="animate-spin text-stone-600" />
                      <span className="text-xs text-stone-600">Loading members…</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {/* "Me" option */}
                      <button type="button"
                        onClick={() => setAssigneeId(prev => prev === (userId ?? "") ? "" : (userId ?? ""))}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${assigneeId === userId ? "border-stone-500/40 bg-stone-500/10 text-white" : "border-white/[.08] bg-white/[.02] text-stone-400 hover:border-white/[.15] hover:text-white"}`}>
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/[.10] text-[8px] font-bold">
                          {(members.find(m => m.user_id === userId)?.name ?? "Me").slice(0, 2).toUpperCase()}
                        </span>
                        Me
                      </button>
                      {members.filter(m => m.user_id !== userId).map(m => (
                        <button key={m.user_id} type="button"
                          onClick={() => setAssigneeId(prev => prev === m.user_id ? "" : m.user_id)}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${assigneeId === m.user_id ? "border-stone-500/40 bg-stone-500/10 text-white" : "border-white/[.08] bg-white/[.02] text-stone-400 hover:border-white/[.15] hover:text-white"}`}>
                          <span className="grid h-4 w-4 place-items-center rounded-full bg-white/[.10] text-[8px] font-bold">
                            {memberInitials(m)}
                          </span>
                          {memberLabel(m).split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Share with */}
                {members.filter(m => m.user_id !== assigneeId).length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-stone-600">Share with</label>
                    <div className="flex flex-wrap gap-1.5">
                      {members.filter(m => m.user_id !== assigneeId).map(m => (
                        <button key={m.user_id} type="button"
                          onClick={() => toggleShared(m.user_id)}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${sharedWith.includes(m.user_id) ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/[.08] bg-white/[.02] text-stone-400 hover:border-white/[.15] hover:text-white"}`}>
                          <span className="grid h-4 w-4 place-items-center rounded-full bg-white/[.10] text-[8px] font-bold">
                            {memberInitials(m)}
                          </span>
                          {memberLabel(m).split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button type="submit" disabled={!name.trim() || create.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-600 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-stone-500 transition-colors">
                  {create.isPending ? "Creating…" : "Create list"}
                </button>
              </form>
            ) : (
              <div className="space-y-3.5 p-5">
                <p className="text-[11px] text-stone-600">Describe the list you want. AI will name it, pick the right object type, and populate it with matching records.</p>
                <textarea autoFocus value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={4}
                  placeholder={`e.g. "High-value fintech companies" or "Leads from referrals not yet contacted"`}
                  className="w-full resize-none rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2.5 text-[12px] text-white placeholder-stone-700 outline-none focus:border-stone-500/40 transition-colors" />
                {aiError && <p className="text-[11px] text-stone-400">{aiError}</p>}
                <button onClick={createWithAI} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-600 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-stone-500 transition-colors">
                  {aiLoading ? <><Loader2 size={13} className="animate-spin" /> Creating list…</> : <><Sparkles size={13} /> Create with AI</>}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

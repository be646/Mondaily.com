import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

interface ListItem { id: string; name: string; object_type: string; entry_count: number }
interface NodeRecord { id: string; object_type: string; data: Record<string, unknown> }

export function SidebarLists() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"manual" | "ai">("manual");

  // Manual
  const [name, setName] = useState("");
  const [objectType, setObjectType] = useState("");

  // AI
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const objectsQuery = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });
  const objectTypes = objectsQuery.data ?? [];
  const defaultObjectType = objectTypes[0]?.slug ?? "companies";

  const query = useQuery({ queryKey: ["lists"], queryFn: () => apiClient.get<ListItem[]>("/lists") });

  const create = useMutation({
    mutationFn: () => apiClient.post<ListItem>("/lists", { name, object_type: objectType || defaultObjectType }),
    onSuccess: (data) => {
      setOpen(false); setName("");
      qc.invalidateQueries({ queryKey: ["lists"] });
      navigate(`/lists/${data.id}`);
    },
  });

  function resetModal() {
    setOpen(false); setName(""); setAiPrompt(""); setAiError(""); setTab("manual");
  }

  async function createWithAI() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setAiError("");
    try {
      // Step 1: Ask Claude to name the list and pick the object type
      const namingRes = await apiClient.post<{ name: string; object_type: string; reason: string }>("/generate/list-name", {
        prompt: aiPrompt,
        objectTypes: objectTypes.map(o => o.slug),
      });
      const listName = namingRes.name;
      const listObjectType = namingRes.object_type || defaultObjectType;

      // Step 2: Create the list
      const newList = await apiClient.post<ListItem>("/lists", { name: listName, object_type: listObjectType });
      qc.invalidateQueries({ queryKey: ["lists"] });

      // Step 3: Fetch records of that type and ask AI to select matching ones
      const records = await apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(listObjectType)}&limit=100`);
      if (records.length > 0) {
        const selRes = await apiClient.post<{ selectedIds: string[] }>("/generate/list-entries", {
          prompt: aiPrompt,
          objectType: listObjectType,
          records: records.map(r => ({ id: r.id, data: r.data })),
        });
        // Add selected entries
        for (const id of selRes.selectedIds.slice(0, 30)) {
          await apiClient.post(`/lists/${newList.id}/entries`, { node_id: id }).catch(() => {});
        }
        qc.invalidateQueries({ queryKey: ["list-entries", newList.id] });
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

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between px-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Lists</p>
        <button onClick={() => setOpen(true)} title="New list" className="text-slate-600 hover:text-white transition-colors">
          <Plus size={13} />
        </button>
      </div>

      {lists.map(list => (
        <div key={list.id} className="group flex items-center">
          <Link to={`/lists/${list.id}`} className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-white/[.04] hover:text-slate-200 transition-colors">
            <span className="truncate">{list.name}</span>
            <span className="text-[10px] text-slate-700">{list.entry_count}</span>
          </Link>
          <button title="List menu" className="mr-1 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal size={12} />
          </button>
        </div>
      ))}

      {!query.isLoading && !lists.length && (
        <button onClick={() => setOpen(true)} className="w-full px-3 py-2 text-left text-xs text-slate-600 hover:text-slate-400">
          Create your first list
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={resetModal}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            {/* Header with tab switcher */}
            <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3.5">
              <div className="flex items-center gap-0.5 rounded-lg border border-white/[.07] bg-white/[.02] p-0.5">
                <button onClick={() => setTab("manual")}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${tab === "manual" ? "bg-white/[.08] text-white" : "text-slate-500 hover:text-slate-300"}`}>
                  Manual
                </button>
                <button onClick={() => setTab("ai")}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${tab === "ai" ? "bg-violet-500/20 text-violet-300" : "text-slate-500 hover:text-slate-300"}`}>
                  <Sparkles size={10}/> AI
                </button>
              </div>
              <button onClick={resetModal} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
                <X size={13}/>
              </button>
            </div>

            {tab === "manual" ? (
              <form onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="p-5 space-y-3.5">
                <div>
                  <label className="text-[11px] text-zinc-600 mb-1.5 block uppercase tracking-wide">Name</label>
                  <input autoFocus value={name} onChange={e => setName(e.target.value)}
                    className="key-input w-full"/>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-600 mb-1.5 block uppercase tracking-wide">Object type</label>
                  <select value={objectType || defaultObjectType} onChange={e => setObjectType(e.target.value)}
                    className="key-input w-full">
                    {objectTypes.length > 0
                      ? objectTypes.map(o => <option key={o.slug} value={o.slug}>{o.name_plural}</option>)
                      : <>
                          <option value="people">People</option>
                          <option value="companies">Companies</option>
                          <option value="deals">Deals</option>
                        </>}
                  </select>
                </div>
                <button type="submit" disabled={!name.trim() || create.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-red-400 transition-colors">
                  {create.isPending ? "Creating…" : "Create list"}
                </button>
              </form>
            ) : (
              <div className="p-5 space-y-3.5">
                <p className="text-[11px] text-zinc-600">Describe the list you want. AI will name it, pick the right object type, and populate it with matching records.</p>
                <textarea
                  autoFocus
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  rows={4}
                  placeholder={`e.g. "High-value fintech companies" or "Leads from referrals not yet contacted"`}
                  className="w-full rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2.5 text-[12px] text-white placeholder-zinc-700 resize-none outline-none focus:border-violet-500/40 transition-colors"
                />
                {aiError && <p className="text-[11px] text-red-400">{aiError}</p>}
                <button onClick={createWithAI} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-violet-500 transition-colors">
                  {aiLoading ? <><Loader2 size={13} className="animate-spin"/> Creating list…</> : <><Sparkles size={13}/> Create with AI</>}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Zap, Mail, GitBranch, Play, Pause, MoreHorizontal, Trash2, Copy, Sparkles, Loader2, X, Check } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";

// ─── AI Sequence Generator Modal ──────────────────────────────────────────────
function AISequenceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [stepCount, setStepCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; steps: any[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setPreview(null);
    try {
      const res = await apiClient.post<{ name: string; steps: any[] }>("/generate/sequence", {
        prompt, steps: stepCount,
      });
      setPreview(res);
    } catch (e: any) { setError(e.message || "Failed to generate"); }
    finally { setLoading(false); }
  };

  const createSequence = async () => {
    if (!preview) return;
    setCreating(true);
    try {
      // API uses PATCH /sequences/new to create (id="new" triggers an INSERT)
      const seq = await apiClient.patch<{ id: string }>("/sequences/new", {
        name: preview.name,
        stop_on_reply: true,
        sending_days: ["Mon","Tue","Wed","Thu","Fri"],
        send_start: "09:00",
        send_end: "17:00",
        daily_limit: 50,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        unsubscribe: true,
        steps: preview.steps.map((s, i) => ({
          id: crypto.randomUUID(),
          type: s.type ?? "email",
          label: `Step ${i + 1}`,
          position: i,
          delay_value: s.delay_value ?? (i === 0 ? 0 : 3),
          delay_unit: s.delay_unit ?? "days",
          subject: s.subject ?? "",
          body: s.body ?? "",
          send_as: s.send_as ?? (i === 0 ? "new" : "reply"),
        })),
      });
      onCreated(seq.id);
    } catch (e: any) { setError(e.message || "Failed to create"); setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className={`w-full rounded-xl border border-white/10 bg-[#111419] transition-all ${preview ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between p-5 border-b border-white/[.06]">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-400"/>
            <h2 className="font-semibold text-white">Generate sequence with AI</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16}/></button>
        </div>

        <div className="p-5 space-y-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            placeholder={`e.g. "Cold outreach to SaaS founders about our analytics tool" or "Follow-up sequence for leads who downloaded our whitepaper"`}
            className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2.5 text-sm text-white placeholder-slate-600 resize-none outline-none focus:border-violet-500/40"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Steps</span>
            <div className="flex gap-1">
              {[3,4,5,6].map(n => (
                <button key={n} onClick={() => setStepCount(n)}
                  className={`w-9 rounded-md border py-1 text-xs font-medium transition-colors ${stepCount === n ? "border-violet-500/50 bg-violet-500/10 text-violet-300" : "border-white/10 text-slate-500 hover:text-slate-300"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {preview && (
          <div className="border-t border-white/[.06] px-5 pb-4">
            <p className="py-3 text-xs font-semibold text-slate-400">"{preview.name}" — {preview.steps.length} steps</p>
            <div className="space-y-2 max-h-64 overflow-auto">
              {preview.steps.map((s, i) => (
                <div key={i} className="rounded-lg border border-white/[.06] bg-white/[.02] p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Step {i+1}</span>
                    {i > 0 && <span className="text-[10px] text-slate-700">· {s.delay_value}d delay</span>}
                  </div>
                  <p className="text-xs font-medium text-white">{s.subject}</p>
                  <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-t border-white/[.06]">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">Cancel</button>
          {!preview ? (
            <button onClick={generate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-violet-500">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Generating…</> : <><Sparkles size={13}/> Generate</>}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={loading} className="text-sm text-slate-500 hover:text-slate-300">Regenerate</button>
              <button onClick={createSequence} disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-violet-500">
                {creating ? <><Loader2 size={13} className="animate-spin"/> Creating…</> : <><Check size={13}/> Create sequence</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Automation {
  id: string;
  name: string;
  type: "workflow" | "sequence";
  status: string;
  updated_at: string;
  data?: { steps?: unknown[]; enrollments?: unknown[] };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    draft:    "bg-slate-700/50 text-slate-400 border-slate-600/30",
    paused:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    archived: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${map[status] ?? map.draft}`}>
      {status}
    </span>
  );
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const query = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiClient.get<Automation[]>("/automations"),
  });
  const items = query.data ?? [];
  const sequences = items.filter(i => (i as any).type === "sequence" || !(i as any).type);
  const workflows  = items.filter(i => (i as any).type === "workflow");

  const createSequence = useMutation({
    mutationFn: () => apiClient.patch<{ id: string }>("/sequences/new", {
      name: "New Sequence",
      stop_on_reply: true,
      sending_days: ["Mon","Tue","Wed","Thu","Fri"],
      send_start: "09:00",
      send_end: "17:00",
      daily_limit: 50,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unsubscribe: true,
    }),
    onSuccess: (seq) => navigate(`/automations/sequences/${seq.id}`),
  });

  const createWorkflow = useMutation({
    mutationFn: () => apiClient.patch<{ id: string }>("/workflows/new", { name: "New Workflow", status: "draft", nodes: [] }),
    onSuccess: (wf) => navigate(`/automations/workflows/${wf.id}`),
  });

  const deleteItem = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "sequence"|"workflow" }) =>
      type === "workflow" ? apiClient.delete(`/workflows/${id}`) : apiClient.delete(`/sequences/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["automations"] }); setMenuOpen(null); },
  });

  const duplicateItem = useMutation({
    mutationFn: async ({ item, type }: { item: Automation; type: "sequence"|"workflow" }) => {
      const name = `${item.name} (copy)`;
      if (type === "workflow") {
        return apiClient.patch<{ id: string }>("/workflows/new", { name, status: "draft", nodes: (item.data as any)?.nodes ?? [] });
      }
      return apiClient.patch<{ id: string }>("/sequences/new", {
        name,
        stop_on_reply: (item.data as any)?.stop_on_reply ?? true,
        sending_days: (item.data as any)?.sending_days ?? ["Mon","Tue","Wed","Thu","Fri"],
        send_start: (item.data as any)?.send_start ?? "09:00",
        send_end: (item.data as any)?.send_end ?? "17:00",
        daily_limit: (item.data as any)?.daily_limit ?? 50,
        timezone: (item.data as any)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        unsubscribe: (item.data as any)?.unsubscribe ?? true,
        steps: (item.data as any)?.steps ?? [],
      });
    },
    onSuccess: (res, { type }) => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      setMenuOpen(null);
      navigate(type === "workflow" ? `/automations/workflows/${res.id}` : `/automations/sequences/${res.id}`);
    },
  });

  function formatDate(s: string) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const Section = ({ title, icon: Icon, items, newHref, newLabel, onNew }: {
    title: string; icon: any; items: Automation[]; newHref?: string; newLabel: string; onNew?: () => void;
  }) => (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-slate-500"/>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">{items.length}</span>
        </div>
        {onNew ? (
          <button
            onClick={onNew}
            disabled={createSequence.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors disabled:opacity-50"
          >
            <Plus size={11}/> {newLabel}
          </button>
        ) : (
          <Link
            to={newHref!}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors"
          >
            <Plus size={11}/> {newLabel}
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[.08] px-6 py-8 text-center">
          <Icon size={20} className="mx-auto mb-2 text-slate-700"/>
          <p className="text-xs text-slate-600">No {title.toLowerCase()} yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[.08]">
          {items.map((item, i) => {
            const steps = (item.data as any)?.steps?.length ?? 0;
            const enrolled = (item.data as any)?.enrollments?.length ?? 0;
            const href = title.toLowerCase().includes("sequence")
              ? `/automations/sequences/${item.id}`
              : `/automations/workflows/${item.id}`;
            return (
              <div
                key={item.id}
                className={`group relative flex items-center gap-4 px-4 py-3.5 hover:bg-white/[.02] transition-colors ${i < items.length - 1 ? "border-b border-white/[.06]" : ""}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${title.toLowerCase().includes("sequence") ? "border-purple-500/20 bg-purple-500/[.08] text-purple-400" : "border-red-500/20 bg-red-500/[.08] text-red-400"}`}>
                  <Icon size={14}/>
                </div>

                <Link to={href} className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {steps > 0 ? `${steps} step${steps !== 1 ? "s" : ""}` : "No steps"}
                    {enrolled > 0 ? ` · ${enrolled} enrolled` : ""}
                    {item.updated_at ? ` · Updated ${formatDate(item.updated_at)}` : ""}
                  </p>
                </Link>

                <StatusBadge status={(item.data as any)?.status ?? item.status ?? "draft"}/>

                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === item.id ? null : item.id); }}
                    className="rounded-md p-1.5 text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-white/[.06] hover:text-slate-300 transition-all"
                  >
                    <MoreHorizontal size={14}/>
                  </button>
                  {menuOpen === item.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)}/>
                      <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-lg border border-white/[.08] bg-[#13151a] shadow-xl">
                        <Link to={href} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white">
                          <Play size={11}/> Open
                        </Link>
                        <button
                          onClick={() => duplicateItem.mutate({ item, type: title.toLowerCase().includes("sequence") ? "sequence" : "workflow" })}
                          disabled={duplicateItem.isPending}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white disabled:opacity-50">
                          <Copy size={11}/> Duplicate
                        </button>
                        <button
                          onClick={() => deleteItem.mutate({ id: item.id, type: title.toLowerCase().includes("sequence") ? "sequence" : "workflow" })}
                          disabled={deleteItem.isPending}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/[.06] disabled:opacity-50">
                          <Trash2 size={11}/> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[.06] px-6 py-3">
        <Zap size={16} className="text-red-400"/>
        <h1 className="flex-1 text-[15px] font-semibold text-white tracking-tight">Automations</h1>
        <button onClick={() => setAiOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-600/30 transition-colors">
          <Sparkles size={12}/> Generate with AI
        </button>
        <button
          onClick={() => createSequence.mutate()}
          disabled={createSequence.isPending}
          className="flex items-center gap-1.5 rounded-lg border-x border-t border-red-500/50 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition-all active:translate-y-[1px] disabled:opacity-50"
        >
          <Plus size={13}/> New sequence
        </button>
      </div>

      {query.isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500"/>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-6 max-w-4xl">
          <Section
            title="Email Sequences"
            icon={Mail}
            items={items.filter(i => (i.data as any)?.type === "sequence" || !(i.data as any)?.type)}
            newLabel="New sequence"
            onNew={() => createSequence.mutate()}
          />
          <Section
            title="Workflows"
            icon={GitBranch}
            items={workflows}
            newLabel="New workflow"
            onNew={() => createWorkflow.mutate()}
          />
        </div>
      )}
      {aiOpen && (
        <AISequenceModal
          onClose={() => setAiOpen(false)}
          onCreated={(id) => { setAiOpen(false); navigate(`/automations/sequences/${id}`); }}
        />
      )}
    </div>
  );
}

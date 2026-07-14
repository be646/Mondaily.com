import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Globe, Loader2, Search, X } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";

/**
 * Prospecting Agent UI — calls the real POST /api/v1/prospecting/run
 * route (packages/api/src/routes/prospecting.ts). Every candidate shown
 * here came back from a real web search with a real source URL; nothing
 * is invented client-side. Reused on both the list detail page ("Find
 * from web") and the records table's selected-rows bar ("Find similar
 * from web") via the `seedQuery` prop.
 */

interface ProspectCandidate {
  name: string;
  object_type: string;
  email: string | null;
  domain: string | null;
  website: string | null;
  linkedin: string | null;
  description: string | null;
  location: string | null;
  source_url: string;
  source_title: string;
  confidence_label: "high" | "medium" | "low";
  reason: string;
  status: "created" | "existing" | "queued_for_review";
  node_id?: string;
  decision_id?: string;
}

interface ProspectingRunResult {
  created: number;
  existing: number;
  queued_for_review: number;
  added_to_list: number;
  candidates: ProspectCandidate[];
  sources: { url: string; title: string }[];
}

const CONFIDENCE_STYLE: Record<ProspectCandidate["confidence_label"], string> = {
  high: "text-[#2f9e6b] border-[#2f9e6b]/30 bg-[#2f9e6b]/10",
  medium: "text-[#c6892e] border-[#c6892e]/30 bg-[#c6892e]/10",
  low: "text-stone-400 border-[var(--border-soft)] bg-[var(--surface-hover)]",
};

export function ProspectingModal({
  onClose,
  defaultObjectType = "company",
  destinationListId,
  seedQuery,
  onCreated,
}: {
  onClose: () => void;
  defaultObjectType?: string;
  destinationListId?: string;
  /** Pre-fills the query — used by "Find similar from web" with selected-row context. */
  seedQuery?: string;
  /** Called after candidates are created/added so the caller can refetch its list. */
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState(seedQuery ?? "");
  const [objectType, setObjectType] = useState(defaultObjectType);
  const [count, setCount] = useState(10);
  const [requireApproval, setRequireApproval] = useState(true);
  const [result, setResult] = useState<ProspectingRunResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const run = useMutation({
    mutationFn: () =>
      apiClient.post<ProspectingRunResult>("/prospecting/run", {
        query,
        object_type: objectType,
        count,
        destination_list_id: destinationListId,
        require_approval: requireApproval,
      }),
    onSuccess: (data) => {
      setResult(data);
      setSelected(new Set(data.candidates.map((_, i) => i).filter(i => data.candidates[i]!.status === "queued_for_review")));
      if (data.created > 0 || data.added_to_list > 0) {
        qc.invalidateQueries({ queryKey: ["list-entries"] });
        qc.invalidateQueries({ queryKey: ["nodes"] });
        onCreated?.();
      }
    },
  });

  const approveSelected = useMutation({
    mutationFn: async () => {
      if (!result) return;
      const targets = result.candidates.filter((c, i) => selected.has(i) && c.decision_id);
      await Promise.all(targets.map(c => apiClient.post(`/decisions/${c.decision_id}/approve`, {})));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["list-entries"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      onCreated?.();
      onClose();
    },
  });

  function toggle(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const queuedCandidates = result?.candidates.filter(c => c.status === "queued_for_review") ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_24px_64px_rgba(0,0,0,0.7)] px-5 py-5 max-h-[85vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-stone-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Find from web</h2>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-[var(--text-primary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {!result ? (
          <div className="space-y-3.5">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-stone-400">What are you looking for?</label>
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. AI startups in London, climate tech investors in Europe, suppliers for commercial solar projects"
                rows={3}
                className="key-input w-full text-[13px] resize-none"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-stone-400">Object type</label>
                <input
                  value={objectType}
                  onChange={e => setObjectType(e.target.value)}
                  placeholder="company, person, investor…"
                  className="key-input w-full text-[13px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-stone-400">How many</label>
                <input
                  type="number" min={1} max={50}
                  value={count}
                  onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="key-input w-full text-[13px]"
                />
              </div>
            </div>
            {destinationListId && (
              <p className="text-[11px] text-stone-500">Matches will be added to this list once created.</p>
            )}
            <label className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer">
              <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} className="accent-stone-500" />
              Require review before creating records
            </label>
            {run.isError && (
              <p className="text-[11px] text-[#d1524a]">{(run.error as Error)?.message || "Search failed — try again."}</p>
            )}
            <button
              onClick={() => run.mutate()}
              disabled={!query.trim() || run.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors disabled:opacity-50"
            >
              {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {run.isPending ? "Searching the web…" : "Run search"}
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {result.created > 0 && <span className="rounded-full border border-[#2f9e6b]/30 bg-[#2f9e6b]/10 px-2 py-0.5 text-[#2f9e6b]">{result.created} created</span>}
              {result.queued_for_review > 0 && <span className="rounded-full border border-[#c6892e]/30 bg-[#c6892e]/10 px-2 py-0.5 text-[#c6892e]">{result.queued_for_review} awaiting approval</span>}
              {result.existing > 0 && <span className="rounded-full border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-0.5 text-stone-400">{result.existing} already in graph</span>}
              {result.added_to_list > 0 && <span className="rounded-full border border-stone-500/30 bg-stone-600/10 px-2 py-0.5 text-stone-400">{result.added_to_list} added to list</span>}
            </div>

            {result.candidates.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-stone-500">No real candidates found for that query — try being more specific.</p>
            ) : (
              <ul className="space-y-2">
                {result.candidates.map((c, i) => (
                  <li key={i} className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-3">
                    <div className="flex items-start gap-2.5">
                      {c.status === "queued_for_review" ? (
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          className="mt-0.5 accent-stone-500"
                        />
                      ) : (
                        <CheckCircle2 size={14} className={`mt-0.5 shrink-0 ${c.status === "created" ? "text-[#2f9e6b]" : "text-stone-500"}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{c.name}</p>
                          <span className={`shrink-0 rounded-full border px-1.5 py-0 text-[9.5px] font-medium ${CONFIDENCE_STYLE[c.confidence_label]}`}>{c.confidence_label}</span>
                        </div>
                        {c.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-stone-400">{c.description}</p>}
                        <p className="mt-0.5 text-[10.5px] text-stone-500">{c.reason}</p>
                        <a href={c.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-stone-400 hover:text-stone-300 transition-colors">
                          <ExternalLink size={9} /> {c.source_title || c.source_url}
                        </a>
                      </div>
                      <span className="shrink-0 text-[10px] text-stone-500">
                        {c.status === "existing" ? "Already in graph" : c.status === "created" ? "Created" : "Pending"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2 pt-1">
              {queuedCandidates.length > 0 && (
                <button
                  onClick={() => approveSelected.mutate()}
                  disabled={selected.size === 0 || approveSelected.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--accent)] disabled:opacity-50"
                >
                  {approveSelected.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Approve selected ({selected.size}) — create records{destinationListId ? " and add to list" : ""}
                </button>
              )}
              <button
                onClick={() => { setResult(null); }}
                className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-[12.5px] text-stone-300 hover:bg-[var(--surface-hover)] transition-colors"
              >
                New search
              </button>
              {queuedCandidates.length === 0 && (
                <button onClick={onClose} className="ml-auto rounded-lg border border-[var(--border-soft)] px-4 py-2 text-[12.5px] text-stone-300 hover:bg-[var(--surface-hover)] transition-colors">
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

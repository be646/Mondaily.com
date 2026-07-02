import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileSearch,
  Globe2,
  Layers3,
  ListPlus,
  Loader2,
  MessageSquare,
  Microscope,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestAsk } from "../../lib/ask-bus";
import { PageHeader } from "../../components/ui/page-state";

type DiscoveryTab = "search" | "saved" | "recent" | "review";
type SaveMode = "create" | "review";

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
  error?: string;
}

interface SavedRecord {
  id: string;
  object_type: string;
  updated_at?: string;
  data: Record<string, unknown>;
}

interface ListRow {
  id: string;
  name: string;
  object_type: string;
  entry_count?: number;
}

interface DiscoveryStatus {
  status: "HEALTHY" | "DEGRADED";
  services: { searxng_reachable: boolean; scraper_reachable: boolean };
  diagnostic?: string;
}

const EXAMPLES = [
  "Aesthetic clinics in London with poor review response",
  "Boutique hotels in Dubai hiring operations managers",
  "Commercial solar installers in Texas with expansion signals",
  "SaaS companies in Europe that recently raised funding",
];

const OBJECT_TYPES = ["company", "people", "investor", "supplier", "asset", "candidate"];

const confidenceTone: Record<ProspectCandidate["confidence_label"], string> = {
  high: "#2f7d52",
  medium: "#a9782a",
  low: "#737373",
};

function hostOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  }
}

function labelOf(record: SavedRecord): string {
  const d = record.data ?? {};
  return String(d.name ?? d.company ?? d.full_name ?? d.title ?? "Untitled record");
}

function sourceKey(candidate: ProspectCandidate): string {
  return [
    candidate.name,
    candidate.email ?? "",
    candidate.domain ?? "",
    candidate.website ?? "",
    candidate.linkedin ?? "",
    hostOf(candidate.source_url),
  ].join("|").toLowerCase();
}

function savedKey(record: SavedRecord): string {
  const d = record.data ?? {};
  return [
    d.name ?? d.company ?? d.full_name ?? d.title ?? "",
    d.email ?? "",
    d.domain ?? "",
    d.website ?? "",
    d.linkedin ?? "",
    hostOf(String(d.source_url ?? "")),
  ].join("|").toLowerCase();
}

function statusLabel(candidate: ProspectCandidate): string {
  if (candidate.status === "created") return "Saved to graph";
  if (candidate.status === "existing") return "Already in graph";
  return "Awaiting review";
}

export function DiscoveryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DiscoveryTab>("search");
  const [query, setQuery] = useState("");
  const [objectType, setObjectType] = useState("company");
  const [count, setCount] = useState(12);
  const [saveMode, setSaveMode] = useState<SaveMode>("create");
  const [destinationListId, setDestinationListId] = useState("");
  const [result, setResult] = useState<ProspectingRunResult | null>(null);
  const [lastSearch, setLastSearch] = useState<{ query: string; objectType: string } | null>(null);
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("mondaily_discovery_recent_queries") || "[]");
    } catch {
      return [];
    }
  });

  const statusQ = useQuery({
    queryKey: ["discovery-status"],
    queryFn: () => apiClient.get<DiscoveryStatus>("/discovery/status"),
    staleTime: 60_000,
  });

  const listsQ = useQuery({
    queryKey: ["lists"],
    queryFn: () => apiClient.get<ListRow[]>("/lists"),
    staleTime: 30_000,
  });

  const decisionsQ = useQuery({
    queryKey: ["decisions", "pending", "prospecting"],
    queryFn: () => apiClient.get<{ agent_name: string; status: string }[]>("/decisions?status=pending"),
    staleTime: 20_000,
  });
  const pendingProspecting = (decisionsQ.data ?? []).filter((d) => d.agent_name === "prospecting").length;

  const savedQ = useQuery({
    queryKey: ["nodes", objectType, "discovery-saved"],
    queryFn: () => apiClient.get<SavedRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}&limit=300`),
    staleTime: 20_000,
  });

  const compatibleLists = useMemo(() => {
    return (listsQ.data ?? []).filter((l) => !l.object_type || l.object_type === objectType);
  }, [listsQ.data, objectType]);

  useEffect(() => {
    if (destinationListId && !compatibleLists.some((l) => l.id === destinationListId)) {
      setDestinationListId("");
    }
  }, [compatibleLists, destinationListId]);

  const savedRecords = useMemo(() => {
    const rows = savedQ.data ?? [];
    return rows.filter((r) => {
      const d = r.data ?? {};
      return Boolean(
        d.source === "discovery" ||
        d.discovery_query ||
        d.prospecting_reason ||
        d.source_url ||
        d.source_title ||
        d.confidence_label
      );
    });
  }, [savedQ.data, objectType]);

  const savedKeys = useMemo(() => new Set(savedRecords.map(savedKey).filter(Boolean)), [savedRecords]);

  function pushRecent(q: string) {
    const clean = q.trim();
    if (!clean) return;
    setRecents((prev) => {
      const next = [clean, ...prev.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 12);
      localStorage.setItem("mondaily_discovery_recent_queries", JSON.stringify(next));
      return next;
    });
  }

  const run = useMutation({
    mutationFn: (input: { query: string; objectType: string }) =>
      apiClient.post<ProspectingRunResult>("/prospecting/run", {
        query: input.query,
        object_type: input.objectType,
        count,
        destination_list_id: destinationListId || undefined,
        require_approval: saveMode === "review",
      }),
    onSuccess: (data, input) => {
      setResult(data);
      setLastSearch(input);
      pushRecent(input.query);
      qc.invalidateQueries({ queryKey: ["nodes", input.objectType, "discovery-saved"] });
      qc.invalidateQueries({ queryKey: ["decisions", "pending"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const removeRecord = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes", objectType, "discovery-saved"] }),
  });

  const addToList = useMutation({
    mutationFn: ({ listId, nodeId }: { listId: string; nodeId: string }) =>
      apiClient.post(`/lists/${listId}/entries`, { node_id: nodeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });

  function submitSearch(q = query) {
    const clean = q.trim();
    if (!clean || run.isPending) return;
    setTab("search");
    run.mutate({ query: clean, objectType });
  }

  function askAboutCandidate(candidate: ProspectCandidate) {
    requestAsk(
      `Research this Discovery candidate using only source-backed information: ${candidate.name}. ` +
      `Source: ${candidate.source_url}. Explain what they do, why they match "${lastSearch?.query ?? query}", ` +
      `what signal or review evidence exists, red flags, and the best next action. If reviews are not found, say "No review source found".`
    );
  }

  function createTask(candidate: ProspectCandidate) {
    requestAsk(
      `Create a follow-up task for Discovery candidate "${candidate.name}" from ${candidate.source_url}. ` +
      `Use the real context only. If the assignee or due date is ambiguous, ask me before creating it.`
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Discovery"
        description="Find real prospects, suppliers, candidates, assets, reviews, and market signals from the open web — then save them into the workspace graph."
      />

      <section className="mt-5 border-y py-5" style={{ borderColor: "var(--border-soft)" }}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: statusQ.data?.status === "DEGRADED" ? "#b45309" : "#2f7d52" }} />
              Sovereign web search
              <span aria-hidden>·</span>
              SearXNG + scraper + source-backed extraction
            </div>

            <div
              className="mt-4 flex min-h-[58px] items-center gap-3 rounded-full border px-4 transition-colors"
              style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
            >
              <Search size={18} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSearch();
                }}
                placeholder="Search the web for leads, reviews, suppliers, investors, assets, candidates..."
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                onClick={() => submitSearch()}
                disabled={!query.trim() || run.isPending}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-opacity disabled:opacity-40"
                style={{ background: "var(--text-primary)", color: "var(--surface-canvas)" }}
              >
                {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
                Search
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setQuery(ex);
                    submitSearch(ex);
                  }}
                  className="rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:border-[color:var(--section-accent)]"
                  style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-l pl-5 max-lg:border-l-0 max-lg:border-t max-lg:pl-0 max-lg:pt-4" style={{ borderColor: "var(--border-soft)" }}>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Object</span>
                <select
                  value={objectType}
                  onChange={(e) => setObjectType(e.target.value)}
                  className="key-input h-10 w-full rounded-sm text-[13px]"
                >
                  {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Count</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="key-input h-10 w-full rounded-sm text-[13px]"
                />
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Save behavior</span>
              <div className="grid grid-cols-2 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
                {([
                  ["create", "Save now"],
                  ["review", "Review first"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setSaveMode(value)}
                    className="px-3 py-2 text-[12px] font-medium transition-colors"
                    style={{
                      background: saveMode === value ? "var(--text-primary)" : "transparent",
                      color: saveMode === value ? "var(--surface-canvas)" : "var(--text-muted)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>

            <label className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Add to list</span>
              <select
                value={destinationListId}
                onChange={(e) => setDestinationListId(e.target.value)}
                className="key-input h-10 w-full rounded-sm text-[13px]"
              >
                <option value="">No list selected</option>
                {compatibleLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {statusQ.data?.status === "DEGRADED" && (
          <div className="mt-4 flex items-start gap-2 rounded-sm border px-3 py-2.5 text-[12.5px]" style={{ borderColor: "#b4530933", color: "#92400e", background: "#f59e0b12" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{statusQ.data.diagnostic ?? "The search stack is degraded. Discovery cannot return good results until the appliance is reachable."}</span>
          </div>
        )}
      </section>

      <nav className="mt-5 flex flex-wrap items-center gap-1 border-b" style={{ borderColor: "var(--border-soft)" }}>
        {([
          ["search", "Search results"],
          ["saved", `Saved graph records${savedRecords.length ? ` · ${savedRecords.length}` : ""}`],
          ["review", `Review queue${pendingProspecting ? ` · ${pendingProspecting}` : ""}`],
          ["recent", "Recent searches"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="relative -mb-px px-3 py-2 text-[12.5px] font-medium"
            style={{ color: tab === key ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {label}
            {tab === key && <span className="absolute inset-x-2 -bottom-px h-px" style={{ background: "var(--text-primary)" }} />}
          </button>
        ))}
      </nav>

      {tab === "search" && (
        <SearchResults
          result={result}
          pending={run.isPending}
          error={run.error}
          savedKeys={savedKeys}
          objectType={objectType}
          onAsk={askAboutCandidate}
          onTask={createTask}
          onAddToList={(nodeId, listId) => addToList.mutate({ nodeId, listId })}
          lists={compatibleLists}
          addingListId={addToList.variables?.listId ?? null}
        />
      )}

      {tab === "saved" && (
        <SavedRecords
          loading={savedQ.isLoading}
          error={savedQ.isError}
          records={savedRecords}
          objectType={objectType}
          lists={compatibleLists}
          onRemove={(id) => removeRecord.mutate(id)}
          removingId={removeRecord.variables ?? null}
          onAddToList={(nodeId, listId) => addToList.mutate({ nodeId, listId })}
          addingListId={addToList.variables?.listId ?? null}
        />
      )}

      {tab === "review" && (
        <ReviewQueue pending={pendingProspecting} />
      )}

      {tab === "recent" && (
        <RecentSearches
          recents={recents}
          onClear={() => {
            setRecents([]);
            localStorage.removeItem("mondaily_discovery_recent_queries");
          }}
          onRun={(q) => {
            setQuery(q);
            submitSearch(q);
          }}
        />
      )}
    </div>
  );
}

function SearchResults({
  result,
  pending,
  error,
  savedKeys,
  objectType,
  lists,
  addingListId,
  onAsk,
  onTask,
  onAddToList,
}: {
  result: ProspectingRunResult | null;
  pending: boolean;
  error: unknown;
  savedKeys: Set<string>;
  objectType: string;
  lists: ListRow[];
  addingListId: string | null;
  onAsk: (candidate: ProspectCandidate) => void;
  onTask: (candidate: ProspectCandidate) => void;
  onAddToList: (nodeId: string, listId: string) => void;
}) {
  if (pending) {
    return (
      <div className="grid min-h-[360px] place-items-center border-b py-16" style={{ borderColor: "var(--border-soft)" }}>
        <div className="max-w-md text-center">
          <Loader2 size={24} className="mx-auto animate-spin" style={{ color: "var(--section-accent)" }} />
          <p className="mt-4 text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>Searching the open web</p>
          <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Mondaily is reading sovereign search results, scraping source pages, extracting real candidates, deduplicating against your graph, and saving or queueing records.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-5 rounded-sm border px-4 py-4" style={{ borderColor: "#be123c33", background: "#be123c0d" }}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "#be123c" }} />
          <div>
            <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>Discovery search failed</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{(error as Error)?.message ?? "Try again or check the Discovery status."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="grid gap-4 py-8 lg:grid-cols-3">
        {[
          ["Find real leads", "Search industries, geographies, funding signals, reviews, and source pages."],
          ["Save to graph", "Create records directly, queue candidates for approval, or add them to a list."],
          ["Ask deeper", "Open a source-backed AI research prompt from any candidate."],
        ].map(([title, body]) => (
          <div key={title} className="border-b py-5" style={{ borderColor: "var(--border-soft)" }}>
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{body}</p>
          </div>
        ))}
      </div>
    );
  }

  const candidates = result.candidates ?? [];

  return (
    <section className="py-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
        <span><strong style={{ color: "var(--text-primary)" }}>{candidates.length}</strong> candidates</span>
        <span aria-hidden>·</span>
        <span><strong style={{ color: "var(--text-primary)" }}>{result.created}</strong> saved</span>
        <span aria-hidden>·</span>
        <span><strong style={{ color: "var(--text-primary)" }}>{result.existing}</strong> already existed</span>
        <span aria-hidden>·</span>
        <span><strong style={{ color: "var(--text-primary)" }}>{result.queued_for_review}</strong> queued</span>
        <span aria-hidden>·</span>
        <span><strong style={{ color: "var(--text-primary)" }}>{result.sources?.length ?? 0}</strong> sources</span>
      </div>

      {candidates.length === 0 ? (
        <div className="border-y px-4 py-14 text-center" style={{ borderColor: "var(--border-soft)" }}>
          <FileSearch size={22} className="mx-auto mb-3" style={{ color: "var(--text-faint)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>No real candidates found</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            The agent did not find enough source-backed data for this query. Try a clearer industry, location, or target type.
          </p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {candidates.map((candidate, index) => {
            const saved = Boolean(candidate.node_id) || savedKeys.has(sourceKey(candidate));
            return (
              <CandidateRow
                key={`${candidate.name}-${candidate.source_url}-${index}`}
                candidate={candidate}
                saved={saved}
                objectType={objectType}
                lists={lists}
                addingListId={addingListId}
                onAsk={() => onAsk(candidate)}
                onTask={() => onTask(candidate)}
                onAddToList={(listId) => candidate.node_id && onAddToList(candidate.node_id, listId)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  saved,
  objectType,
  lists,
  addingListId,
  onAsk,
  onTask,
  onAddToList,
}: {
  candidate: ProspectCandidate;
  saved: boolean;
  objectType: string;
  lists: ListRow[];
  addingListId: string | null;
  onAsk: () => void;
  onTask: () => void;
  onAddToList: (listId: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const tone = confidenceTone[candidate.confidence_label] ?? "#737373";
  const domain = candidate.domain || candidate.website || hostOf(candidate.source_url);

  return (
    <article className="group py-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            <span className="inline-flex items-center gap-1">
              <Globe2 size={11} /> {hostOf(candidate.source_url) || "source"}
            </span>
            {candidate.location && <><span aria-hidden>·</span><span>{candidate.location}</span></>}
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone, background: `${tone}16` }}>
              {candidate.confidence_label}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: saved ? "#2f7d52" : "var(--text-muted)", background: saved ? "#2f7d5214" : "var(--surface-hover)" }}>
              {statusLabel(candidate)}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={candidate.source_url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-[16px] font-semibold hover:underline"
              style={{ color: "var(--section-accent)" }}
            >
              {candidate.name}
            </a>
            <ExternalLink size={13} style={{ color: "var(--text-faint)" }} />
          </div>

          {candidate.description && (
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{candidate.description}</p>
          )}
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{candidate.reason}</p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {domain && <span>Domain: <span style={{ color: "var(--text-secondary)" }}>{domain}</span></span>}
            {candidate.email && <span>Email: <span style={{ color: "var(--text-secondary)" }}>{candidate.email}</span></span>}
            {candidate.linkedin && <a href={candidate.linkedin} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--section-accent)" }}>LinkedIn</a>}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
            <button onClick={onAsk} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <MessageSquare size={12} /> Ask AI
            </button>
            <button onClick={onAsk} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <Microscope size={12} /> Deep research
            </button>
            <button onClick={onTask} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <ListPlus size={12} /> Task
            </button>
          </div>

          {candidate.node_id ? (
            <div className="relative">
              <button
                onClick={() => setListOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium"
                style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}
              >
                <Plus size={12} /> Add to list <ChevronDown size={12} />
              </button>
              {listOpen && (
                <>
                  <button className="fixed inset-0 z-20 cursor-default" onClick={() => setListOpen(false)} aria-label="Close list picker" />
                  <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-sm border shadow-lg" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                    {lists.length === 0 ? (
                      <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-faint)" }}>No compatible lists for {objectType}.</div>
                    ) : lists.map((list) => (
                      <button
                        key={list.id}
                        onClick={() => {
                          onAddToList(list.id);
                          setListOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-[var(--surface-hover)]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <span className="truncate">{list.name}</span>
                        {addingListId === list.id ? <Loader2 size={12} className="animate-spin" /> : <span style={{ color: "var(--text-faint)" }}>{list.entry_count ?? 0}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link to="/decisions" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium" style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}>
              Review in queue <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function SavedRecords({
  loading,
  error,
  records,
  objectType,
  lists,
  removingId,
  addingListId,
  onRemove,
  onAddToList,
}: {
  loading: boolean;
  error: boolean;
  records: SavedRecord[];
  objectType: string;
  lists: ListRow[];
  removingId: string | null;
  addingListId: string | null;
  onRemove: (id: string) => void;
  onAddToList: (nodeId: string, listId: string) => void;
}) {
  if (loading) return <div className="py-12 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="mr-2 inline animate-spin" /> Loading saved records…</div>;
  if (error) return <div className="py-12 text-[13px]" style={{ color: "#be123c" }}>Could not load saved records.</div>;
  if (records.length === 0) {
    return (
      <div className="grid min-h-[260px] place-items-center border-b py-10 text-center" style={{ borderColor: "var(--border-soft)" }}>
        <div>
          <Layers3 size={22} className="mx-auto mb-3" style={{ color: "var(--text-faint)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>No saved {objectType} records yet</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>Run Discovery in “Save now” mode to create graph records here.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="divide-y py-3" style={{ borderColor: "var(--border-soft)" }}>
      {records.map((record) => {
        const d = record.data ?? {};
        const name = labelOf(record);
        const source = String(d.source_url ?? d.website ?? d.domain ?? "");
        return (
          <div key={record.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <div className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>{hostOf(source) || "No source stored yet"}</div>
              <Link to={`/objects/${record.object_type}/${record.id}`} className="mt-0.5 inline-block max-w-full truncate text-[15px] font-semibold hover:underline" style={{ color: "var(--section-accent)" }}>{name}</Link>
              <p className="mt-1 line-clamp-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                {String(d.description ?? d.notes ?? d.reason ?? "Not found yet")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
              <Link to={`/objects/${record.object_type}/${record.id}`} className="rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Open</Link>
              <ListPicker lists={lists} addingListId={addingListId} onSelect={(listId) => onAddToList(record.id, listId)} />
              <button onClick={() => requestAsk(`Tell me what matters about saved Discovery record "${name}" using workspace and source-backed information only.`)} className="rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Ask AI</button>
              <button onClick={() => onRemove(record.id)} disabled={removingId === record.id} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-medium" style={{ color: "#be123c", background: "#be123c0d" }}>
                {removingId === record.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListPicker({ lists, addingListId, onSelect }: { lists: ListRow[]; addingListId: string | null; onSelect: (listId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
        Add to list <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-label="Close list picker" />
          <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-sm border shadow-lg" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            {lists.length === 0 ? (
              <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-faint)" }}>No compatible lists.</div>
            ) : lists.map((list) => (
              <button
                key={list.id}
                onClick={() => {
                  onSelect(list.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-[var(--surface-hover)]"
                style={{ color: "var(--text-secondary)" }}
              >
                <span className="truncate">{list.name}</span>
                {addingListId === list.id ? <Loader2 size={12} className="animate-spin" /> : <span style={{ color: "var(--text-faint)" }}>{list.entry_count ?? 0}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewQueue({ pending }: { pending: number }) {
  return (
    <div className="grid min-h-[260px] place-items-center border-b py-10 text-center" style={{ borderColor: "var(--border-soft)" }}>
      <div className="max-w-md">
        <ShieldCheck size={24} className="mx-auto mb-3" style={{ color: "var(--section-accent)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{pending} prospecting candidate{pending === 1 ? "" : "s"} awaiting review</p>
        <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          When you use “Review first”, Discovery sends candidates to the Decision Queue instead of creating records immediately.
        </p>
        <Link to="/decisions" className="mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium" style={{ background: "var(--text-primary)", color: "var(--surface-canvas)" }}>
          Open Decision Queue <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function RecentSearches({ recents, onRun, onClear }: { recents: string[]; onRun: (query: string) => void; onClear: () => void }) {
  if (!recents.length) {
    return (
      <div className="grid min-h-[260px] place-items-center border-b py-10 text-center" style={{ borderColor: "var(--border-soft)" }}>
        <div>
          <Clock size={22} className="mx-auto mb-3" style={{ color: "var(--text-faint)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>No recent searches yet</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>Searches you run from this device will appear here.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>{recents.length} recent searches</span>
        <button onClick={onClear} className="text-[12px] font-medium" style={{ color: "var(--text-faint)" }}>Clear</button>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
        {recents.map((recent) => (
          <button key={recent} onClick={() => onRun(recent)} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:opacity-80">
            <span className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>{recent}</span>
            <span className="shrink-0 text-[12px] font-medium" style={{ color: "var(--section-accent)" }}>Run again</span>
          </button>
        ))}
      </div>
    </div>
  );
}

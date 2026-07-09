import { useQuery } from "@tanstack/react-query";
import { Building2, CheckSquare, Database, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState, ConsoleSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

interface SearchResult { id: string; object_type: string; data: Record<string, unknown>; updated_at?: string; last_activity_at?: string }

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return <>{parts.map((part, index) => part.toLowerCase() === query.toLowerCase() ? <mark key={index} className="bg-stone-500/20 text-[#9c6b72]">{part}</mark> : part)}</>;
}

export function SearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(input);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(input.trim()); setParams(input.trim() ? { q: input.trim() } : {}, { replace: true }); setSelected(0); }, 300); return () => window.clearTimeout(timer); }, [input, setParams]);
  const results = useQuery({ queryKey: ["global-search", query], queryFn: () => apiClient.post<SearchResult[]>("/search", { query, limit: 50 }), enabled: query.length > 0 });
  const grouped = useMemo(() => (results.data ?? []).reduce<Record<string, SearchResult[]>>((groups, item) => { (groups[item.object_type] ??= []).push(item); return groups; }, {}), [results.data]);
  const flat = useMemo(() => Object.values(grouped).flat(), [grouped]);
  function open(result: SearchResult) {
    if (result.object_type === "task") { navigate("/tasks"); return; }
    navigate(`/objects/${result.object_type}/${result.id}`);
  }
  return <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8" onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, flat.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); } if (event.key === "Enter" && flat[selected]) open(flat[selected]); }}>
    <label className="relative block">
      <Search className="absolute left-4 top-3.5 text-[var(--text-muted)]" size={18} />
      <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search your workspace" className="key-input h-12 w-full pl-12 pr-16 text-base" />
      <kbd className="absolute right-4 top-3.5 rounded border border-[var(--border-soft)] bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-faint)]">⌘K</kbd>
    </label>
    <div className="mt-6">{results.isLoading ? <ConsoleSkeleton rows={7} /> : query && flat.length === 0 ? <EmptyState icon={Search} title={`No results for "${query}"`} description="Try a company name, email address, deal, note, or a broader keyword." action={<div className="flex gap-2 text-xs text-[var(--text-muted)]"><button onClick={() => setInput("")}>Clear search</button><button onClick={() => navigate("/ask")}>Ask Mondaily</button></div>} /> : <div className="space-y-7">{Object.entries(grouped).map(([type, items]) => <section key={type}><h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">{type === "contact" || type === "person" ? <UserRound size={13} /> : type === "company" ? <Building2 size={13} /> : type === "task" ? <CheckSquare size={13} /> : <Database size={13} />}{type.replaceAll("_", " ")} <span>({items.length})</span></h2><div className="minimal-sheet divide-y divide-[var(--border-soft)] overflow-hidden">{items.map((item) => { const index = flat.indexOf(item); const name = String(item.data.name ?? item.data.title ?? item.data.subject ?? "Untitled"); const keyField = String(item.data.email ?? item.data.domain ?? item.data.company ?? item.data.value ?? ""); return <button key={item.id} onClick={() => open(item)} className={`flex w-full items-center gap-4 p-4 text-left transition-colors ${selected === index ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-[var(--surface-hover)] text-[var(--text-muted)]">{item.object_type === "task" ? <CheckSquare size={14} /> : <Database size={14} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium"><Highlight text={name} query={query} /></p><p className="mt-1 truncate font-mono text-xs text-[var(--text-muted)]"><Highlight text={keyField} query={query} /></p></div><span className="shrink-0 font-mono text-xs text-[var(--text-faint)]">{item.last_activity_at || item.updated_at ? new Date(item.last_activity_at || item.updated_at!).toLocaleDateString() : ""}</span></button>; })}</div></section>)}</div>}</div>
  </div>;
}

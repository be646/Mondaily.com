import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Building2, UserRound, TrendingUp, CheckSquare, FileText, ArrowRight, Plus, Radar, BarChart3, Workflow, Receipt, ReceiptText, CreditCard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { AIMark } from "./ai-button";

interface SearchResult { id: string; object_type: string; data: Record<string, unknown> }

const TYPE_ICON: Record<string, React.ElementType> = {
  companies: Building2, people: UserRound, deals: TrendingUp,
  task: CheckSquare, note: FileText,
  invoice: Receipt, quote: ReceiptText, expense: Receipt, credit_note: CreditCard,
};
const TYPE_COLOR: Record<string, string> = {
  companies: "text-[#717784]", people: "text-[#2f9e6b]", deals: "text-[#c6892e]",
  task: "text-stone-400", note: "text-stone-400",
  invoice: "text-[#2f9e6b]", quote: "text-[#717784]", expense: "text-[#c6892e]", credit_note: "text-[#717784]",
};

// Finance nodes navigate to their finance route, not /objects/*.
const FINANCE_ROUTE: Record<string, (id: string) => string> = {
  invoice: id => `/finance/invoices/${id}`,
  credit_note: id => `/finance/credit-notes/${id}`,
  quote: () => `/finance/quotes`,
  expense: () => `/finance/expenses`,
};

// A palette item is one of: an AI passthrough, a quick action, a nav link, or a record hit.
type Item =
  | { kind: "ai"; label: string }
  | { kind: "action"; label: string; to: string; icon: React.ElementType }
  | { kind: "nav"; label: string; to: string }
  | { kind: "record"; id: string; object_type: string; data: Record<string, unknown> };

const QUICK_ACTIONS: { label: string; to: string; icon: React.ElementType }[] = [
  { label: "New task",          to: "/tasks?new=1",      icon: Plus },
  { label: "Discover leads",    to: "/discovery",         icon: Radar },
  { label: "Build a report",    to: "/reports",           icon: BarChart3 },
  { label: "New automation",    to: "/automations",       icon: Workflow },
];

const QUICK_LINKS: { label: string; to: string }[] = [
  { label: "Home",          to: "/home" },
  { label: "Tasks",         to: "/tasks" },
  { label: "Decisions",     to: "/decisions" },
  { label: "People",        to: "/objects/people" },
  { label: "Companies",     to: "/objects/companies" },
  { label: "Deals",         to: "/objects/deals" },
  { label: "Reports",       to: "/reports" },
  { label: "Automations",   to: "/automations" },
  { label: "Agents",        to: "/agents" },
];

export function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [input, setInput] = useState("");
  const [idx, setIdx]     = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(o => { if (!o) setInput(""); return !o; });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", down, true); // capture phase
    return () => window.removeEventListener("keydown", down, true);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const query = input.trim();
  const { data: results = [] } = useQuery({
    queryKey: ["cmd-search", query],
    // Keyword-first for instant exact hits, MERGED with semantic (vector) matches so the palette
    // finds records by meaning too — deduped, keyword ranked first. Semantic only for 3+ chars to
    // keep it cheap; fails soft to keyword alone.
    queryFn: async () => {
      const [kw, sem] = await Promise.all([
        apiClient.post<SearchResult[]>("/search", { query, limit: 8 }),
        query.length > 2
          ? apiClient.post<{ results: SearchResult[] }>("/search/semantic", { query, limit: 6 }).then(r => r.results ?? []).catch(() => [] as SearchResult[])
          : Promise.resolve([] as SearchResult[]),
      ]);
      const seen = new Set(kw.map(r => r.id));
      return [...kw, ...sem.filter(r => !seen.has(r.id))].slice(0, 10);
    },
    enabled: query.length > 1,
    staleTime: 15_000,
  });

  // Build the flat, ordered item list. When the user has typed, the AI passthrough is always the
  // first row (so ⌘K → type → Enter always asks the AI), followed by matching records, then any
  // quick actions/pages whose label matches. Empty state shows actions + pages.
  const items: Item[] = (() => {
    if (query.length > 1) {
      const recordItems: Item[] = results.map(r => ({ kind: "record", id: r.id, object_type: r.object_type, data: r.data }));
      const q = query.toLowerCase();
      const actionHits: Item[] = QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q)).map(a => ({ kind: "action", ...a }));
      const navHits: Item[] = QUICK_LINKS.filter(l => l.label.toLowerCase().includes(q)).map(l => ({ kind: "nav", ...l }));
      return [{ kind: "ai", label: query }, ...recordItems, ...actionHits, ...navHits];
    }
    return [
      ...QUICK_ACTIONS.map(a => ({ kind: "action", ...a }) as Item),
      ...QUICK_LINKS.map(l => ({ kind: "nav", ...l }) as Item),
    ];
  })();

  useEffect(() => { setIdx(0); }, [input, open]);

  function go(item: Item) {
    setOpen(false);
    setInput("");
    if (item.kind === "ai") {
      navigate("/ask/new", { state: { askPrompt: item.label } });
    } else if (item.kind === "action" || item.kind === "nav") {
      navigate(item.to);
    } else if (item.object_type === "task") {
      navigate("/tasks");
    } else if (FINANCE_ROUTE[item.object_type]) {
      navigate(FINANCE_ROUTE[item.object_type]!(item.id));
    } else {
      navigate(`/objects/${item.object_type}/${item.id}`);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && items[idx]) go(items[idx]!);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-soft)]">
          <Search size={15} className="text-stone-500 shrink-0"/>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search records, pages, or ask AI…"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-stone-600 outline-none"
          />
          <kbd className="hidden sm:inline-block rounded border border-[var(--border-soft)] bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-stone-600">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1.5">
          {items.map((item, i) => {
            const active = i === idx;
            const rowCls = `flex w-full items-center gap-3 px-4 py-2.5 transition-colors ${active ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"}`;
            if (item.kind === "ai") {
              return (
                <button key="ai" onClick={() => go(item)} onMouseEnter={() => setIdx(i)} className={rowCls}>
                  <span style={{ color: "var(--section-accent)" }} className="shrink-0"><AIMark size={13}/></span>
                  <span className="flex-1 text-left text-sm text-[var(--text-primary)] truncate">Ask Mondaily AI: <span className="text-[var(--text-muted)]">"{item.label}"</span></span>
                  <span className="text-[10px] text-stone-600 shrink-0">↵</span>
                </button>
              );
            }
            if (item.kind === "action") {
              const Icon = item.icon;
              return (
                <button key={"a" + item.to} onClick={() => go(item)} onMouseEnter={() => setIdx(i)} className={rowCls}>
                  <Icon size={14} className="text-[var(--text-muted)] shrink-0"/>
                  <span className="flex-1 text-left text-sm text-[var(--text-primary)] truncate">{item.label}</span>
                  <span className="text-[10px] text-stone-600 capitalize shrink-0">action</span>
                </button>
              );
            }
            if (item.kind === "nav") {
              return (
                <button key={"n" + item.to} onClick={() => go(item)} onMouseEnter={() => setIdx(i)} className={rowCls}>
                  <ArrowRight size={14} className="text-stone-500 shrink-0"/>
                  <span className="flex-1 text-left text-sm text-[var(--text-primary)] truncate">{item.label}</span>
                  <span className="text-[10px] text-stone-600 shrink-0">page</span>
                </button>
              );
            }
            // record
            const d = item.data as Record<string, unknown>;
            const name = String(d.name ?? d.title ?? item.id);
            const Icon = TYPE_ICON[item.object_type] ?? FileText;
            const color = TYPE_COLOR[item.object_type] ?? "text-stone-500";
            return (
              <button key={item.id + i} onClick={() => go(item)} onMouseEnter={() => setIdx(i)} className={rowCls}>
                <Icon size={14} className={`${color} shrink-0`}/>
                <span className="flex-1 text-left text-sm text-[var(--text-primary)] truncate">{name}</span>
                <span className="text-[10px] text-stone-600 capitalize shrink-0">{item.object_type}</span>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-[var(--border-soft)] px-4 py-2">
          <span className="text-[10px] text-stone-700">↑↓ navigate</span>
          <span className="text-[10px] text-stone-700">↵ open</span>
          <span className="text-[10px] text-stone-700 ml-auto">⌘K to close</span>
        </div>
      </div>
    </div>
  );
}

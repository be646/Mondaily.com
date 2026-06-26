import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Building2, UserRound, TrendingUp, CheckSquare, FileText, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

interface SearchResult { id: string; object_type: string; data: Record<string, unknown> }

const TYPE_ICON: Record<string, React.ElementType> = {
  companies: Building2, people: UserRound, deals: TrendingUp,
  task: CheckSquare, note: FileText,
};
const TYPE_COLOR: Record<string, string> = {
  companies: "text-blue-400", people: "text-emerald-400", deals: "text-amber-400",
  task: "text-purple-400", note: "text-stone-400",
};

const QUICK_LINKS = [
  { label: "Home",          to: "/home" },
  { label: "Tasks",         to: "/tasks" },
  { label: "People",        to: "/objects/people" },
  { label: "Companies",     to: "/objects/companies" },
  { label: "Deals",         to: "/objects/deals" },
  { label: "Reports",       to: "/reports" },
  { label: "Automations",   to: "/automations" },
  { label: "Ask AI",        to: "/ask/new" },
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

  const { data: results = [] } = useQuery({
    queryKey: ["cmd-search", input],
    queryFn: () => apiClient.post<SearchResult[]>("/search", { query: input, limit: 8 }),
    enabled: input.trim().length > 1,
    staleTime: 5_000,
  });

  const items = input.trim().length > 1
    ? results
    : QUICK_LINKS.map(l => ({ id: l.to, object_type: "nav", data: { name: l.label, to: l.to } }));

  useEffect(() => { setIdx(0); }, [input, open]);

  function go(item: typeof items[number]) {
    setOpen(false);
    setInput("");
    if (item.object_type === "nav") {
      navigate(String(item.data.to));
    } else if (item.object_type === "task") {
      navigate("/tasks");
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
        className="w-full max-w-lg rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[.07]">
          <Search size={15} className="text-stone-500 shrink-0"/>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search records, pages, actions…"
            className="flex-1 bg-transparent text-sm text-white placeholder-stone-600 outline-none"
          />
          <kbd className="hidden sm:inline-block rounded border border-white/[.08] bg-white/[.04] px-1.5 py-0.5 text-[10px] text-stone-600">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1.5">
          {items.length === 0 && input.trim().length > 1 && (
            <p className="px-4 py-6 text-center text-xs text-stone-600">No results for "{input}"</p>
          )}
          {items.map((item, i) => {
            const d = item.data as Record<string, unknown>;
            const name = String(d.name ?? d.title ?? item.id);
            const Icon = item.object_type === "nav" ? ArrowRight : (TYPE_ICON[item.object_type] ?? FileText);
            const color = item.object_type === "nav" ? "text-stone-500" : (TYPE_COLOR[item.object_type] ?? "text-stone-500");
            const sub = item.object_type === "nav" ? "" : item.object_type;
            return (
              <button
                key={item.id + i}
                onClick={() => go(item)}
                onMouseEnter={() => setIdx(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 transition-colors ${i === idx ? "bg-white/[.05]" : "hover:bg-white/[.03]"}`}
              >
                <Icon size={14} className={`${color} shrink-0`}/>
                <span className="flex-1 text-left text-sm text-stone-200 truncate">{name}</span>
                {sub && <span className="text-[10px] text-stone-600 capitalize shrink-0">{sub}</span>}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-white/[.05] px-4 py-2">
          <span className="text-[10px] text-stone-700">↑↓ navigate</span>
          <span className="text-[10px] text-stone-700">↵ open</span>
          <span className="text-[10px] text-stone-700 ml-auto">⌘K to close</span>
        </div>
      </div>
    </div>
  );
}

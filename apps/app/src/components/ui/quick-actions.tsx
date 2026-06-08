import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Users, CheckSquare, FileText, Mail, Phone, BarChart2, Zap, Settings, Search, Bell } from "lucide-react";

const ACTIONS = [
  { label: "Home", to: "/home", icon: Home },
  { label: "Tasks", to: "/tasks", icon: CheckSquare },
  { label: "Notes", to: "/notes", icon: FileText },
  { label: "Emails", to: "/emails", icon: Mail },
  { label: "Calls", to: "/calls", icon: Phone },
  { label: "Reports", to: "/reports", icon: BarChart2 },
  { label: "Automations", to: "/automations", icon: Zap },
  { label: "Notifications", to: "/notifications", icon: Bell },
  { label: "People", to: "/objects/people", icon: Users },
  { label: "Settings", to: "/settings/account", icon: Settings },
  { label: "Search", to: "/search", icon: Search },
];

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase()));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)}/>
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#161820] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search size={16} className="text-slate-400 shrink-0"/>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or jump to..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-xs text-slate-500">esc</kbd>
        </div>
        <div className="max-h-72 overflow-auto p-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">No results</div>
          )}
          {filtered.map(({ label, to, icon: Icon }) => (
            <button
              key={to}
              onClick={() => { navigate(to); setOpen(false); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[.06] hover:text-white transition-colors"
            >
              <Icon size={15} className="text-slate-500 shrink-0"/>
              {label}
            </button>
          ))}
        </div>
        <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-600">
          Press <kbd className="rounded border border-white/10 px-1 py-0.5">↑↓</kbd> to navigate · <kbd className="rounded border border-white/10 px-1 py-0.5">↵</kbd> to select · <kbd className="rounded border border-white/10 px-1 py-0.5">⌘K</kbd> to toggle
        </div>
      </div>
    </div>
  );
}

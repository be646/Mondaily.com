import { Building2, CreditCard, Database, Mail, Plug, Shield, ShieldCheck, Sparkles, User, Users, ChevronRight, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

// Grouped settings IA — You / Workspace / Plan — instead of a flat list, so the cluster reads as
// a clear, friendly hierarchy. Members & finance now live under one "Members" entry (consolidated).
type NavTuple = [path: string, icon: LucideIcon, label: string];
const GROUPS: { title: string; items: NavTuple[] }[] = [
  { title: "You", items: [
    ["account", User, "Account"],
    ["security", Shield, "Security"],
  ] },
  { title: "Workspace", items: [
    ["workspace", Building2, "Workspace"],
    ["members", Users, "Members"],
    ["objects", Database, "Objects & attributes"],
    ["integrations", Plug, "Integrations & API"],
    ["email", Mail, "Email & calendar"],
  ] },
  { title: "Plan", items: [
    ["billing", CreditCard, "Billing & Usage"],
    ["ask-mondaily", Sparkles, "Ask Mondaily"],
    ["ai-control-room", ShieldCheck, "AI Control Room"],
  ] },
];

const ALL_ITEMS: NavTuple[] = GROUPS.flatMap(g => g.items);

export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname === "/settings" || location.pathname === "/settings/";
  const currentItem = ALL_ITEMS.find(([to]) => location.pathname.includes(to));

  return (
    // Dual-font: settings UI (tabs, labels, headers, buttons) uses Geist Sans; data values opt into mono.
    <div className="flex h-full">
      {/* Sidebar nav */}
      <aside className={`w-full md:w-56 md:shrink-0 border-r border-[var(--border-soft)] px-3 py-6 ${!isRoot ? "hidden md:block" : "block"}`}>
        <p className="mb-4 px-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--section-accent)" }}>// Settings</p>
        {GROUPS.map(group => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{group.title}</p>
            {group.items.map(([to, Icon, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center justify-between rounded-sm px-3 py-2 text-sm ${isActive ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`
                }
              >
                <div className="flex items-center gap-2">
                  <Icon size={14}/>
                  {label}
                </div>
                <ChevronRight size={13} className="md:hidden text-[var(--text-muted)]"/>
              </NavLink>
            ))}
          </div>
        ))}
      </aside>

      {/* Content area */}
      <main className={`min-w-0 flex-1 overflow-auto ${isRoot ? "hidden md:block" : "block"}`}>
        {/* Mobile back button */}
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3 md:hidden">
          <button onClick={() => navigate("/settings")} className="flex items-center gap-1.5 text-sm text-[var(--text-faint)] hover:text-[var(--text-primary)]">
            <ArrowLeft size={15}/> Settings
          </button>
          {currentItem && <span className="text-sm text-[var(--text-primary)]">· {currentItem[2]}</span>}
        </div>
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

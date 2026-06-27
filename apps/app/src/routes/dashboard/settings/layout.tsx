import { Building2, CreditCard, Database, Mail, Plug, Shield, Sparkles, User, Users, ChevronRight, ArrowLeft } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

const items = [
  ["account", User, "Account"],
  ["workspace", Building2, "Workspace"],
  ["members", Users, "Members & teams"],
  ["billing", CreditCard, "Billing"],
  ["objects", Database, "Objects & attributes"],
  ["integrations", Plug, "Integrations & API"],
  ["email", Mail, "Email & calendar"],
  ["security", Shield, "Security"],
  ["ask-mondaily", Sparkles, "Ask Mondaily"]
] as const;

export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname === "/settings" || location.pathname === "/settings/";
  const currentItem = items.find(([to]) => location.pathname.includes(to));

  return (
    <div className="flex h-full">
      {/* Desktop sidebar — always visible */}
      {/* Mobile: show nav list when at /settings root, show back+content when in a sub-page */}
      
      {/* Sidebar nav */}
      <aside className={`w-full md:w-56 md:shrink-0 border-r border-[#e5e7eb] dark:border-[var(--border-soft)] px-3 py-6 ${!isRoot ? "hidden md:block" : "block"}`}>
        <p className="mb-3 px-3 text-xs font-semibold uppercase text-[#9ca3af] dark:text-stone-600">Settings</p>
        {items.map(([to, Icon, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `mb-1 flex items-center justify-between rounded-md px-3 py-2.5 text-sm ${isActive ? "bg-stone-200 text-stone-900 dark:bg-[var(--surface-hover)] dark:text-[var(--text-primary)]" : "text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#18181b] dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-transparent"}`
            }
          >
            <div className="flex items-center gap-2">
              <Icon size={14}/>
              {label}
            </div>
            <ChevronRight size={13} className="md:hidden text-[#9ca3af] dark:text-stone-600"/>
          </NavLink>
        ))}
      </aside>

      {/* Content area */}
      <main className={`min-w-0 flex-1 overflow-auto ${isRoot ? "hidden md:block" : "block"}`}>
        {/* Mobile back button */}
        <div className="flex items-center gap-2 border-b border-[#e5e7eb] dark:border-[var(--border-soft)] px-4 py-3 md:hidden">
          <button onClick={() => navigate("/settings")} className="flex items-center gap-1.5 text-sm text-[#6b7280] hover:text-[#111827] dark:text-stone-400 dark:hover:text-[var(--text-primary)]">
            <ArrowLeft size={15}/> Settings
          </button>
          {currentItem && <span className="text-sm text-[#111827] dark:text-[var(--text-primary)]">· {currentItem[2]}</span>}
        </div>
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

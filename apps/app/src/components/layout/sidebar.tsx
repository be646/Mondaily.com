import { Link, useLocation } from "react-router-dom";
import { BarChart2, Bell, CheckSquare, FileText, Home, Mail, MessageCircle, Phone, Settings, Zap } from "lucide-react";
import { SidebarObjects } from "./sidebar-records";
import { SidebarLists } from "./sidebar-lists";
import { SidebarAsk } from "./sidebar-ask";

const navItems = [
  { to: "/dashboard/home", label: "Home", icon: Home },
  { to: "/dashboard/notifications", label: "Notifications", icon: Bell },
  { to: "/dashboard/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/dashboard/notes", label: "Notes", icon: FileText },
  { to: "/dashboard/emails", label: "Emails", icon: Mail },
  { to: "/dashboard/calls", label: "Calls", icon: Phone },
  { to: "/dashboard/reports", label: "Reports", icon: BarChart2 },
  { to: "/dashboard/automations", label: "Automations", icon: Zap }
];

export function Sidebar() {
  const location = useLocation();
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-[#0d0f13]">
      <div className="border-b border-white/10 p-4">
        <div className="font-semibold">Mondaily</div>
        <div className="text-xs text-slate-500">AI business OS</div>
      </div>
      <nav className="flex-1 overflow-auto p-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${location.pathname.startsWith(to) ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"}`}
          >
            <Icon size={15} />
            {label}
          </Link>
        ))}
        <SidebarObjects />
        <SidebarLists />
        <SidebarAsk />
      </nav>
      <Link to="/dashboard/settings/account" className="m-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04]">
        <Settings size={15} />
        Settings
      </Link>
    </aside>
  );
}


import { Link, useLocation } from "react-router-dom";
import { BarChart2, Bell, CheckSquare, FileText, Home, Mail, MessageCircle, Phone, Settings, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { SidebarObjects } from "./sidebar-records";
import { SidebarLists } from "./sidebar-lists";
import { SidebarAsk } from "./sidebar-ask";

const navItems = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/emails", label: "Emails", icon: Mail },
  { to: "/calls", label: "Calls", icon: Phone },
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/automations", label: "Automations", icon: Zap }
];

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glowS" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0"/>
        </radialGradient>
        <filter id="gbS" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4"/>
        </filter>
        <filter id="sbS" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2"/>
        </filter>
      </defs>
      <circle cx="22" cy="22" r="20" fill="url(#glowS)" filter="url(#gbS)"/>
      <circle cx="22" cy="22" r="18" fill="none" stroke="#ef4444" strokeWidth="0.6" opacity="0.15"/>
      <circle cx="22" cy="22" r="14" fill="none" stroke="#ef4444" strokeWidth="0.8" opacity="0.3"/>
      <circle cx="22" cy="22" r="10" fill="none" stroke="#ef4444" strokeWidth="1.2" opacity="0.55"/>
      <circle cx="22" cy="22" r="6" fill="none" stroke="#ef4444" strokeWidth="1.8" opacity="0.8"/>
      <circle cx="22" cy="22" r="3" fill="#ef4444" filter="url(#sbS)" opacity="0.6"/>
      <circle cx="22" cy="22" r="2.5" fill="#ef4444"/>
    </svg>
  );
}

export function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      style={{ transition: "width 0.25s ease" }}
      className={`relative flex h-full shrink-0 flex-col border-r border-white/10 bg-[#0d0f13] ${collapsed ? "w-16" : "w-64"}`}
    >
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0d0f13] text-slate-400 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-white/10 p-4 overflow-hidden">
        <Logo size={28} />
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 200, letterSpacing: "0.2em", fontSize: "0.8rem", textTransform: "uppercase" }} className="text-white">mondaily</div>
            <div className="text-xs text-slate-500">AI business OS</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-auto p-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${location.pathname.startsWith(to) ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"} ${collapsed ? "justify-center" : ""}`}
          >
            <Icon size={15} />
            {!collapsed && label}
          </Link>
        ))}
        {!collapsed && <SidebarObjects />}
        {!collapsed && <SidebarLists />}
        {!collapsed && <SidebarAsk />}
      </nav>

      {/* Settings */}
      <Link
        to="/settings/account"
        title={collapsed ? "Settings" : undefined}
        className={`m-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] ${collapsed ? "justify-center" : ""}`}
      >
        <Settings size={15} />
        {!collapsed && "Settings"}
      </Link>
    </aside>
  );
}

import { Link, useLocation, useNavigate } from "react-router-dom";
import { BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone, Settings, Zap, ChevronLeft, ChevronRight, ChevronDown, LogOut, Users, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { useClerk, useUser } from "@clerk/react";
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
      <circle cx="18" cy="22" r="13" fill="none" stroke="#ef4444" strokeWidth="2.5"/>
      <circle cx="26" cy="22" r="13" fill="none" stroke="white" strokeWidth="2" opacity="0.55"/>
      <circle cx="22" cy="22" r="3.5" fill="#ef4444"/>
      <circle cx="22" cy="22" r="6" fill="#ef4444" opacity="0.12"/>
    </svg>
  );
}

const GETTING_STARTED = [
  { label: "Create your workspace", done: true },
  { label: "Invite a team member", done: false },
  { label: "Add your first contact", done: false },
  { label: "Create a task", done: false },
  { label: "Try Ask Mondaily", done: false },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false);

  const doneCount = GETTING_STARTED.filter(i => i.done).length;
  const progress = Math.round((doneCount / GETTING_STARTED.length) * 100);
  const org = user?.organizationMemberships?.[0]?.organization;
  const workspaceName = org?.name || (user?.firstName ? `${user.firstName}'s Workspace` : "My Workspace");
  const workspaceLogo = (org as any)?.imageUrl as string | null || null;
  const workspaceInitial = workspaceName[0]?.toUpperCase() || "M";

  return (
    <aside
      style={{ transition: "width 0.25s ease" }}
      className={`relative flex h-full shrink-0 flex-col border-r border-white/10 bg-[#0d0f13] ${collapsed ? "w-16" : "w-64"}`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0d0f13] text-slate-400 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      <div className="relative border-b border-white/10">
        <button
          onClick={() => !collapsed && setWorkspaceOpen(!workspaceOpen)}
          className={`flex w-full items-center gap-2.5 p-4 hover:bg-white/[.03] transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          {workspaceLogo ? (
            <img src={workspaceLogo} alt={workspaceName} className="h-7 w-7 rounded-lg object-cover shrink-0"/>
          ) : (
            <Logo size={28} />
          )}
          {!collapsed && (
            <>
              <div className="flex-1 text-left min-w-0">
                <div className="truncate text-sm font-medium text-white">{workspaceName}</div>
                <div className="text-xs text-slate-500">Pro workspace</div>
              </div>
              <ChevronsUpDown size={13} className="text-slate-500 shrink-0"/>
            </>
          )}
        </button>

        {workspaceOpen && !collapsed && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)}/>
            <div className="absolute left-2 right-2 top-full z-50 mt-1 rounded-xl border border-white/10 bg-[#161820] shadow-2xl">
              <div className="p-2">
                <div className="mb-1 px-2 py-1 text-xs text-slate-500 uppercase tracking-wider">Workspaces</div>
                <div className="flex items-center gap-2.5 rounded-lg bg-white/[.06] px-3 py-2">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt={workspaceName} className="h-6 w-6 rounded-md object-cover"/>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/20 text-xs font-semibold text-red-400">{workspaceInitial}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-white">{workspaceName}</div>
                    <div className="text-xs text-slate-500">Pro</div>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-green-400"/>
                </div>
              </div>
              <div className="border-t border-white/10 p-2">
                <Link to="/settings/workspace" onClick={() => setWorkspaceOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                  <Plus size={14}/> Create new workspace
                </Link>
              </div>
              <div className="border-t border-white/10 p-2">
                <Link to="/settings/members" onClick={() => setWorkspaceOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                  <Users size={14}/> Invite members
                </Link>
                <Link to="/settings/workspace" onClick={() => setWorkspaceOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                  <Settings size={14}/> Workspace settings
                </Link>
                <button
                  onClick={() => { setWorkspaceOpen(false); signOut(() => navigate("/sign-in")); }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-red-400 transition-colors"
                >
                  <LogOut size={14}/> Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-auto p-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${location.pathname.startsWith(to) ? "bg-red-500/15 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"} ${collapsed ? "justify-center" : ""}`}
          >
            <Icon size={15} />
            {!collapsed && label}
          </Link>
        ))}
        {!collapsed && <SidebarObjects />}
        {!collapsed && <SidebarLists />}
        {!collapsed && <SidebarAsk />}
      </nav>

      {!collapsed && (
        <div className="border-t border-white/10 p-2 space-y-1">
          <button
            onClick={() => setGettingStartedOpen(!gettingStartedOpen)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors"
          >
            <span>Getting started {doneCount}/{GETTING_STARTED.length}</span>
            <ChevronDown size={12} className={`transition-transform ${gettingStartedOpen ? "rotate-180" : ""}`}/>
          </button>
          <div className="mx-3 h-1 rounded-full bg-white/10">
            <div className="h-1 rounded-full bg-red-500 transition-all" style={{ width: `${progress}%` }}/>
          </div>
          {gettingStartedOpen && (
            <div className="mx-1 mt-1 space-y-0.5">
              {GETTING_STARTED.map((item, i) => (
                <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${item.done ? "text-slate-600 line-through" : "text-slate-400"}`}>
                  <div className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${item.done ? "border-slate-600 bg-slate-600" : "border-slate-600"}`}>
                    {item.done && <div className="h-1.5 w-1.5 rounded-full bg-white"/>}
                  </div>
                  {item.label}
                </div>
              ))}
            </div>
          )}
          <Link to="/settings/members" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
            <Users size={13}/> Invite team members
          </Link>
          <div className="mx-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="text-xs font-medium text-amber-400">14 days left on trial</div>
            <div className="text-xs text-slate-500 mt-0.5">Upgrade to keep access</div>
            <Link to="/settings/billing" className="mt-1.5 block rounded-md bg-amber-500/15 px-2 py-1 text-center text-xs text-amber-400 hover:bg-amber-500/25 transition-colors">
              Upgrade to Pro
            </Link>
          </div>
        </div>
      )}

      {collapsed && (
        <Link to="/settings/account" title="Settings" className="m-2 flex items-center justify-center rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04]">
          <Settings size={15}/>
        </Link>
      )}
    </aside>
  );
}

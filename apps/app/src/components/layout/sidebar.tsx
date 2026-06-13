import { Link, useLocation, useNavigate } from "react-router-dom";
import { BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone, Settings, Zap, ChevronLeft, ChevronRight, ChevronDown, LogOut, Users, ChevronsUpDown, Plus, X, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { useClerk, useUser } from "@clerk/react";
import { apiClient } from "../../lib/api-client";
import { SidebarObjects } from "./sidebar-records";
import { SidebarAsk } from "./sidebar-ask";

const navItems = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/search", label: "Search", icon: Search },
  { to: "/emails", label: "Emails", icon: Mail },
  { to: "/calls", label: "Calls", icon: Phone },
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/automations", label: "Automations", icon: Zap }
];

function Logo({ size = 28 }: { size?: number }) {
  const lineCount = 14;
  const lineH = size / lineCount;
  const radius = Math.max(2, size * 0.1);
  const dotSize = Math.max(4, size * 0.16);
  return (
    <div
      className="relative overflow-hidden bg-black border border-white/20 shrink-0"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {/* Scanning grid lines */}
      <div
        className="logo-scan absolute inset-x-0 top-0 will-change-transform"
        style={{ height: "200%" }}
      >
        {Array.from({ length: lineCount * 2 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: lineH,
              borderBottom: `1px solid rgba(255,255,255,${i % 5 === 0 ? 0.22 : i % 2 === 0 ? 0.07 : 0.03})`,
            }}
          />
        ))}
      </div>
      {/* Accent dot */}
      <div
        className="logo-dot absolute rounded-full bg-white"
        style={{
          width: dotSize,
          height: dotSize,
          top: Math.max(3, size * 0.12),
          right: Math.max(3, size * 0.12),
          boxShadow: "0 0 5px rgba(255,255,255,0.9)",
        }}
      />
    </div>
  );
}

const GETTING_STARTED = [
  { label: "Create your workspace", done: true },
  { label: "Invite a team member", done: false },
  { label: "Add your first contact", done: false },
  { label: "Create a task", done: false },
  { label: "Try Ask Mondaily", done: false },
];

export function Sidebar({ onMobileClose }: { onMobileClose?: () => void } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [collapsed, setCollapsed] = useState(false);

  // Sync current user as workspace member
  useEffect(() => {
    const email = user?.primaryEmailAddress?.emailAddress;
    const name = user?.fullName || user?.firstName;
    if (!user?.id || !email) return;
    apiClient.post("/members/sync", {
      email,
      name: name || email,
      avatar_url: user.imageUrl || undefined
    }).catch(() => {});
  }, [user?.id, user?.primaryEmailAddress?.emailAddress, user?.fullName]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");

  const doneCount = GETTING_STARTED.filter(i => i.done).length;
  const progress = Math.round((doneCount / GETTING_STARTED.length) * 100);
  const org = user?.organizationMemberships?.[0]?.organization;
  const workspaceName = org?.name || (user?.firstName ? `${user.firstName}'s Workspace` : "My Workspace");
  const workspaceLogo = (org as any)?.imageUrl as string | null || null;
  const workspaceInitial = workspaceName[0]?.toUpperCase() || "M";

  return (
    <>
      <aside
        style={{ transition: "width 0.25s ease" }}
        className={`relative flex h-full shrink-0 flex-col border-r border-white/10 bg-[#0d0f13] ${collapsed ? "w-16" : "w-64"}`}
      >
        <button
          onClick={() => { if (onMobileClose) { onMobileClose(); } else { setCollapsed(!collapsed); } }}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0d0f13] text-slate-400 hover:text-white transition-colors"
        >
          {onMobileClose ? <X size={12} /> : collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* Workspace selector */}
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
              <div className="dropdown-panel absolute left-2 right-2 top-full">
                <div className="flex items-center gap-2.5 border-b border-zinc-800/50 px-3 py-2.5">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt={workspaceName} className="h-6 w-6 rounded-md object-cover shrink-0"/>
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-500/20 text-xs font-semibold text-red-400">{workspaceInitial}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[12px] font-medium text-white">{workspaceName}</div>
                    <div className="text-[11px] text-zinc-500">Pro</div>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-green-400 shrink-0"/>
                </div>
                <button
                  onClick={() => { setWorkspaceOpen(false); setNewWorkspaceOpen(true); }}
                  className="dropdown-item"
                >
                  <Plus size={13}/> Create new workspace
                </button>
                <Link to="/settings/members" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Users size={13}/> Invite members
                </Link>
                <Link to="/settings/workspace" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Settings size={13}/> Workspace settings
                </Link>
                <button
                  onClick={() => { setWorkspaceOpen(false); signOut(() => navigate("/sign-in")); }}
                  className="dropdown-item text-red-400 hover:text-red-300"
                >
                  <LogOut size={13}/> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-auto p-2">
        {!collapsed && (
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="key-button mb-2 flex w-full items-center justify-between px-3 py-2 text-xs"
          >
            <div className="flex items-center gap-2"><Search size={13}/> Quick actions</div>
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-xs opacity-50">⌘K</kbd>
          </button>
        )}
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
          {!collapsed && <SidebarAsk />}
        </nav>

        {/* Bottom section */}
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
            <div className="mx-1 flex items-center justify-between rounded-lg border border-white/[.06] bg-white/[.03] px-3 py-2">
              <div>
                <span className="text-[11px] text-slate-400">14-day trial</span>
                <span className="ml-1.5 text-[11px] text-slate-600">· 14 days left</span>
              </div>
              <Link to="/settings/billing" className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-slate-400 hover:text-white hover:border-white/20 transition-colors whitespace-nowrap">
                Upgrade
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

      {/* Create workspace modal */}
      {newWorkspaceOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setNewWorkspaceOpen(false)}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#161820] p-6 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-base font-medium text-white">Create new workspace</div>
              <button onClick={() => setNewWorkspaceOpen(false)} className="text-slate-400 hover:text-white">
                <X size={16}/>
              </button>
            </div>
            <div className="mb-4 text-xs text-slate-500">Each workspace has its own contacts, deals, and settings.</div>
            <input
              value={newWsName}
              onChange={e => setNewWsName(e.target.value)}
              placeholder="e.g. Acme Corp, Personal, Side Project"
              className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-red-500/40 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => { setNewWorkspaceOpen(false); setNewWsName(""); }} className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/[.04] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newWsName.trim()) {
                    alert(`Workspace "${newWsName}" will be created. This feature requires backend integration — coming soon!`);
                    setNewWorkspaceOpen(false);
                    setNewWsName("");
                  }
                }}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

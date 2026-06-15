import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone,
  Settings, Zap, ChevronLeft, ChevronRight, LogOut, Users,
  ChevronsUpDown, Plus, X, Search, Receipt, TrendingUp,
  GitBranch, Activity, Layers,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useClerk, useUser } from "@clerk/react";
import { apiClient } from "../../lib/api-client";
import { SidebarObjects } from "./sidebar-records";
import { SidebarLists } from "./sidebar-lists";
import { SidebarAsk } from "./sidebar-ask";

// ─── Nav structure — 4 clean groups ──────────────────────────────────────────
const NAV: { label: string; items: { to: string; label: string; icon: React.ElementType }[] }[] = [
  {
    label: "",
    items: [
      { to: "/home",          label: "Home",          icon: Home },
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/search",        label: "Search",        icon: Search },
    ],
  },
  {
    label: "Work",
    items: [
      { to: "/tasks",  label: "Tasks",  icon: CheckSquare },
      { to: "/notes",  label: "Notes",  icon: FileText },
      { to: "/emails", label: "Emails", icon: Mail },
      { to: "/calls",  label: "Calls",  icon: Phone },
    ],
  },
  {
    label: "Revenue",
    items: [
      { to: "/pipeline",        label: "Pipeline", icon: TrendingUp },
      { to: "/reports",         label: "Reports",  icon: BarChart2 },
      { to: "/finance/invoices",label: "Invoices", icon: Receipt },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/automations", label: "Workflows",  icon: GitBranch },
      { to: "/sequences",   label: "Sequences",  icon: Activity },
      { to: "/canvas",      label: "Canvas",     icon: Layers },
    ],
  },
];

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ size = 24 }: { size?: number }) {
  const lineCount = 14;
  const lineH = size / lineCount;
  const radius = Math.max(2, size * 0.1);
  const dotSize = Math.max(4, size * 0.16);
  return (
    <div
      className="relative overflow-hidden bg-black border border-white/20 shrink-0"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <div className="logo-scan absolute inset-x-0 top-0 will-change-transform" style={{ height: "200%" }}>
        {Array.from({ length: lineCount * 2 }).map((_, i) => (
          <div key={i} style={{ height: lineH, borderBottom: `1px solid rgba(255,255,255,${i % 5 === 0 ? 0.22 : i % 2 === 0 ? 0.07 : 0.03})` }}/>
        ))}
      </div>
      <div
        className="logo-dot absolute rounded-full bg-white"
        style={{ width: dotSize, height: dotSize, top: Math.max(3, size * 0.12), right: Math.max(3, size * 0.12), boxShadow: "0 0 5px rgba(255,255,255,0.9)" }}
      />
    </div>
  );
}

// ─── Single nav item ──────────────────────────────────────────────────────────
function NavItem({
  to, label, icon: Icon, collapsed,
}: { to: string; label: string; icon: React.ElementType; collapsed: boolean }) {
  const location = useLocation();
  const active = location.pathname.startsWith(to);

  if (collapsed) {
    return (
      <Link
        to={to}
        title={label}
        className={`mb-0.5 flex items-center justify-center rounded-lg p-2 transition-colors ${active ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}
      >
        <Icon size={14}/>
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={`mb-px flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${active ? "bg-white/[.07] text-white" : "text-slate-400 hover:bg-white/[.03] hover:text-slate-200"}`}
    >
      <Icon size={13} className={active ? "text-red-400" : "text-slate-600"}/>
      {label}
    </Link>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  if (!label) return null;
  return (
    <div className="mb-1 mt-3 px-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-700">{label}</span>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({ onMobileClose }: { onMobileClose?: () => void } = {}) {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");

  useEffect(() => {
    const email = user?.primaryEmailAddress?.emailAddress;
    const name = user?.fullName || user?.firstName;
    if (!user?.id || !email) return;
    apiClient.post("/members/sync", { email, name: name || email, avatar_url: user.imageUrl || undefined }).catch(() => {});
  }, [user?.id, user?.primaryEmailAddress?.emailAddress, user?.fullName]);

  const org = user?.organizationMemberships?.[0]?.organization;
  const workspaceName    = org?.name || (user?.firstName ? `${user.firstName}'s Workspace` : "My Workspace");
  const workspaceLogo    = (org as any)?.imageUrl as string | null || null;
  const workspaceInitial = workspaceName[0]?.toUpperCase() || "M";

  return (
    <>
      <aside
        style={{ transition: "width 0.2s ease" }}
        className={`relative flex h-full shrink-0 flex-col border-r border-white/[.05] bg-[#0b0d10] ${collapsed ? "w-[52px]" : "w-[216px]"}`}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => { if (onMobileClose) onMobileClose(); else setCollapsed(c => !c); }}
          className="absolute -right-3 top-[18px] z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/[.08] bg-[#0b0d10] text-slate-600 hover:text-white transition-colors shadow-md"
        >
          {onMobileClose ? <X size={10}/> : collapsed ? <ChevronRight size={10}/> : <ChevronLeft size={10}/>}
        </button>

        {/* Workspace header */}
        <div className="relative shrink-0 border-b border-white/[.05]">
          <button
            onClick={() => !collapsed && setWorkspaceOpen(o => !o)}
            className={`flex w-full items-center gap-2.5 px-3 py-3 hover:bg-white/[.03] transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            {workspaceLogo
              ? <img src={workspaceLogo} alt={workspaceName} className="h-6 w-6 rounded-md object-cover shrink-0"/>
              : <Logo size={24}/>
            }
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-[13px] font-semibold text-white/90 leading-tight">{workspaceName}</div>
                  <div className="text-[10px] text-slate-700">Pro workspace</div>
                </div>
                <ChevronsUpDown size={11} className="text-slate-700 shrink-0"/>
              </>
            )}
          </button>

          {workspaceOpen && !collapsed && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)}/>
              <div className="dropdown-panel absolute left-2 right-2 top-full z-50">
                <div className="flex items-center gap-2.5 border-b border-white/[.06] px-3 py-2.5">
                  {workspaceLogo
                    ? <img src={workspaceLogo} alt={workspaceName} className="h-5 w-5 rounded-md object-cover shrink-0"/>
                    : <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-red-500/20 text-[10px] font-semibold text-red-400">{workspaceInitial}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[12px] font-medium text-white">{workspaceName}</div>
                    <div className="text-[10px] text-zinc-600">Pro</div>
                  </div>
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"/>
                </div>
                <button onClick={() => { setWorkspaceOpen(false); setNewWorkspaceOpen(true); }} className="dropdown-item">
                  <Plus size={12}/> Create workspace
                </button>
                <Link to="/settings/members" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Users size={12}/> Invite members
                </Link>
                <Link to="/settings/workspace" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Settings size={12}/> Workspace settings
                </Link>
                <div className="mx-2 my-1 border-t border-white/[.05]"/>
                <button onClick={() => { setWorkspaceOpen(false); signOut(() => navigate("/sign-in")); }} className="dropdown-item text-red-400 hover:text-red-300">
                  <LogOut size={12}/> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav scroll — overscroll-none prevents the sidebar from dragging the page */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-none px-2 py-2 sidebar-scroll">
          {!collapsed && (
            <button
              onClick={() => window.dispatchEvent(new Event("mondaily:open-quick-actions"))}
              className="key-button mb-3 flex w-full items-center gap-2 px-3 py-2 text-[12px]"
            >
              <Plus size={12}/> Quick create
            </button>
          )}

          {collapsed
            ? NAV.flatMap(g => g.items).map(item => (
                <NavItem key={item.to} {...item} collapsed={true}/>
              ))
            : NAV.map(group => (
                <div key={group.label || "__top"}>
                  <SectionLabel label={group.label}/>
                  {group.items.map(item => <NavItem key={item.to} {...item} collapsed={false}/>)}
                </div>
              ))
          }

          {!collapsed && (
            <>
              <SidebarObjects />
              <SidebarLists />
              <SidebarAsk />
            </>
          )}
        </nav>

        {/* Bottom bar */}
        <div className="shrink-0 border-t border-white/[.05] p-2">
          {collapsed ? (
            <Link to="/settings/account" title="Settings"
              className="flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-white/[.04] hover:text-slate-300 transition-colors">
              <Settings size={14}/>
            </Link>
          ) : (
            <div className="space-y-1">
              {/* Trial chip */}
              <div className="flex items-center justify-between rounded-lg border border-white/[.05] bg-white/[.02] px-2.5 py-2">
                <div>
                  <span className="text-[11px] text-slate-600">Trial</span>
                  <span className="text-[11px] text-slate-500 ml-1">· 14 days left</span>
                </div>
                <Link
                  to="/settings/billing"
                  className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors whitespace-nowrap"
                >
                  Upgrade
                </Link>
              </div>

              {/* User row */}
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/[.03] transition-colors">
                {user?.imageUrl
                  ? <img src={user.imageUrl} className="h-5 w-5 rounded-full object-cover shrink-0" alt=""/>
                  : <div className="h-5 w-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-300 shrink-0">
                      {user?.firstName?.[0]?.toUpperCase() || "?"}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[12px] text-slate-300 leading-tight">{user?.fullName || user?.firstName || "You"}</div>
                  <div className="truncate text-[10px] text-slate-700">{user?.primaryEmailAddress?.emailAddress}</div>
                </div>
                <Link to="/settings/account" title="Settings" className="text-slate-700 hover:text-slate-400 transition-colors">
                  <Settings size={12}/>
                </Link>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Create workspace modal */}
      {newWorkspaceOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setNewWorkspaceOpen(false)}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Create workspace</span>
              <button onClick={() => setNewWorkspaceOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-white/[.05] hover:text-white transition-colors">
                <X size={13}/>
              </button>
            </div>
            <p className="mb-4 text-[11px] text-zinc-600">Each workspace has its own contacts, deals, and settings.</p>
            <input
              value={newWsName}
              onChange={e => setNewWsName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newWsName.trim()) {
                  alert(`Workspace "${newWsName}" — coming soon!`);
                  setNewWorkspaceOpen(false);
                  setNewWsName("");
                }
              }}
              placeholder="e.g. Acme Corp, Personal…"
              className="key-input w-full mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => { setNewWorkspaceOpen(false); setNewWsName(""); }}
                className="flex-1 rounded-xl border border-white/[.08] px-4 py-2 text-xs text-slate-400 hover:bg-white/[.04] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { if (newWsName.trim()) { alert(`Workspace "${newWsName}" will be created. Coming soon!`); setNewWorkspaceOpen(false); setNewWsName(""); } }}
                className="flex-1 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 transition-colors"
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

import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone,
  Settings, Zap, ChevronLeft, ChevronRight, ChevronDown, LogOut, Users,
  ChevronsUpDown, Plus, X, Search, Receipt, TrendingUp,
  GitBranch, Activity, Layers, Check, ReceiptText, ShieldCheck,
  FileSignature, Wallet,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";
import { useClerk, useUser } from "@clerk/react";
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
      { to: "/finance/invoices",       label: "Invoices",         icon: Receipt        },
      { to: "/finance/credit-notes",   label: "Credit Notes",     icon: ReceiptText    },
      { to: "/finance/quotes",         label: "Quotes",           icon: FileSignature  },
      { to: "/finance/expenses",       label: "Expenses",         icon: Wallet         },
      { to: "/finance/reports",        label: "Finance Reports",  icon: TrendingUp     },
      { to: "/approvals",              label: "Approvals",        icon: ShieldCheck    },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/automations", label: "Workflows",  icon: GitBranch },
      { to: "/automations", label: "Sequences",  icon: Activity },
      { to: "/canvas",      label: "Canvas",     icon: Layers },
    ],
  },
];

// ─── Getting Started checklist ────────────────────────────────────────────────
const CHECKLIST = [
  {
    id: "workspace",
    label: "Create your workspace",
    hint: "Set your workspace name and logo so your team knows they're in the right place.",
    to: "/settings/workspace",
  },
  {
    id: "contact",
    label: "Add your first contact",
    hint: "Add a person or company. This is the foundation of your CRM — every deal, email, and task connects to a contact.",
    to: "/objects/people",
  },
  {
    id: "email",
    label: "Sync email account",
    hint: "Connect Gmail or Outlook so every email you send and receive is logged automatically against the right contact.",
    to: "/settings/email",
  },
  {
    id: "import",
    label: "Import your contacts",
    hint: "Upload a CSV to bulk-add your existing contacts. Mondaily will auto-enrich them with company info and social profiles.",
    to: "/objects/people",
  },
  {
    id: "deal",
    label: "Create your first deal",
    hint: "Deals track revenue opportunities through your pipeline stages — from first contact to closed won.",
    to: "/pipeline",
  },
  {
    id: "member",
    label: "Invite a team member",
    hint: "Sales is a team sport. Invite a colleague so you can assign contacts, share deals, and collaborate on tasks.",
    to: "/settings/members",
  },
  {
    id: "extension",
    label: "Install our extension",
    hint: "The Mondaily browser extension lets you capture contacts from LinkedIn, enrich records, and log emails — without leaving your browser.",
    to: "/settings/integrations",
  },
  {
    id: "report",
    label: "Create a report",
    hint: "Build a custom report to see your pipeline health, team activity, or revenue forecast at a glance.",
    to: "/reports",
  },
  {
    id: "workflow",
    label: "Create a workflow",
    hint: "Automate repetitive tasks — like assigning new leads, sending follow-up reminders, or updating deal stages automatically.",
    to: "/automations",
  },
  {
    id: "sequence",
    label: "Create a sequence",
    hint: "Set up a multi-step email drip campaign to nurture leads automatically over days or weeks.",
    to: "/automations",
  },
  {
    id: "ai",
    label: "Try Ask Mondaily",
    hint: "Ask Mondaily anything about your data — 'which deals haven't moved in 2 weeks?' or 'summarise my week'. Your AI sales assistant.",
    to: "/ask/new",
  },
  {
    id: "apps",
    label: "Explore our apps",
    hint: "Connect Slack, Zapier, HubSpot, and more. Integrations keep Mondaily in sync with the tools your team already uses.",
    to: "/settings/integrations",
  },
];

function GettingStarted() {
  const [open, setOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem("gs_dismissed"));

  const extensionInstalled = useMemo(() => !!localStorage.getItem("mondaily_extension_installed"), []);

  const { data: status } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: async () => {
      const res = await apiClient.get("/onboarding/status");
      return (res as { data: Record<string, boolean> }).data;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const done = useMemo<Set<string>>(() => {
    if (!status) return new Set(["workspace"]);
    const s = new Set<string>(Object.entries(status).filter(([, v]) => v).map(([k]) => k));
    if (extensionInstalled) s.add("extension");
    return s;
  }, [status, extensionInstalled]);

  const doneCount = done.size;
  const total = CHECKLIST.length;
  const pct = Math.round((doneCount / total) * 100);

  function dismiss() {
    localStorage.setItem("gs_dismissed", "1");
    setDismissed(true);
  }

  if (dismissed || doneCount === total) return null;

  const cardBg = "linear-gradient(160deg, rgba(99,102,241,0.11) 0%, rgba(99,102,241,0.04) 100%)";
  const cardBorder = "1px solid rgba(99,102,241,0.18)";

  return (
    <div className="shrink-0 px-2 pb-2">
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: cardBg, border: cardBorder }}
      >
        {/* Checklist — slides open inside the card itself, same bg */}
        {open && (
          <div className="px-2 pt-1.5 pb-0 max-h-[320px] overflow-y-auto sidebar-scroll space-y-px">
            {CHECKLIST.map(item => {
              const checked = done.has(item.id);
              const hovered = hoverId === item.id;
              return (
                <div
                  key={item.id}
                  className="relative"
                  onMouseEnter={() => setHoverId(item.id)}
                  onMouseLeave={() => setHoverId(null)}
                >
                  <div className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${checked ? "opacity-35" : hovered ? "bg-white/[.06]" : ""}`}>
                    <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${checked ? "bg-indigo-500 border-indigo-500" : "border-indigo-500/30"}`}>
                      {checked && <Check size={7} className="text-white" strokeWidth={3.5}/>}
                    </div>
                    <Link to={item.to} onClick={() => setOpen(false)} className="flex-1 min-w-0">
                      <span className={`text-[11px] leading-tight ${checked ? "line-through text-white/20" : "text-white/55"}`}>
                        {item.label}
                      </span>
                    </Link>
                  </div>

                  {/* Tooltip — pops right */}
                  {hovered && !checked && (
                    <div className="absolute left-full top-0 z-[210] ml-2.5 w-56 pointer-events-none">
                      <div className="absolute -left-[7px] top-2.5 h-3 w-3 rotate-45 border-l border-t border-indigo-500/20 bg-[#1a1118]"/>
                      <div className="rounded-xl border border-indigo-500/20 bg-[#1a1118] px-3 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
                        <div className="text-[12px] font-semibold text-white mb-1.5">{item.label}</div>
                        <div className="text-[11px] text-white/40 leading-relaxed">{item.hint}</div>
                        <div className="mt-2.5 text-[10px] font-semibold text-indigo-400">→ Go there</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Dismiss */}
            <div className="border-t border-indigo-500/10 mt-1 px-1 py-2 flex items-center justify-between">
              <span className="text-[10px] text-white/20">Auto-detected · updates live</span>
              <button onClick={dismiss} className="text-[10px] font-semibold text-indigo-400/50 hover:text-indigo-400 transition-colors">
                Mark all done
              </button>
            </div>
          </div>
        )}

        {/* Header — always visible, clicking toggles list */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-2.5 px-3 pt-2.5 pb-2"
        >
          <div className="relative shrink-0 h-7 w-7">
            <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90">
              <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="2.5"/>
              <circle cx="14" cy="14" r="11" fill="none" stroke="#6366f1" strokeWidth="2.5"
                strokeDasharray={`${2 * Math.PI * 11}`}
                strokeDashoffset={`${2 * Math.PI * 11 * (1 - pct / 100)}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.5s ease" }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-indigo-400">{doneCount}</span>
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-[12px] font-semibold text-white/80">Getting started</div>
            <div className="text-[10px] text-white/25">{doneCount} of {total} done</div>
          </div>
          <ChevronDown size={11} className={`text-indigo-400/40 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}/>
        </button>

        {/* Progress bar */}
        <div className="mx-3 mb-2.5 h-[3px] rounded-full bg-indigo-500/10 overflow-hidden">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }}/>
        </div>
      </div>
    </div>
  );
}

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
  to, label, icon: Icon, collapsed, badge,
}: { to: string; label: string; icon: React.ElementType; collapsed: boolean; badge?: number }) {
  const location = useLocation();
  const active = location.pathname.startsWith(to);

  if (collapsed) {
    return (
      <Link
        to={to}
        title={label}
        className={`mb-0.5 relative flex items-center justify-center rounded-lg p-2 transition-colors ${active ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}
      >
        <Icon size={14}/>
        {!!badge && <span className="absolute top-0.5 right-0.5 h-3.5 min-w-[14px] rounded-full bg-indigo-500 px-1 text-[8px] font-bold text-white flex items-center justify-center leading-none">{badge > 9 ? "9+" : badge}</span>}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={`mb-px flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${active ? "bg-white/[.07] text-white" : "text-slate-400 hover:bg-white/[.03] hover:text-slate-200"}`}
    >
      <Icon size={13} className={active ? "text-indigo-400" : "text-slate-600"}/>
      {label}
      {!!badge && <span className="ml-auto h-4 min-w-[16px] rounded-full bg-indigo-500 px-1.5 text-[9px] font-bold text-white flex items-center justify-center leading-none">{badge > 99 ? "99+" : badge}</span>}
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
  const { hasFinance } = useModules();
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

  const { data: notifications = [] } = useQuery<{ read_at: string | null }[]>({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unreadCount = notifications.filter(n => !n.read_at).length;

  return (
    <>
      <aside
        style={{ transition: "width 0.2s ease" }}
        className={`relative flex h-full shrink-0 flex-col border-r border-zinc-200 dark:border-white/[.05] bg-white dark:bg-[#0b0d10] ${collapsed ? "w-[52px]" : "w-[216px]"}`}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => { if (onMobileClose) onMobileClose(); else setCollapsed(c => !c); }}
          className="absolute -right-3 top-[18px] z-10 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/[.08] bg-white dark:bg-[#0b0d10] text-slate-600 hover:text-zinc-900 dark:hover:text-white transition-colors shadow-md"
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
                    : <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-500/20 text-[10px] font-semibold text-indigo-400">{workspaceInitial}</div>
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

        {/* Quick Action — frozen above the scroll area, always visible */}
        {!collapsed && (
          <div className="shrink-0 border-b border-white/[.05] px-2 py-2">
            <button
              onClick={() => window.dispatchEvent(new Event("mondaily:open-quick-actions"))}
              className="key-button flex w-full items-center gap-2 px-3 py-2 text-[12px]"
            >
              <Zap size={12} className="text-indigo-400 shrink-0"/>
              <span>Quick action</span>
              <Plus size={11} className="ml-auto text-slate-600"/>
            </button>
          </div>
        )}

        {/* Nav scroll — overscroll-none prevents the sidebar from dragging the page */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-none px-2 py-2 sidebar-scroll">

          {(() => {
            const FINANCE_ONLY = ["/finance/invoices", "/finance/credit-notes", "/finance/quotes", "/finance/expenses", "/finance/reports", "/approvals"];
            const filteredNAV = NAV.map(group => {
              if (group.label === "Revenue") {
                return { ...group, items: group.items.filter(item => hasFinance || !FINANCE_ONLY.includes(item.to)) };
              }
              return group;
            }).filter(group => group.items.length > 0);
            return collapsed
              ? filteredNAV.flatMap(g => g.items).map(item => (
                  <NavItem key={item.to} {...item} collapsed={true}
                    badge={item.to === "/notifications" ? unreadCount : undefined}/>
                ))
              : filteredNAV.map(group => (
                  <div key={group.label || "__top"}>
                    <SectionLabel label={group.label}/>
                    {group.items.map(item => (
                      <NavItem key={item.to} {...item} collapsed={false}
                        badge={item.to === "/notifications" ? unreadCount : undefined}/>
                    ))}
                  </div>
                ));
          })()}

          {!collapsed && (
            <>
              <SidebarObjects />
              <SidebarLists />
              <SidebarAsk />
            </>
          )}
        </nav>

        {/* Getting started card — sits above bottom bar, expands inside itself */}
        {!collapsed && <GettingStarted />}

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
                  className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold text-indigo-400 hover:bg-indigo-500/20 transition-colors whitespace-nowrap"
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
                className="flex-1 rounded-xl border-x border-t border-indigo-500/40 border-b-[3px] border-b-indigo-700 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
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

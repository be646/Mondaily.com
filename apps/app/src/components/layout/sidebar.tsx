import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone,
  Settings, Zap, ChevronLeft, ChevronRight, ChevronDown, LogOut, Users,
  ChevronsUpDown, Plus, X, Receipt, TrendingUp,
  GitBranch, Activity, Layers, Check, ReceiptText, ShieldCheck,
  FileSignature, Wallet, MessageCircle,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";
import { useClerk, useUser } from "@clerk/react";
import { SidebarObjects } from "./sidebar-records";
import { SidebarLists } from "./sidebar-lists";
import { SidebarAsk } from "./sidebar-ask";
import { AgentPulse } from "../ai/agent-constellation";

// ─── Primary nav — calm by design: 6 items max, always visible. Everything
// else lives in the collapsible "More" group below or behind command/search.
// "Finance" only appears here when the module is enabled — otherwise its
// slot is "Reports" so the main nav never shows a field-specific label for
// a module that isn't on. ──────────────────────────────────────────────────
function primaryNav(hasFinance: boolean): { to: string; label: string; icon: React.ElementType }[] {
  return [
    { to: "/home", label: "Home", icon: Home },
    { to: "/ask/new", label: "Ask", icon: MessageCircle },
    { to: "/search", label: "Graph", icon: GitBranch },
    { to: "/tasks", label: "Tasks", icon: CheckSquare },
    { to: "/automations", label: "Automations", icon: Activity },
    hasFinance
      ? { to: "/finance/invoices", label: "Finance", icon: Receipt }
      : { to: "/reports", label: "Reports", icon: BarChart2 },
  ];
}

// ─── Everything else — collapsed by default, reached via the "More" toggle
// or command/search (⌘K) instead of permanently occupying sidebar space.
const MORE_NAV: { label: string; items: { to: string; label: string; icon: React.ElementType }[] }[] = [
  {
    label: "Work",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/notes",  label: "Notes",  icon: FileText },
      { to: "/emails", label: "Emails", icon: Mail },
      { to: "/calls",  label: "Calls",  icon: Phone },
    ],
  },
  {
    label: "Finance & Reports",
    items: [
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
    // "Workflows"/"Sequences" used to be listed here too, but both pointed
    // at the same /automations route the primary nav already links to —
    // removed rather than showing three buttons for one destination.
    // Canvas is a real, distinct page, so it stays.
    label: "Automation",
    items: [
      { to: "/canvas", label: "Canvas", icon: Layers },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/status", label: "Status", icon: Activity },
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
    hint: "Add a person or company. This is the foundation of your workspace graph — every opportunity, email, and task connects back to a record.",
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
    label: "Create your first opportunity",
    hint: "Opportunities track relationships through stages on the graph — from first contact to closed won.",
    to: "/pipeline",
  },
  {
    id: "member",
    label: "Invite a team member",
    hint: "The graph gets smarter with more people on it. Invite a colleague so you can assign records, share opportunities, and collaborate on tasks.",
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
    hint: "Ask Mondaily anything about your data — 'which opportunities haven't moved in 2 weeks?' or 'summarise my week'. Your AI agent assistant.",
    to: "/ask/new",
  },
  {
    id: "apps",
    label: "Explore our apps",
    hint: "Connect Slack, Zapier, HubSpot, and more. Integrations keep Mondaily in sync with the tools your team already uses.",
    to: "/settings/integrations",
  },
];

// Exported so Home can render it (per design: Getting Started shouldn't
// permanently occupy sidebar space — it belongs near the work itself).
export function GettingStarted() {
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

  return (
    <div className="shrink-0 px-2 pb-1">
      <div className={open ? "rounded-xl overflow-hidden" : ""} style={open ? { background: "var(--surface-card)", border: "1px solid var(--border-soft)" } : undefined}>
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
                  <div className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${checked ? "opacity-35" : hovered ? "bg-zinc-100 dark:bg-white/[.06]" : ""}`}>
                    <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${checked ? "bg-indigo-500 border-indigo-500" : "border-indigo-500/30"}`}>
                      {checked && <Check size={7} className="text-white" strokeWidth={3.5}/>}
                    </div>
                    <Link to={item.to} onClick={() => setOpen(false)} className="flex-1 min-w-0">
                      <span className={`text-[11px] leading-tight ${checked ? "line-through text-zinc-400 dark:text-white/20" : "text-zinc-600 dark:text-white/55"}`}>
                        {item.label}
                      </span>
                    </Link>
                  </div>

                  {/* Tooltip — pops right */}
                  {hovered && !checked && (
                    <div className="absolute left-full top-0 z-[210] ml-2.5 w-56 pointer-events-none">
                      <div className="absolute -left-[7px] top-2.5 h-3 w-3 rotate-45 border-l border-t border-indigo-200 bg-white dark:border-indigo-500/20 dark:bg-[#1a1118]"/>
                      <div className="rounded-xl border border-indigo-200 bg-white px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.12)] dark:border-indigo-500/20 dark:bg-[#1a1118] dark:shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
                        <div className="text-[12px] font-semibold text-[#111827] dark:text-white mb-1.5">{item.label}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-white/40 leading-relaxed">{item.hint}</div>
                        <div className="mt-2.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">→ Go there</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Dismiss */}
            <div className="border-t border-indigo-500/10 mt-1 px-1 py-2 flex items-center justify-between">
              <span className="text-[10px] text-zinc-400 dark:text-white/20">Auto-detected · updates live</span>
              <button onClick={dismiss} className="text-[10px] font-semibold text-indigo-400/70 hover:text-indigo-600 dark:text-indigo-400/50 dark:hover:text-indigo-400 transition-colors">
                Mark all done
              </button>
            </div>
          </div>
        )}

        {/* Header — a quiet single line, same weight as a nav item, so it
            never competes visually with Home/Tasks/etc. above it. */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors surface-hover"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }}/>
          <span className="flex-1 text-left text-[11px]" style={{ color: "var(--text-faint)" }}>
            Getting started · {doneCount}/{total}
          </span>
          <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
        </button>

        {open && (
          <div className="mx-3 mb-2.5 mt-1 h-[3px] rounded-full bg-indigo-500/10 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }}/>
          </div>
        )}
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
        className={`mb-0.5 relative flex items-center justify-center rounded-md p-2 transition-colors ${active ? "text-neutral-950 dark:text-neutral-50" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"}`}
      >
        {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-neutral-950 dark:bg-neutral-50"/>}
        <Icon size={14}/>
        {!!badge && <span className="absolute top-0.5 right-0.5 h-3.5 min-w-[14px] rounded-full bg-indigo-500 px-1 text-[8px] font-bold text-white flex items-center justify-center leading-none">{badge > 9 ? "9+" : badge}</span>}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={`relative mb-px flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${active ? "font-medium text-neutral-950 dark:text-neutral-50" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"}`}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-neutral-950 dark:bg-neutral-50"/>}
      <Icon size={13} className={active ? "text-neutral-950 dark:text-neutral-50" : "text-neutral-400 dark:text-neutral-600"}/>
      {label}
      {!!badge && <span className="ml-auto h-4 min-w-[16px] rounded-full bg-indigo-500 px-1.5 text-[9px] font-bold text-white flex items-center justify-center leading-none">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  if (!label) return null;
  return (
    <div className="mb-1.5 mt-4 px-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] dark:text-slate-700">{label}</span>
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
        className={`relative flex h-full shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 ${collapsed ? "w-[52px]" : "w-[216px]"}`}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => { if (onMobileClose) onMobileClose(); else setCollapsed(c => !c); }}
          className="absolute -right-3 top-[18px] z-10 flex h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-500 dark:hover:text-neutral-50"
        >
          {onMobileClose ? <X size={10}/> : collapsed ? <ChevronRight size={10}/> : <ChevronLeft size={10}/>}
        </button>

        {/* Workspace header */}
        <div className="relative shrink-0 border-b border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => !collapsed && setWorkspaceOpen(o => !o)}
            className={`flex w-full items-center gap-2.5 px-3 py-3 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 ${collapsed ? "justify-center" : ""}`}
          >
            {workspaceLogo
              ? <img src={workspaceLogo} alt={workspaceName} className="h-6 w-6 rounded-md object-cover shrink-0"/>
              : <Logo size={24}/>
            }
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-[13px] font-semibold text-neutral-950 dark:text-neutral-50 leading-tight">{workspaceName}</div>
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-600">Pro workspace</div>
                </div>
                <ChevronsUpDown size={11} className="text-zinc-400 dark:text-slate-700 shrink-0"/>
              </>
            )}
          </button>

          {workspaceOpen && !collapsed && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)}/>
              <div className="dropdown-panel absolute left-2 right-2 top-full z-50">
                <div className="flex items-center gap-2.5 border-b border-zinc-100 dark:border-white/[.06] px-3 py-2.5">
                  {workspaceLogo
                    ? <img src={workspaceLogo} alt={workspaceName} className="h-5 w-5 rounded-md object-cover shrink-0"/>
                    : <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-100 dark:bg-indigo-500/20 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">{workspaceInitial}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[12px] font-medium text-[#18181b] dark:text-white">{workspaceName}</div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-600">Pro</div>
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
                <div className="mx-2 my-1 border-t border-zinc-100 dark:border-white/[.07]"/>
                <button onClick={() => { setWorkspaceOpen(false); signOut(() => navigate("/sign-in")); }} className="dropdown-item text-rose-600 hover:text-rose-700 dark:text-red-400 dark:hover:text-red-300">
                  <LogOut size={12}/> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Quick Action — frozen above the scroll area, always visible */}
        {!collapsed && (
          <div className="shrink-0 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
            <button
              onClick={() => window.dispatchEvent(new Event("mondaily:open-quick-actions"))}
              className="key-button flex w-full items-center gap-2 px-3 py-2 text-[12px]"
            >
              <Zap size={12} className="text-indigo-500 dark:text-indigo-400 shrink-0"/>
              <span>Quick action</span>
              <Plus size={11} className="ml-auto text-zinc-400 dark:text-slate-600"/>
            </button>
          </div>
        )}

        {/* Agent Dock — visible near the top, compact by default. */}
        <div className="shrink-0 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
          <AgentPulse collapsed={collapsed}/>
        </div>

        {/* Nav scroll — overscroll-none prevents the sidebar from dragging the page */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-none px-2 py-2 sidebar-scroll">

          {!collapsed && <GettingStarted />}

          {(() => {
            const primary = primaryNav(hasFinance);
            return collapsed
              ? primary.map(item => <NavItem key={item.to} {...item} collapsed={true}/>)
              : primary.map(item => <NavItem key={item.to} {...item} collapsed={false}/>);
          })()}

          {!collapsed && (() => {
            const FINANCE_ONLY = ["/finance/invoices", "/finance/credit-notes", "/finance/quotes", "/finance/expenses", "/finance/reports", "/approvals"];
            // Don't repeat whichever of Reports/Finance is already shown in
            // the primary nav above.
            const primaryTo = hasFinance ? "/finance/invoices" : "/reports";
            const filteredMore = MORE_NAV.map(group => ({
              ...group,
              items: group.items.filter(item => item.to !== primaryTo && (hasFinance || !FINANCE_ONLY.includes(item.to))),
            })).filter(group => group.items.length > 0);

            // Flat, always-visible — no "More" toggle to unfold. Each group
            // keeps its quiet section label so the list still reads as
            // organized, not just a long undifferentiated stack.
            return filteredMore.map(group => (
              <div key={group.label} className="mt-1">
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

        {/* Bottom bar */}
        <div className="shrink-0 border-t border-neutral-200 p-2.5 dark:border-neutral-800">
          {collapsed ? (
            <Link to="/settings/account" title="Settings"
              className="flex items-center justify-center rounded-lg p-2 text-zinc-400 hover:bg-[#f4f4f5] hover:text-zinc-700 dark:text-slate-600 dark:hover:bg-white/[.04] dark:hover:text-slate-300 transition-colors">
              <Settings size={14}/>
            </Link>
          ) : (
            <div className="overflow-hidden">
              {/* Trial row */}
              <div className="flex items-center justify-between border-b border-neutral-200 px-1 py-2 dark:border-neutral-800">
                <div>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Trial</span>
                  <span className="text-[11px] ml-1" style={{ color: "var(--text-faint)" }}>· 14 days left</span>
                </div>
                <Link
                  to="/settings/billing"
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap transition-colors"
                  style={{ color: "var(--accent)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-selected)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  Upgrade
                </Link>
              </div>

              {/* User row */}
              <Link to="/settings/account" title="Settings" className="flex items-center gap-2 rounded-md px-1 py-2 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900">
                {user?.imageUrl
                  ? <img src={user.imageUrl} className="h-5 w-5 rounded-full object-cover shrink-0" alt=""/>
                  : <div className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                      {user?.firstName?.[0]?.toUpperCase() || "?"}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[12px] leading-tight" style={{ color: "var(--text-primary)" }}>{user?.fullName || user?.firstName || "You"}</div>
                  <div className="truncate text-[10px]" style={{ color: "var(--text-faint)" }}>{user?.primaryEmailAddress?.emailAddress}</div>
                </div>
                <Settings size={12} style={{ color: "var(--text-faint)" }}/>
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Create workspace modal */}
      {newWorkspaceOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-[2px]" onClick={() => setNewWorkspaceOpen(false)}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_24px_48px_rgba(15,23,42,0.18)] dark:border-white/[.09] dark:bg-[#0d0f13] dark:shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111827] dark:text-white">Create workspace</span>
              <button onClick={() => setNewWorkspaceOpen(false)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:text-slate-500 dark:hover:bg-white/[.05] dark:hover:text-white transition-colors">
                <X size={13}/>
              </button>
            </div>
            <p className="mb-4 text-[11px] text-zinc-500 dark:text-zinc-600">Each workspace has its own contacts, deals, and settings.</p>
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
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-white/[.08] dark:text-slate-400 dark:hover:bg-white/[.04] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { if (newWsName.trim()) { alert(`Workspace "${newWsName}" will be created. Coming soon!`); setNewWorkspaceOpen(false); setNewWsName(""); } }}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 dark:hover:bg-indigo-500 transition-colors"
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

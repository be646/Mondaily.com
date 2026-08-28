import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2, Bell, CheckSquare, FileText, Home, Mail, Phone,
  Settings, Zap, ChevronLeft, ChevronRight, ChevronDown, LogOut, Users,
  ChevronsUpDown, Plus, X, Receipt, TrendingUp,
  GitBranch, Activity, Layers, Check, ReceiptText, ShieldCheck,
  FileSignature, Wallet, MessageCircle, Radar, Inbox, CalendarDays, LifeBuoy, LayoutGrid, Sparkles, Target, Crown,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSovereignAuthOptional } from "../auth/sovereign-auth-context";
import { useLanguage } from "../../hooks/useLanguage";
import { resolveDisplayName } from "@mondaily/shared/identity";
import { SidebarObjects } from "./sidebar-records";
import { SidebarLists } from "./sidebar-lists";
import { SidebarAsk } from "./sidebar-ask";

// ─── Core nav — the 7 always-visible surfaces. Monochrome; each row uses the shared nav-row
// token (no per-section tints). Everything else lives in the grouped sections below. ─────────
type NavEntry = { to: string; label: string; icon: React.ElementType; tint?: string };

/**
 * SIDEBAR INFORMATION ARCHITECTURE — grouped by INTENT, and nothing was removed.
 *
 * It used to be 9 flat core rows, a 3-row "Work", and a 9-row "Workspace" junk drawer where
 * Calendar sat between Notifications and Team Oversight, and two admin consoles lived mid-list.
 * Now: five flat everyday rows, then three collapsible intent groups —
 *   Workspace = the surfaces where YOU work (calendar, inbox, mail, calls, notes, canvas),
 *   AI        = the autonomous workforce (agents raise decisions, goals direct them,
 *               discovery hunts, automations execute),
 *   Analytics = how it's going (reports, insights, team) —
 * with Records/Finance/Lists keeping their own sections and the Owner Console pinned at the
 * bottom by the account area, where a control plane belongs.
 */
const CORE_NAV: NavEntry[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/briefing", label: "Brief", icon: Sparkles },
  { to: "/ask/new", label: "Ask", icon: MessageCircle },
  { to: "/search", label: "Graph", icon: GitBranch },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
];

// ─── Workspace — where you personally work: schedule, conversations, writing.
const WORKSPACE_NAV: NavEntry[] = [
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/messages", label: "Inbox", icon: Inbox },
  { to: "/emails", label: "Emails", icon: Mail },
  { to: "/calls",  label: "Calls",  icon: Phone },
  { to: "/notes",  label: "Notes",  icon: FileText },
  { to: "/canvas", label: "Canvas", icon: Layers },
];

// ─── AI — the autonomous workforce and its levers.
const AI_NAV: NavEntry[] = [
  { to: "/activity", label: "Agents", icon: Zap },
  { to: "/decisions", label: "Decisions", icon: ShieldCheck },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/discovery", label: "Discovery", icon: Radar },
  { to: "/automations", label: "Automations", icon: Activity },
];

// ─── Analytics — how the business and the team are doing.
const ANALYTICS_NAV: NavEntry[] = [
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/insights", label: "Insights", icon: LayoutGrid },
  { to: "/team/oversight", label: "Team Oversight", icon: Users },
];

// Owner Console — pinned at the sidebar's bottom next to account/settings, where a control plane
// belongs. The API route is requireAdminRole; a member who opens it gets the 403 error state, same
// policy as /admin readiness. Hiding it per-role client-side is cosmetics, not access.
const CONSOLE_ENTRY: NavEntry = { to: "/console", label: "Owner Console", icon: Crown };

// ─── Finance — merged into ONE entry: the /finance tab shell carries Invoices, Quotes,
// Credit notes, Expenses, Reports and Approvals as tabs with live counts. Six sidebar links
// became one; nothing was removed — the surfaces moved behind the strip.
const FINANCE_NAV: NavEntry[] = [
  { to: "/finance/invoices", label: "Finance", icon: Receipt, tint: "#a3946b" },
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

  // Guided first action: when onboarding just finished it sets mondaily_first_run, so the
  // checklist auto-opens once instead of dropping the operator into a cold empty workspace.
  useEffect(() => {
    if (localStorage.getItem("mondaily_first_run")) {
      localStorage.removeItem("mondaily_first_run");
      const t = setTimeout(() => setOpen(true), 700);
      return () => clearTimeout(t);
    }
  }, []);

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

  // Floating, dismissible — it's a temporary aid for new users, so it lives as a
  // FAB at the bottom-right of the app rather than taking permanent sidebar space.
  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col items-end">
      {open && (
        <div className="mb-3 w-72 overflow-hidden rounded-sm border shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)]" style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Getting started</span>
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{doneCount}/{total} done</span>
          </div>
          <div className="mx-4 mb-1 h-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
            <div className="h-full rounded-full bg-stone-950 transition-all duration-500 dark:bg-stone-50" style={{ width: `${pct}%` }}/>
          </div>
          <div className="max-h-[300px] space-y-px overflow-y-auto px-2 py-2 sidebar-scroll">
            {CHECKLIST.map(item => {
              const checked = done.has(item.id);
              const hovered = hoverId === item.id;
              return (
                <div key={item.id} className="relative" onMouseEnter={() => setHoverId(item.id)} onMouseLeave={() => setHoverId(null)}>
                  <div className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${checked ? "opacity-35" : hovered ? "bg-stone-100 dark:bg-[var(--surface-hover)]" : ""}`}>
                    <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${checked ? "bg-stone-950 border-stone-950 dark:bg-stone-50 dark:border-stone-50" : "border-stone-300 dark:border-stone-800"}`}>
                      {checked && <Check size={7} className="text-[var(--text-primary)] dark:text-black" strokeWidth={3.5}/>}
                    </div>
                    <Link to={item.to} onClick={() => setOpen(false)} className="flex-1 min-w-0">
                      <span className={`text-[12px] leading-tight ${checked ? "line-through text-[var(--text-secondary)]" : "text-[var(--text-faint)] dark:text-[var(--text-secondary)]"}`}>{item.label}</span>
                    </Link>
                  </div>
                  {/* Tooltip — pops left (FAB is on the right edge) */}
                  {hovered && !checked && (
                    <div className="absolute right-full top-0 z-[210] mr-2.5 w-56 pointer-events-none">
                      <div className="rounded-sm border border-stone-200 bg-white px-3 py-3 dark:border-stone-800 dark:bg-black">
                        <div className="text-[12px] font-semibold text-[#111827] dark:text-[var(--text-primary)] mb-1.5">{item.label}</div>
                        <div className="text-[11px] text-[var(--text-muted)] dark:text-[var(--text-secondary)] leading-relaxed">{item.hint}</div>
                        <div className="mt-2.5 text-[10px] font-semibold text-stone-950 dark:text-[var(--text-primary)]">→ Go there</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>Auto-detected · updates live</span>
            <button onClick={dismiss} className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-stone-950 dark:text-[var(--text-faint)] dark:hover:text-[var(--text-primary)] transition-colors">Dismiss</button>
          </div>
        </div>
      )}

      {/* The floating button — a progress ring + label */}
      <button
        onClick={() => setOpen(o => !o)}
        className="group flex items-center gap-2.5 rounded-full border px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-0.5"
        style={{ background: "var(--surface-card)", borderColor: "var(--border-soft)" }}
      >
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--surface-hover) ${pct}%)` }}>
          <span className="absolute inset-[3px] rounded-full" style={{ background: "var(--surface-card)" }}/>
          <span className="relative text-[8px] font-bold" style={{ color: "var(--text-secondary)" }}>{doneCount}</span>
        </span>
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Getting started</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "" : "rotate-180"}`} style={{ color: "var(--text-faint)" }}/>
      </button>
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
      className="relative overflow-hidden bg-black border border-[var(--border-soft)] shrink-0"
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

// English nav/section label → translation key. Routes/paths are NEVER translated — only the visible
// label text. Unmapped labels fall back to their English string unchanged.
const NAV_TKEY: Record<string, string> = {
  Home: "nav.home", Ask: "nav.ask", Graph: "nav.graph", Tasks: "nav.tasks", Decisions: "nav.decisions",
  Agents: "nav.agents", Discovery: "nav.discovery", Automations: "nav.automations", Reports: "nav.reports",
  Notifications: "nav.notifications", Inbox: "nav.inbox", Notes: "nav.notes", Emails: "nav.emails",
  Calls: "nav.calls", Canvas: "nav.canvas", Calendar: "nav.calendar", "Team Oversight": "nav.team_oversight",
  Work: "section.work", Workspace: "section.workspace", Finance: "section.finance",
  AI: "section.ai", Analytics: "section.analytics",
};
/** Localize a known nav/section label; return the original for anything unmapped. */
function useNavLabel(label: string): string {
  const { t } = useLanguage();
  return NAV_TKEY[label] ? t(NAV_TKEY[label]) : label;
}

// ─── Single nav item ──────────────────────────────────────────────────────────
function NavItem({
  to, label: rawLabel, icon: Icon, collapsed, badge,
}: { to: string; label: string; icon: React.ElementType; collapsed: boolean; badge?: number; tint?: string }) {
  const label = useNavLabel(rawLabel);
  const location = useLocation();
  const active = location.pathname.startsWith(to);
  // Monochrome by design: ONE active indicator (accent bar + primary text/icon). Inactive rows are
  // calm neutral tokens; hover lifts to the shared surface. No per-section tints, no mixed stone/hex.
  const iconColor = active ? "var(--text-primary)" : "var(--text-muted)";
  const badgeEl = !!badge && (
    <span
      className={collapsed
        ? "absolute top-0.5 right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-bold leading-none"
        : "ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full px-1.5 text-[9px] font-bold leading-none"}
      style={{ background: "var(--section-accent)", color: "var(--surface-page)" }}>
      {badge > 99 ? "99+" : badge > 9 && collapsed ? "9+" : badge}
    </span>
  );

  if (collapsed) {
    return (
      <Link
        to={to} title={label}
        className={`mb-0.5 relative flex items-center justify-center rounded-md p-2 transition-colors ${active ? "" : "hover:bg-[var(--surface-hover)]"}`}
        style={{ background: active ? "var(--surface-hover)" : undefined }}
      >
        {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full" style={{ background: "var(--section-accent)" }}/>}
        <Icon size={16} style={{ color: iconColor }}/>
        {badgeEl}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={`nav-row relative mb-px flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] transition-colors ${active ? "font-medium" : "hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`}
      style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)", background: active ? "var(--surface-hover)" : undefined }}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full" style={{ background: "var(--section-accent)" }}/>}
      <Icon size={16} style={{ color: iconColor }}/>
      {label}
      {badgeEl}
    </Link>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  const localized = useNavLabel(label);
  if (!label) return null;
  return (
    <div className="mb-1.5 mt-4 px-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af] dark:text-[var(--text-faint)]">{localized}</span>
    </div>
  );
}

// ─── Collapsible nav group ────────────────────────────────────────────────────
// Secondary nav groups collapse by default so the sidebar isn't one long scroll.
// Each group remembers its open/closed state, and auto-opens when the current
// route lives inside it.
function NavGroup({ label, items, unreadCount, defaultOpen = true }: {
  label: string;
  items: NavEntry[];
  unreadCount: number;
  defaultOpen?: boolean;
}) {
  const location = useLocation();
  const groupLabel = useNavLabel(label);
  const hasActive = items.some(i => location.pathname.startsWith(i.to));
  const storeKey = `sb_group_${label}`;
  // Consistent with the other sidebar sections: open by default, and remembers
  // if you choose to collapse it.
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(storeKey);
    return saved === null ? defaultOpen : saved === "1";
  });
  useEffect(() => { if (hasActive) setOpen(true); }, [hasActive]);
  const toggle = () => setOpen(o => { localStorage.setItem(storeKey, o ? "0" : "1"); return !o; });
  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
      >
        <span className="flex-1 text-left text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>{groupLabel}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
      </button>
      {open && items.map(item => (
        <NavItem key={item.to} {...item} collapsed={false}
          badge={item.to === "/notifications" ? unreadCount : undefined}/>
      ))}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({ onMobileClose }: { onMobileClose?: () => void } = {}) {
  // Platform-admin capability probe (Mondaily operators). false/error → link simply doesn't render.
  const platformAdmin = useQuery<{ platform_admin: boolean }>({
    queryKey: ["platform-admin-probe"],
    queryFn: () => apiClient.get("/platform/support/me"),
    staleTime: 5 * 60_000, retry: false,
  }).data?.platform_admin === true;
  const navigate = useNavigate();
  const me = useCurrentUser(); // unified (sovereign) identity for profile display
  const sov = useSovereignAuthOptional();

  // Native sign-out: clear the cookie session + local workspace, return to login.
  async function handleSignOut() {
    setWorkspaceOpen(false);
    await sov?.logout();
    localStorage.removeItem("mondaily_workspace_id");
    navigate("/auth/shadow-login");
  }
  const { hasFinance } = useModules();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [wsError, setWsError] = useState("");

  // Actually create a workspace (was a "coming soon" stub). On success, switch
  // to it and hard-reload so AuthGate re-bootstraps against the new workspace.
  // Errors render inline in the modal — no blocking browser alert banner.
  async function createWorkspace() {
    const name = newWsName.trim();
    if (!name || creatingWs) return;
    setCreatingWs(true); setWsError("");
    try {
      const res = await apiClient.post<{ workspace_id?: string }>("/workspaces", { name });
      if (res?.workspace_id) {
        // Remember the workspace we're leaving so onboarding can offer "cancel & go back".
        const prev = localStorage.getItem("mondaily_workspace_id");
        if (prev) localStorage.setItem("mondaily_prev_workspace_id", prev);
        localStorage.setItem("mondaily_workspace_id", res.workspace_id);
        localStorage.setItem("mondaily_needs_onboarding", "1");
        window.location.href = "/onboarding"; // unified terminal console (legacy step wizard removed)
        return;
      }
      setWsError("Could not create the workspace. Please try again.");
    } catch {
      setWsError("Could not create the workspace. Please try again.");
    } finally {
      setCreatingWs(false);
    }
  }

  // Workspace title from our own Postgres (workspace settings) — not Clerk's organization.
  const { data: wsSettings, isLoading: wsLoading } = useQuery<{ name?: string; logo_url?: string | null }>({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<{ name?: string; logo_url?: string | null }>("/settings/workspace"),
    staleTime: 300_000,
  });
  // Never fall back to the MEMBER's name — that caused the "Bassem's Workspace" → "Mondaily" flash on
  // load. While the workspace name is still loading we render a skeleton (below) instead of a guess.
  const workspaceName    = wsSettings?.name ?? (wsLoading ? "" : "My Workspace");
  const workspaceLogo: string | null = wsSettings?.logo_url ?? null;
  const workspaceInitial = workspaceName[0]?.toUpperCase() || "M";

  // Every workspace this user belongs to — powers the switcher in the workspace dropdown.
  const activeWorkspaceId = typeof localStorage !== "undefined" ? localStorage.getItem("mondaily_workspace_id") : null;
  const { data: myWorkspaces = [] } = useQuery<{ workspace_id: string; name: string; role: string }[]>({
    queryKey: ["my-workspaces"],
    queryFn: async () => (await apiClient.get<{ workspaces?: { workspace_id: string; name: string; role: string }[] }>("/workspaces/mine")).workspaces ?? [],
    staleTime: 300_000,
  });
  function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) { setWorkspaceOpen(false); return; }
    localStorage.setItem("mondaily_workspace_id", id);
    window.location.assign("/"); // hard reload so every query refetches against the new workspace
  }

  const { data: notifications = [] } = useQuery<{ read_at: string | null }[]>({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unreadCount = notifications.filter(n => !n.read_at).length;

  // AI credit wallet — sidebar telemetry. SAME /credits/balance source as the Billing page, so the
  // two can never disagree. The meter denominator is the included monthly allotment (+ purchased),
  // never the raw ledger grant-row sum (which caused the stale "0 / 50,000" line).
  const { data: wallet } = useQuery<{ enrolled: boolean; remaining: number; included_monthly: number | null; purchased: number; used: number; capacity: number; account_tier: string; trial_ends_at: string | null; low?: boolean; exhausted?: boolean; burst?: { used: number; cap: number; limited: boolean; resets_at: string | null } }>({
    queryKey: ["credits-balance"],
    queryFn: () => apiClient.get("/credits/balance"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const TIER_LABEL: Record<string, string> = { scout: "Scout", operator: "Operator", command: "Command", sovereign: "Sovereign", business: "Operator", personal: "Scout", free: "Scout", trial: "Operator" };
  const tierLabel = TIER_LABEL[wallet?.account_tier ?? ""] ?? "Scout";
  const trialDaysLeft = wallet?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(wallet.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;
  // Denominator: included monthly + purchased, but NEVER lower than remaining (requirement 4 — no
  // "984k / 550k" impossible ratio if the entitlement is briefly inconsistent).
  const walletCapacity = wallet ? Math.max(wallet.remaining, wallet.capacity || (wallet.included_monthly ?? 0) + (wallet.purchased ?? 0)) : 0;
  const walletPct = wallet && walletCapacity > 0 ? Math.max(0, Math.min(100, Math.round((wallet.remaining / walletCapacity) * 100))) : 0;

  return (
    <>
      <aside
        style={{ transition: "width 0.2s ease" }}
        className={`relative flex h-full shrink-0 flex-col border-r border-stone-200 bg-white text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-[var(--text-primary)] ${collapsed ? "w-[56px] min-w-[56px]" : "w-64 min-w-[16rem]"}`}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => { if (onMobileClose) onMobileClose(); else setCollapsed(c => !c); }}
          className="absolute -right-3 top-[18px] z-10 flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white text-[var(--text-muted)] shadow-sm transition-colors hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-[var(--text-muted)] dark:hover:text-[var(--text-primary)]"
        >
          {onMobileClose ? <X size={10}/> : collapsed ? <ChevronRight size={10}/> : <ChevronLeft size={10}/>}
        </button>

        {/* Workspace header */}
        <div className="relative shrink-0 border-b border-stone-200 dark:border-stone-800">
          <button
            onClick={() => !collapsed && setWorkspaceOpen(o => !o)}
            className={`flex w-full items-center gap-2.5 px-3 py-3 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900 ${collapsed ? "justify-center" : ""}`}
          >
            {workspaceLogo
              ? <img src={workspaceLogo} alt={workspaceName} className="h-7 w-7 rounded-md object-cover shrink-0"/>
              : <Logo size={28}/>
            }
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  {workspaceName
                    ? <div className="truncate text-[14px] font-semibold text-stone-950 dark:text-[var(--text-primary)] leading-tight">{workspaceName}</div>
                    : <div className="h-3.5 w-24 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />}
                  <div className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-faint)]">{tierLabel} workspace</div>
                </div>
                <ChevronsUpDown size={12} className="text-[var(--text-secondary)] dark:text-[var(--text-faint)] shrink-0"/>
              </>
            )}
          </button>

          {workspaceOpen && !collapsed && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)}/>
              <div className="dropdown-panel absolute left-2 right-2 top-full z-50">
                <div className="flex items-center gap-2.5 border-b border-stone-100 dark:border-[var(--border-soft)] px-3 py-2.5">
                  {workspaceLogo
                    ? <img src={workspaceLogo} alt={workspaceName} className="h-5 w-5 rounded-md object-cover shrink-0"/>
                    : <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-stone-100 dark:bg-stone-900 text-[10px] font-semibold text-stone-950 dark:text-[var(--text-primary)]">{workspaceInitial}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[12px] font-medium text-[#18181b] dark:text-[var(--text-primary)]">{workspaceName}</div>
                    <div className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-faint)]">{tierLabel}</div>
                  </div>
                  <div className="h-1.5 w-1.5 rounded-full bg-[#2f9e6b] shrink-0"/>
                </div>
                {/* Switch between the workspaces this user belongs to */}
                {myWorkspaces.filter(w => w.workspace_id !== activeWorkspaceId).length > 0 && (
                  <div className="border-b border-stone-100 py-1 dark:border-[var(--border-soft)]">
                    <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--text-secondary)] dark:text-[var(--text-faint)]">Switch workspace</div>
                    {myWorkspaces.filter(w => w.workspace_id !== activeWorkspaceId).map(w => (
                      <button key={w.workspace_id} onClick={() => switchWorkspace(w.workspace_id)} className="dropdown-item">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-stone-100 text-[9px] font-semibold text-stone-950 dark:bg-stone-900 dark:text-[var(--text-primary)]">{(w.name || "?")[0]?.toUpperCase()}</span>
                        <span className="flex-1 truncate text-left">{w.name || "Untitled workspace"}</span>
                        <span className="text-[9px] uppercase text-[var(--text-secondary)] dark:text-[var(--text-faint)]">{w.role}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setWorkspaceOpen(false); setNewWorkspaceOpen(true); }} className="dropdown-item">
                  <Plus size={12}/> Create workspace
                </button>
                <Link to="/settings/members" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Users size={12}/> Invite members
                </Link>
                <Link to="/settings/workspace" onClick={() => setWorkspaceOpen(false)} className="dropdown-item">
                  <Settings size={12}/> Workspace settings
                </Link>
                <div className="mx-2 my-1 border-t border-stone-100 dark:border-[var(--border-soft)]"/>
                <button onClick={handleSignOut} className="dropdown-item text-[#d1524a] hover:text-[#d1524a] dark:text-[#d1524a] dark:hover:text-[#d1524a]">
                  <LogOut size={12}/> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav scroll — overscroll-none prevents the sidebar from dragging the page.
            Quick Action + the permanent AI-agents dot block were removed for a calmer sidebar;
            quick actions live behind the command palette, and agents have their own "Agents" row. */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-none px-2 py-2 sidebar-scroll">

          {/* Core — the everyday five, always flat, always visible */}
          {CORE_NAV.map(item => <NavItem key={item.to} {...item} collapsed={collapsed}/>)}

          {collapsed ? (
            <>
              {/* Icon rail keeps EVERY destination reachable, in group order */}
              {[...WORKSPACE_NAV, ...AI_NAV, ...ANALYTICS_NAV].map(item => (
                <NavItem key={item.to} {...item} collapsed={true}
                  badge={item.to === "/notifications" ? unreadCount : undefined}/>
              ))}
              <NavItem {...CONSOLE_ENTRY} collapsed={true}/>
            </>
          ) : (
            <>
              {/* Workspace — where you personally work */}
              <NavGroup label="Workspace" items={WORKSPACE_NAV} unreadCount={unreadCount}/>

              {/* AI — the autonomous workforce */}
              <NavGroup label="AI" items={AI_NAV} unreadCount={unreadCount}/>

              {/* Analytics — closed by default: consulted, not lived in */}
              <NavGroup label="Analytics" items={ANALYTICS_NAV} unreadCount={unreadCount} defaultOpen={false}/>

              {/* Records + Finance — the data itself (Records keeps its own collapsible section) */}
              <SidebarObjects />
              {hasFinance && FINANCE_NAV.map(item => <NavItem key={item.to} {...item} collapsed={false}/>)}

              {/* Recent — lists + chat history, collapsed sections that look like the rest of the nav */}
              <SidebarLists />
              <SidebarAsk />

              {/* Control planes — pinned last: consoles are visited, not lived in */}
              <div className="mt-3 border-t border-stone-200 pt-2 dark:border-stone-800">
                <NavItem {...CONSOLE_ENTRY} collapsed={false}/>
                {/* Mondaily-internal — only for PLATFORM_ADMIN_EMAILS operators (capability probe;
                    the API is hard-gated server-side regardless of what renders here). */}
                {platformAdmin && <NavItem to="/platform/support" label="Platform Support" icon={LifeBuoy} collapsed={false}/>}
              </div>
            </>
          )}
        </nav>

        {/* Bottom bar — no top border here; the line lives on the user banner
            below the trial, so nothing shows above/behind the trial layer. */}
        <div className="shrink-0">
          {collapsed ? (
            <div className="p-2.5 border-t border-stone-200 dark:border-stone-800">
              <Link to="/settings/account" title="Settings"
                className="flex items-center justify-center rounded-lg p-2 text-[var(--text-muted)] hover:bg-stone-100 hover:text-stone-950 dark:text-[var(--text-muted)] dark:hover:bg-stone-900 dark:hover:text-[var(--text-primary)] transition-colors">
                <Settings size={14}/>
              </Link>
            </div>
          ) : (
            <div className="px-2 pt-2 pb-2 space-y-1.5">
              {/* Trial + Upgrade — SINGLE source of truth: real days left from wallet.trial_ends_at,
                  shown only during an active trial. Upgrade → billing plans. */}
              {trialDaysLeft != null && (
                <Link
                  to="/settings/billing"
                  className="flex items-center justify-between rounded-sm px-3 py-2 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
                  style={{ background: "var(--surface-card)", border: "1px solid var(--border-soft)" }}
                >
                  <span className="text-[11.5px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    Trial <span className="font-normal" style={{ color: "var(--text-faint)" }}>· {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left</span>
                  </span>
                  <span className="rounded-sm border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--accent)" }}>Upgrade</span>
                </Link>
              )}

              {/* Compact credits line (text only, no meter) + user row. Sign out lives in the
                  workspace menu above, not as a noisy visible row. */}
              <div className="-mx-2 border-t px-3 py-1" style={{ borderColor: "var(--border-soft)", background: "var(--surface-page)" }}>
                {wallet?.enrolled && (
                  <Link to="/settings/billing" className="flex items-center justify-between px-1.5 pt-1.5 text-[10.5px] tabular-nums" title="Credits & billing">
                    <span style={{ color: "var(--text-faint)" }}>
                      <span style={{ color: wallet.exhausted ? "#d1524a" : "var(--text-secondary)" }}>{wallet.remaining.toLocaleString()}</span> / {walletCapacity.toLocaleString()} AI credits
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: walletPct <= 10 ? "#d1524a" : "var(--text-faint)" }}>
                      {tierLabel}
                    </span>
                  </Link>
                )}
                <Link to="/settings/account" title="Account settings" className="flex items-center gap-2 rounded-lg px-1.5 py-2 transition-colors hover:bg-[var(--surface-hover)]">
                  {me.imageUrl
                    ? <img src={me.imageUrl} className="h-6 w-6 rounded-full object-cover shrink-0" alt=""/>
                    : <div className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                        {(me.name || me.email)?.[0]?.toUpperCase() || "?"}
                      </div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[13px] leading-tight" style={{ color: "var(--text-primary)" }}>{resolveDisplayName(me)}</div>
                    <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{me.email}</div>
                  </div>
                  <Settings size={13} style={{ color: "var(--text-faint)" }}/>
                </Link>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Create workspace modal */}
      {newWorkspaceOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-[2px]" onClick={() => setNewWorkspaceOpen(false)}/>
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-stone-200 bg-white p-6 shadow-[0_24px_48px_rgba(15,23,42,0.18)] dark:border-[var(--border-soft)] dark:bg-[var(--surface-card)] dark:">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111827] dark:text-[var(--text-primary)]">Create workspace</span>
              <button onClick={() => setNewWorkspaceOpen(false)} className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-stone-100 hover:text-stone-900 dark:text-[var(--text-muted)] dark:hover:bg-[var(--surface-hover)] dark:hover:text-[var(--text-primary)] transition-colors">
                <X size={13}/>
              </button>
            </div>
            <p className="mb-4 text-[11px] text-[var(--text-muted)] dark:text-[var(--text-faint)]">Each workspace has its own contacts, deals, and settings.</p>
            <input
              value={newWsName}
              onChange={e => setNewWsName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createWorkspace(); }}
              placeholder="e.g. Acme Corp, Personal…"
              className="key-input w-full mb-2"
            />
            {wsError && <p className="mb-3 text-[11px] text-[#d1524a]">{wsError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setNewWorkspaceOpen(false); setNewWsName(""); }}
                className="flex-1 rounded-sm border border-stone-200 px-4 py-2 text-xs text-[var(--text-muted)] hover:bg-stone-100 dark:border-[var(--border-soft)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--surface-hover)] transition-colors">
                Cancel
              </button>
              <button
                onClick={createWorkspace}
                disabled={creatingWs || !newWsName.trim()}
                className="flex-1 rounded-sm bg-stone-950 px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black transition-opacity"
              >
                {creatingWs ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

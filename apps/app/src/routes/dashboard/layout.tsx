import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { Sidebar, GettingStarted } from "../../components/layout/sidebar";
import { AgentStatusBar } from "../../components/ai/agent-status";
import { QuickActions } from "../../components/ui/quick-actions";
import { CommandPalette } from "../../components/ui/command-palette";
import { ToastHost } from "../../components/ui/toast-host";
import { ErrorBoundary } from "../../components/ui/error-boundary";
import { CallHost } from "../../components/calls/call-host";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { sectionHue } from "../../lib/sections";
import { agentForRoute } from "../../lib/agents";
import { VerifyEmailBanner } from "../../components/ui/verify-email-banner";
import { PendingPlanBanner } from "../../components/ui/pending-plan-banner";
import { BillingAlertBanner } from "../../components/ui/billing-alert-banner";
import { useLanguage } from "../../hooks/useLanguage";
import { HelpProvider } from "../../components/help/help-panel";
import { DialogProvider } from "../../components/ui/dialog-service";
import {
  Home, CheckSquare, Users, MessageCircle, Menu, Search,
  FileText, Bell, BarChart2, Zap, Phone, Mail, Settings,
  List, Building2, TrendingUp, Activity, ShieldCheck, Radar, type LucideIcon,
} from "lucide-react";

// ─── Page icon + label derived from current path ─────────────────────────────
type PageMeta = { label: string; Icon: LucideIcon; color: string };

function getPageMeta(pathname: string): PageMeta {
  if (/^\/objects\//.test(pathname)) {
    const seg = pathname.split("/objects/")[1]?.split("/")[0] ?? "";
    const label = seg.replace(/[-_]/g, " ");
    const icon: Record<string, LucideIcon> = { people: Users, companies: Building2, deals: TrendingUp };
    return { label, Icon: icon[seg] ?? List, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" };
  }
  // Ordered: more specific prefixes must precede shorter ones (startsWith matching).
  const map: [string, PageMeta][] = [
    ["/home",          { label: "Home",          Icon: Home,        color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/briefing",      { label: "Daily Brief",    Icon: FileText,    color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/goals",         { label: "Goals",          Icon: TrendingUp,  color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/insights",      { label: "Insights",       Icon: BarChart2,   color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/calendar",      { label: "Calendar",       Icon: CheckSquare, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/messages",      { label: "Inbox",          Icon: MessageCircle, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/canvas",        { label: "Canvas",         Icon: List,        color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/pipeline",      { label: "Pipeline",       Icon: TrendingUp,  color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance/invoices",     { label: "Invoices",     Icon: FileText, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance/quotes",       { label: "Quotes",       Icon: FileText, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance/credit-notes", { label: "Credit notes", Icon: FileText, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance/expenses",     { label: "Expenses",     Icon: FileText, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance/reports",      { label: "Finance reports", Icon: BarChart2, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/finance",       { label: "Finance",        Icon: FileText,    color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/approvals",     { label: "Approvals",      Icon: ShieldCheck, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/console",       { label: "Owner Console",  Icon: ShieldCheck, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/status",        { label: "Readiness",      Icon: Activity,    color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/tasks",         { label: "Tasks",          Icon: CheckSquare, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/notes",         { label: "Notes",          Icon: FileText,    color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/notifications", { label: "Notifications",  Icon: Bell,        color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/reports",       { label: "Reports",        Icon: BarChart2,   color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/automations",   { label: "Automations",    Icon: Zap,         color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/decisions",     { label: "Decisions",      Icon: ShieldCheck, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/discovery",     { label: "Discovery",      Icon: Radar,       color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/activity",      { label: "Agent Activity", Icon: Zap,         color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/team/oversight",{ label: "Team Oversight", Icon: Users,       color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/calls",         { label: "Calls",          Icon: Phone,       color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/emails",        { label: "Emails",         Icon: Mail,        color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/lists",         { label: "Lists",          Icon: List,        color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/settings",      { label: "Settings",       Icon: Settings,    color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/ask",           { label: "Ask AI",         Icon: MessageCircle, color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
    ["/search",        { label: "Search",         Icon: Search,      color: "text-[var(--text-muted)] dark:text-[var(--text-secondary)]" }],
  ];
  for (const [prefix, meta] of map) {
    if (pathname.startsWith(prefix)) return meta;
  }
  return { label: "Mondaily", Icon: Home, color: "text-[var(--text-secondary)]" };
}

function MobileNav() {
  const location = useLocation();
  const tabs = [
    { to: "/home", icon: Home, label: "Home" },
    { to: "/tasks", icon: CheckSquare, label: "Tasks" },
    { to: "/objects/people", icon: Users, label: "People" },
    { to: "/ask/new", icon: MessageCircle, label: "Ask AI" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t px-2 pb-safe md:hidden" style={{ borderColor: "var(--border-soft)", background: "var(--surface-sidebar)" }}>
      <div className="flex items-center justify-around py-1">
        {tabs.map(({ to, icon: Icon, label }) => {
          const active = location.pathname.startsWith(to.split("/").slice(0, 2).join("/"));
          return (
            <Link
              key={to}
              to={to}
              className="flex min-w-[64px] flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                color: active ? "var(--text-primary)" : "var(--text-faint)",
                background: active ? "var(--surface-selected)" : undefined,
              }}
            >
              <Icon size={20}/>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Minimal always-works nav shown if the full Sidebar throws — keeps the app usable (never black).
function SidebarFallback() {
  const links: [string, string][] = [["/home", "Home"], ["/search", "Graph"], ["/tasks", "Tasks"], ["/discovery", "Discovery"], ["/settings/members", "Settings"]];
  return (
    <nav className="flex h-full w-56 flex-col gap-1 border-r p-3" style={{ borderColor: "var(--border-soft)" }}>
      <div className="px-2 py-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Mondaily</div>
      {links.map(([to, label]) => (
        <Link key={to} to={to} className="rounded-lg px-2 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-900" style={{ color: "var(--text-secondary)" }}>{label}</Link>
      ))}
      <button onClick={() => window.location.reload()} className="mt-auto rounded-lg px-2 py-1.5 text-left text-xs" style={{ color: "var(--text-faint)" }}>Reload</button>
    </nav>
  );
}

function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onClose}/>
      <div className="fixed left-0 top-0 bottom-0 z-50 w-72 overflow-auto bg-white dark:bg-[var(--surface-page)] md:hidden">
        <Sidebar onMobileClose={onClose} />
      </div>
    </>
  );
}

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useLanguage();   // keep <html lang/dir> in sync with the effective language (RTL foundation)

  // Route-level FALLBACK for the browser tab title. Child effects run before parent effects, so a
  // page's CommandPageHeader has already titled the tab (and claimed the path) by the time this
  // fires — overwriting it here would replace "Meeting with Anna" with "Calls", which is exactly
  // what the first version did. Only pages that did NOT title themselves get the route label.
  useEffect(() => {
    const claimed = (window as unknown as { __mdTitledPath?: string }).__mdTitledPath;
    if (claimed === location.pathname) return;   // a page header owns this page's title
    const { label } = getPageMeta(location.pathname);
    // Object pages derive their label from the slug ("discovered leads") — sentence-case it.
    const nice = label.charAt(0).toUpperCase() + label.slice(1);
    document.title = nice === "Mondaily" ? "Mondaily" : `${nice} · Mondaily`;
  }, [location.pathname]);

  const { data: wsSettings } = useQuery<{ onboarded?: boolean; member_count?: number }>({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get("/settings/workspace"),
    staleTime: 300_000,
  });

  useEffect(() => {
    // Only redirect to onboarding for genuinely new workspaces (onboarded=false
    // AND only 1 member — the owner). This prevents existing workspaces from
    // being redirected after the onboarded column was added with DEFAULT false.
    if (wsSettings && wsSettings.onboarded === false && (wsSettings.member_count ?? 2) <= 1) {
      navigate("/onboarding", { replace: true });
    }
  }, [wsSettings, navigate]);

  const { label: pageLabel, Icon: PageIcon } = getPageMeta(location.pathname);
  const sectionAgent = agentForRoute(location.pathname); // which agent operates this section

  // Spreadsheet grid routes own their scroll via internal flex — keep main overflow-hidden.
  // All other routes need native vertical scrolling.
  const isGrid = /^\/objects\/[^/]+$/.test(location.pathname);

  return (
   <HelpProvider>
    <DialogProvider>
    {/* Dual-font: the shell defaults to Geist Sans (UI/structure); data/AI surfaces opt into font-mono. */}
    <div className="flex h-screen w-screen overflow-hidden surface-page">
      {/* Change toasts — slide-in pop-ups for new notifications/activity */}
      <ToastHost />
      {/* Desktop sidebar — wrapped so a sidebar render error can never black-screen the whole app
          (it lives outside the page ErrorBoundary below). Falls back to a minimal nav on failure. */}
      <div className="hidden md:flex">
        <ErrorBoundary fallback={<SidebarFallback />}>
          <Sidebar />
        </ErrorBoundary>
      </div>

      {/* Mobile sidebar drawer */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}/>

      <div className="section-soul app-content-shell flex min-w-0 flex-1 flex-col" style={{ "--section-hue": sectionHue(location.pathname) } as React.CSSProperties}>
        {/* Top bar — logo · page label · actions slot · AI/user buttons */}
        <AgentStatusBar leftSlot={
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-7 w-7 items-center justify-center text-[var(--text-secondary)] md:hidden shrink-0"
            >
              <Menu size={16}/>
            </button>
            <PageIcon size={16} className="shrink-0" style={{ color: "var(--section-accent)" }}/>
            <span className="hidden select-none text-[13px] font-semibold capitalize text-[#111827] dark:text-[var(--text-secondary)] sm:inline">
              {pageLabel}
            </span>
            {/* Which agent operates this section — real attribution from the agent registry */}
            {sectionAgent && (
              <span
                title={`Operated by ${sectionAgent.name}`}
                className="hidden items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-medium lg:inline-flex"
                style={{ borderColor: "var(--border-soft)", color: "var(--section-accent)", background: "var(--section-accent-soft)" }}
              >
                <sectionAgent.Icon size={11} />
                {sectionAgent.name}
              </span>
            )}
            {/* Search trigger */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
              className="hidden h-7 items-center gap-2 rounded-md border px-2.5 text-[12px] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] sm:flex"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)", background: "transparent" }}
            >
              <Search size={12}/>
              <span>Search…</span>
              <kbd className="rounded border px-1 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)", background: "transparent" }}>⌘K</kbd>
            </button>
            {/* Status — quick access icon in the top bar */}
            <Link
              to="/status"
              title="System status"
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-faint)" }}
            >
              <Activity size={15}/>
            </Link>
            {/* Help lives in the right-side global controls (AgentStatusBar), not here. */}
            {/* Page-specific action buttons are portaled here by sub-pages */}
            <div id="mondaily-page-actions" className="flex items-center gap-1.5"/>
          </div>
        }/>

        <VerifyEmailBanner />
        <BillingAlertBanner />
        <PendingPlanBanner />

        <main className={`min-h-0 flex-1 pb-16 md:pb-0 overscroll-none ${isGrid ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"}`}
          // Reserve the scrollbar space so the page never shifts sideways when the vertical
          // scrollbar appears/disappears on data refetch (the "shakes right and left" issue).
          style={{ scrollbarGutter: "stable" }}>
          {/* key=pathname → the boundary RESETS on every navigation. Without this, one page throwing
              once leaves the boundary stuck, blanking every subsequent route until a full reload. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <QuickActions />
      <CommandPalette />
      <GettingStarted />
      <CallHost />
      <MobileNav />
    </div>
    </DialogProvider>
   </HelpProvider>
  );
}

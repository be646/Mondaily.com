import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { Sidebar, GettingStarted } from "../../components/layout/sidebar";
import { AgentStatusBar } from "../../components/ai/agent-status";
import { QuickActions } from "../../components/ui/quick-actions";
import { CommandPalette } from "../../components/ui/command-palette";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import {
  Home, CheckSquare, Users, MessageCircle, Menu, Search,
  FileText, Bell, BarChart2, Zap, Phone, Mail, Settings,
  List, Building2, TrendingUp, Activity, type LucideIcon,
} from "lucide-react";

// ─── Page icon + label derived from current path ─────────────────────────────
type PageMeta = { label: string; Icon: LucideIcon; color: string };

function getPageMeta(pathname: string): PageMeta {
  if (/^\/objects\//.test(pathname)) {
    const seg = pathname.split("/objects/")[1]?.split("/")[0] ?? "";
    const label = seg.replace(/[-_]/g, " ");
    const icon: Record<string, LucideIcon> = { people: Users, companies: Building2, deals: TrendingUp };
    return { label, Icon: icon[seg] ?? List, color: "text-stone-500 dark:text-stone-400" };
  }
  const map: [string, PageMeta][] = [
    ["/home",          { label: "Home",          Icon: Home,        color: "text-stone-500 dark:text-stone-400" }],
    ["/tasks",         { label: "Tasks",          Icon: CheckSquare, color: "text-stone-500 dark:text-stone-400" }],
    ["/notes",         { label: "Notes",          Icon: FileText,    color: "text-stone-500 dark:text-stone-400" }],
    ["/notifications", { label: "Notifications",  Icon: Bell,        color: "text-stone-500 dark:text-stone-400" }],
    ["/reports",       { label: "Reports",        Icon: BarChart2,   color: "text-stone-500 dark:text-stone-400" }],
    ["/automations",   { label: "Automations",    Icon: Zap,         color: "text-stone-500 dark:text-stone-400" }],
    ["/calls",         { label: "Calls",          Icon: Phone,       color: "text-stone-500 dark:text-stone-400" }],
    ["/emails",        { label: "Emails",         Icon: Mail,        color: "text-stone-500 dark:text-stone-400" }],
    ["/lists",         { label: "Lists",          Icon: List,        color: "text-stone-500 dark:text-stone-400" }],
    ["/settings",      { label: "Settings",       Icon: Settings,    color: "text-stone-500 dark:text-stone-400" }],
    ["/ask",           { label: "Ask AI",         Icon: MessageCircle, color: "text-stone-500 dark:text-stone-400" }],
    ["/search",        { label: "Search",         Icon: Search,      color: "text-stone-500 dark:text-stone-400" }],
  ];
  for (const [prefix, meta] of map) {
    if (pathname.startsWith(prefix)) return meta;
  }
  return { label: "Mondaily", Icon: Home, color: "text-stone-400" };
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

function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onClose}/>
      <div className="fixed left-0 top-0 bottom-0 z-50 w-72 overflow-auto bg-white dark:bg-[#0d0d0d] md:hidden">
        <Sidebar onMobileClose={onClose} />
      </div>
    </>
  );
}

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      navigate("/onboarding-setup", { replace: true });
    }
  }, [wsSettings, navigate]);

  const { label: pageLabel, Icon: PageIcon, color: pageColor } = getPageMeta(location.pathname);

  // Spreadsheet grid routes own their scroll via internal flex — keep main overflow-hidden.
  // All other routes need native vertical scrolling.
  const isGrid = /^\/objects\/[^/]+$/.test(location.pathname);

  return (
    <div className="flex h-screen w-screen overflow-hidden surface-page">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}/>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — logo · page label · actions slot · AI/user buttons */}
        <AgentStatusBar leftSlot={
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-7 w-7 items-center justify-center text-stone-400 md:hidden shrink-0"
            >
              <Menu size={16}/>
            </button>
            <PageIcon size={16} className={`${pageColor} shrink-0`}/>
            <span className="text-[13px] font-semibold text-[#111827] dark:text-white/80 capitalize select-none hidden sm:inline">
              {pageLabel}
            </span>
            {/* Search trigger */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
              className="hidden items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors hover:bg-stone-100 hover:text-stone-950 dark:hover:bg-stone-900 dark:hover:text-stone-50 sm:flex"
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
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
              style={{ color: "var(--text-faint)" }}
            >
              <Activity size={15}/>
            </Link>
            {/* Page-specific action buttons are portaled here by sub-pages */}
            <div id="mondaily-page-actions" className="flex items-center gap-1.5"/>
          </div>
        }/>

        <main className={`min-h-0 flex-1 pb-16 md:pb-0 overscroll-none ${isGrid ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"}`}>
          <Outlet />
        </main>
      </div>

      <QuickActions />
      <CommandPalette />
      <GettingStarted />
      <MobileNav />
    </div>
  );
}

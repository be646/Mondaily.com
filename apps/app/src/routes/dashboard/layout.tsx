import { Outlet, Link, useLocation } from "react-router-dom";
import { Sidebar } from "../../components/layout/sidebar";
import { AgentStatusBar } from "../../components/ai/agent-status";
import { QuickActions } from "../../components/ui/quick-actions";
import { useState } from "react";
import { Home, CheckSquare, Users, MessageCircle, Menu } from "lucide-react";

// ─── Inline scanning-lines logo (mirrors sidebar Logo) ───────────────────────
function NavLogo() {
  const size = 20;
  const lineCount = 10;
  const lineH = size / lineCount;
  const radius = 2;
  const dotSize = 4;
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
      <div className="logo-dot absolute rounded-full bg-white" style={{ width: dotSize, height: dotSize, top: 3, right: 3, boxShadow: "0 0 4px rgba(255,255,255,0.9)" }}/>
    </div>
  );
}

// ─── Derive readable page label from path ────────────────────────────────────
function getPageLabel(pathname: string): string {
  if (/^\/objects\//.test(pathname)) {
    const seg = pathname.split("/objects/")[1]?.split("/")[0] ?? "";
    return seg.replace(/[-_]/g, " ").toUpperCase();
  }
  const map: Record<string, string> = {
    "/home": "HOME", "/tasks": "TASKS", "/notes": "NOTES",
    "/notifications": "NOTIFICATIONS", "/reports": "REPORTS",
    "/automations": "AUTOMATIONS", "/pipeline": "PIPELINE",
    "/calls": "CALLS", "/emails": "EMAILS", "/search": "SEARCH",
    "/settings": "SETTINGS", "/ask": "ASK AI", "/lists": "LISTS",
  };
  for (const [prefix, label] of Object.entries(map)) {
    if (pathname.startsWith(prefix)) return label;
  }
  return "MONDAILY";
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#0b0d10] px-2 pb-safe md:hidden">
      <div className="flex items-center justify-around">
        {tabs.map(({ to, icon: Icon, label }) => {
          const active = location.pathname.startsWith(to.split("/").slice(0, 2).join("/"));
          return (
            <Link key={to} to={to} className={`flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors ${active ? "text-red-400" : "text-slate-500"}`}>
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
      <div className="fixed left-0 top-0 bottom-0 z-50 w-72 overflow-auto bg-[#0b0d10] md:hidden">
        <Sidebar onMobileClose={onClose} />
      </div>
    </>
  );
}

export function DashboardLayout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pageLabel = getPageLabel(location.pathname);

  // Spreadsheet grid routes own their scroll via internal flex — keep main overflow-hidden.
  // All other routes need native vertical scrolling.
  const isGrid = /^\/objects\/[^/]+$/.test(location.pathname);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d0f13]">
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
              className="flex h-7 w-7 items-center justify-center text-slate-400 md:hidden shrink-0"
            >
              <Menu size={16}/>
            </button>
            <NavLogo/>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400 select-none hidden sm:inline">
              {pageLabel}
            </span>
            {/* Page-specific action buttons are portaled here by sub-pages */}
            <div id="mondaily-page-actions" className="flex items-center gap-1.5"/>
          </div>
        }/>

        <main className={`min-h-0 flex-1 pb-16 md:pb-0 ${isGrid ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"}`}>
          <Outlet />
        </main>
      </div>

      <QuickActions />
      <MobileNav />
    </div>
  );
}

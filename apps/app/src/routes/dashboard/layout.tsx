import { Outlet, Link, useLocation } from "react-router-dom";
import { Sidebar } from "../../components/layout/sidebar";
import { AgentStatusBar } from "../../components/ai/agent-status";
import { QuickActions } from "../../components/ui/quick-actions";
import { useState } from "react";
import { Home, CheckSquare, Users, List, MessageCircle, Menu, X } from "lucide-react";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0d10]">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}/>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-10 w-10 items-center justify-center text-slate-400 md:hidden ml-1"
          >
            <Menu size={20}/>
          </button>
          <div className="flex-1">
            <AgentStatusBar />
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-hidden pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      <QuickActions />
      <MobileNav />
    </div>
  );
}

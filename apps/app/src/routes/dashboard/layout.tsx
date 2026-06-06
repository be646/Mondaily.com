import { Outlet } from "react-router-dom";
import { Sidebar } from "../../components/layout/sidebar";
import { AgentStatusBar } from "../../components/ai/agent-status";

export function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0d10]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AgentStatusBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}


import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Logo } from "../../components/logo";
import { PanelProvider, usePanelContext } from "./onboarding-context";
import {
  ProfilePanel,
  WorkspacePanel,
  ConnectEmailPanel,
  InvitePanel,
  ImportPanel,
  PlanPanel,
} from "./onboarding-panels";

const STEPS = ["profile", "workspace", "connect-email", "invite", "import", "plan"];
const STEP_LABELS = ["Profile", "Workspace", "Email", "Team", "Import", "Plan"];

function RightPanel() {
  const { panelState } = usePanelContext();
  const location = useLocation();
  const step = STEPS.find(s => location.pathname.includes(s)) ?? "profile";

  if (step === "profile")       return <ProfilePanel      name={String(panelState.name ?? "")}      title={String(panelState.title ?? "")} />;
  if (step === "workspace")     return <WorkspacePanel    name={String(panelState.name ?? "")}      size={String(panelState.size ?? "")}  industry={String(panelState.industry ?? "")} />;
  if (step === "connect-email") return <ConnectEmailPanel connected={(panelState.connected as string[]) ?? []} />;
  if (step === "invite")        return <InvitePanel       emails={(panelState.emails as string[]) ?? [""]} sent={Boolean(panelState.sent)} />;
  if (step === "import")        return <ImportPanel       file={String(panelState.file ?? "")} />;
  if (step === "plan")          return <PlanPanel         selected={String(panelState.selected ?? "free")} />;
  return null;
}

function Layout() {
  const location = useLocation();
  const current = Math.max(0, STEPS.findIndex(s => location.pathname.includes(s)));

  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    return () => {
      if (prev) document.documentElement.dataset.theme = prev;
    };
  }, []);

  return (
    <div className="grid min-h-screen" data-theme="light" style={{ gridTemplateColumns: "440px 1fr" }}>
      {/* Left — form */}
      <div className="flex flex-col bg-white">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-black/[.06] px-8 py-4">
          <Logo size={30} />
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 w-6 rounded-full transition-all duration-300 ${i <= current ? "bg-stone-600" : "bg-black/[.07]"}`}
                />
              ))}
            </div>
            <span className="font-mono text-[10px] text-stone-400">
              {STEP_LABELS[current]} · {current + 1} / {STEPS.length}
            </span>
          </div>
        </header>
        {/* Step content */}
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Right — reactive panel */}
      <RightPanel />
    </div>
  );
}

export function OnboardingLayout() {
  return (
    <PanelProvider>
      <Layout />
    </PanelProvider>
  );
}

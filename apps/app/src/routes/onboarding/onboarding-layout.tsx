import { Outlet, useLocation } from "react-router-dom";
import { Logo } from "../../components/logo";

const steps = ["profile", "workspace", "connect-email", "invite", "import", "plan"];
const stepLabels = ["Profile", "Workspace", "Email", "Team", "Import", "Plan"];

export function OnboardingLayout() {
  const location = useLocation();
  const current = Math.max(0, steps.findIndex(s => location.pathname.includes(s)));
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="border-b border-black/[.06] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <Logo size={32} />
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 w-7 rounded-full transition-all duration-300 ${i <= current ? "bg-indigo-600" : "bg-black/[.07]"}`}
                />
              ))}
            </div>
            <span className="font-mono text-[10px] text-zinc-400">
              {stepLabels[current]} · {current + 1} of {steps.length}
            </span>
          </div>
        </div>
      </header>
      <main className="grid flex-1 place-items-center p-6">
        <div className="w-full max-w-lg">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

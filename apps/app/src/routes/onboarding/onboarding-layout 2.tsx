import { Outlet, useLocation } from "react-router-dom";

const steps = ["profile", "workspace", "connect-email", "invite", "import", "plan"];

export function OnboardingLayout() {
  const location = useLocation();
  const current = Math.max(0, steps.findIndex((step) => location.pathname.includes(step)));
  return (
    <div className="flex min-h-screen flex-col bg-[#0b0d10] text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="text-sm font-semibold">Mondaily</span>
          <div className="flex items-center gap-1.5">
            {steps.map((step, index) => (
              <div key={step} className={`h-1.5 w-8 rounded-full ${index <= current ? "bg-red-500" : "bg-white/10"}`} />
            ))}
          </div>
          <span className="text-xs text-slate-500">{current + 1} of {steps.length}</span>
        </div>
      </header>
      <main className="grid flex-1 place-items-center p-6"><div className="w-full max-w-lg"><Outlet /></div></main>
    </div>
  );
}

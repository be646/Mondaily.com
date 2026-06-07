import { CheckCircle, Mail } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function StepConnectEmail() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<string[]>([]);
  function connect(provider: "gmail" | "outlook") {
    const popup = window.open(`/api/v1/integrations/${provider}/connect`, "_blank", "width=520,height=680");
    if (!popup) return;
    const listener = (event: MessageEvent) => {
      if (event.data?.type === `${provider.toUpperCase()}_CONNECTED`) {
        setConnected((current) => [...new Set([...current, provider])]);
        window.removeEventListener("message", listener);
      }
    };
    window.addEventListener("message", listener);
  }
  return (
    <section>
      <h1 className="text-2xl font-semibold">Connect your email</h1>
      <p className="mb-3 mt-1 text-sm text-slate-500">Mondaily can build your relationship graph from email and calendar activity.</p>
      <div className="mb-7 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">AI import always remains reviewable before records are changed.</div>
      <div className="mb-8 space-y-3">
        {(["gmail", "outlook"] as const).map((provider) => (
          <button key={provider} onClick={() => connect(provider)} className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-4 text-left hover:bg-white/[.04]">
            <Mail size={18} className="text-red-400" /><div className="flex-1"><p className="text-sm font-medium">Connect {provider === "gmail" ? "Gmail" : "Outlook"}</p><p className="text-xs text-slate-500">Email and calendar</p></div>
            {connected.includes(provider) ? <CheckCircle size={17} className="text-emerald-500" /> : null}
          </button>
        ))}
      </div>
      <div className="flex gap-3"><button onClick={() => navigate("/onboarding/invite")} className="h-10 flex-1 rounded-md bg-red-600 text-sm font-medium">Continue</button><button onClick={() => navigate("/onboarding/invite")} className="rounded-md border border-white/10 px-4 text-sm">Skip</button></div>
    </section>
  );
}

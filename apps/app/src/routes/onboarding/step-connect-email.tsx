import { CheckCircle, Mail, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePanelState } from "./onboarding-context";

export function StepConnectEmail() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<string[]>([]);

  usePanelState({ connected });

  function connect(provider: "gmail" | "outlook") {
    const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
    const popup = window.open(`${apiBase}/api/v1/integrations/${provider}/connect`, "_blank", "width=520,height=680");
    if (!popup) return;
    const listener = (event: MessageEvent) => {
      if (event.data?.type === `${provider.toUpperCase()}_CONNECTED`) {
        setConnected(c => [...new Set([...c, provider])]);
        window.removeEventListener("message", listener);
      }
    };
    window.addEventListener("message", listener);
  }

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Connect your email</h1>
      <p className="mb-3 font-mono text-[12px] text-stone-500">Mondaily builds your relationship graph from email and calendar activity.</p>

      <div className="mb-6 rounded-xl border border-stone-500/20 bg-stone-500/[.04] px-4 py-3 font-mono text-[12px] text-stone-700">
        AI import is always reviewable before any records are changed.
      </div>

      <div className="mb-8 space-y-3">
        {(["gmail", "outlook"] as const).map(provider => (
          <button
            key={provider}
            onClick={() => connect(provider)}
            className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${connected.includes(provider) ? "border-stone-500/30 bg-stone-500/[.04]" : "border-black/[.08] hover:bg-stone-50"}`}
          >
            <Mail size={15} className={connected.includes(provider) ? "text-stone-500" : "text-stone-400"} />
            <div className="flex-1">
              <p className="font-mono text-[12px] font-medium text-stone-800">Connect {provider === "gmail" ? "Gmail" : "Outlook"}</p>
              <p className="font-mono text-[11px] text-stone-500">Email and calendar</p>
            </div>
            {connected.includes(provider) && <CheckCircle size={14} className="text-stone-500" />}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => navigate("/onboarding/invite")}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all"
        >
          Continue <ArrowRight size={13} />
        </button>
        <button onClick={() => navigate("/onboarding/invite")} className="rounded-xl border border-black/[.08] px-4 font-mono text-[12px] text-stone-500 hover:bg-stone-50 transition-colors">
          Skip
        </button>
      </div>
    </div>
  );
}

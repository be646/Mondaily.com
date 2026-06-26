import { Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePanelState } from "./onboarding-context";
import { getAuthHeaders } from "../../lib/api-client";

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: "$0",
    period: "forever",
    desc: "For solo founders exploring the AI workspace.",
    features: ["1 user", "500 contacts", "Records & pipeline", "Ask Mondaily AI (100/mo)", "1 email integration"],
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$49",
    period: "per user / mo",
    desc: "For growing teams that want AI doing the heavy lifting.",
    features: ["Unlimited contacts", "Full pipeline + AI scoring", "Sequences & automations", "Ask Mondaily AI (unlimited)", "AI enrichment (5,000/mo)"],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    price: "$89",
    period: "per user / mo",
    desc: "For teams needing advanced controls and collaboration.",
    features: ["Everything in Pro", "Custom objects & fields", "Role-based access", "Finance module", "Webhook & API"],
    highlight: false,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "talk to us",
    desc: "For large organisations needing SSO and compliance.",
    features: ["Everything in Business", "SAML SSO & SCIM", "Audit log", "Data residency", "Dedicated CSM"],
    highlight: false,
  },
];

export function StepPlan() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState("starter");

  usePanelState({ selected });

  async function start() {
    localStorage.setItem("mondaily_onboarding_done", "1");
    // Mark onboarding complete server-side (non-fatal if it fails)
    try {
      const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
      const headers = await getAuthHeaders();
      await fetch(`${apiBase}/api/v1/settings/complete-onboarding`, { method: "POST", headers });
    } catch { /* non-fatal */ }

    if (selected === "enterprise") {
      window.location.href = "mailto:sales@mondaily.com";
    } else if (selected === "pro" || selected === "business") {
      // Authed POST → Stripe checkout URL, then redirect. If billing isn't
      // configured yet, don't dead-end onboarding — just go to the app.
      try {
        const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
        const headers = await getAuthHeaders();
        const res = await fetch(`${apiBase}/api/v1/billing/checkout`, {
          method: "POST", headers, body: JSON.stringify({ plan: selected, interval: "month" }),
        });
        const data = await res.json().catch(() => ({})) as { url?: string };
        if (data.url) { window.location.href = data.url; return; }
      } catch { /* fall through to app */ }
      navigate("/home");
    } else {
      navigate("/home");
    }
  }

  return (
    <div>
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-stone-900">Choose your plan</h1>
      <p className="mb-6 font-mono text-[12px] text-stone-500">Start free and upgrade when your team is ready.</p>

      <div className="mb-7 space-y-2.5">
        {plans.map(plan => (
          <button
            key={plan.id}
            onClick={() => setSelected(plan.id)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${selected === plan.id ? "border-stone-500/30 bg-stone-600/[.04] ring-1 ring-stone-500/20" : "border-black/[.08] hover:bg-stone-50"}`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-stone-800">{plan.name}</span>
                {plan.highlight && (
                  <span className="rounded-full border border-stone-500/30 bg-stone-600/[.07] px-2 py-0.5 font-mono text-[9px] text-stone-600 uppercase tracking-wider">Popular</span>
                )}
              </div>
              <span className="shrink-0 font-mono text-[12px] text-stone-500">
                {plan.price}{plan.price !== "Custom" && <span className="text-stone-400"> / {plan.period}</span>}
              </span>
            </div>
            <p className="mb-2 font-mono text-[11px] text-stone-400">{plan.desc}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {plan.features.slice(0, 3).map(f => (
                <span key={f} className="flex items-center gap-1 font-mono text-[10px] text-stone-500">
                  <Check size={9} className="text-stone-500 shrink-0" /> {f}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={start}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-stone-500 transition-all"
      >
        {selected === "starter" ? "Start for free" : selected === "enterprise" ? "Talk to sales" : `Start ${plans.find(p => p.id === selected)?.name} trial`}
        <ArrowRight size={13} />
      </button>
      <p className="mt-3 text-center font-mono text-[11px] text-stone-400">No credit card required for free plan</p>
    </div>
  );
}

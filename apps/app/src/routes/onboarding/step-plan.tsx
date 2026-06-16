import { Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const plans = [
  { id: "free",       name: "Free",       price: "Free",         features: ["3 seats", "50K records", "Basic AI"] },
  { id: "pro",        name: "Pro",         price: "$55/user/mo",  features: ["Unlimited seats", "Full AI agents", "All verticals"] },
  { id: "enterprise", name: "Enterprise",  price: "Custom",       features: ["SSO", "Audit logs", "Dedicated support"] },
];

export function StepPlan() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState("free");

  function start() {
    if (selected === "free") navigate("/home");
    else if (selected === "enterprise") window.location.href = "mailto:sales@mondaily.com";
    else window.location.href = "/api/v1/billing/checkout?plan=pro&interval=year";
  }

  return (
    <div className="rounded-2xl border border-black/[.08] bg-white p-8">
      <h1 className="mb-1 font-sans text-xl font-semibold tracking-tight text-zinc-900">Choose your plan</h1>
      <p className="mb-6 font-mono text-[12px] text-zinc-500">Start free and upgrade when your team is ready.</p>

      <div className="mb-6 space-y-3">
        {plans.map(plan => (
          <button
            key={plan.id}
            onClick={() => setSelected(plan.id)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${
              selected === plan.id
                ? "border-indigo-500/40 bg-indigo-500/[.04] ring-1 ring-indigo-500/20"
                : "border-black/[.08] hover:bg-zinc-50"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[13px] font-medium text-zinc-800">{plan.name}</span>
              <span className="font-mono text-[12px] text-zinc-500">{plan.price}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {plan.features.map(f => (
                <span key={f} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
                  <Check size={10} className="text-indigo-500" /> {f}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={start}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all"
      >
        {selected === "free" ? "Start for free" : selected === "enterprise" ? "Talk to sales" : "Start Pro"}
        <ArrowRight size={13} />
      </button>
    </div>
  );
}

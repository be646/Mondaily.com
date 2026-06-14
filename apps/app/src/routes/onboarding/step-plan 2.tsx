import { Check } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const plans = [
  { id: "free", name: "Free", price: "Free", features: ["3 seats", "50K records", "Basic AI"] },
  { id: "pro", name: "Pro", price: "$55/user/mo", features: ["Unlimited seats", "Full AI agents", "All verticals"] },
  { id: "enterprise", name: "Enterprise", price: "Custom", features: ["SSO", "Audit logs", "Dedicated support"] }
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
    <section>
      <h1 className="text-2xl font-semibold">Choose your plan</h1><p className="mb-7 mt-1 text-sm text-slate-500">Start free and upgrade when your team is ready.</p>
      <div className="mb-7 space-y-3">{plans.map((plan) => <button key={plan.id} onClick={() => setSelected(plan.id)} className={`w-full rounded-lg border p-4 text-left ${selected === plan.id ? "border-red-500 bg-red-500/5" : "border-white/10"}`}><div className="flex justify-between"><span className="text-sm font-medium">{plan.name}</span><span className="text-sm">{plan.price}</span></div><div className="mt-2 flex gap-3">{plan.features.map((feature) => <span key={feature} className="flex items-center gap-1 text-xs text-slate-500"><Check size={11} className="text-emerald-500" />{feature}</span>)}</div></button>)}</div>
      <button onClick={start} className="h-11 w-full rounded-md bg-red-600 text-sm font-medium">{selected === "free" ? "Start for free" : selected === "enterprise" ? "Talk to sales" : "Start Pro"}</button>
    </section>
  );
}

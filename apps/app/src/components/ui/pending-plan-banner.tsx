import { CreditCard, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

// Activation nudge — shown across the workspace when the user picked a paid plan (Command/Sovereign)
// at onboarding but hasn't paid. Until then they're honestly on the free Scout baseline; this makes
// the "selected but not active" state impossible to miss and one click from checkout. Never shown on
// the billing page itself (which has its own inline banner + checkout). Session-dismissible; returns
// on reload so the pending activation is never silently forgotten. Disappears once activated.
export function PendingPlanBanner() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("pending_plan_banner_dismissed") === "1");
  const { data } = useQuery<{ pending_plan?: string | null }>({
    queryKey: ["billing"],                    // dedupes with the billing page's own query
    queryFn: () => apiClient.get("/billing"),
    staleTime: 60_000,
  });

  const pending = data?.pending_plan;
  // Billing page renders its own inline banner + checkout — don't double up there.
  if (!pending || dismissed || pathname.startsWith("/settings/billing")) return null;

  // Sovereign is a custom "talk to us" plan — the CTA must not imply self-serve checkout. Either way
  // the action lives on Billing, so the banner just links there (no faked checkout here).
  const isCustom = pending === "sovereign";

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 text-[12.5px]"
      style={{ borderColor: "#a3946b55", background: "#a3946b18", color: "var(--text-secondary)" }}>
      <CreditCard size={14} style={{ color: "#a3946b" }} />
      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}>
        You selected <strong className="capitalize">{pending}</strong> at signup — {isCustom
          ? "a custom plan our team sets up with you."
          : "it needs payment to activate."} You're on the free Scout tier until then.
      </span>
      <Link to="/settings/billing"
        className="shrink-0 rounded-sm border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:border-[#a3946b]"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
        {isCustom ? "Contact sales" : "Complete checkout"}
      </Link>
      <button onClick={() => { sessionStorage.setItem("pending_plan_banner_dismissed", "1"); setDismissed(true); }}
        className="shrink-0 text-stone-500 hover:text-[var(--text-primary)]" title="Dismiss for now">
        <X size={13} />
      </button>
    </div>
  );
}

import { useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { apiClient } from "../../lib/api-client";

/**
 * Dunning banner — warns the operator when a renewal charge failed ("payment_failed") or the
 * subscription lapsed ("cancelled"). Reads billing_status off /credits/balance (the same wallet the
 * sidebar already fetches, so this dedupes). The billing page renders its own inline state, so we
 * suppress there. Owner/paying workspaces resolve to "active" and never see this.
 */
export function BillingAlertBanner() {
  const { pathname } = useLocation();
  const { data } = useQuery<{ billing_status?: string | null }>({
    queryKey: ["credits-balance"],
    queryFn: () => apiClient.get("/credits/balance"),
    staleTime: 60_000,
  });
  const status = data?.billing_status;
  if (pathname.startsWith("/settings/billing")) return null;
  const failed = status === "payment_failed";
  const cancelled = status === "cancelled";
  if (!failed && !cancelled) return null;

  return (
    <Link to="/settings/billing" className="flex items-center gap-3 border-b px-4 py-2 text-[12.5px] transition-opacity hover:opacity-90"
      style={{ borderColor: "#d1524a55", background: "#d1524a18" }}>
      <AlertTriangle size={14} className="shrink-0" style={{ color: "#d1524a" }} />
      <span className="min-w-0 flex-1" style={{ color: "var(--text-primary)" }}>
        {failed
          ? <>Your last subscription payment failed — <strong>update your card</strong> to keep your plan active.</>
          : <>Your subscription ended and you're back on the free Scout plan — <strong>re-subscribe</strong> to restore full access.</>}
      </span>
      <span className="shrink-0 rounded-sm px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#d1524a", color: "#fff" }}>Fix billing →</span>
    </Link>
  );
}

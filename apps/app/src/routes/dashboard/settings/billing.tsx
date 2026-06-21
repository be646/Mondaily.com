import { useQuery } from "@tanstack/react-query";
import { CreditCard, Download, Zap, Users } from "lucide-react";
import { apiClient, BASE_URL } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Invoice { id: string; date: string; amount: number; pdf_url: string }
interface Billing {
  plan: string;
  seats_used: number;
  seats_limit: number;
  next_billing_date?: string;
  card_last4?: string;
  invoices: Invoice[];
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-white/[.05] text-slate-400",
  pro: "bg-blue-500/10 text-blue-300",
  business: "bg-violet-500/10 text-violet-300",
  enterprise: "bg-amber-500/10 text-amber-300",
};

export function BillingSettings() {
  const query = useQuery({ queryKey: ["billing"], queryFn: () => apiClient.get<Billing>("/billing") });

  if (query.isLoading) return <PageSkeleton />;
  const billing = query.data ?? { plan: "free", seats_used: 1, seats_limit: 3, invoices: [] };
  const seatPct = Math.min(Math.round((billing.seats_used / billing.seats_limit) * 100), 100);

  return (
    <div className="space-y-5">
      <PageHeader title="Billing" description="Manage your plan, payment details, and invoice history." />

      {/* ── Plan ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Current plan</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${PLAN_COLORS[billing.plan] ?? PLAN_COLORS.free}`}>
            {billing.plan}
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold capitalize text-white">{billing.plan} plan</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {billing.next_billing_date
                  ? `Next billing on ${new Date(billing.next_billing_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : "No upcoming charge"}
              </p>
            </div>
            <button
              onClick={() => { window.location.href = `${BASE_URL}/api/v1/billing/portal`; }}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition-all"
            >
              <Zap size={13} /> {billing.plan === "free" ? "Upgrade plan" : "Manage plan"}
            </button>
          </div>

          {/* Seats */}
          <div className="mt-5 rounded-xl border border-white/[.06] bg-white/[.015] p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Users size={14} className="text-slate-500" /> Seats used
              </div>
              <span className="text-sm font-medium text-white">{billing.seats_used} / {billing.seats_limit}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.08]">
              <div
                className={`h-full rounded-full transition-all ${seatPct >= 90 ? "bg-indigo-500" : seatPct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${seatPct}%` }}
              />
            </div>
            {seatPct >= 90 && (
              <p className="mt-2 text-xs text-indigo-400">You're nearly at your seat limit. Upgrade to add more members.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Payment method ── */}
      {billing.card_last4 && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-white">Payment method</h2>
          </div>
          <div className="flex items-center gap-3 p-5">
            <div className="grid h-9 w-14 place-items-center rounded-md border border-white/[.08] bg-white/[.03]">
              <CreditCard size={16} className="text-slate-500" />
            </div>
            <div>
              <p className="text-sm text-slate-200">Card ending in {billing.card_last4}</p>
              <p className="text-xs text-slate-500">Billing currency: USD</p>
            </div>
            <button
              onClick={() => { window.location.href = `${BASE_URL}/api/v1/billing/portal`; }}
              className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Update
            </button>
          </div>
        </section>
      )}

      {/* ── Invoice history ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-white">Invoice history</h2>
        </div>
        {billing.invoices.length ? (
          <div className="divide-y divide-white/[.05] px-5">
            {billing.invoices.map(inv => (
              <a
                key={inv.id}
                href={inv.pdf_url}
                className="flex items-center justify-between py-3.5 hover:text-white transition-colors"
              >
                <div>
                  <p className="text-sm text-slate-200">{new Date(inv.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
                  <p className="text-xs text-slate-500">${(inv.amount / 100).toFixed(2)}</p>
                </div>
                <Download size={14} className="text-slate-600 hover:text-slate-300 transition-colors" />
              </a>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-slate-600">No invoices yet. They'll appear here once you upgrade.</p>
        )}
      </section>
    </div>
  );
}

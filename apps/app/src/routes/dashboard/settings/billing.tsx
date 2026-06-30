import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CreditCard, Download, Zap, Users, Wallet, RefreshCw } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface AutoRefill { enabled: boolean; threshold: number; amount_usd: number }
interface CreditBalance { enrolled: boolean; balance: number; granted: number; used: number; account_tier: string; trial_ends_at: string | null; auto_refill?: AutoRefill }
interface LedgerRow { id: string; amount: number; transaction_type: "grant" | "usage" | "purchase"; description: string | null; created_at: string }

/** Open Stripe checkout (free plan → upgrade) or the customer portal (paying
 *  plan → manage). Both are authed POSTs that return a Stripe URL we redirect
 *  to; errors (e.g. billing not yet configured) surface a clear message. */
async function openBilling(plan: string) {
  const errFrom = (e: unknown) => {
    try { return JSON.parse((e as Error).message)?.error as string; } catch { return undefined; }
  };
  try {
    if (plan === "free") {
      const r = await apiClient.post<{ url?: string }>("/billing/checkout", { plan: "pro", interval: "month" });
      if (r.url) { window.location.href = r.url; return; }
    } else {
      const r = await apiClient.post<{ url?: string; needs_checkout?: boolean }>("/billing/portal", {});
      if (r.url) { window.location.href = r.url; return; }
      if (r.needs_checkout) {
        const cr = await apiClient.post<{ url?: string }>("/billing/checkout", { plan: "pro", interval: "month" });
        if (cr.url) { window.location.href = cr.url; return; }
      }
    }
  } catch (e) {
    console.warn("Billing action failed:", errFrom(e));
  }
}

// Buy a one-time credit pack — redirects to Stripe Checkout (also saves the card for auto-refill).
async function buyCredits() {
  try {
    const r = await apiClient.post<{ url?: string; error?: string }>("/billing/credits-checkout", {});
    if (r.url) { window.location.href = r.url; return; }
    if (r.error) alert(r.error);
  } catch (e) {
    try { alert(JSON.parse((e as Error).message)?.error ?? "Could not start the credit purchase."); }
    catch { alert("Could not start the credit purchase."); }
  }
}

interface Invoice { id: string; date: string; amount: number; pdf_url: string }
interface Billing {
  plan: string;
  seats_used: number;
  seats_limit: number;
  next_billing_date?: string;
  card_last4?: string;
  invoices: Invoice[];
  trial_ends_at?: string | null;
  trial_days_left?: number | null;
}

interface UsageTotals { messages: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface Usage {
  period: string;
  records: number;
  totals: UsageTotals;
  by_model: Record<string, UsageTotals>;
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-[var(--surface-hover)] text-stone-400",
  trial: "bg-emerald-500/10 text-emerald-300",
  pro: "bg-blue-500/10 text-blue-300",
  business: "bg-stone-500/10 text-stone-300",
  enterprise: "bg-amber-500/10 text-amber-300",
};

export function BillingSettings() {
  const query = useQuery({ queryKey: ["billing"], queryFn: () => apiClient.get<Billing>("/billing") });
  const usageQuery = useQuery({ queryKey: ["ai-usage"], queryFn: () => apiClient.get<Usage>("/usage") });
  const balanceQuery = useQuery({ queryKey: ["credits-balance"], queryFn: () => apiClient.get<CreditBalance>("/credits/balance") });
  const ledgerQuery = useQuery({ queryKey: ["credits-ledger"], queryFn: () => apiClient.get<{ ledger: LedgerRow[] }>("/credits/ledger") });
  const qc = useQueryClient();
  const [autoRefill, setAutoRefill] = useState(false);
  // Hydrate the toggle from the persisted workspace policy once the balance loads.
  useEffect(() => {
    if (balanceQuery.data?.auto_refill) setAutoRefill(balanceQuery.data.auto_refill.enabled);
  }, [balanceQuery.data?.auto_refill]);
  const saveAutoRefill = useMutation({
    mutationFn: (enabled: boolean) => apiClient.post("/credits/auto-refill", { enabled, threshold: 5000, amount_usd: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credits-balance"] }),
  });
  function toggleAutoRefill() {
    const next = !autoRefill;
    setAutoRefill(next);            // optimistic
    saveAutoRefill.mutate(next);    // persist to workspace.settings.auto_refill
  }

  if (query.isLoading) return <PageSkeleton />;
  const wallet = balanceQuery.data;
  const ledger = ledgerQuery.data?.ledger ?? [];
  const walletPct = wallet && wallet.granted > 0 ? Math.max(0, Math.min(100, Math.round((wallet.balance / wallet.granted) * 100))) : 0;
  const fmtCredits = (n: number) => n.toLocaleString();
  const billing = query.data ?? { plan: "free", seats_used: 1, seats_limit: 3, invoices: [] };
  const seatPct = Math.min(Math.round((billing.seats_used / billing.seats_limit) * 100), 100);

  return (
    <div className="space-y-5">
      <PageHeader title="Billing" description="Manage your plan, payment details, and invoice history." />

      {/* Trial banner — visible while the 14-day trial is running */}
      {billing.plan === "trial" && typeof billing.trial_days_left === "number" && (
        <div className="rounded-2xl border px-5 py-3.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {billing.trial_days_left > 0 ? (
            <span style={{ color: "var(--text-primary)" }}>
              <strong>{billing.trial_days_left} day{billing.trial_days_left === 1 ? "" : "s"} left</strong> in your free trial. Upgrade any time to keep full access.
            </span>
          ) : (
            <span style={{ color: "var(--text-primary)" }}>Your free trial has ended — upgrade to keep full access.</span>
          )}
        </div>
      )}

      {/* ── Plan ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Current plan</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${PLAN_COLORS[billing.plan] ?? PLAN_COLORS.free}`}>
            {billing.plan}
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold capitalize text-[var(--text-primary)]">{billing.plan} plan</p>
              <p className="mt-0.5 text-sm text-stone-500">
                {billing.next_billing_date
                  ? `Next billing on ${new Date(billing.next_billing_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : "No upcoming charge"}
              </p>
            </div>
            <button
              onClick={() => { openBilling(billing.plan); }}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-all"
            >
              <Zap size={13} /> {billing.plan === "free" ? "Upgrade plan" : "Manage plan"}
            </button>
          </div>

          {/* Seats */}
          <div className="telemetry-strip mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-stone-300">
                <Users size={14} className="text-stone-500" /> Seats used
              </div>
              <span className="text-sm font-medium text-[var(--text-primary)]">{billing.seats_used} / {billing.seats_limit}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className={`h-full rounded-full transition-all ${seatPct >= 90 ? "bg-stone-500" : seatPct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${seatPct}%` }}
              />
            </div>
            {seatPct >= 90 && (
              <p className="mt-2 text-xs text-stone-400">You're nearly at your seat limit. Upgrade to add more members.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Plans / Upgrade ── */}
      {billing.plan !== "business" && billing.plan !== "pro" && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Plans</h2>
            <span className="text-xs text-stone-500">Choose your tier</span>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {/* Personal */}
            <div className="rounded-xl border p-4" style={{ borderColor: billing.plan === "free" ? "var(--accent)" : "var(--border-soft)" }}>
              <div className="text-[11px] uppercase tracking-widest text-stone-500">Personal</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">$0<span className="text-sm text-stone-500"> /mo</span></div>
              <ul className="mt-3 space-y-1.5 text-[12px] text-stone-400">
                <li>· 50,000 AI credits</li>
                <li>· Core workspace</li>
                <li>· Solo operator</li>
              </ul>
              {billing.plan === "free"
                ? <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>✓ Current plan</div>
                : <div className="mt-4 text-[11px] text-stone-600">Included</div>}
            </div>
            {/* Business Pro */}
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", boxShadow: "0 0 24px -10px color-mix(in srgb, var(--accent) 40%, transparent)" }}>
              <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--accent)" }}>Business Pro</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">$49<span className="text-sm text-stone-500"> /mo</span></div>
              <ul className="mt-3 space-y-1.5 text-[12px] text-stone-400">
                <li>· 500,000 AI credits / month</li>
                <li>· 14-day free trial</li>
                <li>· Unlimited operators</li>
                <li>· Priority compute</li>
              </ul>
              <button onClick={() => { openBilling("free"); }} className="mt-4 w-full rounded-lg py-2 text-[12px] font-semibold transition-opacity hover:opacity-90" style={{ background: "var(--accent)", color: "#0a0a0a" }}>
                Upgrade to Pro
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── AI usage (token telemetry) ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI usage</h2>
          <span className="text-xs text-stone-500">This month</span>
        </div>
        <div className="p-5">
          {(() => {
            const u = usageQuery.data;
            const t = u?.totals;
            if (usageQuery.isLoading) return <p className="text-sm text-stone-500">Loading usage…</p>;
            if (!t || (t.total_tokens === 0 && t.messages === 0)) {
              return <p className="text-sm text-stone-500">No AI usage recorded yet this month. Totals appear here as your team chats and runs agents.</p>;
            }
            const fmt = (n: number) => n.toLocaleString();
            const cells: [string, number][] = [
              ["Messages", t.messages],
              ["Prompt tokens", t.prompt_tokens],
              ["Completion tokens", t.completion_tokens],
              ["Total tokens", t.total_tokens],
            ];
            return (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {cells.map(([label, val]) => (
                    <div key={label} className="rounded-xl border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
                      <div className="text-[11px] text-stone-500">{label}</div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmt(val)}</div>
                    </div>
                  ))}
                </div>
                {u && Object.keys(u.by_model).length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">By model</div>
                    <div className="space-y-1.5">
                      {Object.entries(u.by_model).map(([model, mt]) => (
                        <div key={model} className="flex items-center justify-between text-sm">
                          <span className="truncate text-stone-400">{model}</span>
                          <span className="tabular-nums text-[var(--text-primary)]">{fmt(mt.total_tokens)} tokens</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </section>

      {/* ── AI credit wallet + Pay-As-You-Go ── */}
      {wallet?.enrolled && (
        <section className="settings-section font-mono">
          <div className="settings-section-header">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Wallet size={14} className="text-stone-500" /> AI credit wallet</h2>
            <span className="text-xs capitalize text-stone-500">{wallet.account_tier} tier</span>
          </div>
          <div className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-semibold tabular-nums text-[var(--text-primary)]">{fmtCredits(wallet.balance)}</div>
                <div className="mt-0.5 text-xs text-stone-500">of {fmtCredits(wallet.granted)} credits remaining · {fmtCredits(wallet.used)} used</div>
              </div>
              <span className="tabular-nums text-sm text-stone-400">{walletPct}%</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${walletPct}%`, background: walletPct <= 10 ? "#ef4444" : "var(--accent)" }} />
            </div>

            {/* Pay-As-You-Go refill module + auto-refill toggle (Stripe stub) */}
            <div className="mt-5 rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Pay-As-You-Go refill</p>
                  <p className="mt-0.5 text-xs text-stone-500">Top up 100,000 credits for <span className="tabular-nums text-stone-300">$10</span> via Stripe.</p>
                </div>
                <button
                  onClick={() => { buyCredits(); }}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-stone-500/30 bg-stone-600 px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-all"
                >
                  <RefreshCw size={13} /> Buy credits
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Enable Auto-Refill</p>
                  <p className="mt-0.5 text-xs text-stone-500">Automatically charge your card <span className="tabular-nums text-stone-300">$10</span> whenever the credit line falls below <span className="tabular-nums text-stone-300">5,000</span> units.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={autoRefill}
                  onClick={toggleAutoRefill}
                  className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                  style={{ background: autoRefill ? "var(--accent)" : "var(--surface-hover)" }}
                >
                  <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: autoRefill ? "1.5rem" : "0.125rem" }} />
                </button>
              </div>
              {autoRefill && <p className="mt-2 text-[11px] text-stone-500">Auto-Refill armed — connect a card via “Buy credits” to activate billing.</p>}
            </div>
          </div>
        </section>
      )}

      {/* ── Credit ledger history ── */}
      {wallet?.enrolled && (
        <section className="settings-section font-mono">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Credit ledger</h2>
            <span className="text-xs text-stone-500">{ledger.length} transaction{ledger.length === 1 ? "" : "s"}</span>
          </div>
          {ledger.length ? (
            <div className="minimal-sheet overflow-x-auto">
              <table className="minimal-table min-w-[560px] text-left text-sm">
                <thead>
                  <tr>{["Date", "Type", "Description", "Credits"].map(h => <th key={h} className={h === "Credits" ? "text-right" : ""}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {ledger.map(row => {
                    const positive = row.amount >= 0;
                    return (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap text-stone-400">{new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${row.transaction_type === "grant" ? "bg-emerald-500/10 text-emerald-400" : row.transaction_type === "purchase" ? "bg-blue-500/10 text-blue-300" : "bg-[var(--surface-hover)] text-stone-500"}`}>
                            {row.transaction_type}
                          </span>
                        </td>
                        <td className="max-w-[260px] truncate text-stone-400">{row.description ?? "—"}</td>
                        <td className={`whitespace-nowrap text-right tabular-nums ${positive ? "text-emerald-400" : "text-stone-600"}`}>
                          {positive ? "+" : "−"}{fmtCredits(Math.abs(row.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-stone-600">No credit transactions yet. Grants and AI usage will appear here in real time.</p>
          )}
        </section>
      )}

      {/* ── Payment method ── */}
      {billing.card_last4 && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Payment method</h2>
          </div>
          <div className="flex items-center gap-3 p-5">
            <div className="grid h-9 w-14 place-items-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)]">
              <CreditCard size={16} className="text-stone-500" />
            </div>
            <div>
              <p className="text-sm text-stone-200">Card ending in {billing.card_last4}</p>
              <p className="text-xs text-stone-500">Billing currency: USD</p>
            </div>
            <button
              onClick={() => { openBilling(billing.plan); }}
              className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              Update
            </button>
          </div>
        </section>
      )}

      {/* ── Invoice history ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Invoice history</h2>
        </div>
        {billing.invoices.length ? (
          <div className="minimal-sheet divide-y divide-stone-200 px-5 dark:divide-stone-800">
            {billing.invoices.map(inv => (
              <a
                key={inv.id}
                href={inv.pdf_url}
                className="flex items-center justify-between py-3.5 hover:text-[var(--text-primary)] transition-colors"
              >
                <div>
                  <p className="text-sm text-stone-200">{new Date(inv.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
                  <p className="text-xs text-stone-500">${(inv.amount / 100).toFixed(2)}</p>
                </div>
                <Download size={14} className="text-stone-600 hover:text-stone-300 transition-colors" />
              </a>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-stone-600">No invoices yet. They'll appear here once you upgrade.</p>
        )}
      </section>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CreditCard, Download, Zap, Users, Wallet, RefreshCw, HelpCircle } from "lucide-react";
import { useHelp } from "../../../components/help/help-panel";
import { apiClient } from "../../../lib/api-client";
import { PageSkeleton } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { PLANS, PLAN_BY_ID, normalizePlan } from "../../../lib/plans";
import { BILLING_CURRENCIES, PRICING_SYMBOL, priceInCurrency, billingCurrencyForLocale, showsCurrencySwitcher, type BillingCurrency } from "@mondaily/shared/pricing";
import { Check } from "lucide-react";
import { StripePaymentModal } from "../../../components/billing/stripe-payment-form";

interface AutoRefill { enabled: boolean; threshold: number; amount_usd: number }
interface CreditBalance {
  enrolled: boolean;
  // the one balance model (mirrors GET /credits/balance)
  entitlement_tier: string;
  included_monthly_credits: number | null;
  purchased_credits: number;
  used_credits: number;
  remaining_credits: number;
  raw_ledger_balance: number;
  reset_at: string;
  // back-compat aliases the UI reads
  balance: number; remaining: number; granted: number; purchased: number; used: number;
  included_monthly: number | null; capacity: number; account_tier: string;
  trial_ends_at: string | null; low: boolean; exhausted: boolean;
  burst?: { used: number; cap: number; limited: boolean; resets_at: string | null };
  auto_refill?: AutoRefill;
}
interface PackQuote { final_credits: number; base_credits: number; plan_bonus: number; annual_bonus: number }
interface CreditPackRow { id: string; name: string; price_usd: number; base_credits: number; quote: PackQuote }
interface PacksResp { tier: string; interval: string; plan_bonus_pct: number; packs: CreditPackRow[] }
interface LedgerRow { id: string; amount: number; transaction_type: "grant" | "usage" | "purchase"; description: string | null; created_at: string }

// Friendly names for the raw model ids the gateway reports, so AI usage reads as the
// engines we actually run rather than provider slugs.
function prettyEngine(model: string): string {
  const id = model.toLowerCase();
  if (id.includes("120b")) return "Mondaily Reasoning";
  if (id.includes("gpt-oss") || id.includes("20b") || id.includes("8b")) return "Mondaily Fast";
  if (id.includes("llama") || id.includes("enrich")) return "Mondaily Enrichment";
  if (id.includes("embed")) return "Mondaily Embeddings";
  return model.replace(/^.*\//, "").replace(/[-_]/g, " ");
}

const errFrom = (e: unknown): string => {
  try { return JSON.parse((e as Error).message)?.error ?? "Something went wrong."; }
  catch { return (e as Error)?.message || "Something went wrong."; }
};

/** Open the Stripe customer portal to manage an existing subscription (cancel, view invoices,
 *  update card). This is Stripe's own hosted portal — the intentional exception to "our own
 *  frontend": account management (invoice history, cancellation) stays on Stripe's portal, exactly
 *  as most SaaS billing does, while the actual card-entry/subscribe flow is fully embedded below. */
async function openPortal(): Promise<string | null> {
  try {
    const r = await apiClient.post<{ url?: string; error?: string }>("/billing/portal", {});
    if (r.url) { window.location.href = r.url; return null; }
    return r.error ?? "Billing portal isn't available yet.";
  } catch (e) { return errFrom(e); }
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
  pending_plan?: string | null;
  trial_used?: boolean;
  trial_eligible?: boolean;
}

interface UsageTotals { messages: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface Usage {
  period: string;
  records: number;
  totals: UsageTotals;
  by_model: Record<string, UsageTotals>;
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-[var(--surface-hover)] text-[var(--text-faint)]",
  trial: "bg-[#2f9e6b]/10 text-[#2f9e6b]",
  pro: "bg-[#717784]/10 text-[#717784]",
  business: "bg-[var(--surface-hover)] text-[var(--text-faint)]",
  enterprise: "bg-[#c6892e]/10 text-[#c6892e]",
};

export function BillingSettings() {
  const help = useHelp();
  const query = useQuery({ queryKey: ["billing"], queryFn: () => apiClient.get<Billing>("/billing") });
  const usageQuery = useQuery({ queryKey: ["ai-usage"], queryFn: () => apiClient.get<Usage>("/usage") });
  const summaryQuery = useQuery({ queryKey: ["usage-summary"], queryFn: () => apiClient.get<{ month: { by_feature: Record<string, number> } }>("/usage/summary"), retry: false });
  const balanceQuery = useQuery({ queryKey: ["credits-balance"], queryFn: () => apiClient.get<CreditBalance>("/credits/balance") });
  const packsQuery = useQuery({ queryKey: ["credit-packs"], queryFn: () => apiClient.get<PacksResp>("/credits/packs"), retry: false });
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

  // "Stay on Scout for now" — clears ONLY the pending_plan flag server-side; tier/credits/trial
  // are untouched (they already reflect the entitled Scout baseline).
  const dismissPending = useMutation({
    mutationFn: () => apiClient.post("/billing/dismiss-pending", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });

  // Buy a one-time credit pack — launches the admin-gated Stripe Checkout (saves the card
  // off_session for auto-refill), shows a mono loading state, then hard-redirects to the sheet.
  const [charging, setCharging] = useState(false);
  // These MUST be declared before any early return below — otherwise the hook count changes between
  // the loading and loaded renders (Rules of Hooks), which crashed the Billing page.
  const [billingMsg, setBillingMsg] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [payModal, setPayModal] = useState<{ plan: string; label: string; price: string; currency: BillingCurrency } | null>(null);
  // Localized billing currency (charged in USD/EUR/GBP). Detected from the browser locale only.
  const [locale, setLocale] = useState<string | undefined>(undefined);
  const [billingCur, setBillingCur] = useState<BillingCurrency>("USD");
  useEffect(() => {
    const lc = typeof navigator !== "undefined" ? navigator.language : undefined;
    setLocale(lc);
    setBillingCur(billingCurrencyForLocale(lc));
  }, []);
  const curSym = PRICING_SYMBOL[billingCur] ?? "$";
  const showCurSwitch = showsCurrencySwitcher(locale);
  const money = (usd: number | null | undefined) => {
    const v = priceInCurrency(usd ?? null, billingCur);
    return v === null ? "Custom" : `${curSym}${v}`;
  };
  // Refetch EVERY surface that shows tier/credits so the UI settles to one truth immediately after
  // activation: billing (Current plan + trial banner), the wallet, packs (bonus %), the credit
  // ledger, and the sidebar/workspace-access queries that also read the resolved tier.
  const refreshEntitlementSurfaces = () => {
    for (const key of ["billing", "credits-balance", "credit-packs", "credits-ledger", "workspace-settings", "me-access", "onboarding-status"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const startTrial = useMutation({
    mutationFn: () => apiClient.post("/start-trial", {}),
    onSuccess: () => { setBillingMsg(null); refreshEntitlementSurfaces(); },
    // A 409 means the trial is already active/used — that's not a hard error; refresh so the UI
    // reflects the real state (banner flips to the active trial) instead of leaving the button.
    onError: (e) => {
      let parsed: { error?: string; trial_used?: boolean } = {};
      try { parsed = JSON.parse((e as Error).message); } catch { /* non-JSON */ }
      if (parsed.trial_used) { refreshEntitlementSurfaces(); return; }
      setBillingMsg(parsed.error ?? "Could not start the trial.");
    },
  });
  async function handleBuyCredits(packId = "standard") {
    setCharging(true);
    try {
      const session = await apiClient.post<{ url?: string; error?: string }>("/credits/checkout-session", { pack_id: packId });
      if (session.url) { window.location.assign(session.url); return; } // redirecting away — keep loading
      if (session.error) { alert(session.error); setCharging(false); }
    } catch (e) {
      try { alert(JSON.parse((e as Error).message)?.error ?? "Could not start the credit purchase."); }
      catch { alert("Could not start the credit purchase."); }
      setCharging(false);
    }
  }

  if (query.isLoading) return <PageSkeleton />;
  const wallet = balanceQuery.data;
  const ledger = ledgerQuery.data?.ledger ?? [];
  // Meter denominator: included monthly + purchased (NOT the raw ledger grant-row sum). Matches the
  // sidebar exactly — same /credits/balance source, same math.
  const walletCapacity = wallet ? (wallet.capacity || (wallet.included_monthly_credits ?? 0) + (wallet.purchased_credits ?? 0) || wallet.remaining_credits || 0) : 0;
  const walletRemaining = wallet ? (wallet.remaining_credits ?? wallet.remaining ?? wallet.balance) : 0;
  const walletPct = wallet && walletCapacity > 0 ? Math.max(0, Math.min(100, Math.round((walletRemaining / walletCapacity) * 100))) : 0;
  const fmtCredits = (n: number) => n.toLocaleString();
  const billing = query.data ?? { plan: "free", seats_used: 1, seats_limit: 3, invoices: [] };
  const currentPlanId = normalizePlan(billing.plan);
  const currentPlan = PLAN_BY_ID[currentPlanId];
  // Trial countdown derives from the actual end date (set at activation), NOT plan === "trial" —
  // after onboarding the plan is e.g. "business" with a trial_ends_at, so the old check never fired.
  const trialEndsAt = wallet?.trial_ends_at ?? billing.trial_ends_at ?? null;
  const trialDaysLeft = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const trialActive = trialDaysLeft !== null && trialDaysLeft >= 0;
  async function pickPlan(planId: string) {
    // Already on this plan → manage the existing subscription via Stripe's hosted portal.
    if (planId === currentPlanId && billing.plan !== "free") {
      setBillingMsg(null); setBillingBusy(planId);
      const err = await openPortal();
      if (err) setBillingMsg(err);
      setBillingBusy(null);
      return;
    }
    // A new/different plan → embedded card entry on our own page (never a Stripe-hosted redirect).
    const target = PLAN_BY_ID[planId];
    if (!target) return;
    setBillingMsg(null);
    setPayModal({
      plan: planId,
      label: target.name,
      price: interval === "year" && target.priceAnnual != null ? `${money(target.priceAnnual)}/mo billed yearly` : `${money(target.priceMonthly)}/mo`,
      currency: billingCur,
    });
  }
  const seatPct = Math.min(Math.round((billing.seats_used / billing.seats_limit) * 100), 100);

  return (
    <div className="space-y-5">
      <CommandPageHeader
        variant="bar" icon={CreditCard} callsign="BILLING" title="Billing" subtitle="Manage your plan, payment details, and invoice history."
        secondaryActions={
          <button onClick={() => help.open("I have a question about my plan and AI credits.")}
            className="mt-1 flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[12px] transition-colors hover:border-[color:var(--section-accent)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <HelpCircle size={13} /> Get help
          </button>
        } />

      {/* Trial banner — driven by the real end date, not a plan string */}
      {trialActive && (
        <div className="rounded-sm border px-5 py-3.5 text-sm" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
          <span style={{ color: "var(--text-primary)" }}>
            {trialDaysLeft! > 0
              ? <><strong className="font-mono tabular-nums">{trialDaysLeft}</strong> day{trialDaysLeft === 1 ? "" : "s"} left in your trial. Upgrade any time to keep full access.</>
              : "Your trial ends today — upgrade to keep full access."}
          </span>
        </div>
      )}

      {/* Pending paid plan — user picked Command/Sovereign at onboarding but hasn't paid. They're on
          the free Scout baseline until they activate it below. */}
      {billing.pending_plan && (() => {
        // Sovereign is Custom/"Talk to us" (no self-serve price) — it must route to contact/support,
        // never a faked checkout. Command has a real price → the existing checkout flow.
        const isCustom = PLAN_BY_ID[normalizePlan(billing.pending_plan)]?.priceMonthly == null;
        return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border px-5 py-3.5 text-sm" style={{ borderColor: "#a3946b55", background: "#a3946b18" }}>
          <span style={{ color: "var(--text-primary)" }}>
            You selected <strong className="capitalize">{billing.pending_plan}</strong> during onboarding — {isCustom
              ? "it's a custom plan, so our team sets it up with you. You're on the free Scout tier until then."
              : "it needs payment to activate. You're on the free Scout tier until then."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {isCustom ? (
              <button onClick={() => help.open(`I'd like to activate the ${billing.pending_plan} plan — please contact me about setup and pricing.`)}
                className="rounded-sm px-4 py-2 text-[12px] font-semibold text-black" style={{ background: "#a3946b" }}>
                Talk to us
              </button>
            ) : (
              <button onClick={() => pickPlan(normalizePlan(billing.pending_plan!))} disabled={!!billingBusy}
                className="rounded-sm px-4 py-2 text-[12px] font-semibold text-black disabled:opacity-60" style={{ background: "#a3946b" }}>
                {billingBusy === normalizePlan(billing.pending_plan!) ? "Opening…" : "Complete checkout"}
              </button>
            )}
            <button onClick={() => dismissPending.mutate()} disabled={dismissPending.isPending}
              className="rounded-sm border px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60"
              style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
              {dismissPending.isPending ? "…" : "Stay on Scout for now"}
            </button>
          </div>
        </div>
        );
      })()}

      {/* One-time 14-day Operator trial — offered anytime until used (the "decide later" path).
          Hidden while a trial is already running so the two trial banners never show together. */}
      {billing.trial_eligible && !trialActive && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border px-5 py-3.5 text-sm" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
          <span style={{ color: "var(--text-primary)" }}>
            Try <strong>Operator</strong> free for 14 days — full autonomous workspace, {fmtCredits(PLAN_BY_ID.operator?.monthlyCredits ?? 0)} AI credits. No card required.
          </span>
          <button onClick={() => startTrial.mutate()} disabled={startTrial.isPending}
            className="shrink-0 rounded-sm px-4 py-2 text-[12px] font-semibold text-black disabled:opacity-60" style={{ background: "var(--accent)" }}>
            {startTrial.isPending ? "Starting…" : "Start 14-day trial"}
          </button>
        </div>
      )}

      {/* ── Plan ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Current plan</h2>
          <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--surface-selected)", color: "var(--section-accent)" }}>
            {currentPlan?.name ?? "Scout"}{trialActive ? " · trial" : ""}
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {currentPlan?.name ?? "Scout"}
                {currentPlan && currentPlan.priceMonthly !== null && (
                  <span className="ml-2 font-mono text-xs font-normal text-[var(--text-muted)]">
                    {currentPlan.priceMonthly === 0 ? "free" : `${money(currentPlan.priceMonthly)}/mo`}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                {trialActive
                  ? `Trial ends ${new Date(trialEndsAt!).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : billing.next_billing_date
                  ? `Next billing on ${new Date(billing.next_billing_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : "No upcoming charge"}
              </p>
            </div>
            <button
              onClick={() => { void pickPlan(billing.plan === "free" ? "operator" : currentPlanId); }}
              className="flex shrink-0 items-center gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-all"
            >
              <Zap size={13} /> {billing.plan === "free" ? "Upgrade plan" : "Manage plan"}
            </button>
          </div>

          {/* Seats — single-operator tiers (Scout/Operator) have no team, so we show a clear line and
              an upgrade nudge instead of an empty progress bar. */}
          <div className="mt-5 rounded-sm border p-4" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-[var(--text-faint)]">
                <Users size={14} className="text-[var(--text-muted)]" /> {billing.seats_limit > 1 ? "Seats used" : "Operators"}
              </div>
              <span className="text-sm font-medium text-[var(--text-primary)]">{billing.seats_used} / {billing.seats_limit}</span>
            </div>
            {billing.seats_limit > 1 ? (
              <>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
                  <div
                    className={`h-full rounded-full transition-all ${seatPct >= 90 ? "bg-[#d1524a]" : seatPct >= 70 ? "bg-[#c6892e]" : "bg-[#2f9e6b]"}`}
                    style={{ width: `${Math.max(seatPct, 3)}%` }}
                  />
                </div>
                {seatPct >= 90 && (
                  <p className="mt-2 text-xs text-[var(--text-faint)]">You're nearly at your seat limit. Upgrade to add more members.</p>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">This plan is for a single operator. Upgrade to Command to invite your team.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Plans — every tier is directly purchasable; no plan is gated, no forced trial ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Plans</h2>
          <div className="flex items-center gap-2">
            {/* Billing-currency switcher — only when the local currency isn't already USD/EUR/GBP */}
            {showCurSwitch && (
              <div className="inline-flex items-center gap-0.5 text-[11px]">
                {BILLING_CURRENCIES.map(cc => (
                  <button key={cc} onClick={() => setBillingCur(cc)}
                    className="rounded-md px-2.5 py-1 font-medium transition-colors"
                    style={billingCur === cc
                      ? { background: "color-mix(in srgb, var(--text-primary) 5%, transparent)", color: "var(--text-primary)" }
                      : { color: "var(--text-muted)" }}>
                    {PRICING_SYMBOL[cc]} {cc}
                  </button>
                ))}
              </div>
            )}
            {/* Monthly / Annual billing toggle */}
            <div className="inline-flex items-center gap-0.5 text-[11px]">
              {(["month", "year"] as const).map(iv => (
                <button key={iv} onClick={() => setInterval(iv)}
                  className="rounded-md px-2.5 py-1 font-medium transition-colors"
                  style={interval === iv
                    ? { background: "color-mix(in srgb, var(--text-primary) 5%, transparent)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }}>
                  {iv === "month" ? "Monthly" : <>Annual <span style={{ color: "var(--section-accent)" }}>−20%</span></>}
                </button>
              ))}
            </div>
          </div>
        </div>
        {billingMsg && (
          <div className="mx-5 mt-4 rounded-sm border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
            {billingMsg}
          </div>
        )}
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlanId;
            // Only the CURRENT plan gets the accent border. "Popular" shows a badge, not a border —
            // otherwise Scout (current) + Operator (popular) both looked selected.
            const lit = isCurrent;
            return (
              <div key={plan.id} className="flex flex-col rounded-sm border p-4"
                style={{ borderColor: lit ? "var(--section-accent)" : "var(--border-soft)", background: "var(--surface-card-2)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-widest" style={{ color: lit ? "var(--section-accent)" : "var(--text-muted)" }}>{plan.name}</span>
                  {plan.highlight && !isCurrent && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>Popular</span>}
                </div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {plan.priceMonthly === null ? "Custom"
                    : plan.priceMonthly === 0 ? `${curSym}0`
                    : <>{money(interval === "year" ? plan.priceAnnual : plan.priceMonthly)}<span className="text-sm text-[var(--text-muted)]"> /mo</span></>}
                </div>
                {interval === "year" && plan.priceAnnual !== null && plan.priceAnnual > 0 && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{money((plan.priceAnnual ?? 0) * 12)} billed yearly</p>
                )}
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{plan.tagline}</p>
                <div className="mt-3 space-y-1 text-[11px] text-[var(--text-faint)]">
                  <div className="font-mono text-[var(--text-secondary)]">{plan.operators}</div>
                  <div className="font-mono text-[var(--text-secondary)]">{plan.credits}</div>
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-[11.5px] text-[var(--text-faint)]">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check size={11} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />{f}
                    </li>
                  ))}
                </ul>
                <button
                  disabled={isCurrent || billingBusy === plan.id}
                  onClick={() => { plan.priceMonthly === null ? (window.location.href = "mailto:sales@mondaily.com?subject=Sovereign%20plan") : void pickPlan(plan.id); }}
                  className="mt-4 flex min-h-[40px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60"
                  style={{ background: "var(--surface-selected)", borderColor: lit ? "var(--section-accent)" : "var(--border-strong)", color: "var(--text-primary)" }}
                  onMouseEnter={e => !isCurrent && (e.currentTarget.style.borderColor = "var(--section-accent)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = lit ? "var(--section-accent)" : "var(--border-strong)")}>
                  {isCurrent ? <><Check size={12} className="shrink-0" style={{ color: "var(--section-accent)" }} /> Current plan</> : billingBusy === plan.id ? "Opening…" : <span className="truncate">{plan.cta}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── AI usage (token telemetry) ── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI usage</h2>
          <span className="text-xs text-[var(--text-muted)]">This month · engine telemetry</span>
        </div>
        <div className="p-5">
          <p className="mb-3 text-[11px] text-[var(--text-faint)]">Raw engine telemetry for transparency — roughly 1 AI credit per token. Your billable balance is the AI credit wallet below.</p>
          {(() => {
            const u = usageQuery.data;
            const t = u?.totals;
            if (usageQuery.isLoading) return <p className="text-sm text-[var(--text-muted)]">Loading usage…</p>;
            if (!t || (t.total_tokens === 0 && t.messages === 0)) {
              return <p className="text-sm text-[var(--text-muted)]">No AI usage recorded yet this month. Totals appear here as your team chats and runs agents.</p>;
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
                    <div key={label} className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
                      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmt(val)}</div>
                    </div>
                  ))}
                </div>
                {(() => {
                  const bf = Object.entries(summaryQuery.data?.month.by_feature ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
                  if (!bf.length) return null;
                  const label = (k: string) => k === "discovery" ? "Discovery" : k === "chat" ? "Chat / Ask" : k === "other" ? "Other" : k.charAt(0).toUpperCase() + k.slice(1);
                  return (
                    <div className="mt-4">
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">By feature</div>
                      <div className="space-y-1.5">
                        {bf.map(([feat, v]) => (
                          <div key={feat} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 truncate text-[var(--text-faint)]">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--section-accent)" }} />{label(feat)}
                            </span>
                            <span className="font-mono tabular-nums text-[var(--text-primary)]">{fmt(v)} tokens</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {u && Object.entries(u.by_model).filter(([, mt]) => mt.total_tokens > 0).length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">By engine</div>
                    <div className="space-y-1.5">
                      {Object.entries(u.by_model)
                        .filter(([, mt]) => mt.total_tokens > 0)
                        .sort((a, b) => b[1].total_tokens - a[1].total_tokens)
                        .map(([model, mt]) => (
                          <div key={model} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 truncate text-[var(--text-faint)]">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--section-accent)" }} />
                              {prettyEngine(model)}
                            </span>
                            <span className="font-mono tabular-nums text-[var(--text-primary)]">{fmt(mt.total_tokens)} tokens</span>
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
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Wallet size={14} className="text-[var(--text-muted)]" /> AI credit wallet</h2>
            <span className="text-xs capitalize text-[var(--text-muted)]">{wallet.entitlement_tier ?? wallet.account_tier} tier{wallet.trial_ends_at ? " · trial" : ""}</span>
          </div>
          <div className="p-5">
            {/* Exhausted / low warnings — premium, not a harsh red box. Never shows a negative balance. */}
            {wallet.exhausted ? (
              <div className="mb-4 flex items-start gap-3 rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "#d1524a1a" }}><Zap size={12} style={{ color: "#d1524a" }} /></span>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">You're out of AI credits</p>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Chat, agents, enrichment and Discovery pause until you add a pack below or upgrade your plan. Nothing else is affected.</p>
                </div>
              </div>
            ) : wallet.low ? (
              <div className="mb-4 flex items-start gap-3 rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "#c6892e1a" }}><Zap size={12} style={{ color: "#c6892e" }} /></span>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Credits running low</p>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Top up below or enable Auto-Refill so AI never stops mid-task.</p>
                </div>
              </div>
            ) : null}
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-semibold tabular-nums" style={{ color: wallet.exhausted ? "#d1524a" : "var(--text-primary)" }}>{fmtCredits(walletRemaining)}</div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">AI credits remaining</div>
              </div>
              <span className="tabular-nums text-sm text-[var(--text-faint)]">{walletPct}%</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${walletPct}%`, background: walletPct <= 10 ? "#d1524a" : "var(--section-accent)" }} />
            </div>

            {/* One clear wallet summary — the exact figures, so nothing looks contradictory. */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["Included / mo", wallet.included_monthly_credits != null ? fmtCredits(wallet.included_monthly_credits) : "Custom"],
                ["Purchased", fmtCredits(wallet.purchased_credits ?? wallet.purchased ?? 0)],
                ["Used", fmtCredits(wallet.used_credits ?? wallet.used ?? 0)],
                ["Remaining", fmtCredits(walletRemaining)],
                ["Resets", new Date(wallet.reset_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })],
                ["Burst", wallet.burst && wallet.burst.cap > 0 ? `${fmtCredits(wallet.burst.used)} / ${fmtCredits(wallet.burst.cap)}` : "—"],
              ].map(([label, val]) => (
                <div key={label} className="rounded-sm border p-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
                  <div className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
                  <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{val}</div>
                </div>
              ))}
            </div>

            {/* Pay-as-you-go credit packs (from the shared catalog) + auto-refill toggle */}
            <div className="mt-5 rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2)" }}>
              <p className="text-sm font-medium text-[var(--text-primary)]">Buy AI credits</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Credits never expire.{packsQuery.data && packsQuery.data.plan_bonus_pct > 0 ? ` Your ${packsQuery.data.tier} plan adds +${Math.round(packsQuery.data.plan_bonus_pct * 100)}% to every pack.` : ""}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(packsQuery.data?.packs ?? []).map((p) => (
                  <button key={p.id} onClick={() => handleBuyCredits(p.id)} disabled={charging}
                    className="rounded-sm border px-3 py-2.5 text-left transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-60"
                    style={{ borderColor: "var(--border-soft)" }}>
                    <div className="text-[12px] font-semibold text-[var(--text-primary)]">{p.name} · ${p.price_usd}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-secondary)]">{fmtCredits(p.quote.final_credits)} credits</div>
                    {(p.quote.plan_bonus + p.quote.annual_bonus) > 0 && <div className="text-[10px] text-[var(--section-accent)]">+{fmtCredits(p.quote.plan_bonus + p.quote.annual_bonus)} bonus</div>}
                  </button>
                ))}
              </div>
              {charging && <p className="mt-2 font-mono text-xs tracking-wider text-[var(--text-muted)]">Opening secure checkout…</p>}
              <div className="mt-3 flex items-center justify-between gap-4 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Enable Auto-Refill</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">Automatically charge your card <span className="tabular-nums text-[var(--text-faint)]">$10</span> whenever the credit line falls below <span className="tabular-nums text-[var(--text-faint)]">5,000</span> units.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={autoRefill}
                  onClick={toggleAutoRefill}
                  className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                  style={{ background: autoRefill ? "var(--section-accent)" : "var(--surface-hover)" }}
                >
                  <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: autoRefill ? "1.5rem" : "0.125rem" }} />
                </button>
              </div>
              {/* Honest activation state: the toggle only ARMS the policy — a real charge needs a
                  saved card. Say exactly which state we're in rather than implying it's live. */}
              {autoRefill && (billing.card_last4
                ? <p className="mt-2 text-[11px] text-[#2f9e6b]">Auto-Refill active — will charge the card ending in {billing.card_last4} when credits run low.</p>
                : <p className="mt-2 text-[11px] text-[#c6892e]">Auto-Refill is armed but <span className="font-semibold">not active yet</span> — no saved card. Buy any credit pack once to save your card, and refills start working.</p>)}
            </div>
          </div>
        </section>
      )}

      {/* ── Credit ledger history ── */}
      {wallet?.enrolled && (
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Credit ledger</h2>
            <span className="text-xs text-[var(--text-muted)]">{ledger.length} transaction{ledger.length === 1 ? "" : "s"}</span>
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
                        <td className="whitespace-nowrap text-[var(--text-faint)]">{new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${row.transaction_type === "grant" ? "bg-[#2f9e6b]/10 text-[#2f9e6b]" : row.transaction_type === "purchase" ? "bg-[#717784]/10 text-[#717784]" : "bg-[var(--surface-hover)] text-[var(--text-muted)]"}`}>
                            {row.transaction_type}
                          </span>
                        </td>
                        <td className="max-w-[260px] truncate text-[var(--text-faint)]">{row.description ?? "—"}</td>
                        <td className={`whitespace-nowrap text-right tabular-nums ${positive ? "text-[#2f9e6b]" : "text-[var(--text-muted)]"}`}>
                          {positive ? "+" : "−"}{fmtCredits(Math.abs(row.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-[var(--text-muted)]">No credit transactions yet. Grants and AI usage will appear here in real time.</p>
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
            <div className="grid h-9 w-14 place-items-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
              <CreditCard size={16} className="text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-sm text-[var(--text-primary)]">Card ending in {billing.card_last4}</p>
              <p className="text-xs text-[var(--text-muted)]">Billing currency: {billingCur}</p>
            </div>
            <button
              onClick={() => { void openPortal().then(err => err && setBillingMsg(err)); }}
              className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
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
          <div className="minimal-sheet divide-y divide-[var(--border-soft)] px-5">
            {billing.invoices.map(inv => (
              <a
                key={inv.id}
                href={inv.pdf_url}
                className="flex items-center justify-between py-3.5 hover:text-[var(--text-primary)] transition-colors"
              >
                <div>
                  <p className="text-sm text-[var(--text-primary)]">{new Date(inv.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
                  <p className="text-xs text-[var(--text-muted)]">${(inv.amount / 100).toFixed(2)}</p>
                </div>
                <Download size={14} className="text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors" />
              </a>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-[var(--text-muted)]">No invoices yet. They'll appear here once you upgrade.</p>
        )}
      </section>

      {/* Embedded card entry — our own page, Stripe's secure Payment Element underneath */}
      {payModal && (
        <StripePaymentModal
          plan={payModal.plan}
          planLabel={payModal.label}
          priceLabel={payModal.price}
          interval={interval}
          currency={payModal.currency}
          onClose={() => setPayModal(null)}
          onSuccess={() => {
            setPayModal(null);
            qc.invalidateQueries({ queryKey: ["billing"] });
            qc.invalidateQueries({ queryKey: ["credits-balance"] });
            setBillingMsg(`You're now on ${payModal.label} — welcome aboard!`);
          }}
        />
      )}
    </div>
  );
}

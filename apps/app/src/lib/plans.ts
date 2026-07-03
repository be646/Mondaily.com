// ─── Plans — DERIVED from the shared pricing catalog (@mondaily/shared/pricing) ───
// This file no longer hardcodes prices/credits: it maps the one source of truth into the display
// shape the app's billing + onboarding UI already consumes. Change pricing in the catalog only.
import {
  PLAN_TIERS, PLAN_ORDER, CREDIT_PACKS, CREDIT_PACK_ORDER, computePackCredits, normalizeTierId,
  type TierId, type CreditPack, type BillingInterval,
} from "@mondaily/shared/pricing";

export { CREDIT_PACKS, CREDIT_PACK_ORDER, computePackCredits, type CreditPack, type BillingInterval, type TierId };

export interface Plan {
  id: TierId;
  name: string;
  tagline: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  seats: number;
  operators: string;
  credits: string;             // display string, e.g. "1M AI credits / mo"
  monthlyCredits: number | null;
  packBonusPct: number;
  highlight?: boolean;
  cta: string;
  features: string[];
}

/** 100_000 → "100k", 1_000_000 → "1M", 5_000_000 → "5M". */
export function fmtCredits(n: number): string {
  if (n >= 1_000_000) return `${n % 1_000_000 === 0 ? n / 1_000_000 : (n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const CTA: Record<TierId, string> = { scout: "Start free", operator: "Upgrade to Operator", command: "Upgrade to Command", sovereign: "Talk to us" };

export const PLANS: Plan[] = PLAN_ORDER.map((id) => {
  const t = PLAN_TIERS[id];
  return {
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    priceMonthly: t.priceMonthly,
    priceAnnual: t.priceAnnual,
    seats: t.seats,
    operators: t.seats >= 999 ? "Unlimited seats" : `${t.seats} seat${t.seats === 1 ? "" : "s"}`,
    credits: t.monthlyCredits === null ? "Custom AI credits" : `${fmtCredits(t.monthlyCredits)} AI credits / mo`,
    monthlyCredits: t.monthlyCredits,
    packBonusPct: t.packBonusPct,
    highlight: t.id === "operator",
    cta: CTA[t.id],
    features: t.features,
  };
});

export const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.id, p])) as Record<string, Plan>;

/** Normalize legacy/backend tier names to a plan id (uses the catalog's canonical mapping). */
export function normalizePlan(raw?: string | null): TierId {
  return normalizeTierId(raw);
}

export function priceLabel(p: Plan): string {
  if (p.priceMonthly === null) return "Custom";
  if (p.priceMonthly === 0) return "$0";
  return `$${p.priceMonthly}`;
}

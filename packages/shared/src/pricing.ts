/**
 * MONDAILY PRICING CATALOG — the ONE source of truth for plans, monthly AI-credit allotments,
 * burst caps, pay-as-you-go credit packs, and bonus rules. Imported by the backend (grants, usage
 * enforcement, Stripe checkout), the app (billing, onboarding), and the marketing site (landing
 * pricing, hero chat). Do NOT hardcode prices/credits anywhere else.
 *
 * Language rule: user-facing copy says "AI credits", never "tokens".
 */

export type TierId = "scout" | "operator" | "command" | "sovereign";
export type BillingInterval = "month" | "year";

export interface PlanTier {
  id: TierId;
  name: string;
  /** USD/month (billed monthly). null = custom (Sovereign). */
  priceMonthly: number | null;
  /** USD/month when billed annually. null = custom. */
  priceAnnual: number | null;
  /** Monthly included AI credits. null = custom (Sovereign). */
  monthlyCredits: number | null;
  /** Rolling-window burst ceiling (see BURST_WINDOW_HOURS) — stops draining a month in minutes. */
  burstCap: number;
  /** Plan bonus applied to credit-pack purchases (0, 0.10, 0.20). */
  packBonusPct: number;
  /** Seat limit for the workspace. */
  seats: number;
  tagline: string;
  features: string[];
}

/** Extra credit-pack bonus for annual subscribers (added to the plan bonus). */
export const ANNUAL_BONUS_PCT = 0.10;
/** Rolling burst window (hours). */
export const BURST_WINDOW_HOURS = 5;

export const PLAN_TIERS: Record<TierId, PlanTier> = {
  scout: {
    id: "scout", name: "Scout", priceMonthly: 0, priceAnnual: 0,
    monthlyCredits: 100_000, burstCap: 60_000, packBonusPct: 0, seats: 1,
    tagline: "Free — get started with AI-run operations.",
    features: ["1 seat", "100,000 AI credits / month", "Graph, tasks, lists & sheets", "Ask Mondaily + agents", "Discovery search"],
  },
  operator: {
    id: "operator", name: "Operator", priceMonthly: 29, priceAnnual: 23,
    monthlyCredits: 1_000_000, burstCap: 400_000, packBonusPct: 0.10, seats: 5,
    tagline: "For growing teams that run on AI.",
    features: ["Up to 5 seats", "1,000,000 AI credits / month", "Discovery deep research + enrichment", "Decision Queue + workflows", "Finance & billing", "+10% credit-pack bonus"],
  },
  command: {
    id: "command", name: "Command", priceMonthly: 79, priceAnnual: 63,
    monthlyCredits: 5_000_000, burstCap: 1_500_000, packBonusPct: 0.20, seats: 20,
    tagline: "For scaling operations & oversight.",
    features: ["Up to 20 seats", "5,000,000 AI credits / month", "Team Intelligence / Oversight", "Everything in Operator", "+20% credit-pack bonus", "Priority support"],
  },
  sovereign: {
    id: "sovereign", name: "Sovereign", priceMonthly: null, priceAnnual: null,
    monthlyCredits: null, burstCap: 5_000_000, packBonusPct: 0.20, seats: 999,
    tagline: "Custom — private/self-hosted infrastructure.",
    features: ["Unlimited seats", "Custom AI credit allotment", "Self-hosted inference/search/DB", "Encryption/KMS, audit logs, SLAs", "Dedicated support"],
  },
};

export const PLAN_ORDER: TierId[] = ["scout", "operator", "command", "sovereign"];

export interface CreditPack { id: string; name: string; price_usd: number; base_credits: number }

export const CREDIT_PACKS: Record<string, CreditPack> = {
  starter: { id: "starter", name: "Starter", price_usd: 5, base_credits: 50_000 },
  standard: { id: "standard", name: "Standard", price_usd: 10, base_credits: 125_000 },
  power: { id: "power", name: "Power", price_usd: 25, base_credits: 400_000 },
  team: { id: "team", name: "Team", price_usd: 50, base_credits: 1_000_000 },
};

export const CREDIT_PACK_ORDER = ["starter", "standard", "power", "team"];

export interface PackQuote {
  pack_id: string;
  base_credits: number;
  plan_bonus: number;
  annual_bonus: number;
  final_credits: number;
  plan_bonus_pct: number;
  annual_bonus_pct: number;
}

/**
 * Compute the exact credits a pack yields for a tier + billing interval. Bonuses are a percentage
 * of the BASE (they do not compound). This is the SINGLE calculator — the backend uses it to grant
 * and to stamp Stripe metadata; the UI uses it to display. They can never disagree.
 */
export function computePackCredits(packId: string, tier: TierId, interval: BillingInterval): PackQuote {
  const pack = CREDIT_PACKS[packId];
  const base = pack?.base_credits ?? 0;
  const planPct = PLAN_TIERS[tier]?.packBonusPct ?? 0;
  const annualPct = interval === "year" ? ANNUAL_BONUS_PCT : 0;
  const plan_bonus = Math.round(base * planPct);
  const annual_bonus = Math.round(base * annualPct);
  return {
    pack_id: packId,
    base_credits: base,
    plan_bonus,
    annual_bonus,
    final_credits: base + plan_bonus + annual_bonus,
    plan_bonus_pct: planPct,
    annual_bonus_pct: annualPct,
  };
}

/** Normalize any legacy/raw tier string to a canonical TierId. "business" → operator (legacy). */
export function normalizeTierId(t?: string | null): TierId {
  const s = (t ?? "").toLowerCase();
  if (s === "operator" || s === "command" || s === "sovereign" || s === "scout") return s;
  if (s === "business") return "operator";
  return "scout";
}

/** Monthly included credits for a tier (null = custom/Sovereign → treated as a large fixed grant). */
export function monthlyCreditsFor(tier: TierId): number | null {
  return PLAN_TIERS[tier]?.monthlyCredits ?? null;
}

/** The concrete grant amount to seed a wallet for a tier. Sovereign (custom) seeds a large default. */
export const SOVEREIGN_DEFAULT_GRANT = 10_000_000;
export function grantAmountFor(tier: TierId): number {
  return monthlyCreditsFor(tier) ?? SOVEREIGN_DEFAULT_GRANT;
}

export function burstCapFor(tier: TierId): number {
  return PLAN_TIERS[tier]?.burstCap ?? PLAN_TIERS.scout.burstCap;
}

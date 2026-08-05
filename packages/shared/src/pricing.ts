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

// ─── Multi-currency pricing ───────────────────────────────────────────────────
// We CHARGE in one of three billing currencies only (real Stripe currency_options).
// Everything else gets an approximate LOCAL reference so the user understands the cost,
// but must pick one of the three to actually pay in.
export const BILLING_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

// Units per 1 USD. The three billing currencies are FIXED here and MUST match the Stripe
// currency_options we create (see scripts/stripe-setup-prices) so the displayed price always
// equals the charged price. The rest are approximate references for local display only.
export const PRICING_FX: Record<string, number> = {
  USD: 1, EUR: 0.88, GBP: 0.75, // ← billing currencies (fixed, == Stripe amounts)
  PLN: 3.8, CAD: 1.37, AUD: 1.52, CHF: 0.80, JPY: 162, SEK: 10.6, NOK: 10.9, DKK: 6.55,
  CZK: 21.3, HUF: 355, RON: 4.55, BGN: 1.72, TRY: 39, ZAR: 18, INR: 84, BRL: 5.5,
  MXN: 18.5, SGD: 1.35, HKD: 7.8, NZD: 1.65, AED: 3.67, SAR: 3.75,
};

export const PRICING_SYMBOL: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", PLN: "zł", CAD: "C$", AUD: "A$", CHF: "Fr", JPY: "¥",
  SEK: "kr", NOK: "kr", DKK: "kr", CZK: "Kč", HUF: "Ft", RON: "lei", BGN: "лв", TRY: "₺",
  ZAR: "R", INR: "₹", BRL: "R$", MXN: "Mex$", SGD: "S$", HKD: "HK$", NZD: "NZ$", AED: "د.إ", SAR: "﷼",
};

/** Round a converted price to a clean, currency-appropriate whole number. */
export function roundPrice(amount: number, currency: string): number {
  if (currency === "JPY" || currency === "HUF") return Math.round(amount / 10) * 10; // no minor unit
  return Math.round(amount);
}

/** Convert a USD plan price into any currency using the fixed pricing snapshot. null/0 pass through. */
export function priceInCurrency(usd: number | null, currency: string): number | null {
  if (usd === null) return null;
  if (usd === 0) return 0;
  const fx = PRICING_FX[currency] ?? 1;
  return roundPrice(usd * fx, currency);
}

// region (from a BCP-47 locale like "pl-PL", "de-DE") → currency. Sovereign: derived from the
// browser locale only, never a geo-IP lookup.
const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR",
  BE: "EUR", AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", SK: "EUR", SI: "EUR", LU: "EUR",
  PL: "PLN", CA: "CAD", AU: "AUD", CH: "CHF", JP: "JPY", SE: "SEK", NO: "NOK", DK: "DKK",
  CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", ZA: "ZAR", IN: "INR", BR: "BRL",
  MX: "MXN", SG: "SGD", HK: "HKD", NZ: "NZD", AE: "AED", SA: "SAR",
};

/** Best-guess local currency from a BCP-47 locale (e.g. "en-GB" → GBP). Defaults to USD. */
export function localeToCurrency(locale: string | undefined): string {
  if (!locale) return "USD";
  const region = locale.split("-")[1]?.toUpperCase();
  return (region && REGION_CURRENCY[region]) || "USD";
}

/** Which of the 3 billing currencies to default to for a given local currency / locale. */
export function billingCurrencyForLocale(locale: string | undefined): BillingCurrency {
  const local = localeToCurrency(locale);
  if ((BILLING_CURRENCIES as readonly string[]).includes(local)) return local as BillingCurrency;
  // Euro-zone-ish and GB already covered above; everyone else defaults to USD.
  const region = locale?.split("-")[1]?.toUpperCase();
  if (region && REGION_CURRENCY[region] === "EUR") return "EUR";
  return "USD";
}

/** The switcher is only offered when the user's LOCAL currency isn't already a billing currency. */
export function showsCurrencySwitcher(locale: string | undefined): boolean {
  return !(BILLING_CURRENCIES as readonly string[]).includes(localeToCurrency(locale));
}

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

/**
 * The plans, packs and bonuses in prose — the ONE description every assistant quotes.
 *
 * This lived privately inside the marketing chat, so the public bot could answer "what does Command
 * cost?" while the in-app support agent talking to a PAYING customer could not. The numbers were
 * always derived from PLAN_TIERS above; only the wording was stranded. Now both read the same text,
 * and a price change updates every assistant at once.
 */
export function pricingFacts(): string {
  // monthlyCredits is nullable (Sovereign is custom), so say "custom" rather than crash or
  // print a confident zero — an assistant quoting "0 credits" would be worse than vague.
  const fmt = (n: number | null | undefined) => (n == null ? "custom" : n.toLocaleString("en-US"));
  return [
    "PLANS (monthly, with included AI credits):",
    `- Scout: free — ${fmt(PLAN_TIERS.scout.monthlyCredits)} AI credits/month, 1 seat.`,
    `- Operator: $${PLAN_TIERS.operator.priceMonthly}/mo — ${fmt(PLAN_TIERS.operator.monthlyCredits)} AI credits/month, up to ${PLAN_TIERS.operator.seats} seats, +10% credit-pack bonus.`,
    `- Command: $${PLAN_TIERS.command.priceMonthly}/mo — ${fmt(PLAN_TIERS.command.monthlyCredits)} AI credits/month, up to ${PLAN_TIERS.command.seats} seats, +20% credit-pack bonus.`,
    "- Sovereign: custom — custom AI credits, private/self-hosted infrastructure.",
    "PAY-AS-YOU-GO CREDIT PACKS: " + CREDIT_PACK_ORDER.map((id) => {
      const p = CREDIT_PACKS[id]!;
      return `${p.name} $${p.price_usd} → ${fmt(p.base_credits)} credits`;
    }).join("; ") + ".",
    `Pack bonuses: Operator +10%, Command +20%, and annual subscriptions add another +${Math.round(ANNUAL_BONUS_PCT * 100)}%.`,
    "Say 'AI credits', never 'tokens'. Do NOT claim unlimited AI — credits are metered. Manual CRUD (creating/editing records) does not use AI credits; AI chat, agents, enrichment, Discovery deep research, report generation, and workflow drafting do.",
  ].join("\n");
}


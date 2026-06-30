// ─── Plans — single source of truth for tiers (billing + onboarding + home) ───
// Positioning: an Autonomous AI Workspace. Value metric = operators + AI credits,
// not "seats/CRM". Flat pricing, Free converts, every tier is directly purchasable
// (no forced trial — buy upfront or start free, your choice).

export interface Plan {
  id: string;                 // matches backend STRIPE_PRICE_<ID>_<INTERVAL>
  name: string;
  tagline: string;
  priceMonthly: number | null; // null = custom (contact)
  operators: string;
  credits: string;
  highlight?: boolean;        // featured tier
  cta: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "scout",
    name: "Scout",
    tagline: "Run your first autonomous operations.",
    priceMonthly: 0,
    operators: "1 operator",
    credits: "50k AI credits / mo",
    cta: "Start free",
    features: [
      "Full workspace + records",
      "1 live autonomous agent",
      "3 automations",
      "Mondaily AI chat",
    ],
  },
  {
    id: "operator",
    name: "Operator",
    tagline: "Your full autonomous workspace.",
    priceMonthly: 29,
    operators: "1 operator",
    credits: "500k AI credits / mo",
    highlight: true,
    cta: "Upgrade to Operator",
    features: [
      "Everything in Scout",
      "Unlimited autonomous agents",
      "Unlimited automations",
      "Finance + billing suite",
      "Discovery + enrichment",
      "Priority AI responses",
    ],
  },
  {
    id: "command",
    name: "Command",
    tagline: "Run a team of operators + agents.",
    priceMonthly: 79,
    operators: "Up to 10 operators",
    credits: "2M AI credits / mo",
    cta: "Upgrade to Command",
    features: [
      "Everything in Operator",
      "Team Oversight + audit trail",
      "Shared command center",
      "Priority agent execution",
      "Role-based access",
    ],
  },
  {
    id: "sovereign",
    name: "Sovereign",
    tagline: "Autonomy at enterprise scale.",
    priceMonthly: null,
    operators: "Unlimited operators",
    credits: "Custom AI credits",
    cta: "Talk to us",
    features: [
      "Everything in Command",
      "SSO + SAML",
      "Dedicated agents + SLA",
      "Audit export + compliance",
      "Onboarding + success manager",
    ],
  },
];

export const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.id, p])) as Record<string, Plan>;

/** Normalize legacy/backend tier names to a plan id. */
export function normalizePlan(raw?: string | null): string {
  switch ((raw ?? "").toLowerCase()) {
    case "operator": case "command": case "sovereign": case "scout":
      return (raw as string).toLowerCase();
    case "pro": case "business": case "personal":
      return raw === "business" ? "command" : "operator"; // legacy → closest tier
    case "trial":
      return "operator"; // trials sample the Operator tier
    case "free": default:
      return "scout";
  }
}

export function priceLabel(p: Plan): string {
  if (p.priceMonthly === null) return "Custom";
  if (p.priceMonthly === 0) return "$0";
  return `$${p.priceMonthly}`;
}

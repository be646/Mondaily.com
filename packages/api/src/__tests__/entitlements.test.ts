import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveEntitlement } from "../lib/entitlements";

const AT = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();

describe("resolveEntitlement — ONE tier resolver for every surface", () => {
  it("free Scout when nothing is set", () => {
    const e = resolveEntitlement({});
    expect(e.tier).toBe("scout");
    expect(e.source).toBe("free");
    expect(e.includedMonthlyCredits).toBe(100_000);
    expect(e.seats).toBe(1);
  });

  it("active PAID plan resolves to its tier", () => {
    const e = resolveEntitlement({ account_tier: "command", billing_status: "active", stripe_subscription_id: "sub_1" });
    expect(e.tier).toBe("command");
    expect(e.source).toBe("paid");
    expect(e.includedMonthlyCredits).toBe(5_000_000);
    expect(e.seats).toBe(20);
  });

  it("active TRIAL resolves to Operator with 1,000,000 included (the screenshot account)", () => {
    const e = resolveEntitlement({ account_tier: "operator", trial_ends_at: AT(10) });
    expect(e.tier).toBe("operator");
    expect(e.source).toBe("trial");
    expect(e.isTrial).toBe(true);
    expect(e.includedMonthlyCredits).toBe(1_000_000);   // NOT 500k / 50k
  });

  it("EXPIRED trial falls back to Scout (no lingering Operator)", () => {
    const e = resolveEntitlement({ account_tier: "operator", trial_ends_at: AT(-1) });
    expect(e.tier).toBe("scout");
    expect(e.source).toBe("free");
  });

  it("cancelled billing always downgrades to Scout", () => {
    const e = resolveEntitlement({ account_tier: "command", billing_status: "cancelled", stripe_subscription_id: "sub_1" });
    expect(e.tier).toBe("scout");
  });

  it("a PENDING unpaid plan does NOT count as active — stays Scout, surfaces the pending nudge", () => {
    const e = resolveEntitlement({ account_tier: "scout", pending_plan: "command" });
    expect(e.tier).toBe("scout");           // never granted for free
    expect(e.source).toBe("free");
    expect(e.pendingPlan).toBe("command");  // still surfaced so billing can prompt payment
  });

  it("does NOT resolve tier from the coarse `track` flag (the old cross-surface bug)", () => {
    // account_tier missing, only track=business set → must NOT silently become Operator.
    const e = resolveEntitlement({ track: "business" });
    expect(e.tier).toBe("scout");
  });

  it("legacy 'business' account_tier normalizes to Operator", () => {
    const e = resolveEntitlement({ account_tier: "business", billing_status: "active", stripe_subscription_id: "s" });
    expect(e.tier).toBe("operator");
  });
});

describe("reconciliation makes included credits usable (source-read guards)", () => {
  const credits = readFileSync(fileURLToPath(new URL("../lib/credits.ts", import.meta.url)), "utf8");
  it("tops grant rows up to the entitlement target (included credits become usable)", () => {
    const fn = credits.slice(credits.indexOf("export async function reconcileIncludedCredits"));
    expect(fn).toMatch(/const target = grantAmountFor\(ent\.tier\)/);
    expect(fn).toMatch(/const shortfall = target - \(granted \?\? 0\)/);
  });
  it("is idempotent — a shortfall of ≤ 0 grants nothing (never double-grants)", () => {
    const fn = credits.slice(credits.indexOf("export async function reconcileIncludedCredits"));
    expect(fn).toMatch(/if \(shortfall <= 0\) return 0/);
  });
  it("only ever inserts a 'grant' — purchase and usage rows are never touched (preserved)", () => {
    const fn = credits.slice(credits.indexOf("export async function reconcileIncludedCredits"), credits.indexOf("export async function reconcileIncludedCredits") + 1600);
    expect(fn).toMatch(/grantCredits\(workspaceId, shortfall, "grant"/);
    expect(fn).not.toMatch(/transaction_type.*(purchase|usage)/);
  });
  it("balance endpoint self-heals on read (calls reconcile before reporting)", () => {
    const route = readFileSync(fileURLToPath(new URL("../routes/credits.ts", import.meta.url)), "utf8");
    expect(route).toMatch(/reconcileIncludedCredits\(ws/);
    expect(route).toMatch(/remaining_credits/);
    expect(route).toMatch(/included_monthly_credits/);
  });
});

describe("all tier-reading surfaces funnel through the single resolver", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("app-data /billing + /me/access use resolveEntitlement (not ad-hoc account_tier ?? track)", () => {
    const src = read("../routes/app-data.ts");
    expect(src).toMatch(/resolveEntitlement\(settings/);
    expect(src).not.toMatch(/account_tier as string\) \?\? \(settings\.track as string\) \?\? "scout"/);
  });
  it("credits /balance, /packs use getEntitlement", () => {
    const src = read("../routes/credits.ts");
    expect((src.match(/getEntitlement\(ws\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("plan-limits + credit-pack delegate to getEntitlement", () => {
    expect(read("../lib/plan-limits.ts")).toMatch(/getEntitlement\(workspaceId\)/);
    expect(read("../lib/credit-pack.ts")).toMatch(/getEntitlement\(workspaceId\)/);
  });
  it("billing-tiers no longer defaults unknown tiers to Operator", () => {
    const src = read("../lib/billing-tiers.ts");
    expect(src).toMatch(/return normalizeTierId\(raw\)/);
    expect(src).not.toMatch(/\? raw\.toLowerCase\(\) : "operator"/);
  });
});

describe("sidebar + billing share ONE balance source, no stale 50k/500k/2M strings", () => {
  const sidebar = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/layout/sidebar.tsx", import.meta.url)), "utf8");
  const billing = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/billing.tsx", import.meta.url)), "utf8");
  it("both read the same /credits/balance endpoint", () => {
    expect(sidebar).toMatch(/apiClient\.get\("\/credits\/balance"\)/);
    expect(billing).toMatch(/apiClient\.get<CreditBalance>\("\/credits\/balance"\)/);
  });
  it("sidebar meter denominator is capacity (included + purchased) — NOT balance/granted", () => {
    expect(sidebar).toMatch(/walletCapacity/);
    expect(sidebar).toMatch(/wallet\.remaining/);
    expect(sidebar).not.toMatch(/wallet\.granted/);                       // never the raw grant-row sum
    expect(sidebar).not.toMatch(/wallet\.balance\s*\/\s*wallet\.granted/);// the old ratio
    expect(sidebar).not.toMatch(/\/\s*\{?wallet\.granted/);               // granted as visible denominator
  });
  it("sidebar wallet type carries the shared balance model (remaining/included/purchased/used/tier)", () => {
    const decl = sidebar.slice(sidebar.indexOf("const { data: wallet } = useQuery<"), sidebar.indexOf("queryKey: [\"credits-balance\"]"));
    for (const field of ["remaining", "included_monthly", "purchased", "used", "account_tier"]) {
      expect(decl, `wallet type should include ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
  it("no hardcoded stale credit strings in either surface", () => {
    for (const src of [sidebar, billing]) {
      expect(src).not.toMatch(/50k credits|500k credits|2M credits|500,000 credits|50,000 credits/);
    }
  });
});

describe("Start 14-day trial — one consistent activation, no double-grant", () => {
  const appData = readFileSync(fileURLToPath(new URL("../routes/app-data.ts", import.meta.url)), "utf8");
  const credits = readFileSync(fileURLToPath(new URL("../lib/credits.ts", import.meta.url)), "utf8");
  const billing = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/billing.tsx", import.meta.url)), "utf8");
  const startTrial = appData.slice(appData.indexOf('router.post("/start-trial"'), appData.indexOf('router.post("/start-trial"') + 2900);

  it("activates the Operator trial: account_tier=operator, trial_used, trial_ends_at, plan column", () => {
    expect(startTrial).toMatch(/account_tier: "operator"/);
    expect(startTrial).toMatch(/trial_used: true/);
    expect(startTrial).toMatch(/trial_ends_at: trialEndsAt/);
    expect(startTrial).toMatch(/plan: "operator"/);   // top-level column in lockstep
  });

  it("tops credits up via the SHARED grant-row reconciler — NOT the old balance-delta grant", () => {
    expect(startTrial).toMatch(/reconcileIncludedCredits\(ws, \{ enrollIfEmpty: true \}\)/);
    // the buggy balance-based delta grant that caused "1,000,000 / 550,000" must be gone
    expect(startTrial).not.toMatch(/grantAmountFor\("operator"\) - balance/);
    expect(startTrial).not.toMatch(/creditStatus\(ws\)/);
  });

  it("only grants the missing shortfall and is idempotent (no double-grant on re-run)", () => {
    const fn = credits.slice(credits.indexOf("export async function reconcileIncludedCredits"));
    expect(fn).toMatch(/const shortfall = target - \(granted \?\? 0\)/);
    expect(fn).toMatch(/if \(shortfall <= 0\) return 0/);   // second activation adds nothing
  });

  it("a second click is blocked: trial_used → 409 that still returns the resolved state", () => {
    expect(startTrial).toMatch(/if \(settings\.trial_used\)/);
    expect(startTrial).toMatch(/trial_used: true, plan: ent\.tier/);
    expect(startTrial).toMatch(/\}, 409\)/);
  });

  it("returns the fresh resolved entitlement so the UI can settle immediately", () => {
    expect(startTrial).toMatch(/const ent = await getEntitlement\(ws\)/);
    expect(startTrial).toMatch(/ok: true, plan: ent\.tier, source: ent\.source/);
  });

  it("frontend refetches EVERY tier/credit surface after activation (banner hides, tiers agree)", () => {
    for (const key of ["billing", "credits-balance", "credit-packs", "workspace-settings"]) {
      expect(billing, `should invalidate ${key}`).toMatch(new RegExp(`"${key}"`));
    }
    expect(billing).toMatch(/refreshEntitlementSurfaces/);
    // the Start button is gated on trial_eligible, which the backend flips to false on activation
    expect(billing).toMatch(/billing\.trial_eligible/);
  });
});

describe("REPRO: plan-check constraint disconnect (1M credits but tier still Scout)", () => {
  it("the broken live state — grant landed, settings markers did NOT — resolves to Scout", () => {
    // Exactly what the DB showed: settings has no account_tier / trial_ends_at, plan column = 'trial'.
    const e = resolveEntitlement({ track: "business" }, "trial");
    expect(e.tier).toBe("scout");                 // 'trial' normalizes to scout — the disconnect
    expect(e.includedMonthlyCredits).toBe(100_000);
  });
  it("Scout NEVER advertises 1,000,000 included credits", () => {
    expect(resolveEntitlement({}, "trial").includedMonthlyCredits).toBe(100_000);
    expect(resolveEntitlement({ track: "business" }).includedMonthlyCredits).toBe(100_000);
  });
  it("once the trial is ACTUALLY activated (markers persisted), it resolves to Operator trial + 1M", () => {
    const future = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const e = resolveEntitlement({ account_tier: "operator", track: "business", trial_used: true, trial_ends_at: future }, "operator");
    expect(e.tier).toBe("operator");
    expect(e.source).toBe("trial");
    expect(e.includedMonthlyCredits).toBe(1_000_000);
  });
});

describe("plan-column write can never roll back the settings write (the fix)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  const appData = read("../routes/app-data.ts");
  const onboarding = read("../routes/onboarding.ts");
  const billingTiers = read("../lib/billing-tiers.ts");

  it("start-trial writes settings on its own CHECKED statement, fails closed, THEN grants", () => {
    const fn = appData.slice(appData.indexOf('router.post("/start-trial"'), appData.indexOf('router.post("/start-trial"') + 2900);
    expect(fn).toMatch(/const \{ error: settingsErr \} = await supabase\.from\("workspaces"\)\.update\(\{\s*settings:/);
    expect(fn).toMatch(/if \(settingsErr\) return c\.json/);           // never grants if activation failed
    // the plan column is a SEPARATE, tolerated write — not combined with settings
    expect(fn).toMatch(/\.update\(\{ plan: "operator" \}\)\.eq\("id", ws\)\.then\(\(\) => \{\}, \(\) => \{\}\)/);
    expect(fn).not.toMatch(/update\(\{\s*plan: "operator",\s*settings:/);
  });
  it("onboarding + activateTier also split settings from the constrained plan column", () => {
    expect(onboarding).toMatch(/\.update\(\{ plan: effectiveTier \}\).*then/);
    expect(onboarding).not.toMatch(/onboarded: true,\s*plan: effectiveTier,\s*settings:/);
    expect(billingTiers).toMatch(/const \{ error: settingsErr \} = await supabase[\s\S]*update\(\{ settings \}\)/);
    expect(billingTiers).toMatch(/\.update\(\{ plan: tier \}\).*then/);
  });
});

describe("capacity is floored at remaining (no 984k / 550k impossible ratio)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("backend /credits/balance floors capacity at remaining", () => {
    expect(read("../routes/credits.ts")).toMatch(/const capacity = Math\.max\(remaining,/);
  });
  it("sidebar floors the denominator at remaining", () => {
    expect(read("../../../../apps/app/src/components/layout/sidebar.tsx")).toMatch(/Math\.max\(wallet\.remaining,/);
  });
  it("diagnostics exposes the raw fields, resolved tier, and the mismatch flag", () => {
    const src = read("../routes/credits.ts");
    for (const f of ["workspaces_plan_column", "settings_account_tier", "settings_trial_ends_at", "resolved_tier", "resolved_why", "tier_credit_mismatch", "billing_plan_returned", "balance_account_tier_returned"]) {
      expect(src, `diagnostics should return ${f}`).toMatch(new RegExp(f));
    }
  });
});

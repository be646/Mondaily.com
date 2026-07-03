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
    expect(fn).toMatch(/const shortfall = target - granted/);
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
  it("sidebar meter denominator is capacity/included — NOT the raw grant-row sum", () => {
    expect(sidebar).toMatch(/walletCapacity/);
    expect(sidebar).not.toMatch(/wallet\.granted\.toLocaleString\(\)/);   // the stale "50,000" line
  });
  it("no hardcoded stale credit strings in either surface", () => {
    for (const src of [sidebar, billing]) {
      expect(src).not.toMatch(/50k credits|500k credits|2M credits|500,000 credits|50,000 credits/);
    }
  });
});

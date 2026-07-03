import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLAN_TIERS, CREDIT_PACKS, computePackCredits, grantAmountFor, monthlyCreditsFor, burstCapFor,
  normalizeTierId, ANNUAL_BONUS_PCT, PLAN_ORDER,
} from "@mondaily/shared/pricing";

describe("plan catalog consistency", () => {
  it("keeps the fixed plan names + base prices", () => {
    expect(PLAN_TIERS.scout.name).toBe("Scout");
    expect(PLAN_TIERS.scout.priceMonthly).toBe(0);
    expect(PLAN_TIERS.operator.priceMonthly).toBe(29);
    expect(PLAN_TIERS.command.priceMonthly).toBe(79);
    expect(PLAN_TIERS.sovereign.priceMonthly).toBeNull(); // custom
  });
  it("has the new monthly credit allotments", () => {
    expect(monthlyCreditsFor("scout")).toBe(100_000);
    expect(monthlyCreditsFor("operator")).toBe(1_000_000);
    expect(monthlyCreditsFor("command")).toBe(5_000_000);
    expect(monthlyCreditsFor("sovereign")).toBeNull();
  });
  it("plan pack-bonus percentages: scout 0, operator 10%, command 20%", () => {
    expect(PLAN_TIERS.scout.packBonusPct).toBe(0);
    expect(PLAN_TIERS.operator.packBonusPct).toBe(0.10);
    expect(PLAN_TIERS.command.packBonusPct).toBe(0.20);
    expect(ANNUAL_BONUS_PCT).toBe(0.10);
  });
  it("PLAN_ORDER is scout → operator → command → sovereign", () => {
    expect(PLAN_ORDER).toEqual(["scout", "operator", "command", "sovereign"]);
  });
  it("normalizeTierId maps legacy 'business' → operator and junk → scout", () => {
    expect(normalizeTierId("business")).toBe("operator");
    expect(normalizeTierId("BOGUS")).toBe("scout");
    expect(normalizeTierId("command")).toBe("command");
  });
});

describe("credit pack catalog", () => {
  it("has the four packs at the right price/base", () => {
    expect(CREDIT_PACKS.starter).toMatchObject({ price_usd: 5, base_credits: 50_000 });
    expect(CREDIT_PACKS.standard).toMatchObject({ price_usd: 10, base_credits: 125_000 });
    expect(CREDIT_PACKS.power).toMatchObject({ price_usd: 25, base_credits: 400_000 });
    expect(CREDIT_PACKS.team).toMatchObject({ price_usd: 50, base_credits: 1_000_000 });
  });
});

describe("computePackCredits — plan + annual bonus (matches the spec examples)", () => {
  it("scout gets NO bonus", () => {
    const q = computePackCredits("standard", "scout", "month");
    expect(q).toMatchObject({ base_credits: 125_000, plan_bonus: 0, annual_bonus: 0, final_credits: 125_000 });
  });
  it("Operator monthly + Standard = 125,000 + 12,500 = 137,500", () => {
    const q = computePackCredits("standard", "operator", "month");
    expect(q.plan_bonus).toBe(12_500);
    expect(q.annual_bonus).toBe(0);
    expect(q.final_credits).toBe(137_500);
  });
  it("Command annual + Team = 1,000,000 + 200,000 + 100,000 = 1,300,000", () => {
    const q = computePackCredits("team", "command", "year");
    expect(q.base_credits).toBe(1_000_000);
    expect(q.plan_bonus).toBe(200_000);   // 20% of base
    expect(q.annual_bonus).toBe(100_000); // 10% of base
    expect(q.final_credits).toBe(1_300_000);
  });
  it("bonuses are % of BASE and do not compound", () => {
    const q = computePackCredits("power", "command", "year"); // 400k base, +20%, +10%
    expect(q.final_credits).toBe(400_000 + 80_000 + 40_000);
  });
});

describe("grants + burst never bypass total credits", () => {
  it("grantAmountFor matches monthly allotment (sovereign = large default)", () => {
    expect(grantAmountFor("scout")).toBe(100_000);
    expect(grantAmountFor("operator")).toBe(1_000_000);
    expect(grantAmountFor("command")).toBe(5_000_000);
    expect(grantAmountFor("sovereign")).toBeGreaterThan(0);
  });
  it("every tier's burst cap is BELOW its monthly credits (burst can't exceed the wallet)", () => {
    for (const t of ["scout", "operator", "command"] as const) {
      expect(burstCapFor(t)).toBeLessThan(monthlyCreditsFor(t)!);
    }
  });
});

describe("backend enforcement + no-negative (source-read guards)", () => {
  const credits = readFileSync(fileURLToPath(new URL("../lib/credits.ts", import.meta.url)), "utf8");
  const gateway = readFileSync(fileURLToPath(new URL("../lib/ai-gateway.ts", import.meta.url)), "utf8");
  const pack = readFileSync(fileURLToPath(new URL("../lib/credit-pack.ts", import.meta.url)), "utf8");
  const webhook = readFileSync(fileURLToPath(new URL("../routes/webhooks.ts", import.meta.url)), "utf8");

  it("usage is CLAMPED so the wallet can never go below zero", () => {
    expect(credits).toMatch(/Math\.min\(Math\.round\(tokens\), Math\.max\(0, balance\)\)/);
  });
  it("assertCreditsOk fails closed at balance <= 0 (trial credits stop at zero too)", () => {
    expect(credits).toMatch(/if \(balance <= 0\)[\s\S]*CreditsExhaustedError/);
  });
  it("the AI gateway enforces credits BEFORE inference (not just /ask)", () => {
    expect(gateway).toMatch(/assertCreditsOk\(req\.workspaceId\)/);
    expect(gateway).toMatch(/aiGatewayToolUse[\s\S]*assertCreditsOk/);
  });
  it("credit-pack checkout stamps ALL required Stripe metadata", () => {
    for (const key of ["pack_id", "base_credits", "bonus_credits", "final_credits", "plan_tier", "billing_interval", "workspace_id", "user_id"]) {
      expect(pack).toMatch(new RegExp(`metadata\\[${key}\\]`));
    }
  });
  it("webhook grants the catalog-computed final_credits (bonus enforced, not UI-only)", () => {
    expect(webhook).toMatch(/final_credits/);
    expect(webhook).toMatch(/transaction_type: "purchase"/);
  });
  it("balance endpoint floors at zero (never shows negative)", () => {
    const route = readFileSync(fileURLToPath(new URL("../routes/credits.ts", import.meta.url)), "utf8");
    expect(route).toMatch(/const remaining = Math\.max\(0, rawBalance\)/);
    expect(route).toMatch(/router\.get\("\/diagnostics"/); // admin diagnostics exists
  });
});

describe("EVERY gateway path is credit-gated (no bypass)", () => {
  const gw = readFileSync(fileURLToPath(new URL("../lib/ai-gateway.ts", import.meta.url)), "utf8");
  it("plain aiGateway gates + meters when a workspaceId is provided", () => {
    // The plain-completion function now asserts credits and records usage.
    const fn = gw.slice(gw.indexOf("export async function aiGateway("), gw.indexOf("export async function aiGatewayToolUse"));
    expect(fn).toMatch(/assertCreditsOk\(req\.workspaceId\)/);
    expect(fn).toMatch(/recordAiUsage\(req\.workspaceId/);
  });
  it("aiGatewayComplete gates + meters when a workspaceId is provided", () => {
    const fn = gw.slice(gw.indexOf("export async function aiGatewayComplete"));
    expect(fn).toMatch(/assertCreditsOk\(req\.workspaceId\)/);
    expect(fn).toMatch(/recordAiUsage\(req\.workspaceId/);
  });
  it("all four public gateway entry points call assertCreditsOk", () => {
    for (const fnName of ["aiGateway(", "aiGatewayComplete(", "aiGatewayToolUse(", "aiGatewayAgent("]) {
      const start = gw.indexOf(`export async function ${fnName}`);
      expect(start, `${fnName} should exist`).toBeGreaterThan(-1);
    }
    // 4 public functions + the streaming variant = at least 5 assertCreditsOk call sites.
    expect((gw.match(/assertCreditsOk\(req\.workspaceId\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("public marketing chat intentionally has NO workspaceId (documented, unmetered, still sovereign)", () => {
    const pub = readFileSync(fileURLToPath(new URL("../routes/public-ask.ts", import.meta.url)), "utf8");
    expect(pub).toMatch(/aiGateway\(\{ system: SYSTEM/);      // uses the sovereign gateway
    expect(pub).not.toMatch(/workspaceId/);                    // never charges a workspace
  });
});

describe("no stale visible pricing copy (50k/500k/2M) in the onboarding + billing UI", () => {
  const files = [
    "../../../../apps/app/src/routes/onboarding/terminal-console.tsx",
    "../../../../apps/app/src/routes/dashboard/settings/billing.tsx",
  ];
  for (const rel of files) {
    it(`${rel.split("/").pop()} has no hardcoded stale credit strings`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src).not.toMatch(/50k credits|500k credits|2M credits|500,000 credits/);
    });
  }
  it("onboarding plan display derives from the shared catalog", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/onboarding/terminal-console.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/from "@mondaily\/shared\/pricing"/);
    expect(src).toMatch(/PLAN_TIERS\[id\]/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Onboarding → Paid Activation Loop. Guards the honest activation path: paid plans provision the
 * free Scout baseline + pending_plan (no fake subscription), and the client makes activation
 * unmissable (redirect + global banner + one-click checkout). Source-level assertions.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf8");
const onboardingApi = read("packages/api/src/routes/onboarding.ts");
const terminal = read("apps/app/src/routes/onboarding/terminal-console.tsx");
const layout = read("apps/app/src/routes/dashboard/layout.tsx");
const banner = read("apps/app/src/components/ui/pending-plan-banner.tsx");
const billing = read("apps/app/src/routes/dashboard/settings/billing.tsx");

describe("backend: paid plans are pending, never free-granted", () => {
  it("Command/Sovereign require payment → entitled tier stays scout, pending_plan recorded", () => {
    expect(onboardingApi).toMatch(/const requiresPayment = chosen === "command" \|\| chosen === "sovereign"/);
    expect(onboardingApi).toMatch(/const effectiveTier = requiresPayment \? "scout" : chosen/);
    expect(onboardingApi).toMatch(/requiresPayment \? \{ pending_plan: chosen \} : \{\}/);
  });
  it("trial (Operator) is separate from paid-pending; account_tier never 'command' until paid", () => {
    expect(onboardingApi).toMatch(/account_tier: effectiveTier/);
    expect(onboardingApi).toMatch(/isTrial = effectiveTier === "operator"/);
  });
});

describe("client: onboarding routes paid plans to Billing (no silent Scout drop)", () => {
  it("records activation need for command/sovereign and lands on billing", () => {
    expect(terminal).toMatch(/needsActivationRef\.current = plan === "command" \|\| plan === "sovereign"/);
    expect(terminal).toMatch(/window\.location\.assign\(needsActivationRef\.current \? "\/settings\/billing" : "\/"\)/);
  });
});

describe("client: global pending-plan banner", () => {
  it("is rendered in the dashboard layout", () => {
    expect(layout).toMatch(/import \{ PendingPlanBanner \}/);
    expect(layout).toMatch(/<PendingPlanBanner \/>/);
  });
  it("shows only when pending_plan set, links to billing, and steps aside on the billing page", () => {
    expect(banner).toMatch(/data\?\.pending_plan/);
    expect(banner).toMatch(/to="\/settings\/billing"/);
    expect(banner).toMatch(/pathname\.startsWith\("\/settings\/billing"\)/);
    expect(banner).toMatch(/queryKey: \["billing"\]/); // dedupes with billing page
  });
});

describe("client: billing banner explains onboarding selection + one-click checkout", () => {
  it("references onboarding and opens checkout for the pending plan", () => {
    expect(billing).toMatch(/selected <strong className="capitalize">\{billing\.pending_plan\}<\/strong> during onboarding/);
    expect(billing).toMatch(/pickPlan\(normalizePlan\(billing\.pending_plan!\)\)/);
  });
});

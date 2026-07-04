import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveProfile, mergeProfile, discoverySuggestions, askStarterPrompts, profileObjects,
  profileTerms, profileContextBlock, industryFamily, hasProfileSignal, EMPTY_PROFILE,
} from "@mondaily/shared/profile";

describe("resolveProfile — backward-compatible derivation", () => {
  it("empty settings → a neutral profile (no crash, English default)", () => {
    const p = resolveProfile({});
    expect(p.industry).toBe("");
    expect(p.language).toBe("en");
    expect(p.ai_help_level).toBe("balanced");
    expect(hasProfileSignal(p)).toBe(false);
  });
  it("derives from LEGACY onboarding fields when there's no explicit profile", () => {
    const p = resolveProfile({ industry: "Aesthetic clinics", goals: ["book more consultations"], discovery_icp: { description: "clinics in Poland" } });
    expect(p.industry).toBe("Aesthetic clinics");
    expect(p.primary_goals).toEqual(["book more consultations"]);
    expect(p.target_customers).toBe("clinics in Poland");   // from discovery_icp
    expect(hasProfileSignal(p)).toBe(true);
  });
  it("an explicit settings.profile wins over legacy fields", () => {
    const p = resolveProfile({ industry: "old", profile: { industry: "Commercial real estate", region: "London" } });
    expect(p.industry).toBe("Commercial real estate");
    expect(p.region).toBe("London");
  });
  it("mergeProfile keeps unspecified fields intact", () => {
    const base = mergeProfile(EMPTY_PROFILE, { industry: "Agency", region: "NYC" });
    const next = mergeProfile(base, { region: "Boston" });
    expect(next.industry).toBe("Agency");    // untouched
    expect(next.region).toBe("Boston");      // updated
  });
});

describe("industry families map free-text to a bucket", () => {
  it("classifies the spec's example industries", () => {
    expect(industryFamily("Aesthetic clinics")).toBe("healthcare");
    expect(industryFamily("Commercial real estate")).toBe("real_estate");
    expect(industryFamily("Marketing agency")).toBe("agency");
    expect(industryFamily("Skincare cosmetics brand")).toBe("ecommerce");
  });
  it("unknown industries fall back to generic (not a crash)", () => {
    expect(industryFamily("Underwater basket weaving")).toBe("generic");
    expect(industryFamily("")).toBe("generic");
  });
});

describe("suggestions ADAPT to the profile (the spec examples)", () => {
  it("healthcare → clinic/patient/follow-up flavored, region filled", () => {
    const p = mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics", region: "London" });
    const disc = discoverySuggestions(p);
    const ask = askStarterPrompts(p);
    expect(disc.join(" ").toLowerCase()).toContain("clinics in london");
    expect(ask.join(" ").toLowerCase()).toMatch(/patient|clinic/);
    expect(profileObjects(p)).toContain("clinics");
    expect(profileTerms(p).contact).toBe("patient");
  });
  it("real estate → owners/investors, region filled", () => {
    const p = mergeProfile(EMPTY_PROFILE, { industry: "Real estate", region: "Miami" });
    expect(discoverySuggestions(p).join(" ").toLowerCase()).toContain("property owners in miami");
    expect(askStarterPrompts(p).join(" ").toLowerCase()).toMatch(/investor|stale/);
  });
  it("agency → hiring/deliverables framing", () => {
    const p = mergeProfile(EMPTY_PROFILE, { industry: "Creative agency" });
    expect(discoverySuggestions(p).join(" ").toLowerCase()).toMatch(/hiring agencies/);
    expect(askStarterPrompts(p).join(" ").toLowerCase()).toMatch(/deliverable|client work/);
  });
});

describe("fallback works when the profile is empty (neutral, never blank)", () => {
  it("empty profile still yields generic, non-empty Discovery + Ask suggestions", () => {
    const disc = discoverySuggestions(EMPTY_PROFILE);
    const ask = askStarterPrompts(EMPTY_PROFILE);
    expect(disc.length).toBeGreaterThan(0);
    expect(ask.length).toBeGreaterThan(0);
    // generic examples must NOT be industry-specific (no 'clinic'/'aesthetic')
    expect(disc.join(" ").toLowerCase()).not.toMatch(/clinic|aesthetic|patient/);
  });
});

describe("Ask context block includes the profile (relevance only, no fabrication)", () => {
  it("emits the industry/region/goals/terms lines", () => {
    const p = mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics", region: "London", primary_goals: ["reduce no-shows"] });
    const block = profileContextBlock(p);
    expect(block).toMatch(/Industry: Aesthetic clinics/);
    expect(block).toMatch(/Primary region: London/);
    expect(block).toMatch(/reduce no-shows/);
    expect(block.toLowerCase()).toMatch(/never fabricate data/);   // the anti-hallucination instruction
  });
  it("empty profile → empty block (nothing misleading injected)", () => {
    expect(profileContextBlock(EMPTY_PROFILE)).toBe("");
  });
});

describe("wiring guards — the surfaces actually consume the profile", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("onboarding /complete saves settings.profile; /analyze infers the profile fields", () => {
    const src = read("../routes/onboarding.ts");
    expect(src).toMatch(/profile: nextProfile/);
    expect(src).toMatch(/business_model:/);
    expect(src).toMatch(/target_customers:/);
    expect(src).toMatch(/suggested_objects:/);
  });
  it("Ask backend injects the workspace profile block into the system prompt", () => {
    const src = read("../routes/ask.ts");
    expect(src).toMatch(/workspaceProfileBlock\(workspaceId\)/);
    expect((src.match(/SYSTEM_PROMPT \+ profileBlock/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("app-data exposes profile + a /workspace/suggestions endpoint", () => {
    const src = read("../routes/app-data.ts");
    expect(src).toMatch(/router\.get\("\/workspace\/suggestions"/);
    expect(src).toMatch(/profile: resolveProfile\(settings\)/);
  });
  it("Discovery UI no longer hardcodes 'Aesthetic clinics in London' as a fixed example", () => {
    const src = read("../../../../apps/app/src/routes/dashboard/discovery.tsx");
    expect(src).toMatch(/useWorkspaceSuggestions/);
    expect(src).not.toMatch(/label: "Aesthetic clinics in London"/);
  });
  it("Ask UI merges profile-aware starter prompts", () => {
    expect(read("../../../../apps/app/src/components/ai/ask-mondaily.tsx")).toMatch(/useWorkspaceSuggestions/);
  });
  it("Settings has a Workspace profile section", () => {
    expect(read("../../../../apps/app/src/routes/dashboard/settings/workspace.tsx")).toMatch(/Workspace profile/);
  });
});

describe("positioning stays general (no CRM-only framing in the profile layer)", () => {
  it("the shared profile module never says 'CRM'", () => {
    expect(read_shared()).not.toMatch(/\bCRM\b/);
  });
});
function read_shared() {
  return readFileSync(fileURLToPath(new URL("../../../shared/src/profile.ts", import.meta.url)), "utf8");
}

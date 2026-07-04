import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveProfile, mergeProfile, discoverySuggestions, askStarterPrompts, profileObjects,
  profileTerms, profileContextBlock, industryFamily, hasProfileSignal, EMPTY_PROFILE,
  applyTerms, preferredTerm, discoveryPlaceholder, discoveryNextSuggestions, broadQueryRefinements,
  objectCreationExamples, listExamples, tableNlpExamples, importExamples, homeQuickPrompts,
  profileRecommendations,
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
    expect(block.toLowerCase()).toMatch(/never invent workspace data/);   // the anti-hallucination instruction
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
    expect(src).toMatch(/workspaceProfileBlock\(workspaceId, userId\)/);
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

describe("PHASE 2 — soft preferred-term substitution (display copy only)", () => {
  const clinic = mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics" }); // family → contact:patient, deal:case
  it("replaces whole words + plurals, preserving leading case", () => {
    expect(applyTerms("Show me this deal", clinic)).toBe("Show me this case");
    expect(applyTerms("Review all deals", clinic)).toBe("Review all cases");
    expect(applyTerms("Contact the lead", clinic)).toBe("Patient the lead"); // 'contact'→'patient', case preserved
  });
  it("preferredTerm returns the workspace word or the generic unchanged", () => {
    expect(preferredTerm(clinic, "deal")).toBe("case");
    expect(preferredTerm(clinic, "widget")).toBe("widget");
  });
  it("explicit preferred_terms override the family defaults", () => {
    const p = mergeProfile(clinic, { preferred_terms: { deal: "treatment" } });
    expect(preferredTerm(p, "deal")).toBe("treatment");
  });
  it("is display-copy only — the app NEVER runs it on route strings (guarded below)", () => {
    // applyTerms preserves slash structure, but the real safety is that our code only ever passes
    // prompt/label copy through it, never `to=`/path literals (asserted in the wiring guards).
    expect(applyTerms("/deals/123", clinic)).toMatch(/^\/\w+\/123$/);   // still a valid single-segment path
    expect(applyTerms("navigate('/reports')", clinic)).toContain("/reports"); // 'reports' is not a clinic term
  });
  it("empty profile → applyTerms is a no-op", () => {
    expect(applyTerms("Show this deal and contact", EMPTY_PROFILE)).toBe("Show this deal and contact");
  });
});

describe("PHASE 2 — Discovery deeper suggestions adapt (with neutral fallback)", () => {
  const re = mergeProfile(EMPTY_PROFILE, { industry: "Real estate", region: "Miami", target_customers: "property owners" });
  it("placeholder + next + broad-query refinements use the profile", () => {
    expect(discoveryPlaceholder(re).toLowerCase()).toContain("property owners");
    expect(discoveryNextSuggestions(re).join(" ").toLowerCase()).toMatch(/property owners|miami/);
    const broad = broadQueryRefinements(re, "agents");
    expect(broad.join(" ")).toContain("Miami");                 // narrowed by region
    expect(broad.length).toBeGreaterThan(0);
  });
  it("empty profile still returns neutral, non-empty deeper suggestions", () => {
    expect(discoveryNextSuggestions(EMPTY_PROFILE).length).toBeGreaterThan(0);
    expect(broadQueryRefinements(EMPTY_PROFILE, "").length).toBeGreaterThan(0);
    expect(discoveryPlaceholder(EMPTY_PROFILE).toLowerCase()).not.toMatch(/clinic|aesthetic|patient/);
  });
});

describe("PHASE 2 — object / list / table / import examples reflect the profile", () => {
  const clinic = mergeProfile(EMPTY_PROFILE, { industry: "Aesthetic clinics", region: "London", target_customers: "clinics" });
  it("seed from the workspace's object nouns", () => {
    expect(objectCreationExamples(clinic).join(" ").toLowerCase()).toMatch(/clinic|patient|follow/);
    expect(listExamples(clinic).join(" ").toLowerCase()).toContain("clinics");
    expect(importExamples(clinic).join(" ").toLowerCase()).toMatch(/clinic|patient|follow/);
    expect(tableNlpExamples(clinic).join(" ").toLowerCase()).toMatch(/london|clinic/);
  });
  it("empty profile → generic, non-empty examples", () => {
    for (const list of [objectCreationExamples(EMPTY_PROFILE), listExamples(EMPTY_PROFILE), tableNlpExamples(EMPTY_PROFILE), importExamples(EMPTY_PROFILE)]) {
      expect(list.length).toBeGreaterThan(0);
    }
  });
});

describe("PHASE 2 — Home prompts + recommendations", () => {
  const agency = mergeProfile(EMPTY_PROFILE, { industry: "Marketing agency", region: "NYC", target_customers: "companies hiring agencies", preferred_terms: { deal: "project" } });
  it("Home quick prompts are profile-aware + term-substituted", () => {
    const prompts = homeQuickPrompts(agency);
    expect(prompts.find(p => p.key === "discovery")?.prompt.toLowerCase()).toContain("companies hiring agencies");
    expect(prompts.find(p => p.key === "attention")?.prompt.toLowerCase()).toContain("project"); // 'deal'→'project'
  });
  it("recommendations are surfaced (never auto-created) and non-empty", () => {
    const rec = profileRecommendations(agency);
    expect(rec.agents.length).toBeGreaterThan(0);
    expect(rec.automations.length).toBeGreaterThan(0);
    expect(rec.object_types.length).toBeGreaterThan(0);
    expect(rec.discovery_searches.length).toBeGreaterThan(0);
  });
});

describe("PHASE 2 — wiring guards (surfaces consume the new suggestions)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("onboarding survey collects region + language and threads them to the profile", () => {
    const src = read("../../../../apps/app/src/routes/onboarding/terminal-console.tsx");
    expect(src).toMatch(/key: "region"/);
    expect(src).toMatch(/key: "language"/);
    expect(src).toMatch(/answers\.region/);
    expect(src).toMatch(/answers\.language/);
  });
  it("app-data suggestions endpoint serves the phase-2 sets", () => {
    const src = read("../routes/app-data.ts");
    for (const f of ["discovery_placeholder", "discovery_next", "home", "object_examples", "list_examples", "table_examples", "recommendations"]) {
      expect(src, `suggestions should include ${f}`).toMatch(new RegExp(f));
    }
    expect(src).toMatch(/\/workspace\/refine/);
  });
  it("Home applies preferred terms + profile-aware Discovery card", () => {
    const src = read("../../../../apps/app/src/routes/dashboard/home.tsx");
    expect(src).toMatch(/applyTerms/);
    expect(src).toMatch(/useWorkspaceSuggestions/);
  });
  it("Discovery placeholder + NextMoves + builders consume the profile", () => {
    expect(read("../../../../apps/app/src/routes/dashboard/discovery.tsx")).toMatch(/discovery_placeholder/);
    expect(read("../../../../apps/app/src/routes/dashboard/settings/objects.tsx")).toMatch(/object_examples/);
    expect(read("../../../../apps/app/src/components/records/record-table.tsx")).toMatch(/table_examples/);
    expect(read("../../../../apps/app/src/components/layout/sidebar-lists.tsx")).toMatch(/list_examples/);
  });
  it("Settings profile section shows the live preview + 'never auto-created' note", () => {
    const src = read("../../../../apps/app/src/routes/dashboard/settings/workspace.tsx");
    expect(src).toMatch(/These update Discovery examples and Ask AI/);
    expect(src).toMatch(/recommendations only/i);
  });
  it("nav/routes are NOT term-substituted — the sidebar keeps literal route paths", () => {
    const src = read("../../../../apps/app/src/components/layout/sidebar.tsx");
    expect(src).not.toMatch(/applyTerms/);           // nav never runs preferred-term substitution
    expect(src).toMatch(/to: "\/search"/);            // route literals intact
    expect(src).toMatch(/to: "\/discovery"/);
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

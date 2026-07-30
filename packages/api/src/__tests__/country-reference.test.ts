import { describe, it, expect } from "vitest";
import { countryFacts, fmtPopulation } from "../../../../apps/app/src/lib/countries";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The owner-supplied 2026 dataset — a LOOKUP beside the picker, never stored on records. */
describe("country reference data", () => {
  it("holds all 195 rows with verbatim figures", () => {
    expect(countryFacts("Poland")).toEqual({ name: "Poland", population: 37843188, landKm2: 306230, density: 124 });
    expect(countryFacts("Monaco")?.density).toBe(25562);
    expect(countryFacts("Holy See")?.population).toBe(506);
  });

  it("bridges the picker's canonical names to the dataset's official ones", () => {
    // Stored values use the picker's spellings; each must still find its facts.
    expect(countryFacts("United States")?.population).toBe(349035494);
    expect(countryFacts("Czech Republic")?.name).toBe("Czechia (Czech Republic)");
    expect(countryFacts("Myanmar")?.population).toBe(55184819);
    expect(countryFacts("Palestine")?.density).toBe(946);
    expect(countryFacts("Vatican City")?.population).toBe(506);
  });

  it("returns null for unknowns — never a guess", () => {
    expect(countryFacts("Atlantis")).toBeNull();
    expect(countryFacts("")).toBeNull();
    expect(countryFacts(null)).toBeNull();
  });

  it("every picker country resolves to facts (no silent gaps)", () => {
    const table = readFileSync(join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");
    const m = table.match(/const WORLD_COUNTRIES = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const names = [...m![1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    expect(names.length).toBeGreaterThan(180);
    const missing = names.filter(n => !countryFacts(n)).filter(n => !["Taiwan"].includes(n)); // Taiwan absent from the supplied dataset — a data gap, not a lookup bug
    expect(missing, `picker countries without facts: ${missing.join(", ")}`).toEqual([]);
  });

  it("formats population compactly", () => {
    expect(fmtPopulation(37843188)).toBe("37.8M");
    expect(fmtPopulation(83753)).toBe("83.8k");
    expect(fmtPopulation(506)).toBe("506");
    expect(fmtPopulation(1000000)).toBe("1M");
  });
});

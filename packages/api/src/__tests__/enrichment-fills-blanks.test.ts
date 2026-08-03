import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fillBlanks } from "../lib/enrichment-fields";

const read = (p: string) => readFileSync(join(__dirname, "../../../..", p), "utf8");

/**
 * An agent COMPLETES a record; it does not correct one.
 *
 * Both enrichment writers spread agent output last — `{ ...node.data, ...fields }` — so an
 * autonomous run silently replaced human input. Set a deal's country by hand, let enrichment run,
 * and the agent's guess won, while the notification claimed "AI filled in".
 */
describe("enrichment fills blanks", () => {
  it("never overwrites a value a person set", () => {
    const { merged, kept } = fillBlanks({ country: "Israel" }, { country: "Albania" });
    expect(merged.country).toBe("Israel");
    expect(kept).toContain("country");
  });

  it("fills a field that is absent, null or blank", () => {
    expect(fillBlanks({}, { country: "Spain" }).merged.country).toBe("Spain");
    expect(fillBlanks({ country: null }, { country: "Spain" }).merged.country).toBe("Spain");
    expect(fillBlanks({ country: "   " }, { country: "Spain" }).merged.country).toBe("Spain");
  });

  it("ignores blank agent output rather than erasing a real value", () => {
    const { merged } = fillBlanks({ country: "Spain" }, { country: "" });
    expect(merged.country).toBe("Spain");
  });

  it("reports what it applied and what it kept", () => {
    // So the notification can be honest instead of claiming a field it left alone.
    const { applied, kept } = fillBlanks({ country: "Israel", city: "" }, { country: "Albania", city: "Tel Aviv" });
    expect(applied).toEqual(["city"]);
    expect(kept).toEqual(["country"]);
  });

  it("BOTH writers use it — one rule, not one call site", () => {
    // Close-date stamping, win-dating and stage resolution were each fixed in one place and
    // bypassed in another. Not again.
    expect(read("packages/api/src/jobs/enrich-record.ts")).toMatch(/fillBlanks\(/);
    expect(read("packages/api/src/jobs/runners.ts")).toMatch(/fillBlanks\(/);
    for (const f of ["packages/api/src/jobs/enrich-record.ts", "packages/api/src/jobs/runners.ts"]) {
      expect(read(f), f).not.toMatch(/\{ \.\.\.\(node\?\.data \?\? \{\}\), \.\.\.(flat|fields) \}/);
    }
  });
});

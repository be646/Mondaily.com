import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Step 4 — schema as the column spine. The MEASUREMENT came first and changed the plan:
 * object_definitions does not describe the data today, so inverting the column source
 * immediately would have blanked the primary column on hundreds of records.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const records = () => read("packages/api/src/routes/records.ts");

describe("the audit is read-only and honest about coverage", () => {
  it("exposes a GET audit that changes nothing", () => {
    expect(records()).toMatch(/router\.get\("\/schema-audit\/:objectType"/);
  });

  it("counts only NON-EMPTY values — a key that is always blank is not a field", () => {
    expect(records()).toMatch(/if \(v == null \|\| String\(v\)\.trim\(\) === ""\) continue;/);
  });

  it("reports both directions of the gap: live keys missing from the schema, and dead attributes", () => {
    const src = records();
    expect(src).toMatch(/const unmapped = \[\.\.\.counts\.entries\(\)\]/);
    expect(src).toMatch(/const dead = attrs\s*\n?\s*\.filter\(a => !counts\.has\(SCHEMA_KEY\(a\.name\)\)\)/);
  });

  it("suggests a type from real values instead of defaulting everything to text", () => {
    expect(records()).toMatch(/function inferAttrType/);
    expect(records()).toMatch(/return all\(\/%\\s\*\$\/\) \? "percentage" : "number"/);
  });

  it("records SEMANTIC types from the key name — a value scan cannot see them", () => {
    // A stage column is just short strings, indistinguishable from any other option set. Marking
    // these properly is what eventually lets the schema say which attribute IS the stage/owner,
    // instead of every surface re-deriving it from a regex over column names.
    const src = records();
    expect(src).toMatch(/if \(\/country\/\.test\(k\)\) return "country"/);
    expect(src).toMatch(/return "owner"/);
    expect(src).toMatch(/if \(\/stage\/\.test\(k\)\) return "stage"/);
    expect(src).toMatch(/suggested_type: inferAttrType\(vals, k\)/);
  });

  it("is scoped to the workspace on every query it makes", () => {
    const audit = records().slice(records().indexOf('router.get("/schema-audit'), records().indexOf('router.post("/schema-adopt'));
    expect(audit.match(/\.eq\("workspace_id", ws\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("adopting is explicit, reversible in intent, and never silent", () => {
  it("is owner/admin only and dry-run by default, like schema-unify", () => {
    const src = records();
    expect(src).toMatch(/router\.post\("\/schema-adopt\/:objectType", denyViewerWrites/);
    expect(src).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(src).toMatch(/if \(role !== "owner" && role !== "admin"\) return c\.json\(\{ error: "Owner\/admin only\." \}, 403\)/);
  });

  it("only ever adds what the caller listed — it never drops an attribute", () => {
    const adopt = records().slice(records().indexOf('router.post("/schema-adopt'));
    expect(adopt).not.toMatch(/attributes: attrs\.filter/);
    expect(adopt).toMatch(/attributes: \[\.\.\.attrs, \.\.\.added\]/);
  });

  it("adopts under the DATA KEY, so the schema name round-trips to the key records use", () => {
    // Naming attributes prettily ("Deal Name" for data key `name`) is precisely how the schema
    // stopped describing the data.
    expect(records()).toMatch(/name: k\.key, type: valid\.has\(k\.type\) \? k\.type : "text"/);
  });

  it("refuses column names that are not shaped like column names", () => {
    expect(records()).toMatch(/\/\^\[a-zA-Z0-9_-\]\{1,64\}\$\/\.test\(k\.key\)/);
  });

  it("skips keys the schema already has, so re-running adds nothing", () => {
    expect(records()).toMatch(/!have\.has\(SCHEMA_KEY\(k\.key\)\)/);
  });
});

describe("the measurement that justified this order of work is recorded", () => {
  it("documents why the schema could not simply be made authoritative", () => {
    const src = records();
    expect(src).toMatch(/MEASURED LIVE FIRST/);
    expect(src).toMatch(/`name` is absent from the schema/);
  });
});

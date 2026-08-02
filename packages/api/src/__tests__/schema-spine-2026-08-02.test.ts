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
    expect(src).toMatch(/\? "assignee" : "owner"/);
    expect(src).toMatch(/if \(\/stage\/\.test\(k\)\) return "stage"/);
    expect(src).toMatch(/suggested_type: inferAttrType\(vals, k, members\)/);
  });

  it("an OWNER type needs values that resolve to members — the name only nominates it", () => {
    // Measured: `deal_owner` on people holds 46 distinct names, 1 of which is a member. They are
    // counterparts from scraped lead data. Typing them "owner" is what made two unrelated
    // populations look like duplicate owner columns in conflict on 47 records.
    const src = records();
    expect(src).toMatch(/const nameSuggestsPeople =/);
    expect(src).toMatch(/resolves \* 2 > vals\.length/);
    // The roster is read from the workspace, not accepted from the caller.
    expect(src).toMatch(/\.from\("workspace_members"\)\s*\n?\s*\.select\("name, email"\)\.eq\("workspace_id", ws\)/);
  });

  it("publishes the evidence for that call instead of just the verdict", () => {
    const src = records();
    expect(src).toMatch(/values_resolving_to_members: flat\.filter\(v => members\.has\(v\)\)\.length/);
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

describe("a workspace-wide schema write is never one unconfirmed click", () => {
  it("adopting a field asks first, naming the field and the type", () => {
    // Four fields landed in the deals schema unintentionally on 2026-08-02 from stray clicks
    // during verification. Same class as the unguarded row delete fixed earlier that day.
    const table = read("apps/app/src/components/records/record-table.tsx");
    expect(table).toMatch(/Add "\$\{u\.key\}" to the \$\{objectType\} schema as \$\{u\.suggested_type\}\?/);
    expect(table).toMatch(/if \(!window\.confirm\([\s\S]{0,400}\)\) return;\s*\n\s*setAdopting/);
  });

  it("says it is workspace-wide, since that is what makes it consequential", () => {
    expect(read("apps/app/src/components/records/record-table.tsx"))
      .toMatch(/This is a workspace-wide change/);
  });
});

describe("the measurement that justified this order of work is recorded", () => {
  it("documents why the schema could not simply be made authoritative", () => {
    const src = records();
    expect(src).toMatch(/MEASURED LIVE FIRST/);
    expect(src).toMatch(/`name` is absent from the schema/);
  });
});

/**
 * schema-prune — removing an attribute is the destructive direction, so the guards are about who
 * gets to decide it is safe. The answer is the server, from the records, every time.
 */
describe("schema-prune refuses to delete on the caller's word", () => {
  it("is owner/admin only and defaults to a dry run, like adopt", () => {
    const src = records();
    expect(src).toMatch(/router\.post\("\/schema-prune\/:objectType", denyViewerWrites/);
    const body = src.slice(src.indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(body).toMatch(/role !== "owner" && role !== "admin"/);
  });

  it("takes only key NAMES — the caller cannot assert a key is empty", () => {
    const src = records();
    const body = src.slice(src.indexOf('"/schema-prune/:objectType"'), src.indexOf("ATTR_TYPES_FOR_ADOPT ="));
    // adopt takes {key,type}; prune takes bare strings, so there is no field in the request that
    // could carry a claim about the data.
    expect(body).toMatch(/keys: z\.array\(z\.string\(\)\.max\(120\)\)/);
    expect(body).toMatch(/const filled = new Map<string, number>\(\)/);
  });

  it("refuses any key it can see data for, and reports the count instead of deleting", () => {
    const body = records().slice(records().indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/if \(n > 0\) \{ refused\.push\(\{ key, filled: n \}\); continue; \}/);
  });

  it("refuses to act at all when the scan is truncated — emptiness is a claim about every row", () => {
    const body = records().slice(records().indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/rows\.length >= PRUNE_SCAN_CAP/);
    expect(body).toMatch(/409/);
  });

  it("uses the SAME non-empty definition as the audit, so 'dead' means the same thing in both", () => {
    const body = records().slice(records().indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/if \(v == null \|\| String\(v\)\.trim\(\) === ""\) continue;/);
  });

  it("writes the KEPT list, never a filtered-by-name delete that could drop an unrelated attribute", () => {
    const body = records().slice(records().indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/const kept = attrs\.filter\(a => !removedKeys\.has\(SCHEMA_KEY\(a\.name\)\)\)/);
    expect(body).toMatch(/\.update\(\{ attributes: kept \}\)/);
  });

  it("scopes the write to the workspace AND the definition id", () => {
    const body = records().slice(records().indexOf('"/schema-prune/:objectType"'));
    expect(body).toMatch(/\.eq\("workspace_id", ws\)\.eq\("id", def\.id\)/);
  });
});

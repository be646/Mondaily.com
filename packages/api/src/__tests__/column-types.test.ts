import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const api = readFileSync(join(__dirname, "../routes/app-data.ts"), "utf8");
const table = readFileSync(join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");

/**
 * Column types, phase 3. The complaint "countries show number format" had two halves:
 * ATTR_TYPES rejected the sheet's display presets (a Country column 400'd on persist), and
 * AddColumn wrote localStorage ONLY — the type existed in one browser and degraded to
 * name-inference everywhere else.
 */
describe("the schema accepts every column type the sheet offers", () => {
  it("ATTR_TYPES includes the display presets", () => {
    const m = api.match(/const ATTR_TYPES = \[([\s\S]*?)\] as const;/);
    expect(m).toBeTruthy();
    const types = m![1];
    for (const t of ["country", "status", "stage", "assignee", "owner", "tag", "category", "record_id", "finance_billed", "finance_outstanding"]) {
      expect(types, `ATTR_TYPES missing "${t}" — persisting that column 400s and silently degrades`).toContain(`"${t}"`);
    }
  });

  it("every preset the Add-column dropdown offers is persistable", () => {
    // The two lists must stay in sync or a NEW preset silently regresses to browser-only.
    const presets = [...table.matchAll(/\{ type: "([a-z_]+)",\s+label:/g)].map(x => x[1]);
    expect(presets.length).toBeGreaterThanOrEqual(15);
    const m = api.match(/const ATTR_TYPES = \[([\s\S]*?)\] as const;/)!;
    for (const t of presets) {
      if (t === "relation") continue;   // relation persists with meta separately
      expect(m[1], `preset "${t}" not in ATTR_TYPES`).toContain(`"${t}"`);
    }
  });
});

describe("column types persist to the server, not one browser", () => {
  it("AddColumn writes the type to object_definitions and refreshes the schema cache", () => {
    expect(table).toMatch(/apiClient\.post\(`\/settings\/objects\/\$\{def\.id\}\/attributes`, \{ name: key, type \}\)/);
    expect(table).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["object-defs"\] \}\)/);
    // localStorage stays for instant local behavior — it is a cache now, not the source of truth
    expect(table).toMatch(/localStorage\.setItem\(`mondaily_custom_cols_/);
  });

  it("does not re-persist a column the schema already types", () => {
    expect(table).toMatch(/def\?\.id && !serverAttrType\.has\(key\)/);
  });

  it("server types stay authoritative in the resolution chain", () => {
    // local preset → server type → name inference; deleting the server step regresses every
    // other device back to inference.
    expect(table).toMatch(/return serverAttrType\.get\(col\);/);
  });
});

describe("attributes can be removed, not only added", () => {
  it("DELETE /settings/objects/:id/attributes/:attrId exists and touches only the schema", () => {
    // The schema previously only ever GREW — a mistyped column was permanent.
    expect(api).toMatch(/router\.delete\("\/settings\/objects\/:id\/attributes\/:attrId"/);
    // record data under the key is untouched: removing values is data cleaning, not schema editing
    const handler = api.slice(api.indexOf('router.delete("/settings/objects/:id/attributes/:attrId"'), api.indexOf('router.delete("/settings/objects/:id",'));
    expect(handler).not.toMatch(/from\("nodes"\)/);
    expect(handler).toMatch(/404/);   // removing a non-existent attribute says so
  });
});

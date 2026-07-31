import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the 2026-07-31 Graph/records audit. Each encodes a defect that shipped, so a
 * regression breaks a test instead of quietly breaking the product.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const table = () => read("apps/app/src/components/records/record-table.tsx");
const detail = () => read("apps/app/src/components/records/record-detail.tsx");

describe("Graph audit — tenant isolation on writes", () => {
  it("relate() verifies BOTH nodes belong to the caller's workspace", () => {
    const nodes = read("packages/api/src/routes/nodes.ts");
    expect(nodes).toMatch(/\.eq\("workspace_id", workspaceId\)\.in\("id", \[id, target_id\]\)/);
    expect(nodes).toMatch(/if \(!ownedIds\.has\(id\) \|\| !ownedIds\.has\(target_id\)\) return c\.json\(\{ error: "Record not found" \}, 404\)/);
  });

  it("tagging a node verifies both the node and the tag are ours", () => {
    const tags = read("packages/api/src/routes/tags.ts");
    expect(tags).toMatch(/from\("nodes"\)\.select\("id"\)\.eq\("id", nodeId\)\.eq\("workspace_id", workspaceId\)/);
    expect(tags).toMatch(/from\("tags"\)\.select\("id"\)\.eq\("id", tag_id\)\.eq\("workspace_id", workspaceId\)/);
    expect(tags).toMatch(/if \(!node \|\| !tag\) return c\.json\(\{ error: "Not found" \}, 404\)/);
  });
});

describe("Graph audit — a page size is never presented as a total", () => {
  it("the record table reads its total from /nodes/counts, not the loaded page", () => {
    expect(table()).toMatch(/apiClient\.get<\{ total: number; by_type: Record<string, number> \}>\("\/nodes\/counts"\)/);
    expect(table()).toMatch(/const totalOfType = countsQuery\.data\?\.by_type\?\.\[objectType\] \?\? records\.length/);
    expect(table()).toMatch(/\{sorted\.length\} of \{totalOfType\}/);
    // and says so plainly when the view holds less than the whole type
    expect(table()).toMatch(/const truncated = totalOfType > records\.length/);
    expect(table()).toMatch(/exports the \{records\.length\} loaded rows, not all \{totalOfType\}/);
  });

  it("the object-type registry is not capped at the generic 100-row default", () => {
    expect(read("packages/api/src/routes/app-data.ts"))
      .toMatch(/rows\("object_definitions", c\.get\("workspaceId"\), \{ limit: 1000 \}\)/);
  });

  it("a record's children are filtered in SQL, not over a capped global page", () => {
    expect(read("packages/db/src/ubc.ts")).toMatch(/query\.eq\("data->>parent_id", options\.parent_id\)/);
    expect(read("packages/api/src/routes/nodes.ts")).toMatch(/parent_id: z\.string\(\)\.optional\(\)/);
    expect(detail()).toMatch(/object_type=note&parent_id=\$\{encodeURIComponent\(recordId\)\}/);
    expect(detail()).toMatch(/object_type=task&parent_id=\$\{encodeURIComponent\(recordId\)\}/);
    // the old shape: fetch everything, filter here
    expect(detail()).not.toMatch(/"\/nodes\?object_type=note&limit=200"/);
  });
});

describe("Graph audit — nothing writes or claims on the user's behalf", () => {
  it("a keyword match proposes a deal stage; it does not silently write one", () => {
    // was: patch.mutate({...}) on a 1.5s timer, announced as "AI moved stage to X"
    expect(detail()).toMatch(/setStageSuggestion\(detected\)/);
    expect(detail()).toMatch(/>Move stage</);
    expect(detail()).not.toMatch(/AI moved stage to/);
  });

  it("the record-created event uses a real created_at, never updated_at", () => {
    expect(detail()).toMatch(/createdAt=\{record\.created_at\}/);
    expect(detail()).toMatch(/\.\.\.\(createdAt \? \[\{ id: "created"/);
    expect(detail()).not.toMatch(/createdAt=\{record\.updated_at\}/);
  });

  it("absent fields render as em-dash, not an invented status", () => {
    expect(detail()).toMatch(/data\.reimbursed == null \? "—"/);
    expect(detail()).toMatch(/data\.status == null \? "—"/);
    expect(detail()).not.toMatch(/data\.priority \?\? "Normal"/);
  });

  it("fields nothing ever writes are not rendered as empty promises", () => {
    expect(detail()).not.toMatch(/data\.connection_strength/);
    expect(detail()).not.toMatch(/data\.next_interaction/);
  });

  it("AI-extracted records keep the provenance the extractor established", () => {
    expect(read("apps/app/src/routes/dashboard/objects/[objectType]/index.tsx"))
      .toMatch(/\.\.\.\(r\.source_url \? \{ source_url: String\(r\.source_url\) \} : \{\}\)/);
  });

  it("AI generation on this surface is metered", () => {
    const gen = read("packages/api/src/routes/generate.ts");
    expect(gen).toMatch(/feature: "generate\.nlp"/);
    expect(gen).toMatch(/feature: "generate\.records"/);
  });

  it("agent-registered object types get Title Case display names", () => {
    const ask = read("packages/api/src/routes/ask.ts");
    expect(ask).toMatch(/function titleCase/);
    expect(ask).toMatch(/name_plural: titleCase\(/);
  });
});

describe("Graph audit — table wiring", () => {
  it("every column stays reachable; extras start hidden rather than discarded", () => {
    expect(table()).toMatch(/const base = nameKey \? \[nameKey, \.\.\.rest\] : allKeys;/);
    expect(table()).toMatch(/setHiddenCols\(new Set\(allColumns\.slice\(DEFAULT_VISIBLE_COLS\)\)\)/);
    expect(table()).not.toMatch(/: allKeys\)\.slice\(0, 8\)/);
  });

  it("filters are not limited to stage/status/assignee columns", () => {
    // 2026-08-01: superseded by the search-first FilterBar — ANY column can carry a condition,
    // with operators from its inferred kind, and conditions run in SQL over all records.
    expect(table()).toMatch(/function FilterBar/);
    expect(table()).toMatch(/OPS_FOR_KIND\[kindOf\(draftCol\)\]/);
    expect(table()).not.toMatch(/Add a Stage, Status, or Assignee column to enable filters/);
  });

  it("owner reassignment re-runs the filter", () => {
    expect(table()).toMatch(/\[records, toolbarSearch, conditions, owners\]/);
  });

  it("footer aggregates read node-level columns too", () => {
    expect(table()).toMatch(/const vals = records\.map\(r => cellValue\(r, col\)\)/);
  });

  it("avatars are sized with real styles, not interpolated Tailwind classes", () => {
    expect(table()).toMatch(/style=\{\{ height: size \* 4, width: size \* 4 \}\}/);
    expect(table()).not.toMatch(/`h-\$\{size\} w-\$\{size\}/);
  });

  it("footer colSpan accounts for the locked Record ID column", () => {
    expect(table()).toMatch(/colSpan=\{columns\.length \+ 3 \+ \(hasRecordIdCol \? 1 : 0\)\}/);
  });

  it("natural-language table commands are actually mounted", () => {
    // built long ago but never rendered — /generate/nlp had zero callers
    expect(table()).toMatch(/openPanel === "ask" &&/);
    expect(table()).toMatch(/<NLPCommandBar/);
  });

  it("the record-link picker searches the workspace instead of a 200-row slice", () => {
    expect(detail()).toMatch(/apiClient\.post<RelatedNode\[\]>\("\/search", \{ query: searchText\.trim\(\), limit: 25 \}\)/);
  });

  it("related tabs show their own type", () => {
    expect(detail()).toMatch(/const visibleRelated = tabLabel === "Related" \? related/);
  });
});

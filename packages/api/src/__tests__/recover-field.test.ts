import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lib = read("packages/api/src/lib/recover-field.ts");

/**
 * Recovering a bulk-overwritten column without becoming the next thing that destroys data.
 *
 * On 2026-08-02 every deal's `country` became "Albania" — they had held Algeria, Guinea and others,
 * and all changed inside one sub-second burst. The values survive in the activity snapshots.
 */
describe("bulk-overwrite recovery", () => {
  it("only restores where the overwrite was a BURST, never a lone edit", () => {
    // A single record changing is somebody choosing. Reverting that would make this tool the
    // destructive one — the exact failure it exists to undo.
    expect(lib).toMatch(/burst\.length < MIN_BURST_SIZE/);
    expect(lib).toMatch(/MIN_BURST_SIZE = \d+/);
  });

  it("detects the burst from the data, not a hardcoded date", () => {
    // So it works for the next accident, not just this one. Comments are stripped first: the
    // incident date belongs in the docs explaining WHY, and only its presence in executable code
    // would mean the tool is pinned to one event.
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(code).toMatch(/BURST_WINDOW_MS/);
  });

  it("refuses when the replaced value was empty", () => {
    // Restoring "" over a real value would be a loss dressed as a fix.
    expect(lib).toMatch(/there is nothing to restore/);
  });

  it("is read-merge-write", () => {
    // PATCH replaces `data` wholesale; anything not re-sent is erased.
    expect(lib).toMatch(/\.\.\.\(\(row\.data \?\? \{\}\)/);
  });

  it("the endpoint is admin-gated and dry-run by default", () => {
    const routes = read("packages/api/src/routes/clean.ts");
    expect(routes).toMatch(/recover-field/);
    expect(routes).toMatch(/requireAdminRole/);
    expect(routes).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
  });
});

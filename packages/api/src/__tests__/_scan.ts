import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Walk a source tree for a guard that polices the codebase by reading it — and REFUSE to return a
 * suspiciously empty result.
 *
 * Every codebase-scanning guard in this suite asserts a ceiling: `toEqual([])`, `toHaveLength(0)`,
 * `toBeLessThanOrEqual(n)`. A ceiling is satisfied by finding nothing. So the day a directory moves,
 * a file extension changes, or the code migrates behind a helper, the guard reports zero violations
 * and passes — permanently green while inspecting an empty set. It stops being a test and becomes a
 * decoration, and nothing announces that it happened.
 *
 * `readdirSync` already throws when a directory is missing, so that case is loud. This covers the
 * quieter one: the directory still exists, but the walk no longer finds the files it was written to
 * examine.
 *
 * The floor is on the POPULATION SCANNED, never on violations found, so a guard cannot start failing
 * because someone did the right thing and fixed everything it was watching for.
 */
export function scanFiles(dir: string, exts: string[], minimum: number): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (name === "node_modules" || name === ".next" || name === "dist") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some(e => p.endsWith(e))) out.push(p);
    }
  })(dir);

  if (out.length < minimum) {
    throw new Error(
      `Source scan found only ${out.length} file(s) under ${dir} (expected at least ${minimum}). ` +
      `The guard using this walk would have passed by inspecting nothing. Fix the path or the ` +
      `extensions — do not lower the floor to make this go away.`,
    );
  }
  return out;
}

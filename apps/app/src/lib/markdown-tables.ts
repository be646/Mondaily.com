/**
 * Markdown tables → CSV, for the per-answer download button.
 *
 * The data in an answer's table came out of real tools; trapping it in rendered markdown means
 * re-asking or retyping to use it anywhere else. Parsing is deliberately narrow — GitHub-style
 * pipe tables, the only kind the prompt instructs the model to emit.
 */
export function markdownTablesToCsv(text: string): string | null {
  const lines = String(text ?? "").split("\n");
  const tables: string[][][] = [];
  let current: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // the --- separator row
      current.push(cells);
    } else if (current.length) { tables.push(current); current = []; }
  }
  if (current.length) tables.push(current);
  const real = tables.filter(t => t.length >= 2);              // header + at least one row
  if (!real.length) return null;
  const escapeCell = (c: string) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  return real.map(t => t.map(r => r.map(escapeCell).join(",")).join("\n")).join("\n\n");
}

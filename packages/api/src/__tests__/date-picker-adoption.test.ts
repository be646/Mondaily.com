import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * No surface falls back to the browser's own calendar.
 *
 * `<input type="date">` paints the BROWSER's picker — its own typeface, its own chrome, no theme
 * token reaches it. Seventeen of them were scattered across tasks, calendar, finance, reports,
 * record-detail and the period selector, so "pick a date" looked like a different product
 * depending on where you did it.
 */
describe("dates are picked with the app's own calendar", () => {
  const files = walk(APP).filter(f => !f.endsWith("date-picker.tsx"));

  it("no native date input survives outside a comment", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/**")) continue;
        if (/type="date"|type="datetime-local"/.test(line)) offenders.push(`${f.slice(APP.length)}: ${t.slice(0, 70)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("a datetime always emits a time, so it is parsed as LOCAL not UTC", () => {
    // `new Date("2026-08-12")` is UTC midnight; `new Date("2026-08-12T00:00")` is local. Emitting
    // the bare form into a datetime field reintroduced the exact offset bug the tasks page
    // documents, where a due date displayed and then SAVED shifted by the viewer's timezone.
    const src = readFileSync(join(APP, "components/ui/date-picker.tsx"), "utf8");
    expect(src).toMatch(/withTime \? `\$\{ymd\(d\)\}T\$\{t \|\| "00:00"\}`/);
  });

  it("dates are formatted from local parts, never toISOString", () => {
    // toISOString() shifts across the timezone and silently moves the day.
    const src = readFileSync(join(APP, "components/ui/date-picker.tsx"), "utf8");
    const ymd = src.match(/function ymd\([^)]*\)[^}]*\}/)![0];
    expect(ymd).not.toMatch(/toISOString/);
    expect(ymd).toMatch(/getFullYear|getMonth|getDate/);
  });
});

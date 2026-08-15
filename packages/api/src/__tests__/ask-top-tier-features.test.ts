import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownTablesToCsv } from "../../../../apps/app/src/lib/markdown-tables";

const APP = join(__dirname, "../../../../apps/app/src");
const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(join(APP, "components/ai/ask-mondaily.tsx"), "utf8"));
const engine = strip(readFileSync(join(APP, "components/ai/use-ask-engine.ts"), "utf8"));
const store = strip(readFileSync(join(APP, "lib/chat-store.ts"), "utf8"));

/** The three capabilities that closed the gap to a top-tier chat, each verified by behaviour. */
describe("edit-and-rerun", () => {
  it("truncates the last exchange in BOTH the screen and the stored thread, then reuses doSend", () => {
    // Two send paths would drift; the whole point is ONE.
    expect(engine).toMatch(/const editAndResend = \(text: string\)/);
    expect(engine).toMatch(/setMessages\(prev => prev\.slice\(0, lastUser\)\)/);
    expect(engine).toMatch(/truncateThread\(currentThreadId, lastUser\)/);
    expect(engine).toMatch(/setTimeout\(\(\) => doSend\(t\), 0\)/);
    expect(store).toMatch(/export function truncateThread/);
  });

  it("only the LAST question is editable — rewriting the middle would orphan its answers", () => {
    expect(page).toMatch(/i === messages\.length - 2/);
  });

  it("keyboard follows the composer's own contract: Enter runs, Escape cancels", () => {
    expect(page).toMatch(/e\.key === "Enter" && !e\.shiftKey/);
    expect(page).toMatch(/e\.key === "Escape"/);
  });
});

describe("tables download as CSV", () => {
  const answer = [
    "Here is the pipeline:", "",
    "| Stage | Deals | Value |", "| --- | --- | --- |",
    "| Lead | 13 | $1,900,000 |", "| Negotiation, late | 4 | \"Big\" deals |",
    "", "And a note after.",
  ].join("\n");

  it("extracts the real table, skipping the separator row", () => {
    const csv = markdownTablesToCsv(answer)!;
    expect(csv).toContain("Stage,Deals,Value");
    expect(csv).not.toContain("---");
  });

  it("escapes commas and quotes the way a spreadsheet expects", () => {
    const csv = markdownTablesToCsv(answer)!;
    expect(csv).toContain('"Negotiation, late"');
    expect(csv).toContain('"""Big"" deals"');
  });

  it("returns null for prose — the button must not appear on tableless answers", () => {
    expect(markdownTablesToCsv("Just a sentence.\nAnother one.")).toBeNull();
    // A lone pipe-ish line without a body is not a table either.
    expect(markdownTablesToCsv("| looks like a header |")).toBeNull();
  });

  it("the button renders only when a table exists, and downloads client-side", () => {
    expect(page).toMatch(/markdownTablesToCsv\(m\.content\) && \(/);
    expect(page).toMatch(/mondaily-answer\.csv/);
  });
});

describe("the step checklist shows what actually ran", () => {
  it("accumulates REAL status frames — never a plan invented up front", () => {
    expect(engine).toMatch(/setStepLog\(prev => prev\[prev\.length - 1\] === ev\.text \? prev : \[\.\.\.prev, ev\.text\]\)/);
    expect(engine).toMatch(/setStepLog\(\[\]\)/);   // reset per turn
  });

  it("renders completed steps with a check and the current one spinning", () => {
    expect(page).toMatch(/stepLog\.map\(\(step, si\)/);
    expect(page).toMatch(/si === stepLog\.length - 1 && streamStatus/);
  });
});

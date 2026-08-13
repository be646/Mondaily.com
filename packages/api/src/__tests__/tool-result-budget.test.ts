import { describe, it, expect } from "vitest";
import { boundToolResult } from "../lib/ai-gateway";

/**
 * The prompt-size fix, tested on the thing that actually grows: tool output.
 *
 * MEASURED in production 2026-08-13 — the reason this exists:
 *
 *   fixed floor (system prompt + tool schemas)   ~4,400 tokens
 *   observed chat prompts                        median 8,514, MAX 30,783
 *   worst latency                                122 SECONDS
 *   peak traffic                                 7 requests/minute
 *
 * The floor is small, so nearly all of a 30k prompt is tool output. And because every tool result
 * is re-sent on each later round, one fat result is paid repeatedly. That is simultaneously why Ask
 * was slow and why it hit a tokens-per-minute ceiling at trivial traffic — one bug, two symptoms.
 */
describe("tool output is bounded before it enters the prompt", () => {
  it("passes a normal result through untouched", () => {
    const small = "Found 3 open task(s):\n- [a] one\n- [b] two\n- [c] three";
    const r = boundToolResult(small, 0, "list_tasks");
    expect(r.text).toBe(small);
    expect(r.used).toBe(small.length);
  });

  it("caps a single oversized result", () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `- [id${i}] a record with a fairly long name`).join("\n");
    expect(huge.length).toBeGreaterThan(100_000);
    const r = boundToolResult(huge, 0, "search_records");
    expect(r.text.length).toBeLessThan(7_000);
  });

  it("TELLS the model the list was cut — a silent truncation becomes a wrong answer", () => {
    // This is the part that matters. A quietly shortened list reads as complete, and the model will
    // confidently report "3 invoices" when there were 400.
    const huge = Array.from({ length: 4000 }, (_, i) => `- invoice ${i}`).join("\n");
    const r = boundToolResult(huge, 0, "list_invoices");
    expect(r.text).toMatch(/truncated/i);
    expect(r.text).toMatch(/INCOMPLETE/);
    expect(r.text).toMatch(/list_invoices/);
  });

  it("never cuts a row in half", () => {
    const rows = Array.from({ length: 4000 }, (_, i) => `- [id${i}] name ${i}`).join("\n");
    const r = boundToolResult(rows, 0, "search_records");
    const body = r.text.split("\n[truncated")[0]!;
    // Every retained line must be a whole row, not a fragment ending mid-token.
    for (const line of body.split("\n")) expect(line).toMatch(/^- \[id\d+\] name \d+$|^$/);
  });

  it("budgets across the WHOLE turn, not per call", () => {
    // A per-tool cap cannot hold the total down: the cost is the SUM across tools and rounds.
    const chunk = "x".repeat(5_000);
    let spent = 0;
    for (let i = 0; i < 10; i++) {
      const r = boundToolResult(chunk, spent, `tool_${i}`);
      spent += r.used;
    }
    expect(spent, "total tool output across a turn must stay bounded").toBeLessThanOrEqual(24_000);
  });

  it("degrades honestly once the turn's budget is gone", () => {
    const r = boundToolResult("some late result", 24_000, "run_report");
    expect(r.used).toBe(0);
    expect(r.text).toMatch(/omitted/);
    expect(r.text, "the model must be told the answer is incomplete rather than guessing").toMatch(/incomplete/i);
  });

  it("handles empty and non-string results without throwing", () => {
    expect(() => boundToolResult("", 0, "t")).not.toThrow();
    expect(() => boundToolResult(undefined as unknown as string, 0, "t")).not.toThrow();
    expect(typeof boundToolResult(undefined as unknown as string, 0, "t").text).toBe("string");
  });
});

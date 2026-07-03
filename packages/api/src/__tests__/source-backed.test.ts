import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, buildContextNote, selectTools } from "../routes/ask";

/**
 * Source-backed AI enforcement, as tests. These assert the deterministic contracts that make
 * factual answers grounded: the system prompt forbids invented sources; factual/web questions
 * surface a source-returning tool; and action-chip context is preserved (not fabricated).
 * (The end-to-end "answer contains sources" is exercised at runtime; here we lock the pieces
 *  that make it possible without a live gateway.)
 */

describe("System prompt forbids fabricated sources", () => {
  it("instructs the model to use real sources and never invent candidates", () => {
    expect(SYSTEM_PROMPT).toMatch(/source-backed|real source URL|never invent/i);
  });
});

describe("Factual / web questions surface a source-returning tool", () => {
  const factual = [
    "what do people say about Acme Clinic online",
    "find reviews of this law firm",
    "look up the latest news about our competitor",
    "search the web for pricing of X",
  ];
  for (const q of factual) {
    it(`selectTools includes web_search for: "${q}"`, () => {
      const names = selectTools(q).map((t) => t.name);
      expect(names).toContain("web_search");
    });
  }

  it("a pure conversational greeting does NOT pull in web_search", () => {
    const names = selectTools("hi there, thanks").map((t) => t.name);
    expect(names).not.toContain("web_search");
  });
});

describe("Action-chip context is preserved, never invented", () => {
  it("threads a selected record's node_id into the context note", () => {
    const note = buildContextNote({ node_id: "node_123", node_name: "Acme Corp", object_type: "company" });
    expect(note).toContain("node_123");
    expect(note).toContain("Acme Corp");
  });

  it("threads an open task's id into the context note", () => {
    const note = buildContextNote({ task_id: "task_9", task_title: "Follow up ACME" });
    expect(note).toContain("task_9");
    expect(note).toContain("Follow up ACME");
  });

  it("threads a report id so numbers are computed, not guessed", () => {
    const note = buildContextNote({ report_id: "rep_1", report_title: "Q4 Pipeline" });
    expect(note).toContain("rep_1");
    expect(note).toMatch(/run_report/); // instructs computing real numbers, not guessing
  });

  it("invents NO context when none is provided (empty note)", () => {
    expect(buildContextNote(undefined)).toBe("");
    expect(buildContextNote({})).toBe("");
  });

  it("does not leak a node_id that was never supplied", () => {
    const note = buildContextNote({ task_id: "task_1" });
    expect(note).not.toMatch(/node_id: node_/);
  });
});

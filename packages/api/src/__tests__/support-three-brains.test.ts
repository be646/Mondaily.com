import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectBrain } from "../routes/support";

const support = readFileSync(join(__dirname, "../routes/support.ts"), "utf8");
const panel = readFileSync(join(__dirname, "../../../../apps/app/src/components/help/help-panel.tsx"), "utf8");

/**
 * The three-brain support agent (2026-08-19, user ask: "very helpful, fixing everything without
 * coming back to me or opening a ticket"). KNOWLEDGE = the original source-backed answerer,
 * untouched. REPAIR = diagnoses THIS workspace with real tools and files complete bug reports
 * itself. BUILDER = does real work in-chat with Ask's creation tools. The honesty rule survives
 * all three: report exactly what tools did, never pretend.
 */

describe("brain routing", () => {
  it("build intent wins when it LEADS — even if the sentence mentions a bug", () => {
    expect(detectBrain("create a report about the bug I logged")).toBe("builder");
    expect(detectBrain("set up an automation for new leads")).toBe("builder");
    expect(detectBrain("make me a sheet for suppliers")).toBe("builder");
  });
  it("problems route to repair — bare feature nouns must NOT hijack them (audited misroute)", () => {
    expect(detectBrain("the pipeline number looks wrong")).toBe("repair");
    expect(detectBrain("I was charged twice, payment failed")).toBe("repair");
    expect(detectBrain("export is broken")).toBe("repair");
    expect(detectBrain("my dashboard is broken")).toBe("repair");
    expect(detectBrain("the sheet is not loading")).toBe("repair");
    expect(detectBrain("fix the broken automation")).toBe("repair");
  });
  it("a creation verb inside a problem sentence does not flip it — position decides", () => {
    expect(detectBrain("the workflow I set up keeps failing")).toBe("builder");   // leads with set up — ambiguous, builder can hand off
    expect(detectBrain("something is wrong, can you create a fix task")).toBe("repair");
  });
  it("questions route to knowledge (the original path, unchanged)", () => {
    expect(detectBrain("what does the weighted forecast mean?")).toBe("knowledge");
    expect(detectBrain("how much is the Command plan?")).toBe("knowledge");
  });
});

describe("the repair brain never mutates through Ask tools — its writes are the supervised locals", () => {
  it("repair's ask-tool subset is reads only; builder gets the creation set", () => {
    const repairIdx = support.indexOf("REPAIR_TOOL_NAMES");
    const repairBlock = support.slice(repairIdx, repairIdx + 400);
    expect(repairBlock).not.toMatch(/create_record|create_object_type|create_workflow/);
    const builderIdx = support.indexOf("BUILDER_TOOL_NAMES");
    expect(support.slice(builderIdx, builderIdx + 500)).toContain('"create_object_type"');
  });

  it("file_bug_report reuses the ONE ticket path — same diagnostics, notifications, platform mail", () => {
    expect(support).toContain("async function createSupportTicketFull(");
    expect(support).toMatch(/const created = await createSupportTicketFull\(ws, userId, \{\s*category: "bug_report"/);
    // The route uses the same function — an agent-filed ticket must not be a lesser ticket.
    expect(support).toMatch(/const created = await createSupportTicketFull\(ws, userId, \{ category: body\.category/);   // explicit args — the deploy tsc infers zod fields optional
  });

  it("the close-date tool is a DRY RUN that points at the supervised screen", () => {
    expect(support).toContain("proposeWinDates(ws, {})");
    expect(support).toContain("Never writes");
  });
});

describe("honesty properties", () => {
  it("both brains carry the never-pretend doctrine and stay unmetered like knowledge", () => {
    expect(support).toContain("NEVER claim an action you did not take.");
    expect(support).toContain("If a tool fails, say it failed — never claim success.");
    expect(support).toMatch(/UNMETERED like the knowledge path/);
  });

  it("a failed tool loop degrades to the ORIGINAL knowledge path, never to an error", () => {
    expect(support).toContain("fall through and answer source-backed without tools");
  });

  it("the panel renders the tool log — acting must never be invisible", () => {
    expect(panel).toContain("m.toolLog!.map");
    expect(panel).toContain('m.brain === "repair" ? "repair brain" : "builder brain"');
  });

  it("repair never bounces the user to the ticket form — it files itself", () => {
    expect(support).toContain("needs_ticket: false,                       // repair files its own tickets");
  });
});

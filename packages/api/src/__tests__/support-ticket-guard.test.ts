import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ticketContentIssue } from "../routes/support";

/**
 * Support empty-ticket guard. ticketContentIssue is the single authoritative check applied by
 * POST /support/tickets (so every path — Help escalation, Settings → Support, direct API — is
 * covered). Returns null for actionable tickets, or { error, questions } to nudge for detail.
 */
describe("ticketContentIssue — rejects junk, keeps real tickets", () => {
  it("rejects empty subject", () => {
    expect(ticketContentIssue("", "The export button returns a 404 on Safari")).toBeTruthy();
    expect(ticketContentIssue("  ", "The export button returns a 404 on Safari")).toBeTruthy();
  });

  it("rejects empty / whitespace-only message", () => {
    expect(ticketContentIssue("Export broken", "")).toBeTruthy();
    expect(ticketContentIssue("Export broken", "     \n\t ")).toBeTruthy();
  });

  it("rejects generic one-word filler", () => {
    for (const junk of ["help", "PROBLEM", "test", "?", "broken", "idk", "  none  "]) {
      expect(ticketContentIssue("Need help", junk), junk).toBeTruthy();
    }
  });

  it("rejects too-thin content (needs a short sentence's worth)", () => {
    expect(ticketContentIssue("Login", "cant")).toBeTruthy();       // 1 word, <15 chars
  });

  it("returns a friendly error + clarifying questions", () => {
    const issue = ticketContentIssue("Login", "help");
    expect(issue?.error).toMatch(/detail|describe|subject/i);
    expect(Array.isArray(issue?.questions) && issue!.questions.length).toBeGreaterThan(0);
  });

  it("ALLOWS a valid, specific ticket (returns null)", () => {
    expect(ticketContentIssue("Export 404", "The CSV export button returns a 404 on Safari 17.")).toBeNull();
    expect(ticketContentIssue("Billing question", "Why was I charged twice this month?")).toBeNull();
  });

  it("allows a short but multi-word specific message", () => {
    expect(ticketContentIssue("Discovery", "Discovery search returns no results")).toBeNull();
  });
});

describe("route wiring + scoping unchanged (source guards)", () => {
  const support = readFileSync(fileURLToPath(new URL("../routes/support.ts", import.meta.url)), "utf8");
  const help = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/help/help-panel.tsx", import.meta.url)), "utf8");

  it("POST /tickets returns 422 + needs_more_info before inserting", () => {
    expect(support).toMatch(/const issue = ticketContentIssue\(args\.subject, args\.message\);/);   // guard moved INTO the one creation path — agent-filed tickets clear it too
    expect(support).toMatch(/needs_more_info: true, questions: created\.rejected\.questions \}, 422\)/);
    // the 422 short-circuits before the nodes insert
    const guardIdx = support.indexOf("ticketContentIssue(args.subject");
    const insertIdx = support.indexOf('object_type: "support_ticket"');
    expect(guardIdx).toBeLessThan(insertIdx);
  });

  it("stores trimmed subject/message (no whitespace-padded rows)", () => {
    expect(support).toMatch(/const subject = args\.subject\.trim\(\);/);
    expect(support).toMatch(/const message = args\.message\.trim\(\);/);
  });

  it("workspace/user scoping on insert is unchanged", () => {
    expect(support).toMatch(/workspace_id: ws, vertical: "shared", object_type: "support_ticket", created_by: userId/);
  });

  it("Help chat investigates first — no empty ticket on premature escalation", () => {
    expect(help).toMatch(/if \(!firstUser \|\| message\.trim\(\)\.length < 15\)/);
    expect(help).toMatch(/Before I open a request, tell me a bit more/);
  });

  it("Help chat surfaces the server 'needs more info' nudge instead of failing silently", () => {
    expect(help).toMatch(/needs_more_info|questions\?: string\[\]/);
    expect(help).toMatch(/state: "waiting_for_user", messages: \[\.\.\.s\.messages, \{ role: "assistant", content: ask/);
  });
});

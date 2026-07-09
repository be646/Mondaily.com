import { describe, it, expect } from "vitest";
import { sanitizeStreamingMarkdown } from "@mondaily/shared/markdown-stream";

describe("sanitizeStreamingMarkdown — hides half-arrived tokens, keeps closed ones", () => {
  it("hides an unclosed bold until its closer arrives", () => {
    expect(sanitizeStreamingMarkdown("The deal is **impor")).toBe("The deal is ");
    expect(sanitizeStreamingMarkdown("The deal is **important**")).toBe("The deal is **important**");
  });
  it("hides an unclosed inline code span", () => {
    expect(sanitizeStreamingMarkdown("run `npm ins")).toBe("run ");
    expect(sanitizeStreamingMarkdown("run `npm install`")).toBe("run `npm install`");
  });
  it("hides an incomplete link (label or url still arriving)", () => {
    expect(sanitizeStreamingMarkdown("see [the do")).toBe("see ");
    expect(sanitizeStreamingMarkdown("see [the docs](http")).toBe("see ");
    expect(sanitizeStreamingMarkdown("see [the docs](https://x.io)")).toBe("see [the docs](https://x.io)");
  });
  it("hides a dangling single-* italic opener", () => {
    expect(sanitizeStreamingMarkdown("a note *in progr")).toBe("a note ");
    expect(sanitizeStreamingMarkdown("a note *italic*")).toBe("a note *italic*");
  });
  it("leaves fully-closed / plain text untouched", () => {
    expect(sanitizeStreamingMarkdown("Just plain text.")).toBe("Just plain text.");
    expect(sanitizeStreamingMarkdown("**a** and `b` and *c*")).toBe("**a** and `b` and *c*");
    expect(sanitizeStreamingMarkdown("")).toBe("");
  });
  it("handles the realistic partial-stream sequence of a bold phrase", () => {
    const steps = ["Revenue ", "Revenue **", "Revenue **up", "Revenue **up 20", "Revenue **up 20%**"];
    const rendered = steps.map(sanitizeStreamingMarkdown);
    // never exposes the raw "**" while the token is open
    expect(rendered.slice(0, 4).every(s => !s.includes("**"))).toBe(true);
    expect(rendered[4]).toBe("Revenue **up 20%**");
  });
});

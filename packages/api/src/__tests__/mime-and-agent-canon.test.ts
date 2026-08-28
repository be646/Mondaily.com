import { describe, it, expect } from "vitest";
import { decodeMimeWords } from "@mondaily/shared/mime";
import { canonicalAgentName } from "@mondaily/shared/agents";

/**
 * Live-audit regressions (2026-08-28):
 *  - the Emails list rendered "=?UTF-8?Q?Re=3A_Sovereign_outboun…" verbatim as a subject;
 *  - the Agents trust table showed "Signal Agent" twice (grouped on the raw stored spelling).
 */
describe("decodeMimeWords — RFC 2047 subjects render as the sender wrote them", () => {
  it("decodes Q-encoding with =XX bytes and underscore-as-space", () => {
    expect(decodeMimeWords("=?UTF-8?Q?Re=3A_Sovereign_outbound_relay_test?=")).toBe("Re: Sovereign outbound relay test");
  });
  it("decodes B-encoding (base64)", () => {
    expect(decodeMimeWords("=?utf-8?B?SGVsbG8gd29ybGQ=?=")).toBe("Hello world");
  });
  it("decodes non-ASCII (UTF-8 é through Q-encoding)", () => {
    expect(decodeMimeWords("=?UTF-8?Q?R=C3=A9union_demain?=")).toBe("Réunion demain");
  });
  it("joins adjacent encoded-words across folding whitespace (RFC 2047 §6.2)", () => {
    expect(decodeMimeWords("=?UTF-8?Q?Hello?= =?UTF-8?Q?_world?=")).toBe("Hello world");
  });
  it("passes plain subjects through untouched", () => {
    expect(decodeMimeWords("Quarterly review — numbers attached")).toBe("Quarterly review — numbers attached");
  });
  it("never throws on a malformed token or unknown charset — returns it as-is", () => {
    expect(decodeMimeWords("=?x-nope?B?!!!?=")).toBe("=?x-nope?B?!!!?=");
    expect(decodeMimeWords(null)).toBe("");
  });
});

describe("canonicalAgentName — one agent, one scorecard row", () => {
  it("collapses every stored spelling of one agent to the roster name", () => {
    expect(canonicalAgentName("signal")).toBe("Signal Agent");
    expect(canonicalAgentName("signal_agent")).toBe("Signal Agent");
    expect(canonicalAgentName("Signal Agent")).toBe("Signal Agent");
    expect(canonicalAgentName("SIGNAL-AGENT")).toBe("Signal Agent");
  });
  it("matches by roster id as well as name", () => {
    expect(canonicalAgentName("graph-enrichment")).toBe("Graph Enrichment Agent");
    expect(canonicalAgentName("planner")).toBe("Goal Planner");
  });
  it("passes an unknown agent through unchanged — never silently renames the future", () => {
    expect(canonicalAgentName("Discovery")).toBe("Discovery");
    expect(canonicalAgentName("")).toBe("");
  });
});

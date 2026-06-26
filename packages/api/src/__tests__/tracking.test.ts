import { describe, it, expect } from "vitest";
import { makeTrackingToken, verifyTrackingToken } from "../lib/tracking";

// Proves the IDOR fix: tracking URLs no longer expose a raw, guessable node id —
// only a signed opaque token that can't be forged or enumerated.
describe("email tracking token", () => {
  it("roundtrips a node id and does not expose it verbatim", () => {
    const id = "8ccef088-6493-4cd9-a0cf-3214098f59a1";
    const tok = makeTrackingToken(id);
    expect(tok).not.toContain(id); // opaque
    expect(verifyTrackingToken(tok)).toBe(id);
  });

  it("rejects a tampered signature", () => {
    const tok = makeTrackingToken("node-1");
    const tampered = tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A");
    expect(verifyTrackingToken(tampered)).toBeNull();
  });

  it("rejects a forged token (attacker swaps the id, keeps a stolen signature)", () => {
    const tok = makeTrackingToken("victim-node");
    const sig = tok.split(".")[1]!;
    const forged = Buffer.from("attacker-node").toString("base64url") + "." + sig;
    expect(verifyTrackingToken(forged)).toBeNull();
  });

  it("rejects garbage and empty input", () => {
    expect(verifyTrackingToken("not-a-token")).toBeNull();
    expect(verifyTrackingToken("")).toBeNull();
    expect(verifyTrackingToken("a.b.c")).toBeNull();
  });
});

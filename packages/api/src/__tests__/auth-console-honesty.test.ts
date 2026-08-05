import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sign-in console's only value is that its numbers are true.
 *
 * It advertises measured work — real proof-of-work attempt counts, real digests, real latencies —
 * so a wrong measurement is worse than no console at all: it is a confident lie about the one thing
 * the page is claiming. These guard the two ways it silently stopped being true.
 */
const APP = join(__dirname, "../../../../apps/app/src");
const trace = readFileSync(join(APP, "lib/auth-trace.tsx"), "utf8");
const login = readFileSync(join(APP, "routes/auth/shadow-login.tsx"), "utf8");

/**
 * Source with comments stripped.
 *
 * The enumeration check below is about what the console PRINTS, and the comment explaining why it
 * must stay generic necessarily names the very phrases it forbids. Matching raw source failed on
 * the prose rather than the behaviour — the same way the design ratchet counts a hex inside a
 * comment. Here the distinction is real, so the test makes it.
 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("timestamps are measured when the event happens", () => {
  it("stamps the clock OUTSIDE the state updater", () => {
    // Reading performance.now() inside setLines dates the line whenever React next flushes. During
    // an 8-second proof-of-work that is long after the fact: observed live, "challenge issued" was
    // stamped 8930ms when it really happened at ~200ms, and every line emitted during the solve
    // collapsed onto one timestamp.
    const stamp = trace.indexOf("const at = Math.round(performance.now() - started.current)");
    const setter = trace.indexOf("setLines(prev => [...prev, { id: seq.current++, at,");
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeLessThan(setter);
    // And no surviving call that computes the time inside an updater.
    expect(trace).not.toMatch(/setLines\(prev => \[\.\.\.prev, \{[^}]*performance\.now\(\)/);
  });
});

describe("no line is emitted for work that did not happen", () => {
  it("reports proof-of-work as ABSENT rather than narrating it", () => {
    // A deployment with PoW off must not print a shield step it never ran.
    expect(login).toMatch(/unavailable: \(\) => trace\.emit\("note", "proof-of-work not required/);
  });

  it("shows the real attempt count and digest, not a fixed string", () => {
    expect(login).toMatch(/r\.attempts\.toLocaleString\(\)/);
    expect(login).toMatch(/r\.digest\.slice/);
    expect(login).toMatch(/\$\{r\.ms\}ms/);
  });

  it("keeps failures generic — no account-enumeration oracle", () => {
    // Distinguishing "no such user" from "wrong password" in the console would leak exactly what
    // the 401 message is careful not to.
    expect(login).toMatch(/trace\.settle\("fail", "sign-in rejected"/);
    expect(code(login)).not.toMatch(/no such user|unknown email|wrong password/i);
  });
});

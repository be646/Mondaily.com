import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  subscribeAlerts, pushAlert, dismissAlert, alertError, alertOk, describeError, errorText,
  type AppAlert,
} from "../../../../apps/app/src/lib/alerts";

/**
 * The mutation-failure alert surface, tested by RUNNING it.
 *
 * This exists because of a gap I had to admit to: the fix for the 38 silently-failing mutations was
 * covered only by tests that asserted the SOURCE contained the right strings. That proves the code
 * was written, not that it behaves — and the behaviour is the whole point, because the bug being
 * fixed was a user being told nothing when a save failed.
 *
 * Driving it in a browser needs an authenticated session, and the owner account has 2FA, so the
 * end-to-end path stays blocked. The store itself is plain TypeScript with no DOM and no React, so
 * everything except the rendering can be exercised directly — which is most of what can be wrong.
 */
describe("the alert store behaves the way the silent-failure fix depends on", () => {
  let seen: AppAlert[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribe = subscribeAlerts(a => { seen = a; });
    for (const a of [...seen]) dismissAlert(a.id);   // isolate: the store is a module singleton
  });
  afterEach(() => { unsubscribe(); vi.useRealTimers(); });

  it("delivers a raised error to subscribers immediately", () => {
    alertError("That didn't save", "Workspace is read-only");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ tone: "error", text: "That didn't save", detail: "Workspace is read-only" });
  });

  it("KEEPS errors until dismissed — the failure must not disappear on its own", () => {
    // The point of the whole fix: a save that failed cannot quietly stop being reported, or the
    // user is back to walking away believing the opposite of what is true.
    alertError("That didn't save");
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(1);
    dismissAlert(seen[0]!.id);
    expect(seen).toHaveLength(0);
  });

  it("fades a success, because it needs no action", () => {
    alertOk("Saved");
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(seen).toHaveLength(0);
  });

  it("caps the stack so a loop of failing requests cannot bury the page", () => {
    for (let i = 0; i < 10; i++) alertError(`failure ${i}`);
    expect(seen).toHaveLength(3);
    // Newest first — the most recent failure is the one the user just caused.
    expect(seen[0]!.text).toBe("failure 9");
  });

  it("stops delivering after unsubscribe", () => {
    unsubscribe();
    const before = seen.length;
    alertError("after teardown");
    expect(seen).toHaveLength(before);
  });

  it("gives the subscriber the current state on subscribe, not only future changes", () => {
    alertError("already here");
    let late: AppAlert[] = [];
    const off = subscribeAlerts(a => { late = a; });
    expect(late).toHaveLength(1);
    off();
  });

  describe("describeError turns what a failed request threw into something a person can act on", () => {
    it("unwraps the API's {\"error\":...} envelope", () => {
      // apiClient rejects with the response body, so the raw message is JSON. Showing that to a
      // user is barely better than showing nothing.
      expect(describeError(new Error('{"error":"Seat limit reached"}'))).toBe("Seat limit reached");
    });

    it("falls back to `message` when that is what the body used", () => {
      expect(describeError(new Error('{"message":"Upstream timeout"}'))).toBe("Upstream timeout");
    });

    it("passes a plain message through untouched", () => {
      expect(describeError(new Error("Network request failed"))).toBe("Network request failed");
    });

    it("never renders an empty banner", () => {
      expect(describeError(new Error(""))).toBe("Something went wrong. Please try again.");
      expect(describeError(undefined)).toBe("Something went wrong. Please try again.");
    });

    it("does not mangle JSON that is not an error envelope", () => {
      expect(describeError(new Error('{"unexpected":true}'))).toBe('{"unexpected":true}');
    });

    /**
     * THE PRODUCTION CRASH, 2026-08-11. Reported as "calendar shows react error and many pages show
     * react error"; client_errors recorded 5 occurrences of minified React error #31 on /calendar,
     * naming an "object with keys {issues, name}" — a ZodError.
     *
     * @hono/zod-validator answers a failed body validation with
     * {"success":false,"error":{"issues":[…],"name":"ZodError"}}, so `error` is an OBJECT. This
     * function returned it under a `string` annotation, the banner rendered it as a React child,
     * and React unmounted the tree. MANY pages because the MutationCache default routes every
     * failed mutation through here — one bad shape broke all of them at once.
     */
    it("turns a ZodError body into a sentence instead of returning an object", () => {
      const body = JSON.stringify({
        success: false,
        error: { name: "ZodError", issues: [{ path: ["title"], message: "Required" }] },
      });
      const out = describeError(new Error(body));
      expect(typeof out).toBe("string");
      expect(out).toBe("title: Required");
    });

    it("reports several invalid fields, bounded", () => {
      const issues = ["title", "starts_at", "ends_at", "owner"].map(f => ({ path: [f], message: "Required" }));
      const out = describeError(new Error(JSON.stringify({ error: { name: "ZodError", issues } })));
      expect(typeof out).toBe("string");
      expect(out).toBe("title: Required; starts_at: Required; ends_at: Required");
    });

    it("handles a nested { error: { message } } envelope", () => {
      expect(describeError(new Error('{"error":{"message":"Upstream refused"}}'))).toBe("Upstream refused");
    });

    it("survives a value whose toString throws", () => {
      // Found by fuzzing. describeError runs inside MutationCache.onError, so throwing here throws
      // from the error handler — the surface that reports a problem becoming the problem, which is
      // the same failure as the crash this path exists to prevent.
      const hostile = { toString() { throw new Error("nope"); } };
      expect(() => describeError(hostile)).not.toThrow();
      expect(typeof describeError(hostile)).toBe("string");
    });

    it("survives a circular object passed as detail", () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      expect(() => pushAlert("error", "Failed", circular as unknown as string)).not.toThrow();
      expect(typeof seen[0]!.detail).toBe("string");
    });

    it("never returns a non-string, whatever the body holds", () => {
      for (const body of ['{"error":{}}', '{"error":[]}', '{"error":null}', '{"error":123}', '{"error":{"issues":[]}}']) {
        expect(typeof describeError(new Error(body)), body).toBe("string");
      }
    });
  });

  /**
   * errorText replaced nine hand-rolled `JSON.parse(err.message)?.error ?? "…"` sites, every one of
   * which put a possibly-OBJECT value straight into React state — the /calendar crash waiting for a
   * different endpoint to reject a body.
   */
  describe("errorText prefers the server's words but never shows wire format", () => {
    it("returns the server's message when there is one", () => {
      expect(errorText(new Error('{"error":"Seat limit reached"}'), "Could not invite.")).toBe("Seat limit reached");
    });

    it("turns a ZodError into a sentence rather than an object", () => {
      const body = JSON.stringify({ error: { name: "ZodError", issues: [{ path: ["email"], message: "Invalid email" }] } });
      const out = errorText(new Error(body), "Could not invite.");
      expect(typeof out).toBe("string");
      expect(out).toBe("email: Invalid email");
    });

    it("falls back rather than showing raw JSON to a person", () => {
      expect(errorText(new Error('{"unexpected":true}'), "Could not invite.")).toBe("Could not invite.");
      expect(errorText(new Error("[1,2,3]"), "Could not invite.")).toBe("Could not invite.");
    });

    it("falls back on an empty or generic failure", () => {
      expect(errorText(new Error(""), "Could not invite.")).toBe("Could not invite.");
      expect(errorText(undefined, "Could not invite.")).toBe("Could not invite.");
    });

    it("passes a plain non-JSON message through", () => {
      expect(errorText(new Error("Network request failed"), "Could not invite.")).toBe("Network request failed");
    });

    it("always returns a string, for any input", () => {
      const inputs: unknown[] = [null, undefined, 0, false, [], {}, { toString() { throw new Error("x"); } }];
      for (const i of inputs) expect(typeof errorText(i, "fallback")).toBe("string");
    });
  });

  /**
   * Defence in depth at the chokepoint. describeError is one caller; a later one will not remember,
   * and TypeScript cannot help when the value came out of JSON.parse. Rendering a non-string throws
   * React #31 and unmounts the page — a banner reporting a failure must never take the screen down.
   */
  describe("no object can reach the DOM through an alert", () => {
    it("coerces an object passed as detail", () => {
      pushAlert("error", "That didn't save", { issues: [{ path: ["title"], message: "Required" }] } as unknown as string);
      expect(typeof seen[0]!.detail).toBe("string");
      expect(seen[0]!.detail).toBe("title: Required");
    });

    it("coerces an object passed as the headline", () => {
      pushAlert("error", { name: "ZodError", issues: [{ path: ["x"], message: "Bad" }] } as unknown as string);
      expect(typeof seen[0]!.text).toBe("string");
      expect(seen[0]!.text).toBe("x: Bad");
    });

    it("falls back to JSON rather than rendering [object Object]", () => {
      pushAlert("error", "Failed", { code: 500, hint: "retry" } as unknown as string);
      expect(seen[0]!.detail).toBe('{"code":500,"hint":"retry"}');
    });

    it("never leaves an empty headline", () => {
      pushAlert("error", "" as unknown as string);
      expect(seen[0]!.text).toBe("Something went wrong.");
    });
  });

  it("pushAlert returns the id the caller needs to dismiss it", () => {
    const id = pushAlert("info", "Working…");
    expect(seen.find(a => a.id === id)).toBeTruthy();
    dismissAlert(id);
    expect(seen.find(a => a.id === id)).toBeFalsy();
  });
});

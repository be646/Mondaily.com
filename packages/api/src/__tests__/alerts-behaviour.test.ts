import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  subscribeAlerts, pushAlert, dismissAlert, alertError, alertOk, describeError,
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
  });

  it("pushAlert returns the id the caller needs to dismiss it", () => {
    const id = pushAlert("info", "Working…");
    expect(seen.find(a => a.id === id)).toBeTruthy();
    dismissAlert(id);
    expect(seen.find(a => a.id === id)).toBeFalsy();
  });
});

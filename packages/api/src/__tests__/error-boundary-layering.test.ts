import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const app = readFileSync(join(APP, "App.tsx"), "utf8");
const layout = readFileSync(join(APP, "routes/dashboard/layout.tsx"), "utf8");
const boundary = readFileSync(join(APP, "components/ui/error-boundary.tsx"), "utf8");

/**
 * WHERE the error boundaries sit, which is the whole difference between "a page broke" and "the app
 * is gone".
 *
 * Three of them, each doing a different job:
 *
 *   App.tsx           — outermost. Catches a stale-chunk load after a deploy and auto-reloads once.
 *   layout.tsx (nav)  — the sidebar, with its own fallback, so navigation survives its own bugs.
 *   layout.tsx (page) — the routed page, INSIDE the chrome, so a crashing page leaves the sidebar
 *                       standing and the user can simply click somewhere else.
 *
 * The fallback tells the user "The rest of the app is fine". That sentence is only TRUE because the
 * page-level boundary is nested inside the layout. Hoist it above the chrome and the card becomes a
 * lie printed on an empty screen.
 *
 * Verified against the real production incident: React #31 on /calendar unmounted the routed page,
 * not the app — the sidebar stayed and navigating away recovered.
 */
describe("error boundaries are layered so a broken page is not a broken app", () => {
  it("the routed page has its own boundary, nested inside the layout chrome", () => {
    // Nested = it appears in the layout, wrapping the Outlet — not only at the router root.
    const main = layout.slice(layout.indexOf("<main"), layout.indexOf("</main>"));
    expect(main, "the page boundary must live inside <main>, below the sidebar").toMatch(/<ErrorBoundary[^>]*>/);
    expect(main).toMatch(/<Outlet\s*\/>/);
  });

  it("that boundary RESETS on navigation", () => {
    /**
     * React error boundaries do not clear themselves. Without a key that changes per route, one
     * page throwing once leaves the boundary latched: every subsequent route renders the error card
     * instead of the page, and only a full reload escapes. The user experiences "the whole app is
     * broken" after a single bad page.
     */
    const main = layout.slice(layout.indexOf("<main"), layout.indexOf("</main>"));
    expect(main, "page boundary must be keyed on the path so navigation clears a caught error")
      .toMatch(/<ErrorBoundary\s+key=\{location\.pathname\}/);
  });

  it("the sidebar is isolated behind its own fallback", () => {
    // If the nav itself throws, the user still needs a way out — a bare crash there removes every
    // route link at once.
    expect(layout).toMatch(/<ErrorBoundary\s+fallback=\{<SidebarFallback\s*\/>\}/);
  });

  it("the router root still catches what the inner boundaries cannot", () => {
    // A chunk that fails to load never reaches the layout, so this one has to exist too.
    expect(app).toMatch(/<ErrorBoundary>/);
  });

  it("the fallback offers a way forward, not just an apology", () => {
    expect(boundary).toMatch(/Try again/);
    expect(boundary).toMatch(/Reload/);
    expect(boundary).toMatch(/window\.location\.reload\(\)/);
    // "Try again" must actually clear the caught error rather than being decorative.
    expect(boundary).toMatch(/setState\(\{ hasError: false/);
  });

  it("a stale chunk after a deploy auto-recovers exactly once", () => {
    // Reloading on every chunk error would loop forever when the chunk is genuinely gone.
    expect(boundary).toMatch(/ChunkLoadError/);
    expect(boundary).toMatch(/sessionStorage\.getItem\(RELOAD_FLAG\)/);
    expect(boundary).toMatch(/sessionStorage\.setItem\(RELOAD_FLAG/);
  });

  it("a render error is reported where a human will see it", () => {
    // console.error goes into a browser nobody is watching. This is how the /calendar crash was
    // found at all — client_errors had it with route, count and user agent.
    expect(boundary).toMatch(/telemetry\/error/);
    expect(boundary).toMatch(/keepalive: true/);
  });
});

/**
 * THE BLIND SPOT, found 2026-08-14.
 *
 * The chunk-recovery branch `return`ed before the reporting call, so a stale-chunk error — by far
 * the most common render error in a deployed SPA — was NEVER recorded. client_errors sat quiet for
 * days while users hit them on every lazy route after a deploy, and the only evidence was someone
 * saying "I keep getting a react error on any page".
 *
 * The auto-reload is exactly what made it invisible: it fixed the symptom and erased the trace.
 */
describe("a stale-chunk error is recorded, not silently reloaded away", () => {
  it("reports BEFORE recovering", () => {
    const fn = boundary.slice(boundary.indexOf("componentDidCatch"), boundary.indexOf("private report"));
    const reportAt = fn.indexOf("this.report(");
    const reloadAt = fn.indexOf("window.location.reload()");
    expect(reportAt, "the report call must exist inside componentDidCatch").toBeGreaterThan(-1);
    expect(reloadAt, "the reload must exist").toBeGreaterThan(-1);
    expect(reportAt, "reporting after the reload means chunk errors are never recorded").toBeLessThan(reloadAt);
  });

  it("keepalive is what makes reporting-before-reload work", () => {
    // Without it the browser cancels the request as the page tears down and the trace is lost anyway.
    expect(boundary).toMatch(/keepalive: true/);
  });

  it("tags chunk errors instead of dropping them", () => {
    // Expected after a deploy and self-healing — but a SPIKE is the difference between one stale
    // tab and every user being bounced, and that is only visible if they are recorded.
    expect(boundary).toMatch(/\[stale-chunk\]/);
  });

  it("still recovers automatically, exactly once", () => {
    expect(boundary).toMatch(/sessionStorage\.setItem\(RELOAD_FLAG/);
    expect(boundary).toMatch(/window\.location\.reload\(\)/);
  });
});

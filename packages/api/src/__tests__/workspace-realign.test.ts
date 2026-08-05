import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A rejected workspace must self-correct, not strand the app.
 *
 * Measured in production on 2026-08-05: the signed-in user was myserverscom@gmail.com while local
 * storage still held a workspace belonging to a different account. Every one of the dashboard's
 * fourteen calls returned 403, and the app's entire response was a yellow "what you see below may
 * be incomplete" banner — the exact warning that was reported. It never recovered on its own.
 */
const client = readFileSync(join(__dirname, "../../../../apps/app/src/lib/api-client.ts"), "utf8");

describe("403 workspace realignment", () => {
  it("retries once after adopting the session's workspace", () => {
    expect(client).toMatch(/if \(response\.status === 403 && !path\.startsWith\("\/auth\/"\)\) \{\s*\n\s*if \(await realignWorkspace\(\)\) response = await send\(\);/);
  });

  it("only realigns when the workspace ACTUALLY changed", () => {
    // Rewriting the same value and retrying turns a genuine permission error into an infinite
    // pair of requests.
    expect(client).toMatch(/if \(!next \|\| next === localStorage\.getItem\("mondaily_workspace_id"\)\) return null/);
  });

  it("shares one probe across concurrent calls", () => {
    // A dashboard fires a dozen queries at once; without this each 403 hits /auth/me separately.
    expect(client).toMatch(/realigning \?\?= /);
  });

  it("reads the workspace header on every send, not once per request", () => {
    // Capturing it before the retry would resend the id the server just rejected.
    expect(client).toMatch(/const send = \(\) => \{\s*\n\s*const workspaceId = localStorage\.getItem/);
  });

  it("never realigns on /auth/ routes", () => {
    // /auth/me is how realignment resolves the truth; looping through it would be circular.
    const guard = client.match(/response\.status === 403 && !path\.startsWith\("\/auth\/"\)/);
    expect(guard).not.toBeNull();
  });
});

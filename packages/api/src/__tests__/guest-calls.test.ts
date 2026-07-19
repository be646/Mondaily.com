import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guest Call Experience Phase 1 — a public, account-less way to join ONE Mondaily call safely.
 * The public routes must fail closed, expose only a safe whitelist, mint roomJoin-only LiveKit tokens,
 * enforce recording consent, and never leak workspace internals or secrets. The guest page must stay
 * outside the dashboard/auth shell and never call an authenticated workspace API.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const route = read("../routes/guest-calls.ts");
const app = read("../app.ts");
const guestPage = read("../../../../apps/app/src/routes/guest-call.tsx");
const appTsx = read("../../../../apps/app/src/App.tsx");
const calendar = read("../routes/calendar.ts");
const calendarUi = read("../../../../apps/app/src/routes/dashboard/calendar.tsx");
const authCtx = read("../../../../apps/app/src/components/auth/sovereign-auth-context.tsx");

describe("guest-calls — public, no-account, fails closed", () => {
  it("is mounted PUBLIC (outside requireAuth) and exposes only /meta + /token", () => {
    expect(app).toMatch(/app\.route\("\/api\/v1\/public\/calls", guestCallsRouter\)/);
    expect(route).toMatch(/router\.post\("\/meta"/);
    expect(route).toMatch(/router\.post\("\/token"/);
    // No requireAuth MIDDLEWARE on this router (it's the public surface; a doc comment may mention it).
    expect(route).not.toMatch(/router\.use\([^)]*requireAuth/);
    expect(route).not.toMatch(/import.*requireAuth/);
  });
  it("both routes verify the same signed JWT + epoch/validity via one shared resolver", () => {
    expect(route).toMatch(/async function resolveGuest\(token: string\)/);
    expect(route).toMatch(/await verify\(token, secret, "HS256"\)/);           // signature + exp enforced
    expect(route).toMatch(/claims\.kind !== "call_guest"/);
    expect(route).toMatch(/Number\(claims\.epoch \?\? 0\) < Number\(d\.guest_link_epoch \?\? 0\)/); // revocation
  });
  it("resolveGuest returns every honest status (ok/expired/revoked/cancelled/ended/not_configured)", () => {
    for (const s of ["not_configured", "expired", "cancelled", "ended", "revoked", '"ok"']) {
      expect(route).toMatch(new RegExp(`status: ${s.startsWith('"') ? s : `"${s}"`}`));
    }
  });
});

describe("guest metadata — strict whitelist, no workspace internals or secrets", () => {
  it("returns ONLY the safe whitelist fields", () => {
    for (const f of ["event_title", "start_time", "host_display_name", "workspace_display_name", "recording_may_occur", "calls_enabled", "status"]) {
      expect(route).toMatch(new RegExp(`${f}`));
    }
  });
  it("never leaks attendees / notes / recording / email / secrets (code, not prose)", () => {
    // The meta handler resolves host + workspace by NAME only and reads only the event's `data`.
    expect(route).toMatch(/\.select\("name"\)/);            // host + workspace name only
    expect(route).toMatch(/\.select\("data"\)/);            // event lookup — no wildcard
    expect(route).not.toMatch(/\.select\("\*"\)/);
    // no CODE reference to sensitive fields / no secret env value inside a JSON response
    expect(route).not.toMatch(/attendee_ids|recording_url|\.email|d\.description|data\.description/);
    expect(route).not.toMatch(/c\.json\([^\n]*(?:LIVEKIT_API_SECRET|AUTH_JWT_SECRET|SUPABASE_SERVICE_KEY)/);
  });
  it("recording_may_occur reflects the real recording capability (recordingEnabled)", () => {
    expect(route).toMatch(/import \{ recordingEnabled \} from "\.\.\/lib\/livekit"/);
    expect(route).toMatch(/const recording_may_occur = recordingEnabled\(\)/);
  });
});

describe("guest token — consent-gated, roomJoin only, no secrets", () => {
  it("requires consent === true when recording may occur", () => {
    expect(route).toMatch(/if \(recordingEnabled\(\) && consent !== true\)/);
    expect(route).toMatch(/code: "consent_required"/);
    expect(route).toMatch(/consent: z\.boolean\(\)\.optional\(\)/);
  });
  it("mints a roomJoin-only LiveKit token — NEVER roomAdmin", () => {
    expect(route).toMatch(/roomJoin: true/);
    expect(route).not.toMatch(/roomAdmin: true/);   // never grants admin (a "// NO roomAdmin" note is fine)
    // guest identity is namespaced so the UI badges it; no session/user is created.
    expect(route).toMatch(/identity = `guest_/);
    expect(route).not.toMatch(/issueSession|setCookie|createUser/);
  });
  it("rejects each invalid state with an honest status code", () => {
    expect(route).toMatch(/r\.status === "expired"[\s\S]{0,80}, 401\)/);
    expect(route).toMatch(/r\.status === "cancelled"[\s\S]{0,80}, 410\)/);
    expect(route).toMatch(/r\.status === "ended"[\s\S]{0,80}, 410\)/);
    expect(route).toMatch(/r\.status === "revoked"[\s\S]{0,80}, 403\)/);
    expect(route).toMatch(/!callsEnabled\(\)[\s\S]{0,110}, 503\)/);
  });
});

describe("host guest-link actions — organizer/admin gated (unchanged endpoints)", () => {
  it("mint + revoke stay organizer/admin-only on the calendar route", () => {
    expect(calendar).toMatch(/canManage\(ev\.data, me, c\.get\("role"\)\)/);
    expect(calendar).toMatch(/Only the organizer or an admin can create a guest link/);
    expect(calendar).toMatch(/router\.post\("\/events\/:id\/guest-link"/);
    expect(calendar).toMatch(/router\.post\("\/events\/:id\/revoke-guest-links"/);
  });
  it("the calendar UI surfaces Copy/Revoke guest link only to the organizer", () => {
    expect(calendarUi).toMatch(/isOrganizer && e\.call_url && e\.calls_enabled/);
    expect(calendarUi).toMatch(/Copy guest link/);
    expect(calendarUi).toMatch(/Revoke links/);
    expect(calendarUi).toMatch(/\/calendar\/events\/\$\{id\}\/guest-link/);
    expect(calendarUi).toMatch(/\/calendar\/events\/\$\{id\}\/revoke-guest-links/);
  });
});

describe("guest page — outside dashboard/auth, public APIs only, consent gate", () => {
  it("route is top-level (no DashboardLayout / auth wrapper)", () => {
    expect(appTsx).toMatch(/<Route path="\/join\/:eventId" element=\{<GuestCallPage \/>\} \/>/);
    // guest page imports no dashboard layout / auth-only client.
    expect(guestPage).not.toMatch(/DashboardLayout|useCurrentUser|requireAuth/);
  });
  it("calls ONLY the two public endpoints — never an authenticated workspace API", () => {
    expect(guestPage).toMatch(/\/api\/v1\/public\/calls\/meta/);
    expect(guestPage).toMatch(/\/api\/v1\/public\/calls\/token/);
    // no apiClient (which attaches auth) and no other /api/v1 calls.
    expect(guestPage).not.toMatch(/apiClient|getAuthHeaders/);
    expect(guestPage).not.toMatch(/\/api\/v1\/(?!public\/calls)/);
  });
  it("the global auth bootstrap SKIPS its /me probe on the public /join route (no auth call at all)", () => {
    // The provider wraps the router, so without this guard it would fire /auth/me on the guest page.
    expect(authCtx).toMatch(/window\.location\.pathname\.startsWith\("\/join\/"\)[\s\S]{0,40}setGuest\(\); return;/);
  });
  it("keeps the token in the URL fragment (#g=) and never puts it in a query string", () => {
    expect(guestPage).toMatch(/\[#&\]g=\(\[\^&\]\+\)/);
    expect(guestPage).not.toMatch(/\?g=|token=\$\{token\}/);
  });
  it("shows a consent checkbox only when recording may occur + disables join until consented", () => {
    expect(guestPage).toMatch(/const recordingMayOccur = !!meta\?\.recording_may_occur/);
    expect(guestPage).toMatch(/const canJoin = !!name\.trim\(\) && \(!recordingMayOccur \|\| consent\)/);
    expect(guestPage).toMatch(/By joining, I consent to being recorded/);
    expect(guestPage).toMatch(/disabled=\{!canJoin\}/);
    // consent flows to the token call.
    expect(guestPage).toMatch(/consent: recordingMayOccur \? consent : undefined/);
  });
});

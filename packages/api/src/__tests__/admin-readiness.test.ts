import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * /api/v1/admin/readiness — an owner/admin-only, READ-ONLY production config inspector. It must return
 * booleans/status ONLY (never a secret value), reuse the real gating helpers, and perform no side
 * effects: no paid AI, Stripe, mail send, LiveKit, STT, search, scrape, or GPU calls.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const route = read("../routes/admin-readiness.ts");
const app = read("../app.ts");
const livekit = read("../lib/livekit.ts");
const ui = read("../../../../apps/app/src/routes/dashboard/settings/ai-control-room.tsx");

describe("admin readiness — gated, read-only, no secrets", () => {
  it("is registered and admin-gated (requireAuth + requireAdminRole)", () => {
    expect(app).toMatch(/app\.route\("\/api\/v1\/admin", adminReadinessRouter\)/);
    expect(route).toMatch(/router\.use\("\*", requireAuth, requireAdminRole\)/);
    expect(route).toMatch(/router\.get\("\/readiness"/);
  });
  it("returns booleans via a presence-only helper — never echoes an env VALUE", () => {
    // `has()` coerces to boolean; the raw process.env value is never placed in the response.
    expect(route).toMatch(/const has = \(name: string\) => !!\(process\.env\[name\] \|\| ""\)\.trim\(\)/);
    // The ONLY raw process.env value read anywhere in the file is the public git SHA (deploy_commit).
    const envReads = route.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect(envReads).toEqual(["process.env.VERCEL_GIT_COMMIT_SHA"]);
    // Everything else goes through the boolean `has("NAME")` presence check (bracket access, no value out).
    expect(route).toMatch(/deploy_commit: process\.env\.VERCEL_GIT_COMMIT_SHA/);
  });
  it("reuses the real feature gates (can't drift from actual behavior)", () => {
    expect(route).toMatch(/import \{ liveKitEnabled, recordingEnabled, transcriptionEnabled, livekitSelfTest \} from "\.\.\/lib\/livekit"/);
    expect(route).toMatch(/import \{ isEmbeddingsEnabled, embedOne \} from "\.\.\/lib\/embeddings"/);
    expect(route).toMatch(/const livekit_configured = liveKitEnabled\(\)/);
    expect(route).toMatch(/const stt_configured = transcriptionEnabled\(\)/);
    expect(route).toMatch(/const embeddings_configured = isEmbeddingsEnabled\(\)/);
  });
  it("performs NO side effects — no paid AI / Stripe / mail / LiveKit / STT / search / scrape / GPU calls", () => {
    // The only I/O is a read-only Supabase getBucket metadata check, wrapped so it can't throw.
    expect(route).toMatch(/supabase\.storage\.getBucket\(RECORDINGS_BUCKET\)/);
    expect(route).toMatch(/catch \{ recording_bucket_checkable = false; \}/);
    // No mutations / sends / external fetches / model or provider CALLS (naming a config field like
    // stripe_configured / scrape_configured is fine — invoking those subsystems is what's forbidden).
    expect(route).not.toMatch(/\.upload\(|\.remove\(|createSignedUploadUrl|createSignedUrl|sendMail|createCheckout|fetch\(|createCompletion|\.chat\(|transcribeAudio|searchWeb\(|scrapeUrl\(/);
  });
  it("exposes the grouped status (ready/partial/missing) for every subsystem", () => {
    for (const g of ["billing", "mail", "ai", "calls", "meeting_memory", "realtime", "search", "private_inference"]) {
      expect(route).toMatch(new RegExp(`${g}:`));
    }
    // realtime is READY when all three credentials are present (creds → mintable token); MISSING otherwise.
    // Not hardcoded "partial" — the live socket is confirmed by the smoke test, not this endpoint.
    expect(route).toMatch(/realtime: supabase_realtime_token_configured \? "ready" : "missing"/);
    expect(route).not.toMatch(/realtime: supabase_realtime_token_configured \? "partial"/);
    // Note no longer implies missing publication/anon config; it's an advisory to smoke-test the socket.
    expect(route).toMatch(/supabase_realtime_note: "Realtime credentials are configured\. Live subscription should be verified by smoke test/);
    expect(route).not.toMatch(/Token env is present, but a live realtime websocket also requires/);
  });
  it("adds NO live websocket / realtime probe from the endpoint (env presence only)", () => {
    // The readiness endpoint must never open a realtime socket or call the Supabase realtime API.
    expect(route).not.toMatch(/realtime\/v1\/websocket|createClient|\.channel\(|WebSocket|new RealtimeClient|setAuth\(/);
    // supabase usage stays limited to the read-only bucket metadata check.
    expect((route.match(/supabase\.storage\.getBucket/g) ?? []).length).toBe(1);
    expect(route).not.toMatch(/supabase\.realtime/);
  });
  it("does NOT run a paid AI health probe — configured-only", () => {
    expect(route).toMatch(/ai_gateway_healthy: null/);
  });
});

describe("mail self-test — admin-only, own-address-only, fail-safe, no spam", () => {
  it("is a POST under the admin-gated router (inherits requireAuth + requireAdminRole)", () => {
    expect(route).toMatch(/router\.post\("\/readiness\/mail-test"/);
  });
  it("sends ONLY to the caller's own workspace email — never an arbitrary recipient from the body", () => {
    // Recipient resolved server-side from workspace_members by userId+workspaceId; no body.to / req input.
    expect(route).toMatch(/\.from\("workspace_members"\)\.select\("email, name"\)/);
    expect(route).toMatch(/\.eq\("user_id", userId\)\.eq\("workspace_id", ws\)/);
    expect(route).toMatch(/to: \[\{ email, name:/);
    // The handler never reads a recipient from the request body.
    expect(route).not.toMatch(/req\.json[\s\S]*mail-test/);
    expect(route).not.toMatch(/body\.(to|email|recipient)/);
  });
  it("is fail-safe — reuses sendTransactionalEmail (returns false, never throws) + honest reason", () => {
    // Named-import list, not an exact line: the file legitimately also imports sovereignRelayStatus
    // from the same module. What matters is that the send path reuses the shared fail-safe helper.
    expect(route).toMatch(/import \{[^}]*\bsendTransactionalEmail\b[^}]*\} from "\.\.\/lib\/mail"/);
    expect(route).toMatch(/const sent = await sendTransactionalEmail\(\{/);
    expect(route).toMatch(/reason: "mail_not_configured_or_send_failed"/);
    expect(route).toMatch(/subject: "Mondaily production mail test"/);
  });
  it("has a per-user cooldown so it can't be used to spam", () => {
    expect(route).toMatch(/const MAIL_TEST_COOLDOWN_MS = 60_000/);
    expect(route).toMatch(/if \(now - prev < MAIL_TEST_COOLDOWN_MS\)/);
    expect(route).toMatch(/reason: "cooldown"/);
  });
});

describe("livekit self-test — non-destructive, no egress, no secrets", () => {
  it("is a POST under the admin-gated router and delegates to livekitSelfTest()", () => {
    expect(route).toMatch(/router\.post\("\/readiness\/livekit-test"/);
    expect(route).toMatch(/const r = await livekitSelfTest\(\)/);
  });
  it("only mints+discards a short-lived join token — NO room create, NO recording/egress", () => {
    expect(livekit).toMatch(/export async function livekitSelfTest\(\)/);
    expect(livekit).toMatch(/exp: now \+ 60/);              // short-lived
    // Must not start egress / recording / hit the LiveKit network in the self-test.
    const fn = livekit.slice(livekit.indexOf("export async function livekitSelfTest"), livekit.indexOf("export async function livekitSelfTest") + 700);
    expect(fn).not.toMatch(/startRoomEgress|StartRoomCompositeEgress|fetch\(|roomRecord/);
    expect(fn).toMatch(/if \(!liveKitEnabled\(\)\) return \{ ok: false, token_minted: false/);  // fail closed
  });
  it("returns booleans only — never the token, key, or secret", () => {
    // Response is { ok, token_minted, reason? } — the token variable is never placed in the return.
    expect(route).toMatch(/return c\.json\(r\)/);
    const fn = livekit.slice(livekit.indexOf("export async function livekitSelfTest"), livekit.indexOf("export async function livekitSelfTest") + 700);
    expect(fn).toMatch(/token_minted: !!token/);
    expect(fn).not.toMatch(/return \{[^}]*token:[^}]*\}/);   // never returns the raw token
    expect(fn).not.toMatch(/secret:|key:/);                 // never returns key/secret
  });
});

describe("readiness UI — renders every subsystem row, no env values, calls readiness page intact", () => {
  it("fetches the admin readiness endpoint and renders a Production readiness section", () => {
    expect(ui).toMatch(/apiClient\.get<ReadinessResp>\("\/admin\/readiness"\)/);
    expect(ui).toMatch(/title="Production readiness"/);
    expect(ui).toMatch(/<ProdReadinessSection \/>/);
  });
  it("renders a row for every grouped subsystem", () => {
    for (const k of ["ai", "billing", "mail", "realtime", "calls", "meeting_memory", "search", "private_inference"]) {
      expect(ui).toMatch(new RegExp(`key: "${k}"`));
    }
  });
  it("shows status + unlocks + fail-closed + priority, never an env value", () => {
    expect(ui).toMatch(/Ready|Partial|Missing|Unknown/);
    expect(ui).toMatch(/Unlocks: /);
    expect(ui).toMatch(/Without it: /);
    expect(ui).toMatch(/before customers/);
    // The UI never reads process.env or renders a secret-shaped token.
    expect(ui).not.toMatch(/process\.env|sk_live|whsec_|SUPABASE_SERVICE_KEY|API_KEY\b/);
  });
  it("renders the two admin self-test actions with Passed/Failed/Not-run states", () => {
    expect(ui).toMatch(/function VerifyAction/);
    expect(ui).toMatch(/"Passed"/);
    expect(ui).toMatch(/"Failed"/);
    expect(ui).toMatch(/"Not run"/);
    // mail verify → the own-address mail-test endpoint; calls verify → the livekit-test endpoint.
    expect(ui).toMatch(/label="Verify mail \(to me\)"/);
    expect(ui).toMatch(/"\/admin\/readiness\/mail-test"/);
    expect(ui).toMatch(/label="Verify LiveKit"/);
    expect(ui).toMatch(/"\/admin\/readiness\/livekit-test"/);
    // No Stripe-payment or realtime-fix button was added.
    expect(ui).not.toMatch(/Verify Stripe|Test payment|Fix realtime/i);
  });
});

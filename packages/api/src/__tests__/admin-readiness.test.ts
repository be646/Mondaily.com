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
    expect(route).toMatch(/import \{ liveKitEnabled, recordingEnabled, transcriptionEnabled \} from "\.\.\/lib\/livekit"/);
    expect(route).toMatch(/import \{ isEmbeddingsEnabled \} from "\.\.\/lib\/embeddings"/);
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
    // realtime is honestly "partial" when only the token env is present (WS still needs Supabase config).
    expect(route).toMatch(/realtime: supabase_realtime_token_configured \? "partial" : "missing"/);
    expect(route).toMatch(/supabase_realtime_note: "Token env is present/);
  });
  it("does NOT run a paid AI health probe — configured-only", () => {
    expect(route).toMatch(/ai_gateway_healthy: null/);
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
});

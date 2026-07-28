import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Shared mutable mock state (vi.hoisted so the vi.mock factories can reference it safely).
const h = vi.hoisted(() => ({ cacheData: [] as Array<Record<string, unknown>>, upserts: [] as unknown[], gatewayCalls: [] as unknown[], gwConfigured: true, gwReturn: "TRANSLATED" }));

vi.mock("@mondaily/db/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b; b.in = () => b; b.gt = () => b;
      b.upsert = (rows: unknown) => { h.upserts.push(rows); return Promise.resolve({ error: null }); };
      (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: h.cacheData });
      return b;
    },
  },
}));

vi.mock("../lib/ai-gateway", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    gatewayEnv: () => (h.gwConfigured ? { baseURL: "https://gw", apiKey: "k" } : {}),
    aiGateway: async (req: unknown) => { h.gatewayCalls.push(req); return { text: h.gwReturn, provider: "p", model: "gpt-oss-120b" }; },
  };
});

import { translateLines, textHash, translationConfigured } from "../lib/translation";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LIVE_CALLS = "packages/api/src/routes/live-calls.ts";
const GUEST_CALLS = "packages/api/src/routes/guest-calls.ts";
const TRANSLATION = "packages/api/src/lib/translation.ts";
const CALL_TILES = "apps/app/src/routes/dashboard/call-tiles.tsx";
const CALL_ROOM = "apps/app/src/routes/dashboard/call-room.tsx";
const GUEST_CALL = "apps/app/src/routes/guest-call.tsx";
const MIGRATION = "packages/db/migrations/20260720_caption_translations.sql";

beforeEach(() => { h.cacheData = []; h.upserts = []; h.gatewayCalls = []; h.gwConfigured = true; h.gwReturn = "TRANSLATED"; });

describe("textHash — stable idempotency key input", () => {
  it("normalizes whitespace + trims so trivially-different text hits the same cache row", () => {
    expect(textHash("  hello   world ")).toBe(textHash("hello world"));
    expect(textHash("hello world")).not.toBe(textHash("hello  worldx"));
  });
});

describe("translateLines — sovereign, cached, honest", () => {
  const WS = "ws1", U = "u1";

  it("target === source → passthrough 'original', NEVER calls the gateway (req 13)", async () => {
    const out = await translateLines(WS, U, "en", [{ text: "hello", source_lang: "en" }]);
    expect(out.results[0].state).toBe("original");
    expect(h.gatewayCalls.length).toBe(0);
  });

  it("cache MISS → translates via gateway once and back-fills the cache", async () => {
    h.gwReturn = "HOLA";
    const out = await translateLines(WS, U, "es", [{ text: "hello", source_lang: "en" }]);
    expect(out.results[0]).toMatchObject({ state: "translated", translated: "HOLA" });
    expect(h.gatewayCalls.length).toBe(1);
    expect(h.upserts.length).toBe(1);
  });

  it("cache HIT avoids a second model call", async () => {
    h.cacheData = [{ text_hash: textHash("hello"), source_lang: "en", translated_text: "HOLA" }];
    const out = await translateLines(WS, U, "es", [{ text: "hello", source_lang: "en" }]);
    expect(out.results[0]).toMatchObject({ state: "translated", translated: "HOLA" });
    expect(h.gatewayCalls.length).toBe(0);      // served from cache — no gateway hit
  });

  it("empty model output → 'unavailable', never fabricated, nothing cached (req 14)", async () => {
    h.gwReturn = "   ";
    const out = await translateLines(WS, U, "es", [{ text: "hello", source_lang: "en" }]);
    expect(out.results[0].state).toBe("unavailable");
    expect(out.results[0]).not.toHaveProperty("translated");
    expect(h.upserts.length).toBe(0);
  });

  it("gateway not configured → everything 'unavailable'/'original', no AI call", async () => {
    h.gwConfigured = false;
    const out = await translateLines(WS, U, "es", [{ text: "hello", source_lang: "en" }, { text: "hi", source_lang: "es" }]);
    expect(out.configured).toBe(false);
    expect(out.results[0].state).toBe("unavailable");
    expect(out.results[1].state).toBe("original");   // same-lang stays original
    expect(h.gatewayCalls.length).toBe(0);
  });

  it("de-dupes identical source text within a batch → one model call", async () => {
    const out = await translateLines(WS, U, "es", [{ text: "same", source_lang: "en" }, { text: "same", source_lang: "en" }]);
    expect(out.results.every((r) => r.state === "translated")).toBe(true);
    expect(h.gatewayCalls.length).toBe(1);
  });

  it("cache key carries workspace + text_hash + source + target (unique idempotency tuple)", () => {
    expect(read(MIGRATION)).toMatch(/UNIQUE \(workspace_id, text_hash, source_lang, target_lang\)/);
    expect(read(TRANSLATION)).toMatch(/onConflict: "workspace_id,text_hash,source_lang,target_lang", ignoreDuplicates: true/);
  });

  it("translationConfigured reflects the gateway env", () => { expect(translationConfigured()).toBe(true); });
});

// ── Guardrails: auth/workspace, no STT/recording/guest coupling, sovereign-only, original untouched ────
describe("Phase C.1 endpoint + sovereignty guards", () => {
  const s = read(LIVE_CALLS);

  it("adds an auth-gated, workspace-scoped, rate-limited /translate endpoint", () => {
    expect(s).toMatch(/router\.post\("\/translate", rateLimit\(/);
    expect(s).toMatch(/router\.use\("\*", requireAuth\)/);
    expect(s).toMatch(/const ws = c\.get\("workspaceId"\)/);
  });

  it("translation runs ONLY through aiGateway, metered as feature 'live_translation' (req 9/16)", () => {
    const t = read(TRANSLATION);
    expect(t).toMatch(/from "\.\/ai-gateway"/);
    expect(t).toMatch(/feature: "live_translation"/);
  });

  it("NEVER reads/writes call_transcript_lines and never touches STT/recording", () => {
    const t = read(TRANSLATION);
    // the reassuring docstring names the table, but there must be NO actual query against it
    expect(t).not.toMatch(/\.from\(["']call_transcript_lines["']\)/);
    expect(t).not.toMatch(/caption-chunk|SOVEREIGN_STT|egress|\/transcribe|recording_status/i);
    // the endpoint takes text in the body — it does not fetch transcript rows
    expect(s).not.toMatch(/\/translate[\s\S]{0,400}from\("call_transcript_lines"\)/);
  });

  it("no browser/third-party translation anywhere in the Phase C surfaces (incl. guest)", () => {
    const all = [TRANSLATION, LIVE_CALLS, GUEST_CALLS, CALL_TILES, CALL_ROOM, GUEST_CALL].map(read).join("\n");
    expect(all).not.toMatch(/webkitSpeechRecognition|[^a-zA-Z]SpeechRecognition|deepl|googleapis|translate\.google|libretranslate|\.translate\(/i);
  });

  it("no gateway keys/config leak to the frontend (member or guest)", () => {
    expect([CALL_TILES, CALL_ROOM, GUEST_CALL].map(read).join("\n")).not.toMatch(/AI_GATEWAY_API_KEY|AI_GATEWAY_BASE_URL|SOVEREIGN_STT/);
  });

  // ── Phase C.3 — guest translation: token + consent scoped, write-nothing, no data exposure ──────────
  it("C.3: guest /translate is token + consent gated, rate-limited, ws from claims only", () => {
    const g = read(GUEST_CALLS);
    expect(g).toMatch(/router\.post\("\/translate", rateLimit\(/);           // rate-limited
    expect(g).toMatch(/c\.req\.header\("X-Guest-Token"\)/);                    // token via header
    expect(g).toMatch(/resolveGuest\(token\)/);                               // valid/unrevoked/unexpired token
    expect(g).toMatch(/if \(c\.req\.query\("consent"\) !== "true"\) return c\.json\(\{ error: "consent_required" \}/);
    expect(g).toMatch(/const ws = r\.claims!\.ws!/);                          // workspace ONLY from signed claims
    // never trusts workspace/room/event/member id from the body (body carries only target + lines)
    expect(g).not.toMatch(/\/translate[\s\S]{0,600}(body\.ws|body\.room|body\.event_id|body\.workspace)/);
  });
  it("C.3: guest /translate reuses the shared engine, returns translations only, no transcript read, NO guest read route", () => {
    const g = read(GUEST_CALLS);
    expect(g).toMatch(/translateLines\(ws,/);                                 // reuses C.1/C.2 engine + cache
    expect(g).not.toMatch(/\/translate[\s\S]{0,600}from\("call_transcript_lines"\)/);  // never reads transcript rows
    expect(g).not.toMatch(/router\.get\("\/translate"/);                      // write-nothing; no guest read endpoint
  });
  it("C.3: guest page wires onTranslate to the PUBLIC token+consent endpoint (not the member route)", () => {
    const gc = read(GUEST_CALL);
    expect(gc).toMatch(/\/api\/v1\/public\/calls\/translate\?consent=true/);
    expect(gc).toMatch(/"X-Guest-Token": token/);
    expect(gc).not.toMatch(/\/live-calls\/translate/);                        // guest never calls the member endpoint
  });

  it("migration: RLS on, TTL/expiry present, additive", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(m).toMatch(/expires_at/);
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS caption_translations/);
  });
});

// ── Frontend UI states ────────────────────────────────────────────────────────────────────────────────
describe("Translation overlay UI — honest states, original preserved, member-only", () => {
  const tiles = read(CALL_TILES);
  it("renders a member-only target-language selector (Original/off) that affects BOTH tabs", () => {
    // C.2: the selector is shown whenever onTranslate is present (not gated to the Transcript tab).
    expect(tiles).toMatch(/\{onTranslate && \(/);
    expect(tiles).not.toMatch(/onTranslate && view === "transcript"/);
    expect(tiles).toMatch(/<option value="off"[^>]*>Original<\/option>/);
    expect(tiles).toMatch(/SUPPORTED_LANGUAGES/);
  });
  it("renders translated / pending / unavailable states and always keeps the original visible", () => {
    expect(tiles).toMatch(/translating…/);
    expect(tiles).toMatch(/translation unavailable — showing original/);
    expect(tiles).toMatch(/· original/);                       // original always shown beneath the translation
    expect(tiles).toMatch(/c\.lang !== target/);               // same-lang lines are not sent (req 13/15)
  });
  it("C.2: a shared translationFor helper drives BOTH the Live and Transcript renders, finals-only", () => {
    expect(tiles).toMatch(/const translationFor = \(c: CaptionPacket\)/);
    expect(tiles).toMatch(/const translating = target !== "off" && !!onTranslate && !!c\.final/);  // interim never translates
    // both tab maps exist and both consume the shared helper (used ≥2×)
    expect(tiles).toMatch(/captions\.map\(\(c\) => \{/);   // Live tab
    expect(tiles).toMatch(/timeline\.map\(\(c\) => \{/);   // Transcript tab
    expect((tiles.match(/translationFor\(c\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("Live tab renders the ORIGINAL immediately (interim italic/dim) — translation is async overlay only", () => {
    expect(tiles).toMatch(/opacity: c\.final \? 1 : 0\.6, fontStyle: c\.final \? "normal" : "italic"/);
  });
  it("debounces translation off finals for both tabs (batched, capped, tab-agnostic)", () => {
    expect(tiles).toMatch(/setTimeout\(async/);
    expect(tiles).toMatch(/\.slice\(0, 50\)/);
    expect(tiles).toMatch(/if \(!onTranslate \|\| target === "off"\) return/);   // no `view` guard → serves both tabs
  });
  it("member call room wires onTranslate to the authenticated /translate endpoint", () => {
    expect(read(CALL_ROOM)).toMatch(/\/api\/v1\/live-calls\/translate/);
  });

  // ── Phase C.4 — persisted per-viewer language preference (client-side only) ────────────────────────
  it("C.4: CaptionsPanel restores a VALIDATED saved language, defaults to Original, persists on change", () => {
    expect(tiles).toMatch(/preferenceKey\?: string/);                                   // opt-in prop
    expect(tiles).toMatch(/localStorage\.getItem\(preferenceKey\)/);                    // restore
    expect(tiles).toMatch(/saved === "off" \|\| \(saved && SUPPORTED_LANGUAGES\.some\(\(l\) => l\.code === saved\)\)/); // validated
    expect(tiles).toMatch(/return "off";/);                                             // default = Original
    expect(tiles).toMatch(/localStorage\.setItem\(preferenceKey, v\)/);                 // persist on change
    // persistence is client-side only — never a transcript/STT/AI write
    expect(tiles).not.toMatch(/call_transcript_lines|SOVEREIGN_STT|aiGateway/);
  });
  it("C.4: member key is workspace-scoped; guest key is a client-side guest key (no workspace read)", () => {
    expect(read(CALL_ROOM)).toMatch(/preferenceKey=\{`mondaily_caption_lang:\$\{/);     // per user/workspace
    expect(read(CALL_ROOM)).toMatch(/mondaily_workspace_id/);
    expect(read(GUEST_CALL)).toMatch(/preferenceKey="mondaily_caption_lang_guest"/);    // guest: browser-local, not workspace-derived
  });
});

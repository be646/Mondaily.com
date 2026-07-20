import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveCaptionsAllowed, liveCaptionChunksAvailable, liveCaptionsAvailable, captionChunk } from "../lib/livekit";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LIVEKIT = "packages/api/src/lib/livekit.ts";
const LIVE_CALLS = "packages/api/src/routes/live-calls.ts";
const GUEST_CALLS = "packages/api/src/routes/guest-calls.ts";

// ── Canary gate (pure, env-driven) ─────────────────────────────────────────────────────────────────
describe("liveCaptionsAllowed — env + workspace canary gate", () => {
  const save = { ...process.env };
  beforeEach(() => {
    delete process.env.SOVEREIGN_STT_CHUNK_URL;
    delete process.env.SOVEREIGN_STT_STREAM_URL;
    delete process.env.LIVE_CAPTIONS_WORKSPACES;
  });
  afterEach(() => { process.env = { ...save }; });

  it("false when no chunk/stream STT endpoint is configured (prod stays off)", () => {
    expect(liveCaptionsAllowed("ws_1")).toBe(false);
  });
  it("STREAM_URL alone does NOT enable the chunk proxy (gate can't drift from captionChunk)", () => {
    process.env.SOVEREIGN_STT_STREAM_URL = "wss://stt.example/stream";
    // generic capability is true, but the chunk-specific gate + allow gate stay false
    expect(liveCaptionsAvailable()).toBe(true);
    expect(liveCaptionChunksAvailable()).toBe(false);
    expect(liveCaptionsAllowed("ws_1")).toBe(false);
  });
  it("CHUNK_URL is what makes the chunk proxy available", () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    expect(liveCaptionChunksAvailable()).toBe(true);
    expect(liveCaptionsAllowed("ws_1")).toBe(true);
  });
  it("true for any workspace when configured and no allowlist set (staging env)", () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    expect(liveCaptionsAllowed("ws_1")).toBe(true);
    expect(liveCaptionsAllowed("ws_2")).toBe(true);
  });
  it("restricts to the allowlist when LIVE_CAPTIONS_WORKSPACES is set (canary)", () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    process.env.LIVE_CAPTIONS_WORKSPACES = "ws_test, ws_other";
    expect(liveCaptionsAllowed("ws_test")).toBe(true);
    expect(liveCaptionsAllowed("ws_nope")).toBe(false);
    expect(liveCaptionsAllowed(null)).toBe(false);
  });
});

// ── Proxy behavior (mocked fetch — no network) ─────────────────────────────────────────────────────
describe("captionChunk — server-side proxy, fail-closed, never invents text", () => {
  const save = { ...process.env };
  afterEach(() => { process.env = { ...save }; vi.unstubAllGlobals(); });

  const call = () => captionChunk({ audio: new ArrayBuffer(8), format: "pcm_s16le", sampleRate: 16000, session: "s", seq: 1 });

  it("fails closed (503, empty text) when SOVEREIGN_STT_CHUNK_URL is unset", async () => {
    delete process.env.SOVEREIGN_STT_CHUNK_URL;
    const r = await call();
    expect(r.ok).toBe(false); expect(r.status).toBe(503); expect(r.text).toBe("");
  });

  it("sends the bearer key server-side and maps a real transcript", async () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    process.env.SOVEREIGN_STT_KEY = "secret-key";
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      // the master key is attached HERE, never handed to a browser
      expect(init.headers.Authorization).toBe("Bearer secret-key");
      expect(String(_url)).toBe("https://stt.example/caption/chunk");
      return new Response(JSON.stringify({ text: "hello world", no_speech: false, language: "en", confidence: 0.9 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await call();
    expect(r).toMatchObject({ ok: true, status: 200, text: "hello world", no_speech: false, language: "en", confidence: 0.9 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("passes silence through as no_speech with empty text", async () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "", no_speech: true }), { status: 200 })));
    const r = await call();
    expect(r).toMatchObject({ ok: true, no_speech: true, text: "" });
  });

  it("fails closed on a non-2xx appliance response (no fabricated text)", async () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 503 })));
    const r = await call();
    expect(r.ok).toBe(false); expect(r.status).toBe(503); expect(r.text).toBe("");
  });

  it("fails closed (504) on a network/abort error", async () => {
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://stt.example";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const r = await call();
    expect(r.ok).toBe(false); expect(r.status).toBe(504); expect(r.text).toBe("");
  });
});

// ── Source-scan guards ─────────────────────────────────────────────────────────────────────────────
describe("Phase 2 API — endpoints are gated, private, and leak nothing", () => {
  it("member caption endpoint is auth-gated + canary-gated + fail-closed", () => {
    const s = read(LIVE_CALLS);
    expect(s).toMatch(/\/caption-chunk/);
    expect(s).toMatch(/liveCaptionsAllowed\(ws\)/);            // per-workspace canary
    expect(s).toMatch(/live_captions_unavailable/);            // 503 fail-closed
    expect(s).toMatch(/requireAuth/);                          // member session required
    expect(s).toMatch(/rateLimit\(/);                          // rate-limited
  });

  it("guest caption endpoint requires token + consent + canary, stays public-only", () => {
    const s = read(GUEST_CALLS);
    expect(s).toMatch(/\/caption-chunk/);
    expect(s).toMatch(/resolveGuest\(token\)/);                // valid guest token required
    expect(s).toMatch(/consent_required/);                     // explicit consent gate
    expect(s).toMatch(/liveCaptionsAllowed\(r\.claims\?\.ws\)/); // canary by token workspace
    expect(s).toMatch(/rateLimit\(/);
  });

  it("caption endpoints read a raw body (arrayBuffer), not multipart parseBody (throws in Vercel Node)", () => {
    for (const f of [LIVE_CALLS, GUEST_CALLS]) {
      const s = read(f);
      expect(s).toMatch(/c\.req\.arrayBuffer\(\)/);
      expect(s).not.toMatch(/\.parseBody\(/);   // the call, not the explanatory comment
    }
    // guest token arrives via header, never multipart/body
    expect(read(GUEST_CALLS)).toMatch(/c\.req\.header\("X-Guest-Token"\)/);
  });

  it("the STT bearer key is added server-side only and never returned to the caller", () => {
    const s = read(LIVEKIT);
    expect(s).toMatch(/Authorization: `Bearer \$\{process\.env\.SOVEREIGN_STT_KEY\}`/);
    // response never carries the key/url — only text/no_speech/language/confidence
    expect(s).not.toMatch(/return[^;]*SOVEREIGN_STT_KEY/);
  });

  it("liveCaptionsAllowed gates on the CHUNK endpoint, not the generic (no drift)", () => {
    const s = read(LIVEKIT);
    // the canary gate must short-circuit on chunk-specific availability, never the stream-or-chunk generic
    expect(s).toMatch(/liveCaptionsAllowed[\s\S]{0,200}liveCaptionChunksAvailable\(\)/);
    expect(s).toMatch(/liveCaptionChunksAvailable = \(\): boolean => !!\(process\.env\.SOVEREIGN_STT_CHUNK_URL/);
    // event view + guest meta both surface via liveCaptionsAllowed (chunk-gated)
    expect(read("packages/api/src/routes/calendar.ts")).toMatch(/live_captions_available: liveCaptionsAllowed\(ws\)/);
    expect(read(GUEST_CALLS)).toMatch(/live_captions_available: liveCaptionsAllowed\(r\.claims\?\.ws\)/);
  });

  it("the caption path persists nothing (no DB writes) and stores no audio", () => {
    // captionChunk + both endpoints must not insert/upsert or write files in the caption flow.
    expect(read(LIVEKIT)).not.toMatch(/from\(["']call|insert\(|upsert\(|writeFile|createWriteStream/);
  });
});

describe("Phase 2 frontend safety + capture path", () => {
  const APP = "apps/app/src";
  const capFiles = ["routes/dashboard/call-room.tsx", "routes/guest-call.tsx", "routes/dashboard/call-tiles.tsx", "routes/dashboard/use-caption-capture.ts"];
  const files = capFiles.map((f) => read(`${APP}/${f}`)).join("\n");
  const hook = read(`${APP}/routes/dashboard/use-caption-capture.ts`);
  const callRoom = read(`${APP}/routes/dashboard/call-room.tsx`);
  const guest = read(`${APP}/routes/guest-call.tsx`);

  it("no raw SOVEREIGN_STT_KEY or appliance URL anywhere in the frontend caption path", () => {
    expect(files).not.toMatch(/SOVEREIGN_STT_KEY|SOVEREIGN_STT_CHUNK_URL|SOVEREIGN_STT_STREAM_URL|SOVEREIGN_STT_URL/);
  });
  it("no browser Web Speech API / no third-party STT in the caption path", () => {
    expect(files).not.toMatch(/webkitSpeechRecognition|[^a-zA-Z]SpeechRecognition|deepgram|assemblyai|api\.openai|whisper\.(ai|api)/i);
  });

  it("Phase A: transcript timeline is FINAL-only, honest empty state, no persistence/translation/network", () => {
    const tiles = read(`${APP}/routes/dashboard/call-tiles.tsx`);
    expect(tiles).toMatch(/captions\.filter\(\(c\) => c\.final\)/);         // timeline built from finals only
    expect(tiles).toMatch(/Transcript appears here as people speak\./);      // honest empty state
    // Phase A adds NO translation / persistence / new network in the caption UI path
    expect(files).not.toMatch(/aiGateway|caption-translate|transcript-line/i); // no Phase B/C endpoints
    expect(files).not.toMatch(/googleapis|translate\.google|deepl/i);          // no third-party translation
    // detected language rides the packet in BOTH rooms (backwards-compatible optional field)
    expect(callRoom).toMatch(/language \? \{ lang: language \}/);
    expect(guest).toMatch(/language \? \{ lang: language \}/);
  });
  it("captures LOCAL mic only (no mixed room / remote audio)", () => {
    expect(hook).toMatch(/getMicTrack/);
    expect(hook).toMatch(/createMediaStreamSource/);
    expect(hook).not.toMatch(/getDisplayMedia|remoteParticipants|createMediaStreamDestination/);
  });
  it("publishes a caption ONLY on non-empty, non-silence text (never fabricated)", () => {
    // the hook only calls onCaption when res.ok && res.text && !res.noSpeech
    expect(hook).toMatch(/res\.text && !res\.noSpeech/);
  });
  it("backs off on transient errors and stops honestly on auth failure", () => {
    expect(hook).toMatch(/backoffUntil = Date\.now\(\) \+ backoffMs/);
    expect(hook).toMatch(/status === 401 \|\| res\.status === 403[\s\S]{0,80}onStop/);
  });
  it("connects the processor through a MUTED gain to destination (pulled everywhere, no echo)", () => {
    expect(hook).toMatch(/createGain\(\)/);
    expect(hook).toMatch(/mute\.gain\.value = 0/);
    expect(hook).toMatch(/mute\.connect\(ctx\.destination\)/);
    expect(hook).toMatch(/wl\.connect\(mute\)/);   // AudioWorklet routed onward (the fix)
    expect(hook).toMatch(/sp\.connect\(mute\)/);   // ScriptProcessor fallback likewise
    // never wires the mic straight to the speakers (that would echo)
    expect(hook).not.toMatch(/source\.connect\(ctx\.destination\)/);
  });
  it("truly aborts the in-flight request on teardown and forwards the signal", () => {
    expect(hook).toMatch(/inflight = new AbortController\(\)/);
    expect(hook).toMatch(/sendChunk\(new Blob\(\[buf\]\), mySeq, inflight\.signal\)/);
    expect(hook).toMatch(/inflight\?\.abort\(\)/);
    // callers POST the raw PCM as the body and forward the abort signal to the network call
    expect(callRoom).toMatch(/method: "POST", body: pcm,[\s\S]{0,160}signal/);
    expect(guest).toMatch(/method: "POST", body: pcm,[\s\S]{0,200}signal/);
  });
  it("tears down capture (interval/context/nodes/gain) on cleanup", () => {
    expect(hook).toMatch(/clearInterval\(flushTimer\)/);
    expect(hook).toMatch(/ctx\?\.close\(\)/);
    expect(hook).toMatch(/node\?\.disconnect\(\)/);
    expect(hook).toMatch(/mute\?\.disconnect\(\)/);
  });
  it("capture is active only when available + CC on + mic on + live", () => {
    expect(callRoom).toMatch(/active:\s*!!event\.live_captions_available && showCaptions && micOn && phase === "live"/);
    expect(guest).toMatch(/active:\s*!!meta\?\.live_captions_available && showCaptions && micOn && phase === "live"/);
  });
  it("member posts to the authenticated endpoint; guest posts to public with token header + consent", () => {
    expect(callRoom).toMatch(/apiFetch\(`\$\{BASE_URL\}\/api\/v1\/live-calls\/caption-chunk\?/);
    expect(guest).toMatch(/\/api\/v1\/public\/calls\/caption-chunk\?/);
    expect(guest).toMatch(/"X-Guest-Token": token/);   // guest token via header, not multipart/URL
    expect(guest).toMatch(/consent: "true"/);          // explicit consent in the query
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCaptionPacket, CAPTION_PACKET_TYPE } from "@mondaily/shared/captions";
import { liveCaptionsAvailable } from "../lib/livekit";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CALL_ROOM = "apps/app/src/routes/dashboard/call-room.tsx";
const CALL_TILES = "apps/app/src/routes/dashboard/call-tiles.tsx";
const GUEST_CALL = "apps/app/src/routes/guest-call.tsx";
const CAPTIONS_SRC = "packages/shared/src/captions.ts";

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const valid = { t: CAPTION_PACKET_TYPE, id: "c1", participantId: "p1", name: "Ada", text: "hello world", final: true, ts: 123 };

describe("caption packet parser", () => {
  it("accepts a valid packet (object, string, and Uint8Array forms)", () => {
    expect(parseCaptionPacket(valid)?.text).toBe("hello world");
    expect(parseCaptionPacket(JSON.stringify(valid))?.id).toBe("c1");
    const p = parseCaptionPacket(enc(valid));
    expect(p).toMatchObject({ participantId: "p1", name: "Ada", final: true });
  });

  it("preserves partial vs final flag", () => {
    expect(parseCaptionPacket({ ...valid, final: false })?.final).toBe(false);
    expect(parseCaptionPacket({ ...valid, final: "yes" })?.final).toBe(false); // only literal true is final
  });

  it("drops malformed packets", () => {
    expect(parseCaptionPacket(null)).toBeNull();
    expect(parseCaptionPacket("not json")).toBeNull();
    expect(parseCaptionPacket(enc("still not an object"))).toBeNull();
    expect(parseCaptionPacket({ ...valid, t: "chat" })).toBeNull();       // wrong type
    expect(parseCaptionPacket({ ...valid, id: "" })).toBeNull();          // empty id
    expect(parseCaptionPacket({ ...valid, participantId: 5 })).toBeNull(); // bad participant
    expect(parseCaptionPacket({ ...valid, text: "" })).toBeNull();        // empty text
    expect(parseCaptionPacket({ ...valid, text: "   " })).toBeNull();     // whitespace-only text
    expect(parseCaptionPacket(enc({ ...valid, text: undefined }))).toBeNull();
  });

  it("clamps/normalizes over-long or missing fields", () => {
    const p = parseCaptionPacket({ ...valid, name: undefined, text: "x".repeat(5000) });
    expect(p?.name).toBe("Speaker");
    expect(p?.text.length).toBe(2000);
    expect(parseCaptionPacket({ ...valid, ts: "nope" })?.ts).toBe(0);
  });
});

describe("liveCaptionsAvailable capability gate", () => {
  const save = { s: process.env.SOVEREIGN_STT_STREAM_URL, c: process.env.SOVEREIGN_STT_CHUNK_URL, b: process.env.SOVEREIGN_STT_URL };

  it("is false when neither stream nor chunk STT is configured", () => {
    delete process.env.SOVEREIGN_STT_STREAM_URL;
    delete process.env.SOVEREIGN_STT_CHUNK_URL;
    process.env.SOVEREIGN_STT_URL = "https://batch.example"; // batch STT alone is NOT enough
    expect(liveCaptionsAvailable()).toBe(false);
    if (save.b === undefined) delete process.env.SOVEREIGN_STT_URL; else process.env.SOVEREIGN_STT_URL = save.b;
  });

  it("is true only when a stream or chunk STT endpoint exists", () => {
    process.env.SOVEREIGN_STT_STREAM_URL = "https://stream.example";
    expect(liveCaptionsAvailable()).toBe(true);
    if (save.s === undefined) delete process.env.SOVEREIGN_STT_STREAM_URL; else process.env.SOVEREIGN_STT_STREAM_URL = save.s;
    process.env.SOVEREIGN_STT_CHUNK_URL = "https://chunk.example";
    expect(liveCaptionsAvailable()).toBe(true);
    if (save.c === undefined) delete process.env.SOVEREIGN_STT_CHUNK_URL; else process.env.SOVEREIGN_STT_CHUNK_URL = save.c;
  });
});

describe("Phase 1 scope guards — no STT / no persistence / no live AI", () => {
  // Scope the "no new STT machinery" scan to the caption UI + transport files. (livekit.ts legitimately
  // keeps the pre-existing batch /transcribe used by post-call Meeting Memory — not part of the caption path.)
  const captionFiles = [CALL_ROOM, CALL_TILES, GUEST_CALL, CAPTIONS_SRC].map(read).join("\n");

  it("captions are ephemeral: no DB / node / Meeting Memory writes in the caption path", () => {
    // The caption transport + UI must not persist. No insert/upsert into nodes, no transcript writes.
    expect(read(CAPTIONS_SRC)).not.toMatch(/supabase|\.from\(|insert|upsert/i);
    expect(read(CALL_TILES)).not.toMatch(/supabase|apiClient|fetch\(/i);
  });

  it("does not add a caption/transcribe endpoint or audio chunking", () => {
    expect(captionFiles).not.toMatch(/caption-chunk|\/transcribe|MediaRecorder|audio_url/);
  });

  it("does not use browser Web Speech API or any external STT provider", () => {
    expect(captionFiles).not.toMatch(/webkitSpeechRecognition|SpeechRecognition|deepgram|whisper|openai|assemblyai|whispers?\.cpp/i);
  });

  it("renders an honest unavailable state for hosts and guests", () => {
    expect(read(CALL_TILES)).toMatch(/Live captions unavailable/);
    expect(read(CALL_ROOM)).toMatch(/CaptionsPanel[\s\S]{0,120}live_captions_available/);
    expect(read(GUEST_CALL)).toMatch(/CaptionsPanel[\s\S]{0,120}live_captions_available/);
  });

  it("guest page reads captions only from the room data channel, not authenticated workspace APIs", () => {
    const g = read(GUEST_CALL);
    expect(g).toMatch(/parseCaptionPacket/);
    // guest must not reach into the authenticated workspace client
    expect(g).not.toMatch(/from ["']@\/lib\/api["']|apiClient/);
  });
});

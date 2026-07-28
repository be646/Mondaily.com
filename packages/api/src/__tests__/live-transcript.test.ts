import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeLiveTranscriptLine, LIVE_TRANSCRIPT_SOURCE } from "@mondaily/shared/captions";
import { liveTranscriptProvenance } from "../lib/live-transcript";
import { meetingRoom } from "../lib/rooms";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const LIVE_CALLS = "packages/api/src/routes/live-calls.ts";
const GUEST_CALLS = "packages/api/src/routes/guest-calls.ts";
const CALLS = "packages/api/src/routes/calls.ts";
const CALENDAR = "packages/api/src/routes/calendar.ts";
const CAPTIONS_SRC = "packages/shared/src/captions.ts";
const CALL_ROOM = "apps/app/src/routes/dashboard/call-room.tsx";
const CALL_DETAIL = "apps/app/src/routes/dashboard/call-detail.tsx";
const GUEST_CALL = "apps/app/src/routes/guest-call.tsx";
const MIGRATION = "packages/db/migrations/20260720_live_transcript.sql";

// ── Sanitizer: finals-only, no fake text, clamped, stable idempotency key ────────────────────────────
describe("sanitizeLiveTranscriptLine — only real, finalized lines survive", () => {
  const base = { id: "p1-3", participantId: "p1", name: "Ada", text: "hello world", ts: 1000, final: true };

  it("accepts a valid FINAL line and preserves the idempotency key + fields", () => {
    const l = sanitizeLiveTranscriptLine(base)!;
    expect(l).toEqual({ line_id: "p1-3", participant_id: "p1", speaker_name: "Ada", text: "hello world", lang: null, ts: 1000 });
  });

  it("treats an omitted `final` as final (client only ever sends finals)", () => {
    expect(sanitizeLiveTranscriptLine({ ...base, final: undefined })?.line_id).toBe("p1-3");
  });

  it("DROPS interim/partial lines (final === false) — never persisted", () => {
    expect(sanitizeLiveTranscriptLine({ ...base, final: false })).toBeNull();
  });

  it("DROPS empty / whitespace-only / non-string text (no fabricated lines)", () => {
    expect(sanitizeLiveTranscriptLine({ ...base, text: "" })).toBeNull();
    expect(sanitizeLiveTranscriptLine({ ...base, text: "   " })).toBeNull();
    expect(sanitizeLiveTranscriptLine({ ...base, text: 5 as unknown as string })).toBeNull();
  });

  it("DROPS a missing/blank id (no idempotency key = not persistable)", () => {
    expect(sanitizeLiveTranscriptLine({ ...base, id: "" })).toBeNull();
    expect(sanitizeLiveTranscriptLine({ ...base, id: undefined })).toBeNull();
  });

  it("clamps text/name/lang and normalizes a missing speaker to 'Speaker' (never invented)", () => {
    const l = sanitizeLiveTranscriptLine({ ...base, name: undefined, text: "x".repeat(5000), lang: "  EN  ".repeat(20) })!;
    expect(l.speaker_name).toBe("Speaker");
    expect(l.text.length).toBe(2000);
    expect((l.lang ?? "").length).toBeLessThanOrEqual(16);
  });

  it("keeps detected language when valid, null when absent/invalid; participant null when absent", () => {
    expect(sanitizeLiveTranscriptLine({ ...base, lang: "pl" })?.lang).toBe("pl");
    expect(sanitizeLiveTranscriptLine({ ...base, lang: 42 as unknown as string })?.lang).toBeNull();
    expect(sanitizeLiveTranscriptLine({ ...base, participantId: undefined })?.participant_id).toBeNull();
  });
});

// ── Provenance: never silently mix live vs recording ─────────────────────────────────────────────────
describe("liveTranscriptProvenance — honest, four states", () => {
  it("no session (meeting call) → live_only", () => {
    expect(liveTranscriptProvenance(null)).toBe("live_only");
    expect(liveTranscriptProvenance({})).toBe("live_only");
  });
  it("recording opted-in but still processing → recording_pending", () => {
    expect(liveTranscriptProvenance({ record: true, recording_status: "recording" })).toBe("recording_pending");
    expect(liveTranscriptProvenance({ record: true, transcript_status: "processing" })).toBe("recording_pending");
  });
  it("recording transcript ready + node materialized → recording_available", () => {
    expect(liveTranscriptProvenance({ record: true, transcript_status: "ready", memory_node_id: "n1" })).toBe("recording_available");
  });
  it("recording/transcription failed → recording_failed_live_fallback", () => {
    expect(liveTranscriptProvenance({ record: true, recording_status: "failed" })).toBe("recording_failed_live_fallback");
    expect(liveTranscriptProvenance({ record: true, transcript_status: "failed" })).toBe("recording_failed_live_fallback");
    expect(liveTranscriptProvenance({ record: true, recording_status: "failed_start" })).toBe("recording_failed_live_fallback");
  });
  it("ready status WITHOUT a materialized node is NOT 'available' (honest)", () => {
    expect(liveTranscriptProvenance({ record: true, transcript_status: "ready", memory_node_id: null })).not.toBe("recording_available");
  });
});

// ── Room derivation is shared (no key drift between save & join) ──────────────────────────────────────
describe("meetingRoom — single source of the room name", () => {
  it("is workspace-namespaced and matches the calendar join room format", () => {
    expect(meetingRoom("ws1", "ev1")).toBe("ws_ws1__meeting__ev1");
    // calendar.ts derives the SAME room via the shared helper (so saved lines key to the joined room)
    expect(read(CALENDAR)).toMatch(/meetingRoom\(ws, eventId\)/);
    expect(read(CALENDAR)).toMatch(/import \{ meetingRoom \} from "\.\.\/lib\/rooms"/);
  });
});

// ── Save/read route guards — workspace-scoped, consent-gated, idempotent, server-derived room ─────────
describe("live-calls transcript routes — safe by construction", () => {
  const s = read(LIVE_CALLS);

  it("save + read endpoints exist under the authenticated live-calls router", () => {
    expect(s).toMatch(/router\.post\("\/transcript"/);
    expect(s).toMatch(/router\.get\("\/transcript"/);
    expect(s).toMatch(/router\.use\("\*", requireAuth\)/);
  });

  it("consent + workspace canary gate (same as captions), rate-limited", () => {
    expect(s).toMatch(/if \(!liveCaptionsAllowed\(ws\)\) return c\.json\(\{ error: "live_captions_unavailable" \}, 503\)/);
    expect(s).toMatch(/router\.post\("\/transcript", rateLimit\(/);
  });

  it("room is SERVER-DERIVED (meetingRoom / session row), never trusted from the client body", () => {
    expect(s).toMatch(/room = meetingRoom\(ws, body\.event_id\)/);
    // never reads a client-supplied room from body or query
    expect(s).not.toMatch(/body\.room|c\.req\.query\("room"\)/);
  });

  it("direct-call session path is workspace + participant scoped (no IDOR)", () => {
    expect(s).toMatch(/\.eq\("workspace_id", ws\)\.eq\("id", body\.session_id\)/);
    expect(s).toMatch(/me !== s\.initiator_id && me !== s\.invitee_id/);
  });

  it("idempotent: unique (workspace_id, room, line_id) with duplicates ignored", () => {
    expect(s).toMatch(/onConflict: "workspace_id,room,line_id", ignoreDuplicates: true/);
    expect(read(MIGRATION)).toMatch(/UNIQUE \(workspace_id, room, line_id\)/);
  });

  it("persists via the shared sanitizer + constant source, only after it survives sanitization", () => {
    expect(s).toMatch(/sanitizeLiveTranscriptLine/);
    expect(s).toMatch(/source: LIVE_TRANSCRIPT_SOURCE/);
    expect(LIVE_TRANSCRIPT_SOURCE).toBe("live_caption");
  });

  it("read path is participant/organizer scoped and returns honest provenance", () => {
    expect(s).toMatch(/liveTranscriptProvenance\(session\)/);
    expect(s).toMatch(/d\.organizer_id !== me && !\(d\.attendee_ids \?\? \[\]\)\.includes\(me\)/);
  });
});

// ── Meeting Memory read path shows live transcript when no recording transcript ───────────────────────
describe("call detail surfaces the live transcript", () => {
  // Superseded by the post-call transcript-UX pass (transcript-ux.test.ts): the detail now always returns
  // live_transcript + transcript_sources + provenance (recording preferred, never merged), and serves an
  // event's saved live transcript when there is no call node.
  it("attaches live_transcript + honest sources/provenance to the call detail", () => {
    const s = read(CALLS);
    expect(s).toMatch(/live_transcript: live/);
    expect(s).toMatch(/transcript_provenance: liveTranscriptProvenance\(session\)/);
    expect(s).toMatch(/transcript_sources: \{ recording: hasRecordingTranscript, live: live\.length > 0 \}/);
  });
  it("frontend renders the live transcript with an honest provenance chip", () => {
    const d = read(CALL_DETAIL);
    expect(d).toMatch(/live_transcript\?/);
    expect(d).toMatch(/transcriptSource\(call\)/);
  });
});

// ── Write path: member saves FINAL lines; guest save deferred to Phase B.1 ────────────────────────────
describe("frontend write path + guest deferral", () => {
  it("member call room POSTs FINAL lines to the save endpoint (best-effort)", () => {
    const r = read(CALL_ROOM);
    expect(r).toMatch(/\/api\/v1\/live-calls\/transcript/);
    expect(r).toMatch(/event_id: event\.id, lines: \[\{ id: pkt\.id/);
    expect(r).toMatch(/final: true/);
  });
  it("guest call page POSTs FINAL guest lines to the public save endpoint (write-only)", () => {
    const g = read(GUEST_CALL);
    expect(g).toMatch(/\/api\/v1\/public\/calls\/transcript\?consent=true/);
    expect(g).toMatch(/"X-Guest-Token": token/);
    expect(g).toMatch(/final: true/);
  });
});

// ── Phase B.1 — guest transcript save: token + consent scoped, write-only, anti-spoof ─────────────────
describe("guest transcript save (Phase B.1) — safe by construction", () => {
  const s = read(GUEST_CALLS);

  it("adds a WRITE-ONLY save endpoint and NO guest read endpoint", () => {
    expect(s).toMatch(/router\.post\("\/transcript"/);
    expect(s).not.toMatch(/router\.get\("\/transcript"/);   // guests can contribute, never read back
  });

  it("token-gated (X-Guest-Token + resolveGuest), consent-required, canary-gated, rate-limited", () => {
    expect(s).toMatch(/router\.post\("\/transcript", rateLimit\(/);
    expect(s).toMatch(/c\.req\.header\("X-Guest-Token"\)/);
    expect(s).toMatch(/resolveGuest\(token\)/);
    expect(s).toMatch(/if \(!liveCaptionsAllowed\(r\.claims\?\.ws\)\)/);
    expect(s).toMatch(/if \(c\.req\.query\("consent"\) !== "true"\) return c\.json\(\{ error: "consent_required" \}/);
  });

  it("derives workspace/room/event from the TOKEN CLAIMS only, never the request body", () => {
    expect(s).toMatch(/const ws = r\.claims!\.ws!/);
    expect(s).toMatch(/const room = r\.claims!\.room!/);
    expect(s).toMatch(/const eventId = r\.claims!\.ev/);
    // the lines array is the ONLY body input; no room/workspace/event read from the body
    expect(s).not.toMatch(/body\.room|body\.workspace|body\.event_id|c\.req\.query\("room"\)/);
  });

  it("anti-spoof: only real guest identities persist (can't poison a member's `user_…` line)", () => {
    expect(s).toMatch(/startsWith\("guest_"\)/);
    expect(s).toMatch(/l\.line_id\.startsWith\("guest_"\)/);
  });

  it("finals-only via shared sanitizer, constant source, idempotent upsert", () => {
    expect(s).toMatch(/sanitizeLiveTranscriptLine/);
    expect(s).toMatch(/source: LIVE_TRANSCRIPT_SOURCE/);
    expect(s).toMatch(/onConflict: "workspace_id,room,line_id", ignoreDuplicates: true/);
  });

  it("stores the guest's OWN display name (never invents / never member data)", () => {
    // speaker_name comes from the sanitized line (guest's name), call_session_id is always null for guests
    expect(s).toMatch(/speaker_name: l\.speaker_name/);
    expect(s).toMatch(/call_session_id: null/);
  });
});

// ── Sovereignty: no translation, no third-party, no Web Speech, no raw secrets ────────────────────────
describe("Phase B sovereignty guards", () => {
  // Phase B surfaces only. calls.ts legitimately imports aiGateway for the (unrelated) call-analysis
  // feature, so it is excluded from the translation/AI-gateway scan; its Phase B addition is scanned
  // structurally above (live_transcript fallback, no translation).
  const phaseB = [LIVE_CALLS, CAPTIONS_SRC, "packages/api/src/lib/live-transcript.ts", "packages/api/src/lib/rooms.ts"].map(read).join("\n");
  const frontend = [CALL_ROOM, CALL_DETAIL, GUEST_CALL].map(read).join("\n");

  it("NO third-party translation anywhere (Phase C adds ONLY sovereign aiGateway translation)", () => {
    // Phase C.1 legitimately introduces sovereign translation (live-calls.ts /translate + call-room onTranslate),
    // so the guard now forbids only THIRD-PARTY/browser translators — never a proprietary translation API.
    expect(phaseB + frontend).not.toMatch(/deepl|googleapis|translate\.google|libretranslate|webkitSpeechRecognition/i);
  });
  it("NO browser Web Speech API / third-party STT introduced", () => {
    expect(phaseB + frontend + read(CALLS)).not.toMatch(/webkitSpeechRecognition|[^a-zA-Z]SpeechRecognition|deepgram|assemblyai|api\.openai|whisper\.(ai|api)/i);
  });
  it("NO STT appliance key/URL leaks to the frontend save path", () => {
    expect(frontend).not.toMatch(/SOVEREIGN_STT_KEY|SOVEREIGN_STT_CHUNK_KEY|SOVEREIGN_STT_CHUNK_URL|SOVEREIGN_STT_URL/);
  });
  it("the migration enables RLS (server-role only) and never writes audio/files", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(m).not.toMatch(/writeFile|createWriteStream|bucket/i);
    expect(existsSync(join(ROOT, MIGRATION))).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CALLS = "packages/api/src/routes/calls.ts";
const GUEST_CALLS = "packages/api/src/routes/guest-calls.ts";
const CALL_DETAIL = "apps/app/src/routes/dashboard/call-detail.tsx";
const CALL_ROOM = "apps/app/src/routes/dashboard/call-room.tsx";
const CALLS_LIST = "apps/app/src/routes/dashboard/calls.tsx";

// ── Backend: honest transcript sources, event-live path, processing, participant-scoped, no leaks ─────
describe("post-call transcript read — honest sources + event live transcript", () => {
  const s = read(CALLS);

  it("detail returns transcript_sources + provenance + a processing flag (recording, never merged with live)", () => {
    expect(s).toMatch(/transcript_sources: \{ recording: hasRecordingTranscript, live: live\.length > 0 \}/);
    expect(s).toMatch(/transcript_provenance: liveTranscriptProvenance\(session\)/);
    expect(s).toMatch(/recording_processing/);
    expect(s).toMatch(/const hasRecordingTranscript = normalized\.transcript\.length > 0/);
  });

  it("serves a completed MEETING's saved live transcript when there's no call node — participant-scoped only", () => {
    // event fallback: only when the caller is organizer/attendee, and only when live lines exist
    expect(s).toMatch(/object_type", "calendar_event"\)\.eq\("id", id\)/);
    expect(s).toMatch(/d\.organizer_id !== me && !\(d\.attendee_ids \?\? \[\]\)\.includes\(me\)\) return c\.json\(\{ error: "Call not found" \}, 404\)/);
    expect(s).toMatch(/\.eq\("room", meetingRoom\(ws, id\)\)/);
    expect(s).toMatch(/if \(!lines \|\| lines\.length === 0\) return c\.json\(\{ error: "Call not found" \}, 404\)/);
    expect(s).toMatch(/is_event: true/);
  });

  it("the memory LIST marks past meetings that have a saved live transcript (one workspace-scoped query)", () => {
    expect(s).toMatch(/from\("call_transcript_lines"\)[\s\S]{0,120}\.eq\("workspace_id", ws\)\.not\("event_id", "is", null\)/);
    expect(s).toMatch(/eventsWithLiveTranscript\.has\(e\.id\)\) \{ row\.transcript_status = "available"; row\.transcript_kind = "live"; \}/);
  });

  it("NEVER mutates transcript rows from the read path (only select/order/limit, no insert/update/delete/upsert)", () => {
    // scope strictly to the GET /:id handler body (later routes legitimately write).
    const start = s.indexOf('router.get("/:id"');
    const detail = s.slice(start, s.indexOf("router.", start + 20));
    expect(detail).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});

// ── Security: no public/guest transcript READ route; no STT key/URL exposure ──────────────────────────
describe("transcript read stays private + sovereign", () => {
  it("there is NO public/guest transcript read route (guests can't read workspace history)", () => {
    const g = read(GUEST_CALLS);
    expect(g).not.toMatch(/router\.get\("\/transcript"/);           // no guest transcript read
    // the guest translate/save routes are POST-only (write-nothing-back for translate; save is write-only)
    expect(g).not.toMatch(/from\("call_transcript_lines"\)\s*\.select/);
  });
  it("call detail/list expose no STT appliance key or URL, and add no third-party transcription/translation", () => {
    const all = [CALL_DETAIL, CALLS_LIST].map(read).join("\n");
    expect(all).not.toMatch(/SOVEREIGN_STT|AI_GATEWAY_API_KEY|AI_GATEWAY_BASE_URL|deepgram|assemblyai|whisper\.(ai|api)|deepl|googleapis/i);
  });
});

// ── Frontend: readable transcript, honest provenance chip, empty/processing/error states ──────────────
describe("call detail transcript UX", () => {
  const d = read(CALL_DETAIL);

  it("shows an HONEST provenance label: recording / live / both / none", () => {
    expect(d).toMatch(/kind: "both", label: "Recording transcript · live captions also saved"/);
    expect(d).toMatch(/kind: "recording", label: "Recording transcript"/);
    expect(d).toMatch(/kind: "live", label: "Live transcript — saved during the call"/);
    expect(d).toMatch(/kind: "none", label: ""/);
  });
  it("renders live lines with speaker, clock time, language and text", () => {
    expect(d).toMatch(/line\.speaker_name/);
    expect(d).toMatch(/new Date\(line\.ts\)\.toLocaleTimeString/);
    expect(d).toMatch(/line\.lang \?/);
    expect(d).toMatch(/HighlightedText text=\{line\.text\}/);
  });
  it("has honest empty, processing, and retryable error states (never a fake transcript)", () => {
    expect(d).toMatch(/No transcript for this call\./);                     // calm empty state
    expect(d).toMatch(/call\.recording_processing \?/);                     // processing branch
    expect(d).toMatch(/Transcription in progress/);
    expect(d).toMatch(/query\.isError/);                                    // retryable error
    expect(d).toMatch(/onClick=\{\(\) => query\.refetch\(\)\}/);
  });
  it("canonical transcript prefers the RECORDING transcript, then live — never merged", () => {
    // recording transcript branch appears BEFORE the live branch (live is the else) → never mixed.
    const iRec = d.indexOf("visibleTranscript.length ? (");
    const iLive = d.indexOf("call.live_transcript?.length ? (");
    expect(iRec).toBeGreaterThan(-1);
    expect(iLive).toBeGreaterThan(iRec);
  });
});

describe("past-meeting (Meeting Memory) detail shows the saved transcript", () => {
  const r = read(CALL_ROOM);
  it("fetches the saved live transcript for the meeting and renders lines with speaker/time/lang", () => {
    expect(r).toMatch(/\/live-calls\/transcript\?event_id=\$\{e\.id\}/);
    expect(r).toMatch(/line\.speaker_name/);
    expect(r).toMatch(/clockOf\(line\.ts\)/);
    expect(r).toMatch(/line\.lang \?/);
  });
  it("honest states: loading, retryable error, live-source chip, and a calm empty state (no fake transcript)", () => {
    expect(r).toMatch(/transcriptQ\.isLoading \?/);
    expect(r).toMatch(/transcriptQ\.isError \?/);
    expect(r).toMatch(/transcriptQ\.refetch\(\)/);
    expect(r).toMatch(/Live transcript — saved during the call/);
    expect(r).toMatch(/No transcript for this meeting\./);
    // the old hardcoded "Transcript unavailable" is now conditional on the real transcript
    expect(r).toMatch(/hasTranscript \? "Live transcript" : "Transcript unavailable"/);
  });
});

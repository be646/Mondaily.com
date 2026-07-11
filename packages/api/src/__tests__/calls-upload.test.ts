import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Phase 1 Meeting Memory — manual upload → transcript → summary. Guards the honest, sovereign,
 * workspace-scoped upload path: consent required, audio-only, size-capped, private storage with
 * signed-URL-only access, STT + AI fail-closed, no raw/public audio, no Memory Phase 2B changes.
 */
const calls = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const pipeline = readFileSync(fileURLToPath(new URL("../jobs/meeting-memory.ts", import.meta.url)), "utf8");
const modal = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/calls/upload-recording-modal.tsx", import.meta.url)), "utf8");
const list = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calls.tsx", import.meta.url)), "utf8");
const detail = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-detail.tsx", import.meta.url)), "utf8");

describe("upload endpoint — validation + consent", () => {
  it("consent attestation is REQUIRED (must be literal true)", () => {
    expect(calls).toMatch(/consent_attestation: z\.literal\(true\)/);
    expect(calls).toMatch(/method: "upload_attestation"/);
  });
  it("rejects non-audio types (415) and oversize files (413)", () => {
    expect(calls).toMatch(/if \(!AUDIO_MIMES\.has\(b\.content_type\)\) return c\.json\(\{ error: "unsupported_type"[^]*?\}, 415\)/);
    expect(calls).toMatch(/if \(b\.size > MAX_UPLOAD_BYTES\) return c\.json\(\{ error: "too_large"[^]*?\}, 413\)/);
    expect(calls).toMatch(/MAX_UPLOAD_BYTES = 500 \* 1024 \* 1024/);
  });
  it("creates an upload-source, workspace-scoped session", () => {
    expect(calls).toMatch(/source: "upload", record: true, recording_status: "uploading", transcript_status: "queued"/);
    expect(calls).toMatch(/workspace_id: ws, room, initiator_id: userId, invitee_id: userId/);
  });
});

describe("private storage — path isolation + signed URLs only, no public audio", () => {
  it("stores under ${ws}/${session}/${file} and verifies the workspace prefix", () => {
    expect(calls).toMatch(/const path = `\$\{ws\}\/\$\{session\.id\}\/\$\{sanitizeFilename\(b\.filename\)\}`/);
    expect((calls.match(/startsWith\(`\$\{ws\}\/`\)/g) ?? []).length).toBeGreaterThanOrEqual(2); // complete + recording-url
  });
  it("recording-url is participant/admin-scoped, short-lived, never public/raw", () => {
    expect(calls).toMatch(/const isParticipant = userId === sess\.initiator_id \|\| userId === sess\.invitee_id/);
    expect(calls).toMatch(/const isAdmin = role === "owner" \|\| role === "admin"/);
    expect(calls).toMatch(/createSignedUrl\(sess\.recording_url, 120\)/);
    expect(calls).not.toMatch(/getPublicUrl/);
  });
  it("normalizeCall never exposes the raw storage path to the client", () => {
    const norm = calls.slice(calls.indexOf("function normalizeCall"), calls.indexOf("async function memberNames"));
    expect(norm).not.toMatch(/recording_url/);   // client shape omits the storage path
    expect(norm).toMatch(/has_recording: Boolean\(data\.has_recording \|\| data\.audio_url\)/);
  });
});

describe("pipeline — sovereign + fail-closed + honest", () => {
  it("uploads mint a signed URL for the STT appliance (never the raw path)", () => {
    expect(pipeline).toMatch(/const isUpload = session\.source === "upload"/);
    expect(pipeline).toMatch(/const audioUrl = isUpload \? await signedRecordingUrl\(session\.recording_url\) : session\.recording_url/);
  });
  it("STT missing → failed, no fabricated transcript", () => {
    expect(pipeline).toMatch(/if \(!transcriptionEnabled\(\)\) \{[^]*?transcript_status: "failed"/);
  });
  it("AI gateway missing/failing → transcript kept, summary stays empty (no fake summary)", () => {
    expect(pipeline).toMatch(/try \{\s*summary = await summarizeTranscript[^]*?\} catch \{\s*summary = "";/);
  });
  it("upload node data does NOT carry the raw path in audio_url", () => {
    expect(pipeline).toMatch(/isUpload \? \{ has_recording: true \} : \{ audio_url: session\.recording_url \}/);
  });
  it("reprocess is scoped + idempotent (re-emits the same idempotent ingest)", () => {
    expect(calls).toMatch(/router\.post\("\/:id\/reprocess"/);
    expect(calls).toMatch(/role === "owner" \|\| role === "admin" \|\| userId === sess\.initiator_id/);
    expect(calls).toMatch(/enqueueIngest\(sess\.id\)/);
  });
});

describe("UI — Import + consent + states + provenance + export", () => {
  it("Calls page has an Import recording action opening the modal", () => {
    expect(list).toMatch(/Import recording/);
    expect(list).toMatch(/<UploadRecordingModal/);
  });
  it("upload modal requires consent + uses init→PUT→complete (no giant multipart)", () => {
    expect(modal).toMatch(/consent_attestation: true/);
    expect(modal).toMatch(/disabled=\{!file \|\| !consent \|\| busy\}/);
    expect(modal).toMatch(/\/calls\/upload\/init/);
    expect(modal).toMatch(/method: "PUT"/);
    expect(modal).toMatch(/\/calls\/upload\/complete/);
  });
  it("detail shows provenance, plays via signed URL, and offers print + reprocess", () => {
    expect(detail).toMatch(/Uploaded recording/);
    expect(detail).toMatch(/\/calls\/\$\{id\}\/recording-url/);
    expect(detail).toMatch(/window\.print\(\)/);
    expect(detail).toMatch(/\/calls\/\$\{id\}\/reprocess/);
  });
});

describe("must-not-change", () => {
  it("no Memory Phase 2B change — calls upload never imports the recall path", () => {
    expect(calls).not.toMatch(/memory-recall|recallContext|buildAskMemory/);
    expect(pipeline).not.toMatch(/memory-recall|recallContext|buildAskMemory/);
  });
  it("sovereignty — STT only via the existing transcribeAudio (SOVEREIGN_STT), no third-party in the upload path", () => {
    expect(pipeline).not.toMatch(/openai\.com|deepgram|assemblyai|whisper\.api|api\.openai/);
    expect(calls).not.toMatch(/openai\.com|deepgram|assemblyai/);
  });
});

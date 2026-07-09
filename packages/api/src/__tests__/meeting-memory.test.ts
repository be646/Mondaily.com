import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sign } from "hono/jwt";
import {
  egressFilepath, mapSttResponse, parseEgressWebhook, verifyLiveKitWebhook,
  liveKitEnabled, recordingEnabled, transcriptionEnabled,
} from "../lib/livekit";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const livekitLib = read("../lib/livekit.ts");
const ingest = read("../jobs/meeting-memory.ts");
const worker = read("../jobs/meeting-memory-worker.ts");
const webhooks = read("../routes/webhooks.ts");
const liveCalls = read("../routes/live-calls.ts");
const appSrc = read("../app.ts");
const inngestLib = read("../lib/inngest.ts");
const migration = read("../../../db/migrations/20260709_call_recording.sql");
const overlay = read("../../../../apps/app/src/components/calls/call-overlay.tsx");

const LK = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET, rec: process.env.LIVEKIT_RECORDING_ENABLED, stt: process.env.SOVEREIGN_STT_URL };
beforeEach(() => { for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_RECORDING_ENABLED", "SOVEREIGN_STT_URL"]) delete process.env[k]; });
afterEach(() => { process.env.LIVEKIT_URL = LK.url; process.env.LIVEKIT_API_KEY = LK.key; process.env.LIVEKIT_API_SECRET = LK.secret; process.env.LIVEKIT_RECORDING_ENABLED = LK.rec; process.env.SOVEREIGN_STT_URL = LK.stt;
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_RECORDING_ENABLED", "SOVEREIGN_STT_URL"]) if (process.env[k] === undefined) delete process.env[k]; });

describe("Capability gating — fail-closed", () => {
  it("recording needs LiveKit AND the operator flag; both default off", () => {
    expect(recordingEnabled()).toBe(false);
    process.env.LIVEKIT_URL = "https://lk"; process.env.LIVEKIT_API_KEY = "k"; process.env.LIVEKIT_API_SECRET = "s";
    expect(liveKitEnabled()).toBe(true);
    expect(recordingEnabled()).toBe(false);            // LiveKit up but flag off → still no recording
    process.env.LIVEKIT_RECORDING_ENABLED = "1";
    expect(recordingEnabled()).toBe(true);
  });
  it("transcription needs the sovereign STT appliance URL (no third-party)", () => {
    expect(transcriptionEnabled()).toBe(false);
    process.env.SOVEREIGN_STT_URL = "http://stt.internal:9000";
    expect(transcriptionEnabled()).toBe(true);
    // the appliance URL is the ONLY transcription config — no OpenAI/whisper SaaS key referenced
    expect(livekitLib).not.toMatch(/openai\.com|api\.openai|whisper\.ai|assemblyai|deepgram/i);
  });
});

describe("egress output path", () => {
  it("is tenant-namespaced and sanitized (no path traversal / collisions)", () => {
    expect(egressFilepath("ws_1__a__b__99")).toBe("recordings/ws_1__a__b__99.ogg");
    expect(egressFilepath("../../etc/passwd")).toBe("recordings/______etc_passwd.ogg");
  });
});

describe("STT response mapping — honest, defensive", () => {
  it("maps diarized segments to transcript lines and drops empties", () => {
    const out = mapSttResponse({ segments: [{ speaker: "Ann", text: "Hi", start: 0 }, { speaker: "Bob", text: "  " }, { speaker: "Ann", text: "Bye", start_time: 12 }] });
    expect(out).toEqual([{ speaker: "Ann", text: "Hi", start_time: 0 }, { speaker: "Ann", text: "Bye", start_time: 12 }]);
  });
  it("falls back to a single line for a plain text blob, and empty for nothing", () => {
    expect(mapSttResponse({ text: "just words" })).toEqual([{ speaker: "Transcript", text: "just words" }]);
    expect(mapSttResponse({})).toEqual([]);
    expect(mapSttResponse(null)).toEqual([]);
  });
});

describe("egress webhook parsing", () => {
  it("extracts id/status/url across LiveKit field-name variants and ignores non-egress events", () => {
    expect(parseEgressWebhook({ event: "room_started" })).toBeNull();
    expect(parseEgressWebhook({ event: "egress_started", egressInfo: { egressId: "EG_1" } }))
      .toMatchObject({ event: "egress_started", egressId: "EG_1", url: null });
    expect(parseEgressWebhook({ event: "egress_ended", egress_info: { egress_id: "EG_2", status: "EGRESS_COMPLETE", file: { location: "https://store/rec.ogg" } } }))
      .toMatchObject({ egressId: "EG_2", status: "EGRESS_COMPLETE", url: "https://store/rec.ogg" });
    expect(parseEgressWebhook({ event: "egress_ended", egressInfo: { egressId: "EG_3", fileResults: [{ filename: "s3://b/rec.ogg" }] } }).url).toBe("s3://b/rec.ogg");
  });
});

describe("webhook signature verification", () => {
  it("accepts a correctly-signed body and rejects tampering / missing secret", async () => {
    process.env.LIVEKIT_API_SECRET = "topsecret";
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG" } });
    const good = await sign({ sha256: createHash("sha256").update(body).digest("base64") }, "topsecret", "HS256");
    expect(await verifyLiveKitWebhook(body, `Bearer ${good}`)).toBe(true);
    expect(await verifyLiveKitWebhook(body + "x", `Bearer ${good}`)).toBe(false);   // body changed → hash mismatch
    expect(await verifyLiveKitWebhook(body, undefined)).toBe(false);
    const wrong = await sign({ sha256: createHash("sha256").update(body).digest("base64") }, "other", "HS256");
    expect(await verifyLiveKitWebhook(body, `Bearer ${wrong}`)).toBe(false);        // signed with wrong secret
    delete process.env.LIVEKIT_API_SECRET;
    expect(await verifyLiveKitWebhook(body, `Bearer ${good}`)).toBe(false);         // fail-closed without secret
  });
});

describe("Pipeline wiring", () => {
  it("webhook route is signature-gated (401) and correlates egress → session", () => {
    expect(webhooks).toMatch(/router\.post\("\/livekit"/);
    expect(webhooks).toMatch(/verifyLiveKitWebhook/);
    expect(webhooks).toMatch(/return c\.json\(\{ error: "invalid signature" \}, 401\)/);
    expect(webhooks).toMatch(/\.eq\("egress_id", hook\.egressId\)/);
  });
  it("completed recording kicks transcription (Inngest when configured, inline otherwise)", () => {
    expect(webhooks).toMatch(/meeting\/recording\.ready/);
    expect(webhooks).toMatch(/ingestRecording\(session\.id\)/);
  });
  it("the Inngest worker is registered in the serve() handler and listens on the event", () => {
    expect(worker).toMatch(/event: "meeting\/recording\.ready"/);
    expect(appSrc).toMatch(/meetingRecordingWorker/);
    expect(inngestLib).toMatch(/"meeting\/recording\.ready":/);
  });
});

describe("ingestion is honest + idempotent", () => {
  it("guards on opt-in and a real recording, and no-ops when already ingested", () => {
    expect(ingest).toMatch(/if \(!session\.record\) return \{ ok: false, reason: "not_opted_in" \}/);
    expect(ingest).toMatch(/if \(!session\.recording_url\) return \{ ok: false, reason: "no_recording" \}/);
    expect(ingest).toMatch(/transcript_status === "ready" && session\.memory_node_id/);
  });
  it("atomically CLAIMS the session before ingesting, so concurrent webhook redelivery can't create duplicate nodes", () => {
    // compare-and-set: only one runner flips to "processing" while memory_node_id is still null.
    expect(ingest).toMatch(/\.update\(\{ transcript_status: "processing" \}\)\s*\.eq\("id", session\.id\)\.is\("memory_node_id", null\)\.neq\("transcript_status", "processing"\)/);
    expect(ingest).toMatch(/if \(!claimed \|\| claimed\.length === 0\) return \{ ok: false, reason: "already_processing" \}/);
  });
  it("never fabricates: STT off/empty → failed status, and summary stays empty on gateway failure", () => {
    expect(ingest).toMatch(/transcriptionEnabled\(\)/);
    expect(ingest).toMatch(/transcript_status: "failed"/);
    expect(ingest).toMatch(/Summary pending/);
    // stored transcript is the real STT output, not invented
    expect(ingest).toMatch(/transcript: lines/);
  });
  it("logs canonical proof-of-work and materializes a searchable call_record node", () => {
    expect(ingest).toMatch(/agent_name: "Meeting Memory"/);
    expect(ingest).toMatch(/object_type: "call"/);
    expect(ingest).toMatch(/feature: "meeting_memory_summary"/);   // AI is metered/credit-gated
  });
});

describe("opt-in + consent surface", () => {
  it("live-calls only records when opted-in AND capable, and exposes capability", () => {
    expect(liveCalls).toMatch(/const willRecord = record && recordingEnabled\(\)/);
    expect(liveCalls).toMatch(/recording: recordingEnabled\(\)/);
    expect(liveCalls).toMatch(/transcription: transcriptionEnabled\(\)/);
  });
  it("the call overlay shows an on-screen recording notice to participants", () => {
    expect(overlay).toMatch(/call\.recording && \(/);
    expect(overlay).toMatch(/Recording/);
  });
  it("migration adds the recording lifecycle columns additively", () => {
    for (const col of ["record", "egress_id", "recording_status", "recording_url", "transcript_status", "memory_node_id"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });
});

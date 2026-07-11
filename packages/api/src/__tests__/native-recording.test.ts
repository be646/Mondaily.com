import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Native Mondaily call recording foundation. Guards: fail-closed when egress env is missing,
 * organizer-only start/stop, participant-visible status, idempotent start/stop + webhook, workspace
 * isolation, no raw/public audio URL, and the upload + action-item flows still work.
 */
const live = readFileSync(fileURLToPath(new URL("../routes/live-calls.ts", import.meta.url)), "utf8");
const calls = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const pipeline = readFileSync(fileURLToPath(new URL("../jobs/meeting-memory.ts", import.meta.url)), "utf8");
const webhooks = readFileSync(fileURLToPath(new URL("../routes/webhooks.ts", import.meta.url)), "utf8");
const overlay = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/calls/call-overlay.tsx", import.meta.url)), "utf8");
const detail = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-detail.tsx", import.meta.url)), "utf8");

describe("recording endpoints — fail-closed + scoped + host-only", () => {
  it("start/stop/status endpoints exist", () => {
    expect(live).toMatch(/router\.post\("\/rooms\/:id\/recording\/start"/);
    expect(live).toMatch(/router\.post\("\/rooms\/:id\/recording\/stop"/);
    expect(live).toMatch(/router\.get\("\/rooms\/:id\/recording\/status"/);
  });
  it("missing egress env → 503 recording_not_configured (start + stop)", () => {
    expect((live.match(/if \(!recordingEnabled\(\)\) return c\.json\(\{ error: "recording_not_configured" \}, 503\)/g) ?? []).length).toBe(2);
  });
  it("organizer(initiator)-only start/stop; any participant may read status", () => {
    expect((live.match(/if \(me !== session\.initiator_id\) return c\.json\(\{ error: "Only the call organizer/g) ?? []).length).toBe(2);
    // status endpoint gates to participants only, returns can_control for the organizer
    expect(live).toMatch(/can_control: me === session\.initiator_id/);
    expect(live).toMatch(/configured: recordingEnabled\(\)/);
  });
  it("workspace-isolated (session load scoped to the workspace)", () => {
    expect(live).toMatch(/\.eq\("workspace_id", ws\)\.eq\("id", id\)\.maybeSingle\(\)/);
  });
});

describe("start/stop idempotency + honest egress state", () => {
  it("start: already recording ⇒ returns current, no second egress; egress fail ⇒ failed_start (502)", () => {
    expect(live).toMatch(/if \(session\.recording_status === "recording" && session\.egress_id\) return c\.json\(\{ recording_status: "recording"/);
    expect(live).toMatch(/recording_status: "failed_start" \}\).eq\("id", session\.id\); return c\.json\(\{ error: "egress_start_failed", recording_status: "failed_start" \}, 502\)/);
  });
  it("stop: not recording ⇒ no-op; recording ⇒ stopRoomEgress + processing (webhook finalizes)", () => {
    expect(live).toMatch(/if \(session\.recording_status !== "recording" \|\| !session\.egress_id\) return c\.json\(\{ recording_status: session\.recording_status \?\? null \}\)/);
    expect(live).toMatch(/await stopRoomEgress\(session\.egress_id\);[^]*?recording_status: "processing"/);
  });
});

describe("webhook completion — signature-verified + idempotent (unchanged)", () => {
  it("egress webhook verifies signature, fails closed, and triggers the idempotent pipeline", () => {
    expect(webhooks).toMatch(/verifyLiveKitWebhook\(rawBody/);
    expect(webhooks).toMatch(/return c\.json\(\{ error: "invalid signature" \}, 401\)/);
    expect(webhooks).toMatch(/meeting\/recording\.ready/);
  });
});

describe("no raw/public audio URL (native + upload both signed-URL only)", () => {
  it("pipeline never puts the raw egress/storage location in client node data", () => {
    expect(pipeline).toMatch(/direction: "outbound", status: "processing",[^]*?has_recording: true,/);
    expect(pipeline).not.toMatch(/audio_url: session\.recording_url/);
  });
  it("recording-url stays workspace-prefix gated (no raw path exposed)", () => {
    expect(calls).toMatch(/if \(!String\(sess\.recording_url\)\.startsWith\(`\$\{ws\}\/`\)\) return c\.json\(\{ error: "forbidden" \}, 403\)/);
  });
});

describe("UI — live recording control + passive indicator", () => {
  it("overlay polls status and controls via the recording endpoints", () => {
    expect(overlay).toMatch(/\/live-calls\/rooms\/\$\{call\.sessionId\}\/recording\/status/);
    expect(overlay).toMatch(/\/live-calls\/rooms\/\$\{call\.sessionId\}\/recording\/\$\{action\}/);
  });
  it("control shown to organizer only when configured; notice driven by live state", () => {
    expect(overlay).toMatch(/rec\?\.can_control && rec\.configured/);
    expect(overlay).toMatch(/recActive \|\| recProcessing/);
  });
  it("detail shows native provenance", () => {
    expect(detail).toMatch(/Native Mondaily call recording/);
  });
});

describe("regressions — upload + action-item promotion still present; sovereign", () => {
  it("upload flow intact", () => {
    expect(calls).toMatch(/router\.post\("\/upload\/init"/);
    expect(calls).toMatch(/router\.post\("\/upload\/complete"/);
  });
  it("action-item promotion intact", () => {
    expect(calls).toMatch(/router\.post\("\/:id\/action-items\/:index\/promote"/);
  });
  it("no third-party (sovereign) in the live-call path", () => {
    expect(live).not.toMatch(/openai\.com|deepgram|assemblyai|zoom|twilio/);
  });
});

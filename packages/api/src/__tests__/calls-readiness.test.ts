import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Calls & Recording readiness — an admin-only, booleans-only status surface. Never returns env
 * values or secrets; honest partial/missing when env is absent; changes nothing about recording.
 */
const calls = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/calls.tsx", import.meta.url)), "utf8");
const layout = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/layout.tsx", import.meta.url)), "utf8");
const appTsx = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/App.tsx", import.meta.url)), "utf8");

describe("readiness endpoint — admin-gated + booleans only, no secrets", () => {
  it("is registered and owner/admin-gated", () => {
    expect(calls).toMatch(/router\.get\("\/readiness", requireAdminRole, async \(c\) =>/);
  });
  it("derives from env presence (never returns the env values / keys)", () => {
    expect(calls).toMatch(/const calls_configured = liveKitEnabled\(\)/);
    expect(calls).toMatch(/recording_flag_enabled = process\.env\.LIVEKIT_RECORDING_ENABLED === "1"/);
    expect(calls).toMatch(/const stt_configured = transcriptionEnabled\(\)/);
    expect(calls).toMatch(/summary_configured = !!\(process\.env\.AI_GATEWAY_BASE_URL && process\.env\.AI_GATEWAY_API_KEY\)/);
    expect(calls).toMatch(/webhook_secret_set = !!\(process\.env\.LIVEKIT_API_SECRET \|\| ""\)\.trim\(\)/);
    // No raw secret/URL ever placed in the response — only booleans + coarse statuses.
    const block = calls.slice(calls.indexOf('router.get("/readiness"'));
    expect(block).not.toMatch(/return c\.json\(\{[^]*?process\.env\.LIVEKIT_API_SECRET[^]*?\}\)/);
    expect(block).not.toMatch(/AI_GATEWAY_API_KEY:|LIVEKIT_API_KEY:|SOVEREIGN_STT_URL:/);   // never echo keys/urls
  });
  it("bucket check is best-effort and only yields booleans", () => {
    expect(calls).toMatch(/const \{ data \} = await supabase\.storage\.getBucket\(RECORDINGS_BUCKET\)/);
    expect(calls).toMatch(/bucket_ready = !!data && data\.public === false/);
  });
  it("native_recording status is honest: available | partially_configured | not_configured", () => {
    expect(calls).toMatch(/const nativeStatus = !calls_configured \? "not_configured"[^]*?recording_available && bucket_ready\) \? "available"[^]*?: "partially_configured"/);
  });
});

describe("settings page — every readiness row + honest copy", () => {
  it("renders all seven capability rows", () => {
    for (const key of ["calls", "native_recording", "upload_import", "transcription", "ai_summaries", "secure_playback", "webhook"]) {
      expect(page, key).toMatch(new RegExp(`key: "${key}"`));
    }
  });
  it("has the required 'controls appear only when configured' copy + no secret editing", () => {
    expect(page).toMatch(/Recording controls appear in live calls only when LiveKit recording is configured/);
    expect(page).not.toMatch(/process\.env|API_KEY|SECRET/);   // page never references secrets
    expect(page).toMatch(/nothing here exposes or edits secrets/i);
  });
  it("offers safe CTAs (no fake setup automation)", () => {
    expect(page).toMatch(/to="\/calls"/);          // Open Meeting Memory
    expect(page).toMatch(/to="\/settings\/support"/);
  });
  it("is wired into settings nav + routing", () => {
    expect(layout).toMatch(/\["calls", Video, "Calls & Recording"\]/);
    expect(appTsx).toMatch(/<Route path="calls" element=\{<CallsSettings \/>\} \/>/);
  });
});

describe("must-not-change", () => {
  it("recording behavior + Memory 2B untouched by readiness", () => {
    const block = calls.slice(calls.indexOf('router.get("/readiness"'));
    expect(block).not.toMatch(/startRoomEgress|stopRoomEgress|ingestRecording|memory-recall|recallContext/);
  });
});

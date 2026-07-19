import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Calls & Recording readiness — an admin-only, booleans-only status surface. Never returns env
 * values or secrets; honest partial/missing when env is absent; changes nothing about recording.
 */
const calls = readFileSync(fileURLToPath(new URL("../routes/calls.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/calls.tsx", import.meta.url)), "utf8");
const layout = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/layout.tsx", import.meta.url)), "utf8");
const appTsx = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/App.tsx", import.meta.url)), "utf8");
const guestCall = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/guest-call.tsx", import.meta.url)), "utf8");
const callTiles = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/call-tiles.tsx", import.meta.url)), "utf8");
const settingsDir = fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/", import.meta.url));

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

describe("call-room chunk split — guest-call must not statically import call-room", () => {
  it("guest-call imports shared tiles from call-tiles, NOT from call-room (keeps call-room lazy-splittable)", () => {
    // The static edge guest-call → call-room was forcing call-room into guest-call's chunk and defeating
    // its lazy() split in App.tsx. Guests now pull the presentational tiles from the small shared file.
    expect(guestCall).toMatch(/import \{ ParticipantTile, ScreenTile, ToolBtn[\w,\s]*\} from "\.\/dashboard\/call-tiles"/);
    expect(guestCall).not.toMatch(/from "\.\/dashboard\/call-room"/);
  });
  it("call-room stays lazy-loaded in App.tsx (its own chunk)", () => {
    expect(appTsx).toMatch(/const CallRoomDispatch = lazy\(\(\) => import\("\.\/routes\/dashboard\/call-room"\)/);
  });
  it("the shared tiles file is presentational only — livekit is a TYPE-only import (no runtime bundle)", () => {
    expect(callTiles).toMatch(/export function (ParticipantTile|ScreenTile|ToolBtn|initialsOf)/);
    // livekit is imported for types only, so the shared file never pulls the LiveKit runtime into a chunk.
    expect(callTiles).toMatch(/import type \{ Participant, Track as TrackNS \} from "livekit-client"/);
    expect(callTiles).not.toMatch(/^import \{[^}]*\} from "livekit-client"/m);
  });
});

describe("settings pages are lazy-loaded — Tiptap (vendor-editor) stays out of first paint", () => {
  const SETTINGS_PAGES = ["account", "workspace", "members", "billing", "objects", "support", "calls", "integrations", "email", "security", "training", "ask-mondaily", "ai-control-room"];
  it("every settings PAGE is lazy() in App.tsx (not a static import)", () => {
    for (const p of SETTINGS_PAGES) {
      // lazy import present…
      expect(appTsx).toMatch(new RegExp(`lazy\\(\\(\\) => import\\("\\./routes/dashboard/settings/${p}"\\)`));
      // …and NO static named import of that page's export remains.
      expect(appTsx).not.toMatch(new RegExp(`^import \\{[^}]+\\} from "\\./routes/dashboard/settings/${p}"`, "m"));
    }
  });
  it("EmailSettings specifically is lazy, not statically imported (it pulls Tiptap)", () => {
    expect(appTsx).toMatch(/const EmailSettings = lazy\(\(\) => import\("\.\/routes\/dashboard\/settings\/email"\)/);
    expect(appTsx).not.toMatch(/import \{ EmailSettings \} from "\.\/routes\/dashboard\/settings\/email"/);
  });
  it("settings/email.tsx is the ONLY settings page importing Tiptap", () => {
    const tiptapPages = readdirSync(settingsDir)
      .filter(f => f.endsWith(".tsx"))
      .filter(f => /from ["']@tiptap/.test(readFileSync(settingsDir + f, "utf8")));
    expect(tiptapPages).toEqual(["email.tsx"]);
  });
  it("SettingsLayout, GuestCallPage, HomePage, DashboardLayout stay static (stable/first-paint)", () => {
    expect(appTsx).toMatch(/import \{ SettingsLayout \} from "\.\/routes\/dashboard\/settings\/layout"/);
    expect(appTsx).toMatch(/import \{ GuestCallPage \} from "\.\/routes\/guest-call"/);
    expect(appTsx).toMatch(/import \{ HomePage \} from "\.\/routes\/dashboard\/home"/);
    expect(appTsx).toMatch(/import \{ DashboardLayout \} from "\.\/routes\/dashboard\/layout"/);
  });
});

describe("secondary dashboard routes are lazy-loaded (kept off first paint)", () => {
  const askPage = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/ask/[threadId].tsx", import.meta.url)), "utf8");
  const LAZY = [
    { name: "AskPage", path: "./routes/dashboard/ask/\\[threadId\\]" },
    { name: "AgentActivityPage", path: "./routes/dashboard/activity" },
    { name: "StatusPage", path: "./routes/dashboard/status" },
    { name: "NotificationsPage", path: "./routes/dashboard/notifications" },
  ];
  it("the four secondary routes are lazy() and no longer statically imported", () => {
    for (const { name, path } of LAZY) {
      expect(appTsx).toMatch(new RegExp(`const ${name} = lazy\\(\\(\\) => import\\("${path}"\\)\\.then\\(m => \\(\\{ default: m\\.${name} \\}\\)\\)\\)`));
      expect(appTsx).not.toMatch(new RegExp(`^import \\{ ${name} \\} from`, "m"));
    }
  });
  it("first-paint anchors stay static — Home, DashboardLayout, SettingsLayout, auth pages", () => {
    expect(appTsx).toMatch(/import \{ HomePage \} from "\.\/routes\/dashboard\/home"/);
    expect(appTsx).toMatch(/import \{ DashboardLayout \} from "\.\/routes\/dashboard\/layout"/);
    expect(appTsx).toMatch(/import \{ SettingsLayout \} from "\.\/routes\/dashboard\/settings\/layout"/);
    expect(appTsx).toMatch(/import \{ ShadowLoginPage \} from "\.\/routes\/auth\/shadow-login"/);
    expect(appTsx).toMatch(/import \{ WorkspaceSelectPage \} from "\.\/routes\/auth\/workspace-select"/);
  });
  it("AskPage still renders AskMondaily unchanged — only load timing changed", () => {
    expect(askPage).toMatch(/import \{ AskMondaily \} from "\.\.\/\.\.\/\.\.\/components\/ai\/ask-mondaily"/);
    expect(askPage).toMatch(/return <AskMondaily key=\{threadId \?\? "new"\} \/>/);
  });
});

describe("must-not-change", () => {
  it("recording behavior + Memory 2B untouched by readiness", () => {
    // Scope to the readiness HANDLER only (up to the next route). The readiness route is not the last
    // route in the file — recording routes (analyze/reprocess) legitimately live after it and use
    // ingestRecording etc., so slicing to end-of-file was a brittle false positive. The invariant is
    // that the readiness handler itself never touches recording/egress/Memory-2B.
    const start = calls.indexOf('router.get("/readiness"');
    const block = calls.slice(start, calls.indexOf("\nrouter.", start + 10));
    expect(block).not.toMatch(/startRoomEgress|stopRoomEgress|ingestRecording|memory-recall|recallContext/);
  });
});

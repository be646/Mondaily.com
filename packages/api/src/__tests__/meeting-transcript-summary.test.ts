import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CALENDAR = "packages/api/src/routes/calendar.ts";
const MEETING_MEMORY = "packages/api/src/jobs/meeting-memory.ts";
const GUEST_CALLS = "packages/api/src/routes/guest-calls.ts";
const CALL_ROOM = "apps/app/src/routes/dashboard/call-room.tsx";

// Isolate the /summarize-transcript route body from calendar.ts for scoped assertions.
const cal = read(CALENDAR);
const routeStart = cal.indexOf('router.post("/events/:id/summarize-transcript"');
// bound strictly to this handler (ends right before the next route's leading comment)
const routeBody = cal.slice(routeStart, cal.indexOf("// GET /calendar/events/:id/followups", routeStart));
// Isolate the GET /transcript-intel handler (persisted-read path).
const intelStart = cal.indexOf('router.get("/events/:id/transcript-intel"');
const intelBody = cal.slice(intelStart, cal.indexOf('router.post("/events/:id/summarize-transcript"', intelStart));

describe("meeting AI summary from saved live transcript — backend", () => {
  it("reuses the GROUNDED extractMeetingIntel engine (exported) — never a new/ungrounded prompt", () => {
    expect(read(MEETING_MEMORY)).toMatch(/export async function extractMeetingIntel/);
    expect(read(MEETING_MEMORY)).toMatch(/export async function summarizeTranscript/);
    expect(routeBody).toMatch(/extractMeetingIntel\(ws, me, tl, "general"\)/);
    expect(cal).toMatch(/import \{ extractMeetingIntel, summarizeTranscript \} from "\.\.\/jobs\/meeting-memory"/);
  });

  it("summarizes the ORIGINAL saved transcript text only — NOT the translation overlay", () => {
    expect(routeBody).toMatch(/\.from\("call_transcript_lines"\)[\s\S]{0,160}\.eq\("room", meetingRoom\(ws, id\)\)/);
    expect(routeBody).not.toMatch(/\.from\("caption_translations"\)/);   // never QUERIES the translation cache (comment may name it)
    expect(routeBody).toMatch(/speaker_name, text, ts/);             // reads the original columns
  });

  it("is participant/admin scoped and workspace-scoped", () => {
    expect(routeBody).toMatch(/if \(!canView\(ev\.data, me\) && !isWorkspaceAdmin\(role\)\) return c\.json\(\{ error: "Not allowed\." \}, 403\)/);
    expect(routeBody).toMatch(/\.eq\("workspace_id", ws\)/);
  });

  it("fails HONESTLY: too little transcript, no AI, or an empty model result — never a fake summary", () => {
    expect(routeBody).toMatch(/if \(lines\.length < 3 \|\| totalChars < 200\) return c\.json\(\{ ok: false, reason: "insufficient_transcript"/);
    expect(routeBody).toMatch(/if \(!env\.baseURL \|\| !env\.apiKey\) return c\.json\(\{ ok: false, reason: "ai_unavailable"/);
    expect(routeBody).toMatch(/if \(!overview\) return c\.json\(\{ ok: false, reason: "summary_failed"/);
  });

  it("returns provenance (source + count + range) and candidates ONLY — creates NO task/decision, sends NO email", () => {
    expect(routeBody).toMatch(/source: "live_transcript"/);
    expect(routeBody).toMatch(/lines_used: lines\.length/);
    expect(routeBody).toMatch(/ts_range: \{ start:/);
    // the route must not write a decision, a task, or send mail
    expect(routeBody).not.toMatch(/\.from\("decision_queue"\)/);
    expect(routeBody).not.toMatch(/\.from\("tasks"\)/);
    expect(routeBody).not.toMatch(/maybeAutoApprove|sendMail|send_email|\.send\(/i);
  });

  it("recipients are REAL attendee emails only, never invented", () => {
    expect(routeBody).toMatch(/\.filter\(\(r\) => r\.email\)/);
    expect(routeBody).toMatch(/follow_up_draft/);   // draft returned, never sent
  });

  it("the follow-up email is DRAFT-only via aiGateway (sovereign) — grounded, no third-party", () => {
    expect(routeBody).toMatch(/feature: "meeting_followup_draft"/);
    expect(routeBody).toMatch(/never invent commitments, names, dates, or recipients/);
    expect(routeBody).not.toMatch(/deepgram|assemblyai|openai\.com|deepl|googleapis/i);
  });
});

describe("persistence — generated intelligence is saved + read back without a model call", () => {
  it("POST persists the result onto the meeting node (nodes.data), keyed per event id", () => {
    expect(routeBody).toMatch(/const stored: StoredTranscriptIntel = \{/);
    expect(routeBody).toMatch(/source: "saved_live_transcript"/);
    expect(routeBody).toMatch(/\[INTEL_KEY\]: \{ \.\.\.readIntelMap\(ev\.data\), \[id\]: stored \}/);
    expect(routeBody).toMatch(/\.from\("nodes"\)\s*\n?\s*\.update\(\{ data: nextData \}\)/);
    expect(routeBody).toMatch(/\.eq\("object_type", "calendar_event"\)/);
  });

  it("persists provenance: source, line count, ts range, generated_at/by, model/provider/feature, fingerprint", () => {
    for (const f of ["lines_used:", "ts_range:", "fingerprint:", "generated_at:", "generated_by:", "provider,", "feature:"]) {
      expect(routeBody).toContain(f);
    }
    expect(routeBody).toMatch(/generated_at: new Date\(\)\.toISOString\(\)/);
    expect(routeBody).toMatch(/fingerprint: transcriptFingerprint\(lines\)/);
  });

  it("the fingerprint hashes the ORIGINAL transcript only (ts+speaker+text), never translations", () => {
    expect(cal).toMatch(/export function transcriptFingerprint/);
    expect(cal).toMatch(/createHash\("sha256"\)/);
    const fpStart = cal.indexOf("export function transcriptFingerprint");
    const fpBody = cal.slice(fpStart, cal.indexOf("const readIntelMap", fpStart));
    expect(fpBody).not.toMatch(/caption_translations|translated/i);
  });

  it("GET /transcript-intel returns SAVED intel with a stale flag and makes NO model call", () => {
    expect(intelBody).toMatch(/const saved = readIntelMap\(ev\.data\)\[id\] \?\? null/);
    expect(intelBody).toMatch(/if \(!saved\) return c\.json\(\{ ok: true, saved: null/);
    expect(intelBody).toMatch(/const stale = currentFp !== null && currentFp !== saved\.fingerprint/);
    // never invokes the AI gateway on the read path
    expect(intelBody).not.toMatch(/aiGateway|extractMeetingIntel|summarizeTranscript/);
  });

  it("GET reads the ORIGINAL transcript (not translations) and is participant/admin + workspace scoped", () => {
    expect(intelBody).toMatch(/\.from\("call_transcript_lines"\)/);
    expect(intelBody).not.toMatch(/\.from\("caption_translations"\)/);
    expect(intelBody).toMatch(/if \(!canView\(ev\.data, me\) && !isWorkspaceAdmin\(role\)\) return c\.json\(\{ error: "Not allowed\." \}, 403\)/);
    expect(intelBody).toMatch(/\.eq\("workspace_id", ws\)/);
  });

  it("neither the read nor the persist path creates tasks/decisions or sends mail", () => {
    for (const body of [intelBody, routeBody]) {
      expect(body).not.toMatch(/\.from\("decision_queue"\)/);
      expect(body).not.toMatch(/\.from\("tasks"\)/);
      expect(body).not.toMatch(/maybeAutoApprove|sendMail|send_email/i);
    }
  });
});

describe("no guest access + sovereignty", () => {
  it("there is NO guest transcript-intel route (guests never read persisted intelligence)", () => {
    expect(read(GUEST_CALLS)).not.toMatch(/transcript-intel/);
  });
  it("there is NO guest summarize/transcript route (guests never read workspace transcript history)", () => {
    const g = read(GUEST_CALLS);
    expect(g).not.toMatch(/summarize-transcript/);
    expect(g).not.toMatch(/router\.get\("\/transcript"/);
  });
});

describe("Meeting Memory detail — review-first, honest UI", () => {
  const r = read(CALL_ROOM);
  it("runs on demand (not pre-generated) and shows provenance incl. 'original transcript only'", () => {
    expect(r).toMatch(/\/calendar\/events\/\$\{e\.id\}\/summarize-transcript/);
    expect(r).toMatch(/Generate insights from transcript/);          // user must run it
    expect(r).toMatch(/Saved from live transcript/);
    expect(r).toMatch(/original only/);
  });
  it("action items are REVIEW-FIRST (task created only on click), never auto-created", () => {
    expect(r).toMatch(/Create task/);
    expect(r).toMatch(/createTaskFor\(i, a\.owner \? `\$\{a\.text\} — \$\{a\.owner\}` : a\.text\)/);
    expect(r).toMatch(/apiClient\.post\("\/tasks", \{ title \}\)/);
  });
  it("decisions are CANDIDATE-ONLY — no auto-run, and the UI never POSTs to /decisions", () => {
    expect(r).toMatch(/Decision candidates · review only/);
    expect(r).toMatch(/candidate/);
    expect(r).not.toMatch(/apiClient\.post\("\/decisions"/);          // never creates/auto-runs a decision
  });
  it("follow-up email is a copyable DRAFT — never auto-sent", () => {
    expect(r).toMatch(/Follow-up email · draft \(not sent\)/);
    expect(r).toMatch(/navigator\.clipboard\.writeText/);
    expect(r).not.toMatch(/\/send|sendEmail|auto.?send/i);
  });
  it("honest insufficient/unavailable/failed states (no fake summary)", () => {
    expect(r).toMatch(/insufficient_transcript: "Not enough transcript to summarize\."/);
    expect(r).toMatch(/ai_unavailable:/);
    expect(r).toMatch(/summary_failed:/);
  });
  it("reads persisted intel on load (no model call) and renders it as saved", () => {
    expect(r).toMatch(/queryKey: \["event-transcript-intel", e\.id\]/);
    expect(r).toMatch(/\/calendar\/events\/\$\{e\.id\}\/transcript-intel/);
    expect(r).toMatch(/const saved = intelQ\.data\?\.saved \?\? null/);
    expect(r).toMatch(/Saved from live transcript/);
  });
  it("offers Regenerate (updates persisted result) and shows an honest stale marker", () => {
    expect(r).toMatch(/Regenerate/);
    expect(r).toMatch(/invalidateQueries\(\{ queryKey: \["event-transcript-intel", e\.id\] \}\)/);
    expect(r).toMatch(/Transcript changed since this was generated/);
  });
});

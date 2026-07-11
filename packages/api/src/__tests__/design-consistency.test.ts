import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Design-system consistency pass. Interactive buttons/chips are squared (rounded-sm); metadata
 * dots/avatars/status pills stay circular; decorative gradients/orbs and bright one-off colors are
 * removed. Source guards over the touched surfaces.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/app/src/${p}`, import.meta.url)), "utf8");
const help = read("components/help/help-panel.tsx");
const salesReport = read("routes/dashboard/reports/sales-report.tsx");
const recordTable = read("components/records/record-table.tsx");
const recordDetail = read("components/records/record-detail.tsx");
const tasks = read("routes/dashboard/tasks.tsx");
const taskPanel = read("components/tasks/task-detail-panel.tsx");
const notes = read("routes/dashboard/notes.tsx");
const objectsIndex = read("routes/dashboard/objects/[objectType]/index.tsx");
const invoiceDetail = read("routes/dashboard/finance/[invoiceId].tsx");
const creditNoteDetail = read("routes/dashboard/finance/[creditNoteId].tsx");
const SETTINGS = ["account", "integrations", "workspace", "security", "training"].map((n) => read(`routes/dashboard/settings/${n}.tsx`));
const decisions = read("routes/dashboard/decisions.tsx");
const discovery = read("routes/dashboard/discovery.tsx");
const stylesCss = read("styles.css");
const aiIntelligence = read("components/ai/ai-intelligence.tsx");
const commandCenter = read("components/ai/command-center.tsx");
const aiControlRoom = read("routes/dashboard/settings/ai-control-room.tsx");
const home = read("routes/dashboard/home.tsx");
const boardView = read("components/records/board-view.tsx");
const themeLib = read("lib/theme.ts");
const controls = read("components/ui/controls.tsx");
const callsSettings = read("routes/dashboard/settings/calls.tsx");
// The bright, candy hexes that must NOT appear in product UI — only matte semantic tones allowed.
const BRIGHT_HEXES = ["#d97706", "#10b981", "#e11d48", "#dc2626", "#ef4444", "#f59e0b", "#eab308", "#7b6fb0", "#22c55e", "#3b82f6", "#8b5cf6", "#06b6d4", "#0891b2", "#b45309"];
const hasNoBrightHex = (src: string) => BRIGHT_HEXES.every((h) => !src.toLowerCase().includes(h));
const teamOversight = read("routes/dashboard/team-oversight.tsx");
const agentStatus = read("components/ai/agent-status.tsx");
const constellation = read("components/ai/agent-constellation.tsx");
// Landing (apps/web) — marketing surface polish guards.
const readWeb = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/web/${p}`, import.meta.url)), "utf8");
const landing = readWeb("components/landing-page.tsx");
const landingLogo = readWeb("components/logo.tsx");
const askMondaily = read("components/ai/ask-mondaily.tsx");

const hasButtonBubbly = (src: string) =>
  src.split("\n").some((l) => /rounded-(lg|xl)/.test(l) && /hover:bg-\[var\(--surface/.test(l));

// Broader interactive-control signature: a rounded-lg/xl element that also hovers/focuses and
// animates — i.e. a real button/input/picker, not a static container. Segmented-toggle segments
// (bg-[var(--surface-hover)] active state, no border) are excluded — those stay per the toggle rule.
const hasInteractiveBubbly = (src: string) =>
  src.split("\n").some(
    (l) =>
      /rounded-(lg|xl)/.test(l) &&
      /transition-colors|focus:outline/.test(l) &&
      /hover:(bg|text|border|opacity)|focus:outline/.test(l) &&
      /\bborder\b/.test(l), // buttons/inputs carry a border; toggle segments do not
  );

describe("interactive controls squared (no bubbly buttons)", () => {
  it("settings buttons are squared (no rounded-lg/xl + surface-hover on one line)", () => {
    for (const s of SETTINGS) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("records + tasks + report dashboard button radii squared", () => {
    for (const s of [recordTable, recordDetail, tasks]) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("help suggestion chips + FAB squared (no interactive rounded-full border)", () => {
    expect(help).not.toMatch(/rounded-full border/);
  });
  it("notes + objects index + finance detail button radii squared", () => {
    for (const s of [notes, objectsIndex, invoiceDetail, creditNoteDetail]) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("sales-report interactive controls squared (ObjectPicker + forecast/insight buttons + inputs)", () => {
    expect(hasInteractiveBubbly(salesReport)).toBe(false);
    // Confidence badge in the forecast modal is metadata → stays pill-shaped.
    expect(salesReport).toMatch(/inline-flex rounded-full border px-2\.5[^"]*capitalize/);
  });
  it("task-detail-panel picker chips squared (avatars + label pills stay circular)", () => {
    // Interactive assignee/due/priority picker chips were `rounded-full border px-2.5`.
    expect(taskPanel).not.toMatch(/rounded-full border px-2\.5/);
    expect(taskPanel).toMatch(/rounded-full border flex items-center justify-center/); // avatar stack circles
  });
});

describe("intentional circular metadata preserved", () => {
  it("help keeps tiny status dots + the state badge circular", () => {
    expect(help).toMatch(/h-1\.5 w-1\.5 rounded-full/);          // status dots
    expect(help).toMatch(/rounded-full px-2 py-0\.5 text-\[10px\] font-medium/); // state badge (metadata)
  });
});

describe("decorative blobs/gradients + bright one-off colors removed", () => {
  it("sales-report: no decorative orb or one-off panel gradient (bar fills allowed)", () => {
    expect(salesReport).not.toMatch(/opacity-20 blur-2xl/);
    expect(salesReport).not.toMatch(/linear-gradient\(135deg,rgba\(113,119,132/);
  });
  it("help diagnostics use the matte palette (no bright #ef4444)", () => {
    expect(help).not.toMatch(/#ef4444/);
  });
});

describe("control-room surfaces (Decisions / Discovery / Team Oversight) squared", () => {
  it("decisions interactive buttons squared (no rounded-lg/xl bubbly)", () => {
    expect(hasButtonBubbly(decisions)).toBe(false);
    expect(hasInteractiveBubbly(decisions)).toBe(false);
    // Risk/verdict/triage dots stay circular.
    expect(decisions).toMatch(/h-1 w-1 rounded-full/);
  });
  it("discovery frames + controls unified to rounded-sm (only the chat bubble stays rounded)", () => {
    expect(hasInteractiveBubbly(discovery)).toBe(false);
    // No stray rounded-lg content frames remain (was 9); chat bubble keeps rounded-md.
    expect(discovery).not.toMatch(/rounded-lg/);
  });
  it("team-oversight suggestion chip squared; status dots/pills stay circular", () => {
    expect(teamOversight).not.toMatch(/rounded-full border px-2\.5 py-0\.5 text-\[10\.5px\] transition-colors/);
  });
});

describe("agent cockpit is honest + matte (no per-agent rainbow, no bright hexes)", () => {
  it("constellation dot colour encodes STATE via one matte map, not an index rainbow", () => {
    expect(constellation).not.toMatch(/AGENT_DOT_PALETTE/);          // the arbitrary rainbow is gone
    expect(constellation).toMatch(/const STATE_TONE: Record<ConstellationState/); // single matte source
    // No bright one-off dot colours (emerald/pink/blue/lime/amber-500) anywhere.
    for (const bright of ["#10b981", "#e11d48", "#f59e0b", "#ec4899", "#3b82f6", "#84cc16", "#d97706"]) {
      expect(constellation).not.toContain(bright);
    }
  });
  it("constellation uses the matte state palette", () => {
    for (const matte of ["#5f8169", "#97824f", "#9c6b72"]) expect(constellation).toContain(matte);
  });
  it("top bar uses themed CSS vars (no hardcoded light hexes) + squared controls", () => {
    expect(agentStatus).not.toMatch(/border-\[#e5e7eb\]/);
    expect(agentStatus).not.toMatch(/bg-\[#f9fafb\]/);
    expect(hasButtonBubbly(agentStatus)).toBe(false);
  });
});

describe("landing polish (apps/web)", () => {
  it("cookie banner is solid + theme-aware (no invisible 7%-black border, no hardcoded zinc text)", () => {
    // The banner block was `rounded-2xl border border-black/[.07]` with zinc-* text.
    expect(landing).not.toMatch(/rounded-2xl border border-black\/\[\.07\]/);
    expect(landing).toMatch(/var\(--landing-surface-raised\)/); // solid raised surface
  });
  it("no fake integrations advertised (only real OAuth providers remain)", () => {
    // Slack/Zapier/Typeform/Segment/Mailchimp integration cards had no backend — removed. Matched by
    // their unique card descriptions (the ids recur in unrelated workflow demos, so match copy).
    for (const fakeDesc of [
      "Connect Mondaily to thousands of apps via Zaps.",   // Zapier
      "Turn form responses into workspace graph records.", // Typeform
      "Stream customer events directly into the graph.",   // Segment
      "Sync audiences and track campaign engagement.",     // Mailchimp
      "Receive agent alerts and graph signals in channels.", // Slack integration card
    ]) {
      expect(landing).not.toContain(fakeDesc);
    }
    // Real OAuth providers still present in the integrations grid.
    expect(landing).toContain(`id: "gmail"`);
    expect(landing).toContain(`id: "google-calendar"`);
  });
  it("integration icons are matte (no bright brand-colour tiles)", () => {
    for (const brand of ["#EA4335", "#0078D4", "#1A73E8", "#4A154B", "#FF4A00", "#FFE01B"]) {
      expect(landing).not.toContain(brand);
    }
  });
  it("cookie banner is squared (rounded-sm buttons, not pill/2xl)", () => {
    expect(landing).toMatch(/rounded-sm px-4 py-1\.5 font-mono text-\[12px\] font-medium/); // squared Accept btn
  });
  it("hero rotating word has no blur/vertical-jump animation", () => {
    expect(landing).not.toMatch(/filter: "blur\(4px\)"/);
    expect(landing).not.toMatch(/y: 12, filter/);
  });
  it("preloader progress is deterministic (no random jitter in the bar)", () => {
    expect(landing).not.toContain("p + 14 + Math.random()"); // old jittery preloader step
    expect(landing).toContain("Math.min(p + 18, 100)");       // fixed even step
  });
  it("logo colour is explicit (never washes out to white)", () => {
    expect(landingLogo).toMatch(/color: "var\(--landing-text\)"/);
  });
  it("simulated demos stay labelled", () => {
    expect(landing).toContain("Simulated preview");
  });
});

describe("one Mondaily design language (consolidation pass)", () => {
  it("section-soul hue drift is neutralized — ONE accent family app-wide", () => {
    // --theme-spread scales per-section hue rotation; 0 = every section uses the base accent.
    expect(stylesCss).not.toMatch(/--theme-spread:\s*0*\.[1-9]/); // no non-zero spread survives
    expect(stylesCss).toMatch(/--theme-spread:\s*0\b/);
  });
  it("shared agent status dots/badges use the matte palette (no bright #d97706/#dc2626/#06b6d4)", () => {
    expect(stylesCss).not.toMatch(/agent-dot\[data-status="needs_approval"\]\s*\{\s*background:\s*#d97706/);
    expect(stylesCss).toContain('.agent-dot[data-status="issue"]          { background: #9c6b72; }');
    expect(stylesCss).toContain('.agent-dot[data-status="needs_approval"] { background: #97824f; }');
  });
  it("AIHealthScore uses matte semantic tones", () => {
    expect(aiIntelligence).toContain('score >= 70 ? "#5f8169" : score >= 40 ? "#97824f" : "#9c6b72"');
  });
  it("no candy/bright hexes in key product surfaces (matte semantic only)", () => {
    for (const src of [aiIntelligence, commandCenter, aiControlRoom, home, decisions, discovery, teamOversight, boardView]) {
      expect(hasNoBrightHex(src)).toBe(true);
    }
  });
  it("console theme swatch reflects the real matte accent (not bright #10b981)", () => {
    expect(themeLib).not.toContain("#10b981");
  });
  it("board-view Kanban squared (no rounded-lg)", () => {
    expect(boardView).not.toMatch(/rounded-lg/);
  });
});

describe("shared page-architecture primitives (structural consolidation)", () => {
  it("the five shared structural primitives exist in controls.tsx", () => {
    for (const p of ["CommandPageHeader", "FilterToolbar", "ProofOfWorkStrip", "DossierSection", "SettingsSection"]) {
      expect(controls).toMatch(new RegExp(`export function ${p}\\b`));
    }
  });
  it("Decisions / Discovery / Team Oversight all use the shared CommandPageHeader", () => {
    for (const src of [decisions, discovery, teamOversight]) {
      expect(src).toMatch(/import \{[^}]*CommandPageHeader/);
      expect(src).toMatch(/<CommandPageHeader/);
    }
  });
  it("Discovery renders the shared ProofOfWorkStrip fed by REAL counters (no fabricated numbers)", () => {
    expect(discovery).toMatch(/<ProofOfWorkStrip/);
    expect(discovery).toContain("value: turn.scanned ?? 0");
    expect(discovery).toContain("value: turn.results.length");
  });
  it("Decisions dossier uses the shared DossierSection; calls readiness uses SettingsSection", () => {
    expect(decisions).toMatch(/<DossierSection/);
    expect(callsSettings).toMatch(/<SettingsSection/);
  });
  it("Home cockpit orders agents deterministically (no random Meeting-Agent placement)", () => {
    expect(constellation).toContain("function orderConstellation");
    expect(constellation).toContain("orderConstellation(constellation)");
  });
  it("ProofOfWorkStrip status vocabulary is honest (idle/monitoring/running/waiting/failed/complete)", () => {
    expect(controls).toMatch(/CommandStatusKind = "idle" \| "monitoring" \| "running" \| "waiting" \| "failed" \| "complete"/);
    expect(controls).toContain('"no runs yet"'); // honest empty state
  });
});

describe("priority pages preserve every existing action/handler", () => {
  it("Decisions keeps approve/reject/snooze/bulk/triage/adjudicate/assign/comment/ask", () => {
    for (const h of ["runTriage", "adjudicateVisible", "bulkApproveSafe", "bulkDismiss", "AssigneePicker", "onResolve"]) {
      expect(decisions).toContain(h);
    }
  });
  it("Discovery keeps search/save/bulk/watch/deep/exhaustive/ICP", () => {
    for (const h of ["setDeep", "setExhaustive", "setIcpOpen", "clearHistory", "SaveAllLeads", "BulkBar"]) {
      expect(discovery).toContain(h);
    }
  });
  it("Team Oversight keeps call/print/AI-review/timeline/ask", () => {
    for (const h of ["requestCall", "Printer", "OversightAsk", "MemberDetail"]) {
      expect(teamOversight).toContain(h);
    }
  });
});

describe("landing consolidation", () => {
  it("email / start-free form is token-driven (no black-on-black dark:bg-black)", () => {
    expect(landing).not.toMatch(/dark:bg-black/);
    expect(landing).toMatch(/background: "var\(--landing-surface\)"/);
  });
  it("hero chips describe the product, not fake live status", () => {
    expect(landing).not.toContain("Agents active");
    expect(landing).toContain("Agent-driven");
  });
  it("simulated agent terminal is labelled, not implied-live", () => {
    expect(landing).not.toMatch(/text: "active · streaming"/);
    expect(landing).toMatch(/>Simulated preview</);
  });
});

describe("Ask side panel squared (ask-mondaily)", () => {
  it("action + suggestion chips squared; mode-label metadata pill stays circular", () => {
    expect(askMondaily).not.toMatch(/rounded-full border px-3(\.5)? py-1\.5/); // chips squared
    expect(askMondaily).not.toMatch(/rounded-lg/);                            // icon buttons/rows squared
    expect(askMondaily).toMatch(/rounded-full border px-1\.5 py-0\.5/);       // mode-label pill kept
  });
});

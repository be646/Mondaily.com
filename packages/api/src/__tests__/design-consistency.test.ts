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
const activity = read("routes/dashboard/activity.tsx");
const reportsIndex = read("routes/dashboard/reports/index.tsx");
const settingsAccount = read("routes/dashboard/settings/account.tsx");
const settingsMembers = read("routes/dashboard/settings/members.tsx");
const settingsAiControlRoom = read("routes/dashboard/settings/ai-control-room.tsx");
const agentConstellationSrc = read("components/ai/agent-constellation.tsx");
const homeSrc = read("routes/dashboard/home.tsx");
const tasksSrc = read("routes/dashboard/tasks.tsx");
const billingSrc = read("routes/dashboard/settings/billing.tsx");
const apiClientSrc = read("lib/api-client.ts");
const sovereignAuthSrc = read("components/auth/sovereign-auth-context.tsx");
const decisionQueueSrc = read("components/ai/decision-queue.tsx");
const pageStateSrc = read("components/ui/page-state.tsx");
const calendar = read("routes/dashboard/calendar.tsx");
const messages = read("routes/dashboard/messages.tsx");
const askMondailyPage = read("components/ai/ask-mondaily.tsx");
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
// Every settings page as a name→source map, for the Settings-wide normalization guards.
const SETTINGS_PAGES = ["account", "security", "workspace", "members", "support", "objects", "integrations", "email", "billing", "ask-mondaily", "ai-control-room", "training", "calls"] as const;
const SETTINGS_SRC: Record<string, string> = Object.fromEntries(SETTINGS_PAGES.map((n) => [n, read(`routes/dashboard/settings/${n}.tsx`)]));

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
    for (const matte of ["#2f9e6b", "#c6892e", "#d1524a"]) expect(constellation).toContain(matte);
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
    expect(stylesCss).toContain('.agent-dot[data-status="issue"]          { background: #d1524a; }');
    expect(stylesCss).toContain('.agent-dot[data-status="needs_approval"] { background: #c6892e; }');
  });
  it("AIHealthScore uses matte semantic tones", () => {
    expect(aiIntelligence).toContain('score >= 70 ? "#2f9e6b" : score >= 40 ? "#c6892e" : "#d1524a"');
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

describe("structural adoption pass 2 (headers / settings frames / accent life)", () => {
  it("Agents/Activity uses the shared CommandPageHeader with HONEST state (no fake 'Live' ping)", () => {
    expect(activity).toMatch(/<CommandPageHeader/);
    expect(activity).not.toMatch(/<LiveSectionHeader/);
    // 'working now' only derives from the real activeAgents count.
    expect(activity).toContain('activeAgents > 0 ? `${activeAgents} working now` : "all agents monitoring"');
  });
  it("settings frames are lightweight — no filled/tinted 'tan' card background", () => {
    expect(stylesCss).toMatch(/\.settings-section\s*\{[^}]*background:\s*transparent/);
    expect(controls).toMatch(/<section className=\{cx\("mb-6 rounded-sm border"[^)]*\)\} style=\{\{ borderColor: "var\(--border-soft\)", background: "transparent"/);
  });
  it("Settings pages share the PageHeader pattern (members + AI Control Room migrated off raw h1)", () => {
    for (const src of [settingsMembers, settingsAiControlRoom]) {
      expect(src).toMatch(/<PageHeader\b/);
      expect(src).not.toMatch(/<h1\b/);
    }
    // Members keeps invite / role / module-access / remove behaviour.
    for (const h of ["invite", "role", "module", "apiClient.delete"]) expect(settingsMembers).toContain(h);
    // AI Control Room keeps its real config/run + honest state (no behaviour change).
    for (const h of ["useMutation", "apiClient.post", "CONSTELLATION_STATE_LABEL"]) expect(settingsAiControlRoom).toContain(h);
  });
  it("settings sections stay lightweight — no filled/tinted 'tan' frame background", () => {
    expect(stylesCss).toMatch(/\.settings-section\s*\{[^}]*background:\s*transparent/);
  });
  it("Account page is fully on the shared Settings system (PageHeader + SettingsSection, no raw h1 / .settings-section / decorative gradient)", () => {
    expect(settingsAccount).toMatch(/<PageHeader\b/);
    expect(settingsAccount).not.toMatch(/<h1\b/);
    expect((settingsAccount.match(/<SettingsSection\b/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(settingsAccount).not.toContain("settings-section");        // old CSS-class blocks gone
    expect(settingsAccount).not.toMatch(/linear-gradient|radial-gradient/); // hero gradient/orb removed
    // Danger zone signals danger via a rose delete action (not a weird tinted frame).
    expect(settingsAccount).toContain('color: "#d1524a"');
    expect(settingsAccount).toContain("Delete account");
  });
  it("Account preserves every handler/action", () => {
    for (const h of ["uploadAvatar", "save.mutate", "changePassword", "chooseBtnStyle", "setAppearance", "disconnect.mutate", "connect(", "toggleNotif", "autosaveNotif", "deleteAccount", "sov?.logout"]) {
      expect(settingsAccount).toContain(h);
    }
  });
  it("accent has restored life (not the over-flattened 32% saturation)", () => {
    // Console/default accent saturation raised over successive passes → 47% for usable contrast.
    expect(stylesCss).toMatch(/--accent-h: 158; --accent-s: 47%; --accent-l: 50%/);
    expect(stylesCss).not.toMatch(/--accent-s: 32%/);
  });
  it("Agents/Activity keeps run-now + sync + roster proof-of-work", () => {
    for (const h of ["refetch", "constellation", "runsToday", "errorsToday", "pendingCount"]) {
      expect(activity).toContain(h);
    }
  });
  it("Reports index uses the shared CommandPageHeader (header migration complete)", () => {
    expect(reportsIndex).toMatch(/<CommandPageHeader/);
    expect(reportsIndex).not.toMatch(/LiveSectionHeader/);
  });
  it("Reports: ObjectPicker uses the shared FieldSelect (no bespoke dropdown-panel); scope + AI + export preserved", () => {
    // Custom dropdown → shared FieldSelect (required selection, no injected All).
    expect(salesReport).not.toContain("dropdown-panel");
    expect(salesReport).toMatch(/<FieldSelect\s+value=\{value\}/);
    // Honest data scope (real record count), AI insights + forecast with honest not-run states, exports.
    expect(salesReport).toContain("records analysed");
    for (const h of ["exportCSV", "generateReport", "runForecast", "/generate/insights", "/generate/forecast", "handleObjectChange"]) {
      expect(salesReport).toContain(h);
    }
    // No fabricated AI — insights show an honest prompt state when none have run.
    expect(salesReport).toContain("Surface patterns in your data");
  });
  it("sales-report AI panels show real DATA SCOPE (proof-of-work inputs) before a run, honestly", () => {
    // Both panels state what they WILL analyse from real records before Generate/Analyse is pressed,
    // gated on the not-run state (no result/insights yet) — never implying a run already happened.
    expect(salesReport).toContain("nothing is generated until you run it");
    expect(salesReport).toContain("no results until you run it");
    expect(salesReport).toMatch(/Will analyse <span[^>]*>\{stats\.totalCount\}/);       // forecast scope = real count
    expect(salesReport).toMatch(/Will analyse <span[^>]*>\{Math\.min\(records\.length, 50\)\}/); // insights scope = real count
    expect(salesReport).toMatch(/\{!result && !loading && !error &&/);                  // forecast: only pre-run
    expect(salesReport).toMatch(/\{!insights && !loading && !error &&/);                // insights: only pre-run
  });
  it("sales-report KPI area is a cohesive two-tier executive strip (primary vs secondary), not 6 candy cards", () => {
    // Cards are driven by a single `tone` hex accent on a neutral surface — no per-card candy background classes.
    expect(salesReport).toMatch(/function KpiCard\(\{[\s\S]*?tone: string/);
    expect(salesReport).toMatch(/borderLeft: `2px solid \$\{tone\}`/);        // toned left-accent, shared geometry
    expect(salesReport).toMatch(/primary\?: boolean/);                        // primary/secondary hierarchy exists
    // Three headline KPIs are marked primary; the strip is no longer one flat 6-up grid.
    const primaryCount = (salesReport.match(/<KpiCard sym=\{curSym\} primary/g) || []).length;
    expect(primaryCount).toBe(3);
    // No card passes the old candy `color=` background prop anymore.
    expect(salesReport).not.toMatch(/<KpiCard[^>]*\bcolor=/);
  });
  it("sales-report value charts show an HONEST empty state when there's no value signal (no dead flat line)", () => {
    // A value column exists but every bucket is zero → inline NoValueData instead of a misleading flat line.
    expect(salesReport).toContain("No value data for this view");
    expect(salesReport).toMatch(/const hasValueData = useMemo\(\(\) => trendData\.some\(d => \(d\.revenue \?\? 0\) > 0\)/);
    expect(salesReport).toMatch(/hasValue && !hasValueData\) \? \(\s*<NoValueData/);
  });
  it("Discovery pipeline is a collapsed-by-default disclosure (composer is primary), never an always-visible strip", () => {
    // Default-collapsed toggle, not an always-rendered pipeline row competing with the composer.
    expect(discovery).toContain("How Discovery works");
    expect(discovery).toContain("useState(false)");
    expect(discovery).toMatch(/aria-expanded=\{open\}/);
    // Honest: describes what a search does, never implies a stage already ran.
    expect(discovery).toContain("Stages only run when you search");
  });
  it("Discovery Saved-leads tab uses the shared empty/error/loading primitives", () => {
    expect(discovery).toMatch(/<EmptyState[\s\S]*No saved leads yet/);
    expect(discovery).toContain("<ErrorState");
    expect(discovery).toContain("<DelayedLoading");
  });
});

describe("priority pages preserve every existing action/handler", () => {
  it("Decisions keeps approve/reject/snooze/bulk/triage/adjudicate/assign/comment/ask", () => {
    for (const h of ["runTriage", "adjudicateVisible", "bulkApproveSafe", "bulkDismiss", "AssigneePicker", "onResolve"]) {
      expect(decisions).toContain(h);
    }
  });
  it("Decisions is a redesigned approval cockpit: ONE control band (tabs+search+filters+AI tools) + coherent DossierSection dossier", () => {
    // Lane tabs, search, the shared MenuSelect filters, risk sort, and the AI-tools ActionMenu
    // live in a single band — three zones before the work area, not a stack of bars.
    expect(decisions).toMatch(/ONE control band/);
    // Filters use the shared records-style pattern: a FilterButton in the toolbar toggles a thin
    // full-width FilterStrip below (no wasted row, no cramped floating box).
    expect(decisions).toMatch(/<FilterButton /);
    expect(decisions).toMatch(/<FilterStrip/);
    expect(decisions).toMatch(/key: "agent", label: "Agent"/);
    expect(decisions).toMatch(/<ActionMenu triggerLabel=/);
    expect(decisions).not.toContain("function ActiveFilterChip");
    // Queue intelligence folded into the CommandPageHeader honest status row (no separate stats box).
    expect(decisions).toContain("const queueStatus: CommandStatusItem[]");
    expect(decisions).toMatch(/status=\{queueStatus\}/);
    // Dossier is one coherent surface — every section is a DossierSection.
    for (const title of ['title="Proposed change"', 'title="Evidence"', 'title="Why your agent raised this"']) {
      expect(decisions).toContain(title);
    }
    expect(decisions).toMatch(/title=\{`Impact\$\{/);
    // Approve/Reject/Snooze still resolve through the same handler (visible in the dossier footer).
    expect(decisions).toContain('onResolve(d, "approve")');
    expect(decisions).toContain('onResolve(d, "reject"');
    expect(decisions).toContain('onResolve(d, "snooze"');
  });
  it("Decisions cockpit polish: ONE quiet header status row (no metric-card strip) + shared Empty/Error states", () => {
    // The MetricGrid strip is gone — queue intelligence is a single honest status text row with
    // only operational signals (awaiting / high-risk when present / age warning at ≥7d).
    expect(decisions).not.toContain("<MetricGrid");
    expect(decisions).not.toContain("queueMetrics");
    expect(decisions).toContain('{ label: "live sync", kind: "monitoring" }');
    expect(decisions).toMatch(/highRisk > 0 \? \[\{ label: `\$\{highRisk\} high risk`/);
    expect(decisions).toMatch(/oldestDays >= 7 \? \[\{ label: `oldest \$\{oldestDays\}d`/);
    // Empty + error use the shared page-state primitives (retry on error), not bespoke cards.
    expect(decisions).toMatch(/<EmptyState icon=\{lane === "approval"/);
    expect(decisions).toMatch(/<ErrorState error=\{new Error\("Couldn't load the Decision Queue/);
    expect(decisions).toContain("onRetry={() => refetch()}");
    // No hand-rolled empty/error markup left behind.
    expect(decisions).not.toMatch(/surface-card rounded-sm px-5 py-16 text-center/);
    // Honesty preserved: confidence only when the backend computed one, else "source-backed".
    expect(decisions).toContain('d.confidence != null ?');
    expect(decisions).toContain("source-backed");
  });
  it("Decisions list is a fixed index rail and the dossier is the primary reading pane", () => {
    // Rail: fixed width (not a 38% competing pane), subtly recessed surface.
    expect(decisions).toMatch(/md:w-72 md:border-b-0 md:border-r xl:w-80/);
    expect(decisions).not.toContain("md:w-[38%]");
    // Dossier: readable max line length + more section air.
    expect(decisions).toMatch(/max-w-3xl/);
    expect(decisions).toMatch(/space-y-5 overflow-y-auto px-6 py-5/);
  });
  it("Discovery keeps search/save/bulk/watch/deep/exhaustive/ICP", () => {
    for (const h of ["setDeep", "setExhaustive", "setIcpOpen", "clearHistory", "SaveAllLeads", "BulkBar"]) {
      expect(discovery).toContain(h);
    }
  });
  it("Discovery redesign: composer is an AI command surface; LeadCard has one primary + ActionMenu (Details folded in)", () => {
    // Composer command surface (leading Radar glyph + Mode options row).
    expect(discovery).toContain("AI command surface");
    expect(discovery).toMatch(/uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)" \}\}>Mode</);
    // Details is no longer a standalone card button — it's the first ActionMenu item.
    expect(discovery).toContain('key: "details", label: "Details"');
    expect(discovery).not.toMatch(/onClick=\{onDetails\} className="shrink-0 rounded-sm border/);
    // Every lead action + Monitor still present.
    for (const h of ["save.mutate", "addToList.mutate", "enrich.mutate", "outreach.mutate", "leadTask.mutate", "leadDecision.mutate", "onDetails", "WatchButton", "requestAsk"]) {
      expect(discovery).toContain(h);
    }
    // Proof-of-work strip still fed by real counters only.
    expect(discovery).toContain("value: turn.scanned ?? 0");
  });
  it("Team Oversight keeps call/print/AI-review/timeline/ask", () => {
    for (const h of ["requestCall", "Printer", "OversightAsk", "MemberDetail", "window.print()", "member-efficiency", "member-insight", "oversight-actor"]) {
      expect(teamOversight).toContain(h);
    }
  });
  it("Team Oversight member detail is a clean tabbed profile (Overview/Work quality/AI review/Activity/Timeline)", () => {
    expect(teamOversight).toContain("type MemberTab");
    for (const label of ["Overview", "Work quality", "AI review", "Activity", "Timeline"]) {
      expect(teamOversight).toContain(`label: "${label}"`);
    }
    // Tabs gate visibility (queries still auto-run above) — no handler removed.
    expect(teamOversight).toMatch(/tab === "overview"/);
    expect(teamOversight).toMatch(/tab === "timeline"/);
  });
});

describe("debt-closure pass — Decisions dossier unification + colour system", () => {
  it("Decisions dossier is one coherent surface — AI verdict + AI reasoning are DossierSections too", () => {
    // Proposed change / Impact / Why / Evidence / AI reasoning / Audit trail / AI verdict.
    expect((decisions.match(/<DossierSection/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // The old boxed 'AI verdict' card wrapper is gone; verdict handler preserved.
    expect(decisions).toContain('title="AI verdict"');
    expect(decisions).toContain("verdict.mutate");
    // AI reasoning is now a collapsible DossierSection (no stray showReasoning state).
    expect(decisions).not.toContain("setShowReasoning");
  });
  it("Decisions lane tabs align with the shared tab pattern (section-accent underline)", () => {
    expect(decisions).toMatch(/borderBottom: `2px solid \$\{on \? "var\(--section-accent\)"/);
  });
  it("Approve / Reject / Snooze still resolve through the same handler", () => {
    for (const a of ["approve", "reject", "snooze"]) expect(decisions).toContain(`onResolve(d, "${a}"`);
  });
  it("colour system has life + a clear primary action (accent-tinted btn-primary ≠ transparent secondary)", () => {
    // Accent saturation raised for usable contrast (was 40% → 47%).
    expect(stylesCss).toMatch(/--accent-s: 47%/);
    expect(stylesCss).not.toMatch(/--accent-s: 40%/);
    // btn-primary is now clearly accent-tinted (visible primary), not the transparent secondary look.
    expect(stylesCss).toMatch(/\.btn-primary \{[^}]*background: color-mix\(in srgb, var\(--section-accent\) 14%/s);
    // No candy: still no rainbow section drift (theme-spread stays 0).
    expect(stylesCss).toMatch(/--theme-spread: 0\b/);
  });
});

describe("Reports control room — honest cards + responsive finance stats + real loading states", () => {
  it("Reports index uses shared header + honest loading/empty/error (no skeleton-only)", () => {
    expect(reportsIndex).toMatch(/<CommandPageHeader/);
    expect(reportsIndex).toMatch(/<DelayedLoading onRetry=/);
    expect(reportsIndex).toMatch(/<ErrorState /);
    expect(reportsIndex).toMatch(/<EmptyState /);
  });
  it("Report cards make NO fake AI claim — AI insights are 'on demand', scope is honest 'computed on open'", () => {
    expect(reportsIndex).not.toContain("AI insights included");   // implied pre-computed → removed
    expect(reportsIndex).toContain("AI insights on demand");
    expect(reportsIndex).toContain("Computed from your");
    // Report links + dashboard creation preserved.
    expect(reportsIndex).toContain("reports/sales?object=");
    expect(reportsIndex).toContain("createDashboard");
  });
  it("Reports index is grouped by purpose + decluttered (no repeated per-card capability chip wall)", () => {
    // Live reports are grouped (Revenue / Relationships / Operations / Other) instead of one flat wall.
    expect(reportsIndex).toMatch(/REPORT_GROUPS/);
    expect(reportsIndex).toContain('label: "Revenue & finance"');
    expect(reportsIndex).toMatch(/groupOf\(o\) === group\.key/);
    // The repeated 4-chip row per card is gone — "AI insights on demand" is stated once (section badge),
    // and the per-card "KPIs/Charts/Filters" chip array no longer exists.
    expect(reportsIndex).not.toMatch(/\["KPIs", "Charts", "Filters", "AI insights on demand"\]/);
  });
  it("Finance report stat cards wrap responsively (no horizontal clipping of totals)", () => {
    expect(stylesCss).toMatch(/\.telemetry-strip\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe("Team Oversight — shared MetricGrid + AI-action query bar (one metric look)", () => {
  it("a shared MetricGrid primitive exists and Team Oversight uses it (no bespoke metric tile grids)", () => {
    expect(controls).toMatch(/export function MetricGrid/);
    expect(teamOversight).toMatch(/import \{[^}]*MetricGrid/);
    expect((teamOversight.match(/<MetricGrid\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // MetricGrid renders passed-in values only — it never computes/invents a number.
    expect(controls).toMatch(/never computes or invents a number/);
  });
  it("Team Oversight query bar uses the accent AI-action style + preserves all handlers", () => {
    expect(teamOversight).toMatch(/same recognizable primary treatment as \.btn-primary/);
    for (const h of ["ask.mutate", "requestCall", "member-efficiency", "member-insight", "oversight-actor", "window.print"]) {
      expect(teamOversight).toContain(h);
    }
  });
});

describe("Home + Agents unification — one shared AgentCard (same agent system)", () => {
  it("a shared AgentCard exists and is used by BOTH the Home constellation and the Agents control room", () => {
    expect(agentConstellationSrc).toMatch(/export function AgentCard/);
    // Home constellation renders the shared card.
    expect(agentConstellationSrc).toMatch(/<AgentCard key=\{agent\.id\} agent=\{agent\} selected/);
    // Agents page imports + renders the same card (no more bespoke line-list divide-y rows).
    expect(activity).toMatch(/import \{ AgentCard \} from "\.\.\/\.\.\/components\/ai\/agent-constellation"/);
    expect(activity).toMatch(/<AgentCard\b/);
  });
  it("Agents control room preserves Run now / open / filter + honest state (no fake running)", () => {
    for (const h of ["runAgent.mutate", "setAgentFilter", "RUNNABLE", "agent.to"]) expect(activity).toContain(h);
    // AgentCard state/last-run come from real fields; label map + matte tone, never fabricated.
    expect(agentConstellationSrc).toContain("CONSTELLATION_STATE_LABEL[agent.state]");
    expect(agentConstellationSrc).toContain("agentRanAgo(agent.lastRunAt)");
  });
});

describe("Codex source-audit — leftover local styling migrated to the shared token/radius system", () => {
  it("high-value surfaces no longer use bubbly rounded-lg/xl", () => {
    for (const src of [recordTable, recordDetail, homeSrc, tasksSrc, billingSrc]) {
      expect(src).not.toMatch(/rounded-(lg|xl)\b/);
    }
  });
  it("record-detail cards use theme tokens (no dark-hardcoded stone-900/800 surfaces that break light themes)", () => {
    expect(recordDetail).not.toMatch(/bg-stone-900\/\d+/);
    expect(recordDetail).not.toMatch(/border-stone-800\/\d+/);
    expect(recordDetail).toMatch(/bg-\[var\(--surface-hover\)\]/);
  });
  it("sales-report export template hexes are intentionally left (self-contained print doc, not app UI)", () => {
    // Guardrail note: those #6b7280/#e5e7eb live inside the exported HTML <style>, which has no app
    // CSS vars — converting them would break the printed report. Confirm the export block still exists.
    expect(salesReport).toMatch(/\.meta\{font-size:12px;color:#6b7280/);
  });
});

describe("route stability — no false logout / no infinite skeleton (Codex auth audit)", () => {
  it("api-client bounds every request with a timeout so a hung backend errors instead of hanging forever", () => {
    expect(apiClientSrc).toMatch(/REQUEST_TIMEOUT_MS\s*=\s*45_?000/);
    expect(apiClientSrc).toContain("new AbortController()");
    expect(apiClientSrc).toContain("signal: controller.signal");
    expect(apiClientSrc).toContain("clearTimeout(timer)");
  });
  it("auth bootstrap does NOT log the user out on a transient network blip (the /calls false-logout)", () => {
    // authCall returns a synthetic status 0 on a network error instead of throwing.
    expect(sovereignAuthSrc).toMatch(/return \{ status: 0, data: \{\} as T \}/);
    // Bootstrap retries before giving up; only a real 401 (+ failed refresh) drops to guest.
    expect(sovereignAuthSrc).toMatch(/for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
    expect(sovereignAuthSrc).toMatch(/if \(me\.status === 401\)/);
  });
  it("Decisions load is stable: one retry + a delayed 'Still loading… / Retry' fallback, real error state", () => {
    // The cockpit feed (Decisions page) now retries once (retry:1 + retryDelay:800, both unique to it)
    // instead of dropping straight to an error. The separate ["decisions","pending"] hook keeps
    // retry:false on purpose (migration-not-applied).
    expect(decisionQueueSrc).toContain('queryKey: ["decisions", "cockpit"]');
    expect(decisionQueueSrc).toMatch(/retry: 1,\s*\n\s*retryDelay: 800/);
    expect(pageStateSrc).toMatch(/export function DelayedLoading/);
    expect(decisions).toMatch(/<DelayedLoading onRetry=\{\(\) => refetch\(\)\}>/);
    // Existing honest error branch preserved.
    expect(decisions).toContain("Couldn't load the Decision Queue");
  });
  it("DelayedLoading shows no fabricated data — only an honest 'Still loading…' + optional Retry", () => {
    expect(pageStateSrc).toContain("Still loading…");
    expect(pageStateSrc).not.toMatch(/mock|fake|placeholder data/i);
  });
});

describe("Ask AI polish (honest + consistent)", () => {
  it("Ask page shares the app accent (no inert --section-hue override) and honest status dot", () => {
    // The old inline cyan override is gone (theme-spread is 0 app-wide anyway).
    expect(askMondailyPage).not.toMatch(/style=\{\{ "--section-hue": 40 \}/);
    // Header dot pings ONLY while a real answer is streaming — no always-on fake-live.
    expect(askMondailyPage).toMatch(/\{loading && <span className="absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping/);
  });
  it("Ask preserves all actions + honest memory disclosure + real source/token proof", () => {
    // Every AI action chip (real tool behind each).
    for (const k of ["task", "draft", "related", "explain", "decision", "workflow", "report"]) {
      expect(askMondailyPage).toContain(`key: "${k}"`);
    }
    // Memory disclosure renders once, only when facts were actually used.
    expect(askMondailyPage).toContain("meta.memory.used > 0");
    expect(askMondailyPage).toContain("remembered fact");
    // Real evidence/source/token components — no fake sources.
    for (const c of ["EvidenceStrip", "SourceList", "TokenLedger", "doSend", "sendSuggestion", "buildChipText"]) {
      expect(askMondailyPage).toContain(c);
    }
  });
});

describe("Calendar + Inbox AI-native polish", () => {
  it("Calendar uses the shared CommandPageHeader with HONEST Meeting Agent status; keeps prepare/agenda/RSVP/call/followups", () => {
    expect(calendar).toMatch(/<CommandPageHeader/);
    expect(calendar).not.toMatch(/<h1\b/);
    // Meeting Agent status is on-demand/available/monitoring — never a fake "running".
    expect(calendar).toContain('kind: "monitoring"');
    for (const h of ["prepare.mutate", "saveAgenda", "respond.mutate", "addCall.mutate", "createTask.mutate", "openCreate", "/prepare"]) {
      expect(calendar).toContain(h);
    }
  });
  it("Inbox uses the shared CommandPageHeader; AI draft is an integrated assist that never auto-sends; read state is real", () => {
    expect(messages).toMatch(/<CommandPageHeader/);
    expect(messages).not.toMatch(/<h1\b/);
    // AI draft affordance (accent-tinted control) + honest 'you review & send' + never auto-sends.
    expect(messages).toContain("Draft with AI");
    expect(messages).toContain("you review");
    expect(messages).toContain("/messages/draft");
    // Read/Sent state derives only from the real read_at (no faked presence/receipts).
    expect(messages).toMatch(/m\.read_at \?/);
    for (const h of ["send.mutate", "aiDraft", "read_at"]) expect(messages).toContain(h);
  });
  it("Calendar + Inbox adopt the shared page-state primitives (loading/error/empty) and shared button classes", () => {
    // Calendar: shared DelayedLoading + ErrorState + EmptyState (no bespoke inline retry/empty cards).
    expect(calendar).toContain("<DelayedLoading");
    expect(calendar).toContain("<ErrorState");
    expect(calendar).toContain("<SharedEmptyState");
    expect(calendar).not.toMatch(/Couldn't load your calendar\. <button/);
    // Calendar modal footer uses the shared button primitives, not bespoke bordered buttons.
    expect(calendar).toMatch(/className="btn-secondary text-\[12px\]"/);
    expect(calendar).toMatch(/className="btn-primary text-\[12px\] font-semibold"/);
    // Inbox: shared ErrorState + EmptyState for the list / no-conversation surfaces.
    expect(messages).toContain("<ErrorState");
    expect(messages).toContain("<EmptyState");
    expect(messages).not.toMatch(/Couldn't load your inbox\. <button/);
  });
  it("Inbox AI draft is honestly marked as an unsent draft until the human edits or sends", () => {
    // A dedicated flag drives an explicit 'review before sending' marker — set on AI draft, cleared on edit/send.
    expect(messages).toContain("const [aiDrafted, setAiDrafted]");
    expect(messages).toContain("AI draft · review before sending");
    expect(messages).toMatch(/setAiDrafted\(true\)/);
    // Cleared on send and on manual edit so the marker never lies.
    expect(messages).toMatch(/setAiDrafted\(false\)/);
    expect(messages).toMatch(/if \(aiDrafted\) setAiDrafted\(false\)/);
  });
});

describe("Settings-wide visual normalization", () => {
  it("no page-specific brown 'stone' theme survives anywhere in Settings", () => {
    for (const [name, src] of Object.entries(SETTINGS_SRC)) {
      expect(src, `${name} still uses a stone-* color`).not.toMatch(/\bstone-[0-9]/);
    }
  });
  it("Settings buttons/frames are squared (no rounded-lg/md); dividers/frames are token-driven (no divide-white)", () => {
    for (const [name, src] of Object.entries(SETTINGS_SRC)) {
      expect(src, `${name} has rounded-lg/md`).not.toMatch(/rounded-(lg|md)/);
      expect(src, `${name} has divide-white`).not.toContain("divide-white");
    }
  });
  it("ask-mondaily + email use the shared transparent settings-section frame (no filled/tinted frames, no premium-panel)", () => {
    expect(SETTINGS_SRC["ask-mondaily"]).toContain("settings-section");
    expect(SETTINGS_SRC["ask-mondaily"]).not.toMatch(/rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-hover\)\]/);
    expect(SETTINGS_SRC["email"]).toContain("settings-section");
    expect(SETTINGS_SRC["email"]).not.toContain("premium-panel");
  });
  it("destructive Delete buttons use the shared rose danger tone, not a neutral fill", () => {
    expect(SETTINGS_SRC["account"]).toMatch(/Delete account<\/button>/);
    expect(SETTINGS_SRC["account"]).toMatch(/border-\[#d1524a\][\s\S]*Delete account/);
    expect(SETTINGS_SRC["workspace"]).toMatch(/border-\[#d1524a\][\s\S]*Delete workspace/);
  });
  it("primary Settings actions resolve to the shared accent model (accent-soft / btn-primary), preserving handlers", () => {
    // The former stone primaries now use the accent surface token used by btn-primary/MetricGrid.
    expect(SETTINGS_SRC["workspace"]).toContain("btn-primary");
    for (const key of ["section-accent-soft"]) {
      expect(SETTINGS_SRC["integrations"]).toContain(key);
    }
    // Mutations/handlers untouched — spot-check the real save/connect calls still exist.
    expect(SETTINGS_SRC["workspace"]).toContain("save.mutate");
    expect(SETTINGS_SRC["email"]).toContain("connect(");
    expect(SETTINGS_SRC["account"]).toContain("deleteAccount");
  });
});

describe("Primary-button unification (stone → shared accent model)", () => {
  // Every dashboard app source (the surfaces that carried inline stone primary buttons).
  const APP_SURFACES = [
    "routes/dashboard/finance/quotes.tsx", "routes/dashboard/finance/invoices.tsx", "routes/dashboard/finance/expenses.tsx",
    "routes/dashboard/finance/credit-notes.tsx", "routes/dashboard/finance/[invoiceId].tsx", "routes/dashboard/finance/[creditNoteId].tsx",
    "routes/dashboard/automations/index.tsx", "routes/dashboard/automations/workflow-builder.tsx", "routes/dashboard/automations/sequence-builder.tsx",
    "routes/dashboard/notes.tsx", "routes/dashboard/pipeline.tsx", "routes/dashboard/tasks.tsx", "routes/dashboard/call-detail.tsx",
    "routes/dashboard/objects/[objectType]/index.tsx", "routes/dashboard/lists/[listId].tsx",
    "routes/dashboard/reports/dashboard-view.tsx", "routes/dashboard/reports/report-builder.tsx", "routes/dashboard/reports/sales-report.tsx",
    "components/records/board-view.tsx", "components/records/record-table.tsx", "components/records/dedup-panel.tsx",
    "components/records/csv-importer.tsx", "components/records/segment-builder.tsx", "components/layout/sidebar-lists.tsx",
    "components/notes/note-editor.tsx", "components/ai/prospecting-modal.tsx", "components/ai/ask-mondaily.tsx",
  ].map((p) => [p, read(p)] as const);

  it("no filled/solid stone PRIMARY BUTTON survives — solid stone button hovers are all converted to the accent color-mix", () => {
    for (const [name, src] of APP_SURFACES) {
      // A solid button hover (hover:bg-stone-400/500/600/700 with NO opacity suffix) is the signature of
      // a stone primary button. All must now be the shared accent hover.
      const solidStoneHover = src.match(/hover:bg-stone-[4567]00(?![/0-9])/g) ?? [];
      expect(solidStoneHover, `${name} still has a solid stone button hover`).toHaveLength(0);
      // The bordered stone primary cluster must be gone too.
      expect(src, `${name} still has the stone primary border+fill cluster`).not.toMatch(/border-stone-500\/30 bg-stone-(600|700)(?![/0-9])/);
    }
  });
  it("converted surfaces adopt the shared accent primary model (accent-line border + accent-soft fill)", () => {
    // Spot-check representative surfaces actually gained the accent primary treatment.
    for (const p of ["routes/dashboard/finance/quotes.tsx", "routes/dashboard/automations/index.tsx", "components/records/board-view.tsx"]) {
      expect(read(p)).toMatch(/border-\[var\(--section-accent-line\)\] bg-\[var\(--section-accent-soft\)\]/);
    }
  });
  it("PRESERVES intact — checkbox/selected fills, loading dots, and the segmented control keep their neutral stone", () => {
    expect(read("routes/dashboard/tasks.tsx")).toContain("bg-stone-600 border-stone-600"); // selected checkbox
    expect(read("components/ai/agent-status.tsx")).toMatch(/bg-stone-600 animate-bounce/);   // loading dots
    expect(read("components/records/segment-builder.tsx")).toContain('bg-stone-600 text-[var(--text-primary)]'); // AND/OR segmented control
  });
  it("a destructive confirm mis-styled as neutral is now rose danger, not accent", () => {
    // The objects 'Yes, delete sheet' confirm must read as danger (rose), never the neutral/accent fill.
    expect(read("routes/dashboard/objects/[objectType]/index.tsx")).toMatch(/border-\[#d1524a\] bg-\[color-mix\(in_srgb,#d1524a[^)]*\)\][^"]*Yes, delete sheet|Yes, delete sheet/);
    expect(read("routes/dashboard/objects/[objectType]/index.tsx")).toMatch(/border border-\[#d1524a\] bg-\[color-mix\(in_srgb,#d1524a_16%/);
  });
  it("handlers preserved on converted surfaces (className-only change)", () => {
    expect(read("routes/dashboard/finance/quotes.tsx")).toMatch(/onClick|\.mutate/);
    expect(read("routes/dashboard/call-detail.tsx")).toContain("setAnalysisOpen");
    expect(read("routes/dashboard/reports/dashboard-view.tsx")).toContain("setAdding");
  });
});

describe("Premium low-data UX — guided empty states (real actions, no fake data)", () => {
  const callsPage = read("routes/dashboard/calls.tsx");
  const canvasPage = read("routes/dashboard/canvas.tsx");
  const financeReports = read("routes/dashboard/finance/reports.tsx");

  it("shared EmptyState supports guided next-action steps", () => {
    expect(pageStateSrc).toContain("export interface EmptyStateStep");
    expect(pageStateSrc).toMatch(/steps\?: EmptyStateStep\[\]/);
    // Steps are documented as REAL actions only.
    expect(pageStateSrc).toContain("Never a placeholder for data that doesn't exist");
  });
  it("empty object sheet uses the shared tokenized EmptyState — no hardcoded hexes, honest AI hint, real actions", () => {
    // The old empty block was littered with off-token hexes (#111827, #6b7280, #e5e7eb, bg-white…).
    // Isolate the empty-sheet block and assert it's gone.
    const startIdx = objectsIndex.indexOf("Empty sheet — the shared guided EmptyState");
    const block = objectsIndex.slice(startIdx, objectsIndex.indexOf("view === \"board\"", startIdx));
    expect(block).toMatch(/<EmptyState\s/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{6}/);         // no raw hexes
    expect(block).not.toMatch(/bg-stone-\d|text-stone-\d/); // no off-token stone greys
    // Honest AI Fill copy — searches the live web for real, source-backed records (never invented).
    expect(block).toContain("real, source-backed records");
    // Three real actions preserved, same handlers.
    expect(block).toContain("setShowAIFill(true)");
    expect(block).toContain("setShowCreate(true)");
    expect(block).toContain("setImportOpen(true)");
  });
  it("Calendar empty grid is a guided card with three real actions (no fake meetings)", () => {
    expect(calendar).toContain("Guided empty-range card");
    for (const k of ["cal.new_meeting", "cal.draft_agenda", "cal.suggest_followups"]) expect(calendar).toContain(k);
  });
  it("Inbox empty panes guide (DM + group) and stay honest about AI draft review", () => {
    expect(messages).toContain("Create a group");
    expect(messages).toContain("you always review before it sends");
    expect(messages).not.toMatch(/online now|active now/i); // no fake presence language
  });
  it("Meeting Memory uses the shared command header + guided empty with readiness pointer", () => {
    expect(callsPage).toMatch(/<CommandPageHeader/);
    expect(callsPage).toContain('callsign="RECALL"');
    expect(callsPage).toContain("Check recording readiness");
    expect(callsPage).toContain("<DelayedLoading");
    // Header status counts come from the real loaded list only.
    expect(callsPage).toMatch(/all\.length > 0 \? \[/);
  });
  it("Canvas first-run is an interactive labeled template gallery, not a passive caption", () => {
    expect(canvasPage).toContain("A blank canvas for thinking");
    expect(canvasPage).toMatch(/>Template</);
    expect(canvasPage).toMatch(/loadTemplate\(key\)/);
  });
  it("Sales report empty guides to real data paths; chart voids explain instead of 'No data'", () => {
    expect(salesReport).toContain("Find leads with Discovery");
    expect(salesReport).toContain("No records in this period");
    expect(salesReport).not.toContain("No data for this period");
  });
  it("Finance report shows a guided empty instead of an all-zeros dashboard", () => {
    expect(financeReports).toContain("No finance data yet");
    expect(financeReports).toMatch(/invoices\.length === 0 && creditNotes\.length === 0/);
    expect(financeReports).toContain("lg:grid-cols-2"); // top-clients grid stacks on narrow widths
  });
  it("Discovery pre-run surface is CALM: no marketing cards, one honesty line, disclosure below examples", () => {
    // The three pre-run value cards are gone — proof of work appears only after a real run.
    expect(discovery).not.toContain("Source-backed results");
    expect(discovery).not.toContain("What a run actually produces");
    // One quiet honesty line replaces them.
    expect(discovery).toContain("Every result links to the real page it came from");
    // "How Discovery works" renders ONLY inside the empty view (below Try), not above the composer.
    expect(discovery).not.toMatch(/\{view === "chat" && <ModuleStrip \/>\}/);
    const emptyFn = discovery.slice(discovery.indexOf("function Empty"), discovery.indexOf("function TurnView"));
    expect(emptyFn).toMatch(/<ModuleStrip connectors=\{connectors\} \/>/);
    // Per-run proof strip still present for real runs.
    expect(discovery).toMatch(/<ProofOfWorkStrip/);
    // The per-connector source dots no longer decorate the header — only ONE web-search signal there
    // (the header wrapped each connector as `{ node: <Source … }`); the live connected sources moved
    // into the on-demand disclosure (bare <Source> under "Connected sources").
    expect(discovery).not.toContain("{ node: <Source");
    expect(discovery).toMatch(/Connected sources[\s\S]*?<Source label=/);
  });
  it("Discovery workbench: composer is primary, Try is a capped quiet hint, mode controls secondary, a11y wired", () => {
    // The composer command surface stays the hero (leading glyph + query line + submit).
    expect(discovery).toContain('className="ai-composer !p-0 overflow-hidden"');
    expect(discovery).toMatch(/aria-label="Describe the leads or reviews to find"/);
    expect(discovery).toMatch(/aria-label="Run discovery search"/);
    // Try examples are capped to 3 so they never dominate the composer.
    expect(discovery).toMatch(/\)\.slice\(0, 3\)/);
    // Mode pills are secondary + keyboard-operable (pressed state + focus ring), never fake-live.
    expect((discovery.match(/aria-pressed=\{(deep|exhaustive)\}/g) ?? []).length).toBe(2);
    expect(discovery).not.toMatch(/live now|is searching now|AI is (thinking|live)|typing…/i);
    // Keyboard reachability across the pre-run controls.
    expect((discovery.match(/focus-visible:ring-2/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("AgentCard shows an explicit honest 'no runs yet' instead of a blank", () => {
    expect(agentConstellationSrc).toContain("no runs yet");
    expect(agentConstellationSrc).toMatch(/!ran && agent\.evidenceCount === 0 && !ghost/);
  });
  it("Ask welcome carries an honest grounding line (no fake source-backed claim)", () => {
    expect(askMondaily).toContain("Nothing is invented to fill a gap");
  });
});

describe("Credit Notes — polished finance operations page", () => {
  const creditNotes = read("routes/dashboard/finance/credit-notes.tsx");
  it("key totals use the shared telemetry-strip 3-card KPI (same as the other finance pages, not the odd-one-out MetricGrid)", () => {
    expect(creditNotes).toMatch(/telemetry-strip/);
    expect(creditNotes).not.toContain("Total credit issued"); // was a duplicate of Executed
    // Rendered only when rows exist — no zeros-as-stats on an empty workspace.
    expect(creditNotes).toMatch(/creditNotes\.length > 0 && \(/);
  });
  it("status filter uses the shared FinanceListToolbar (visible active tab lives in the one toolbar component)", () => {
    expect(creditNotes).toMatch(/<FinanceListToolbar /);
  });
  it("amounts read as finance numerals: right-aligned + tabular-nums", () => {
    expect(creditNotes).toMatch(/text-right text-\[13px\] font-semibold tabular-nums/);
    expect(creditNotes).toMatch(/text-right text-\[11px\] font-medium[^>]*>Amount/);
  });
  it("loading/error/empty use the shared primitives; empty distinguishes filtered vs truly empty", () => {
    expect(creditNotes).toContain("<DelayedLoading");
    expect(creditNotes).toContain("<ErrorState");
    expect(creditNotes).toMatch(/statusFilter \|\| search \? "Nothing matches this filter" : "No credit notes yet"/);
  });
  it("behavior preserved: create/open/search/filter and honest AI summary (real field only)", () => {
    for (const h of ["setShowNew(true)", "navigate(`/finance/credit-notes/${cn.id}`)", "setStatusFilter", "setSearch", "cn.ai_summary ?"]) {
      expect(creditNotes).toContain(h);
    }
    expect(creditNotes).toContain('apiClient.post<CreditNote>("/credit-notes"');
  });
});

describe("Agent Control Room — clear hierarchy, honest states", () => {
  it("summary stats use the shared MetricGrid (no third hand-rolled stat grid)", () => {
    expect(activity).toMatch(/<MetricGrid className="mb-8" cols=\{4\}/);
    expect(activity).not.toMatch(/grid grid-cols-2 gap-px overflow-hidden rounded-sm border sm:grid-cols-4/);
  });
  it("roster is ordered by REAL state priority (attention first, ghosts last) — pure view-sort", () => {
    expect(activity).toContain("const STATE_ORDER: Record<string, number> = { issue: 0, needs_approval: 1, active: 2, monitoring: 3, disabled: 4, not_configured: 5 }");
    expect(activity).toMatch(/\[\.\.\.constellation\]\.sort\(\(x, y\) => \(STATE_ORDER\[x\.state\] \?\? 9\) - \(STATE_ORDER\[y\.state\] \?\? 9\)\)/);
  });
  it("card footer: proof glyph + quiet ghost Run trigger (no bordered CTA per card)", () => {
    expect(activity).toMatch(/<ShieldCheck size=\{10\}[^>]*\/> <span className="truncate">\{agent\.backedBy\.join\(" · "\)\}/);
    expect(activity).not.toContain("backed by {agent.backedBy.join");
    // Run trigger is a ghost (no border class), still the same runAgent.mutate handler.
    expect(activity).toMatch(/hover:bg-\[var\(--surface-hover\)\] hover:text-\[var\(--section-accent\)\][^}]*disabled:opacity-50" style=\{\{ color: "var\(--text-muted\)" \}\}/);
    expect(activity).toContain("runAgent.mutate(agent.id)");
  });
  it("AgentCard state label carries its honest tone only for the three live states", () => {
    expect(agentConstellationSrc).toMatch(/style=\{\{ color: live \? tone : "var\(--text-faint\)" \}\}/);
    expect(agentConstellationSrc).toMatch(/state === "active" \|\| state === "needs_approval" \|\| state === "issue"/);
  });
  it("header status stays honest — 'working now' only from real active count, no fake live ping", () => {
    expect(activity).toMatch(/activeAgents > 0 \? `\$\{activeAgents\} working now` : "all agents monitoring"/);
  });
});

describe("Team Oversight — member dossier composition + honest activity language", () => {
  it("member panel sections are flat DossierSections, not border-ruled slabs", () => {
    // The local Section wrapper now renders the SAME shared dossier header as Decisions.
    expect(teamOversight).toMatch(/<DossierSection title=\{title\}>\{children\}<\/DossierSection>/);
    // The metrics / deals / AI-review wrappers lost their full-width border-b rules.
    expect(teamOversight).not.toMatch(/className="border-b px-4 py-3\.5" style=\{\{ borderColor: "var\(--border-soft\)" \}\}>\s*<MetricGrid/);
  });
  it("live/active language is honest — sessions and recorded activity, never invented presence", () => {
    expect(teamOversight).toContain('"recorded activity only"');
    expect(teamOversight).not.toContain("live · real activity");
    expect(teamOversight).not.toContain("live now");
    // 'active session' wording is gated on the REAL has_session flag; otherwise real last-active age.
    expect(teamOversight).toMatch(/op\.has_session \? <span style=\{\{ color: "#2f9e6b" \}\}> · active session<\/span> : <span> · \{ago\(op\.last_active_at\)\}<\/span>/);
  });
  it("expanded-panel behavior preserved: message, call gating, print, tabs, insight, efficiency", () => {
    for (const h of [
      "navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)",
      "callCap.data?.enabled",
      "window.print()",
      "efficiency.mutate()",
      "insightQ.refetch()",
      'queryKey: ["oversight-actor", op.operator_id]',
    ]) expect(teamOversight).toContain(h);
  });
  it("Team Oversight is keyboard-reachable: roster expand + dossier tabs carry a11y roles/labels", () => {
    // Roster row is a real expand control with aria-expanded + a focus ring.
    expect(teamOversight).toMatch(/aria-expanded=\{isSel\}/);
    expect(teamOversight).toMatch(/aria-label=\{`\$\{isSel \? "Collapse" : "Expand"\} \$\{op\.name\}'s dossier`\}/);
    // Dossier tabs are a proper tablist with selected state.
    expect(teamOversight).toMatch(/role="tablist"/);
    expect(teamOversight).toMatch(/role="tab" aria-selected=\{tab === tb\.id\}/);
    // Focus-visible rings are present across the interactive controls.
    expect((teamOversight.match(/focus-visible:ring-2/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  it("AI review states the Signal Agent's real data scope and stays advisory (no productivity fiction)", () => {
    expect(teamOversight).toMatch(/Reads recorded activity only — tasks, records, decisions, AI usage &amp; messages\. Advisory: it summarizes and suggests; you decide\./);
    // No fake live / presence / productivity-score language anywhere.
    expect(teamOversight).not.toMatch(/live now|is online now|productivity score|currently working|watching now/i);
  });
  it("load failure shows the honest ErrorState, never the empty 'No members yet' surface", () => {
    // The error branch renders ErrorState; the 'No members yet' copy is only in the empty (non-error) branch.
    expect(teamOversight).toMatch(/isError \? \(\s*\/\/[^\n]*\n[\s\S]*?<ErrorState error=\{new Error\("Couldn't load Team Intelligence/);
    expect(teamOversight).toMatch(/operators\.length === 0 \? \([\s\S]*?No members yet/);
  });
});

describe("Decisions cockpit v2 — approved recommendations (all real data, no fabrication)", () => {
  it("list rows flag side-effecting approvals and snoozed wake times from REAL fields", () => {
    expect(decisions).toMatch(/laneDef\.open && d\.execution_preview\?\.side_effect/);
    expect(decisions).toContain("runs action");
    expect(decisions).toMatch(/d\.status === "snoozed" && d\.snoozed_until/);
    expect(decisions).toMatch(/wakes \{relUntil\(d\.snoozed_until\)\}/);
  });
  it("queue search is client-side over loaded rows (title/summary/agent)", () => {
    expect(decisions).toMatch(/d\.title\.toLowerCase\(\)\.includes\(q\)/);
    expect(decisions).toMatch(/placeholder="Search queue…"/);
  });
  it("selection mirrors to ?id= with a loop guard, and resolve advances via select()", () => {
    expect(decisions).toMatch(/setSearchParams\(id \? \{ id \} : \{\}, \{ replace: true \}\)/);
    expect(decisions).toMatch(/focusId && focusId !== selectedId/);
    expect(decisions).toMatch(/finally \{ setBanner\(null\); setActing\(null\); select\(next\); invalidate\(\); \}/);
  });
  it("risk-first sort defers to an active AI triage ranking", () => {
    expect(decisions).toMatch(/lane === "approval" && triage\)/);
    expect(decisions).toMatch(/: sortRisk\n/);
    expect(decisions).toMatch(/AI triage ranking is active — clear it to sort by risk/);
  });
  it("edit proposal uses the existing PATCH endpoint, open lanes only, evidence untouched", () => {
    expect(decisions).toMatch(/apiClient\.patch\(`\/decisions\/\$\{d\.id\}`/);
    expect(decisions).toMatch(/lane\.open && !editOpen/);
    // Only title / recommended_action / risk_level are editable — never evidence or summary.
    expect(decisions).not.toMatch(/editDraft\.(evidence|summary|confidence)/);
  });
  it("copy-link shares the honored ?id= deep-link; closed lanes disclose the loaded window", () => {
    expect(decisions).toMatch(/\/decisions\?id=\$\{d\.id\}/);
    expect(decisions).toContain("older history isn't loaded");
  });
});

describe("Currency wiring — sales report respects workspace currency + honest FX", () => {
  const rep = read("routes/dashboard/reports/sales-report.tsx");
  it("money is formatted with the workspace DISPLAY symbol, never a hardcoded $", () => {
    expect(rep).toMatch(/const curSym = CURRENCY_SYMBOL\[display\]/);
    expect(rep).toMatch(/function fmtMoney\(n: number, sym = "\$"\)/);
    // No `$`-prefixed money template survives outside the fmtMoney default.
    expect(rep).not.toMatch(/`\$\$\{\(n \/ 1_000_000\)/);
    expect(rep).toMatch(/fmtMoney\([^)]*, (cur)?[Ss]ym\)/);
  });
  it("aggregates convert each record from its own currency into display via the shared convertAmount", () => {
    expect(rep).toMatch(/import \{ useCurrency, convertAmount, currencyOptions, CURRENCY_SYMBOL \}/);
    expect(rep).toMatch(/const v = convertAmount\(raw, from, display, rates\)/);
    // computeStats + buildTrend receive the converter; per-record rows convert too.
    expect(rep).toMatch(/computeStats\(filteredRecords, valueCol, stageCol, period, customRange, toDisplay\)/);
    expect(rep).toMatch(/buildTrend\(filteredRecords, valueCol, stageCol, period, customRange, toDisplay\)/);
    expect(rep).toMatch(/const recVal = \(r: NodeRecord\) =>/);
  });
  it("display-currency selector present + honest mixed/unconverted note (no silent mislabeling)", () => {
    expect(rep).toMatch(/setDisplay\.mutate\(v\)/);
    expect(rep).toContain("at face value");
    expect(rep).toMatch(/const mixedCurrency = valueCurrencies\.size > 1/);
    expect(rep).toMatch(/const unconverted = /);
  });
  it("board-view column calcs convert per-record into the display currency + show the symbol", () => {
    const board = read("components/records/board-view.tsx");
    expect(board).toMatch(/import \{ useCurrency, convertAmount, CURRENCY_SYMBOL \}/);
    expect(board).toMatch(/const curSym = CURRENCY_SYMBOL\[display\]/);
    expect(board).toMatch(/function fmtDisplay\(n: number, sym = ""\)/);
    // Calcs convert then format with the symbol; per-card editable value stays raw.
    expect(board).toMatch(/toDisplay \? toDisplay\(n, \(c\.data\.currency/);
    expect(board).toMatch(/<CalcFooter cards=\{cards\} valueCol=\{valueCol\} sym=\{curSym\} toDisplay=\{toDisplay\}/);
  });
});

describe("Avatar/logo uploads downscale client-side (no 2 MB base64 in member-list responses)", () => {
  const account = read("routes/dashboard/settings/account.tsx");
  const workspace = read("routes/dashboard/settings/workspace.tsx");
  const util = read("lib/image-resize.ts");
  it("the shared downscale util center-crops to a small square thumbnail via canvas", () => {
    expect(util).toContain("export async function downscaleImageToDataUrl");
    expect(util).toMatch(/const side = Math\.min\(img\.naturalWidth, img\.naturalHeight\)/);
    expect(util).toMatch(/canvas\.toDataURL/);
  });
  it("avatar upload downscales to 128px instead of storing the raw file data URL", () => {
    expect(account).toMatch(/downscaleImageToDataUrl\(file, \{ max: 128/);
    // No raw full-file readAsDataURL left in the avatar path.
    expect(account).not.toMatch(/uploadAvatar[\s\S]*?readAsDataURL\(file\)/);
  });
  it("workspace logo downscales raster to 256px but keeps SVG vector untouched", () => {
    expect(workspace).toMatch(/downscaleImageToDataUrl\(file, \{ max: 256/);
    expect(workspace).toMatch(/file\.type === "image\/svg\+xml"/);
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
  it("the workspace-graph MacBook terminal (agent.run '· running') carries its own Simulated preview tag", () => {
    // The streaming '· running' agent log must be honestly framed as a simulated preview, not a live run.
    expect(landing).toContain("· running");
    expect(landing).toMatch(/agent\.run\(&quot;\{activeSlug\}&quot;\) — mondaily/);
    // A Simulated-preview tag sits in that same terminal title bar.
    expect(landing).toMatch(/text-\[9\.5px\][\s\S]*?>Simulated preview</);
  });
  it("integrations strip shows named provider pills (scannable, degrade gracefully) — no bare icon-only tiles", () => {
    // Provider NAME is always rendered, and the brand glyph hides on load error instead of showing a broken box.
    for (const name of ["Gmail", "Outlook", "Google Calendar"]) expect(landing).toContain(name);
    expect(landing).toMatch(/onError=\{e => \{ e\.currentTarget\.style\.display = "none"; \}\}/);
    // Honest: only the three real OAuth providers, still labelled "via OAuth".
    expect(landing).toContain("via OAuth");
  });
  it("the Meeting Agent node no longer overlaps the graph root spine (repositioned off 33,30)", () => {
    expect(landing).toMatch(/label: "Meeting Agent", x: 66, y: 30/);
  });
});

describe("Ask side panel squared (ask-mondaily)", () => {
  it("action + suggestion chips squared; mode-label metadata pill stays circular", () => {
    expect(askMondaily).not.toMatch(/rounded-full border px-3(\.5)? py-1\.5/); // chips squared
    expect(askMondaily).not.toMatch(/rounded-lg/);                            // icon buttons/rows squared
    expect(askMondaily).toMatch(/rounded-full border px-1\.5 py-0\.5/);       // mode-label pill kept
  });
});

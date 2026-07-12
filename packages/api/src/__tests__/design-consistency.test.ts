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
    expect(settingsAccount).toContain('color: "#9c6b72"');
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
  it("Decisions is a redesigned approval cockpit: shared FilterToolbar + coherent DossierSection dossier + header-folded queue stats", () => {
    // Filters now use the shared FilterToolbar (Records/List logic), not a bespoke bar / ActiveFilterChip.
    expect(decisions).toMatch(/<FilterToolbar/);
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
  it("Decisions cockpit polish: shared MetricGrid over REAL queue numbers + shared Empty/Error states", () => {
    // Queue intelligence is a shared MetricGrid (same primitive as Team Oversight), fed only when
    // the queue has content — no fabricated zeros-as-stats on an empty workspace.
    expect(decisions).toContain("const queueMetrics: MetricItem[]");
    expect(decisions).toMatch(/items\.length > 0 && <MetricGrid items=\{queueMetrics\}/);
    // Header stays calm — the long status text row was slimmed to live-sync + awaiting.
    expect(decisions).toContain('{ label: "live sync", kind: "monitoring" }');
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
    expect(SETTINGS_SRC["account"]).toMatch(/border-\[#9c6b72\][\s\S]*Delete account/);
    expect(SETTINGS_SRC["workspace"]).toMatch(/border-\[#9c6b72\][\s\S]*Delete workspace/);
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

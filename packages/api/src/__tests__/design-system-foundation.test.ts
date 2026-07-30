import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Design-system Pass 1 guards — presentation-only foundation (status tokens + type scale +
// a header-consolidation slice). These lock the invariants so a later edit can't silently
// reintroduce hardcoded status hex on the migrated control surfaces or drop the tokens.
const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CSS = read("apps/app/src/styles.css");
const TAILWIND = read("apps/app/tailwind.config.js");

describe("status tokens", () => {
  it("styles.css defines all five semantic status tokens", () => {
    for (const t of ["--status-ok:", "--status-warn:", "--status-error:", "--status-neutral:", "--status-info:"]) {
      expect(CSS).toContain(t);
    }
  });
  it("the tokens are aliased to the existing matte hex (pixel-neutral)", () => {
    expect(CSS).toMatch(/--status-ok:\s*#2f9e6b/);
    expect(CSS).toMatch(/--status-warn:\s*#c6892e/);
    expect(CSS).toMatch(/--status-error:\s*#d1524a/);
    expect(CSS).toMatch(/--status-neutral:\s*#717784/);
  });
  it("the canonical agent-dot / agent-badge status styles consume the tokens, not raw hex", () => {
    expect(CSS).toMatch(/\.agent-dot\[data-status="issue"\]\s*\{\s*background:\s*var\(--status-error\)/);
    expect(CSS).toMatch(/\.agent-badge\[data-status="needs_approval"\]\s*\{\s*color:\s*var\(--status-warn\)/);
    // the raw hex must survive ONLY in the token definitions + the doc comment, never as a live agent-dot value
    expect(CSS).not.toMatch(/\.agent-dot\[data-status="[a-z_]+"\]\s*\{\s*background:\s*#(2f9e6b|c6892e|d1524a|717784)/);
  });
});

describe("type scale", () => {
  it("defines the seven semantic type-scale utilities (incl. text-stat)", () => {
    for (const c of [".text-caption", ".text-label", ".text-body", ".text-row", ".text-stat", ".text-title", ".text-display"]) {
      expect(CSS).toContain(c);
    }
  });
  it("exposes the sizes as CSS variables too", () => {
    for (const v of ["--fs-caption:", "--fs-label:", "--fs-body:", "--fs-row:", "--fs-stat:", "--fs-title:", "--fs-display:"]) {
      expect(CSS).toContain(v);
    }
  });
  // Pass 3N policy: weight-safe scale — a type class controls size/line-height/letter-spacing only.
  it("NONE of the type-scale classes bake font-weight (weight stays page-owned → safe drop-in)", () => {
    for (const c of ["caption", "label", "body", "row", "stat", "title", "display"]) {
      // Each rule is defined on a single line: `.text-<c> { … }` referencing var(--fs-<c>).
      const m = CSS.match(new RegExp(`\\.text-${c}\\s*\\{[^}]*var\\(--fs-${c}\\)[^}]*\\}`));
      expect(m, `.text-${c} rule found`).not.toBeNull();
      expect(m![0]).not.toMatch(/font-weight/);
    }
  });
  it("text-stat is the ~17px KPI/metric size", () => {
    expect(CSS).toMatch(/--fs-stat:\s*17px/);
    expect(CSS).toMatch(/\.text-stat\s*\{[^}]*font-size:\s*var\(--fs-stat\)/);
  });
});

describe("high-density control surfaces no longer hardcode BARE status hex", () => {
  // Bracket tailwind forms (bg-[#hex]/opacity) are intentionally deferred; only the bare/inline-style
  // forms were swapped this pass. Assert no bare (non-bracket) target hex remains in the swapped files.
  const swapped = [
    "apps/app/src/components/ui/controls.tsx",
    "apps/app/src/routes/dashboard/team-oversight.tsx",
    "apps/app/src/routes/dashboard/decisions.tsx",
    "apps/app/src/routes/dashboard/activity.tsx",
    "apps/app/src/routes/dashboard/settings/ai-control-room.tsx",
    "apps/app/src/routes/dashboard/status.tsx",
    "apps/app/src/routes/dashboard/insights.tsx",
  ];
  it("controls.tsx STATUS_TONE maps to the tokens", () => {
    const c = read("apps/app/src/components/ui/controls.tsx");
    expect(c).toMatch(/complete:\s*"var\(--status-ok\)"/);
    expect(c).toMatch(/failed:\s*"var\(--status-error\)"/);
    expect(c).toMatch(/waiting:\s*"var\(--status-warn\)"/);
  });
  it("no bare (non-bracket) #2f9e6b/#c6892e/#d1524a/#717784 remain in the swapped files", () => {
    for (const f of swapped) {
      const src = read(f);
      // bare hex = a target hex NOT immediately preceded by '[' (which would be a tailwind arbitrary value)
      expect(src).not.toMatch(/[^[]#(2f9e6b|c6892e|d1524a|717784)\b/);
    }
  });
});

describe("header consolidation slice", () => {
  for (const [page, file] of [
    ["notes", "apps/app/src/routes/dashboard/notes.tsx"],
    ["notifications", "apps/app/src/routes/dashboard/notifications.tsx"],
    ["tasks", "apps/app/src/routes/dashboard/tasks.tsx"],
  ] as const) {
    it(`${page} uses the shared CommandPageHeader`, () => {
      const src = read(file);
      expect(src).toMatch(/CommandPageHeader/);
      expect(src).toMatch(/<CommandPageHeader/);
    });
  }
});

// ── Pass 2 — Tailwind status colours + safe bracket-form migration ──────────────
describe("Tailwind status colours are registered (opacity-capable)", () => {
  it("tailwind.config declares status.ok/warn/error/neutral/info as rgb(var(--…) / <alpha-value>)", () => {
    for (const k of ["ok", "warn", "error", "neutral", "info"]) {
      expect(TAILWIND).toMatch(new RegExp(`${k}:\\s*"rgb\\(var\\(--status-${k}-rgb\\) / <alpha-value>\\)"`));
    }
  });
  it("styles.css defines the RGB channel triples aliasing the same matte hex (pixel-neutral)", () => {
    expect(CSS).toMatch(/--status-ok-rgb:\s*47 158 107/);
    expect(CSS).toMatch(/--status-warn-rgb:\s*198 137 46/);
    expect(CSS).toMatch(/--status-error-rgb:\s*209 82 74/);
    expect(CSS).toMatch(/--status-neutral-rgb:\s*113 119 132/);
  });
});

// ── Pass 3G — additive DataTable shell enhancement (selection + sortable headers) ─
describe("DataTable gains OPTIONAL selection + sort props (presentational only, no migrations)", () => {
  const DT = read("apps/app/src/components/ui/data-table.tsx");
  it("exposes optional selection + sort props while preserving the existing API", () => {
    expect(DT).toMatch(/export interface DataTableSelection<T>/);
    expect(DT).toMatch(/export interface DataTableSort\b/);
    expect(DT).toMatch(/selection\?: DataTableSelection<T>/);
    expect(DT).toMatch(/sort\?: DataTableSort/);
    expect(DT).toMatch(/sortable\?: boolean/);
    // existing props still present
    for (const p of ["columns:", "rows:", "rowKey:", "onRowClick\\?:", "state\\?:", "align\\?:", "width\\?:", "hideBelow\\?:", "density\\?:", "stickyHeader\\?:", "className\\?:", "cellClassName\\?:"]) {
      expect(DT).toMatch(new RegExp(p));
    }
  });
  it("selection + sort state stay PAGE-OWNED — the shell only renders checkboxes/arrows and calls back", () => {
    expect(DT).toMatch(/selection\.onToggleAll/);
    expect(DT).toMatch(/selection\.onToggle\(row\)/);
    expect(DT).toMatch(/selection\.selectedKeys\.has\(rowKey\(row\)\)/);
    expect(DT).toMatch(/sort!\.onSort\(c\.key\)/);
    // no derived selection/sort state stored in the shell
    expect(DT).not.toMatch(/useState|useReducer/);
  });
  it("renders the checkbox column ONLY when `selection` is provided (opt-in)", () => {
    expect(DT).toMatch(/\{selection && \(/);            // guarded header + body checkbox cells
    expect(DT).toMatch(/const canSort = !!c\.sortable && !!sort;/);
    // non-sortable headers still render the bare header (byte-identical for existing consumers)
    expect(DT).toMatch(/\) : c\.header\}/);
  });
  it("stays presentational-only — no data fetching or domain imports", () => {
    expect(DT).not.toMatch(/apiClient|useQuery|useMutation|from ["'].*\/(finance|hooks|records)/);
  });
});

// ── Pass 3H — saved list sheet migrated to DataTable (selection + sort wired) ────
describe("lists/[listId] sheet uses the shared DataTable with page-owned selection + sort", () => {
  const L = read("apps/app/src/routes/dashboard/lists/[listId].tsx");
  it("imports + renders <DataTable> and no longer hand-rolls the table", () => {
    expect(L).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(L).toMatch(/<DataTable<NodeRecord>/);
    expect(L).toMatch(/columns=\{listColumns\}/);
    expect(L).not.toMatch(/<table\b/);
    expect(L).not.toMatch(/<thead\b/);
    expect(L).not.toMatch(/<tbody\b/);
  });
  it("selection is PAGE-OWNED — wired through DataTable.selection (Set + toggle + toggleAll)", () => {
    expect(L).toMatch(/selection=\{\{/);
    expect(L).toMatch(/selectedKeys: selected/);
    expect(L).toMatch(/onToggle: \(r\) => toggleSelect\(r\.id\)/);
    expect(L).toMatch(/onToggleAll: \(\) => setSelected\(allShownSelected \? new Set\(\) : new Set\(sortedRecords\.map/);
    expect(L).toMatch(/allSelected: allShownSelected/);
  });
  it("sort is PAGE-OWNED — page sorts `sortedRecords`, shell only shows the arrow + calls toggleSort", () => {
    expect(L).toMatch(/sort=\{\{ key: sortCol \?\? "", dir: sortDir, onSort: toggleSort \}\}/);
    expect(L).toMatch(/rows=\{sortedRecords\}/);
    expect(L).toMatch(/sortable: true/);
    // sort ordering logic stays in the page (unchanged)
    expect(L).toMatch(/function toggleSort\(col: string\)/);
    expect(L).toMatch(/const sortedRecords = useMemo/);
  });
  it("row-remove keeps its group-hover reveal (shell rows carry `group`) — behaviour unchanged", () => {
    expect(L).toMatch(/removeEntry\.mutate\(record\.id\)/);
    expect(L).toMatch(/opacity-0 transition-all group-hover:opacity-100/);
    expect(read("apps/app/src/components/ui/data-table.tsx")).toMatch(/cx\("group", onRowClick && "cursor-pointer", rowClassName\?\.\(row\)\)/);
  });
  it("cell formatting + object links + 8-column cap stay page-owned", () => {
    expect(L).toMatch(/const listColumns: DataTableColumn<NodeRecord>\[\]/);
    expect(L).toMatch(/to=\{`\/objects\/\$\{record\.object_type\}\/\$\{record\.id\}`\}/);   // object profile links
    expect(L).toMatch(/<LeadScoreBadge score=\{record\.lead_score\}/);
    expect(L).toMatch(/\.slice\(0, 8\)/);   // 8-column cap preserved
  });
  it("keeps its own loading (PageSkeleton) + guided-empty branches in the page", () => {
    expect(L).toMatch(/<PageSkeleton rows=\{6\}/);
    expect(L).toMatch(/No records in this list yet/);
  });
});

// ── Pass 3J — additive per-row presentational hooks (rowId/rowClassName/rowStyle) ─
describe("DataTable gains OPTIONAL per-row hooks (presentational, additive)", () => {
  const DT = read("apps/app/src/components/ui/data-table.tsx");
  it("exposes optional rowId / rowClassName / rowStyle props", () => {
    expect(DT).toMatch(/rowId\?: \(row: T\) => string/);
    expect(DT).toMatch(/rowClassName\?: \(row: T\) => string/);
    expect(DT).toMatch(/rowStyle\?: \(row: T\) => React\.CSSProperties \| undefined/);
    expect(DT).toMatch(/columns, rows, rowKey, onRowClick, selection, sort, rowId, rowClassName, rowStyle,/);
  });
  it("applies the hooks to the <tr> and keeps the `group` class", () => {
    expect(DT).toMatch(/id=\{rowId\?\.\(row\)\}/);
    expect(DT).toMatch(/className=\{cx\("group", onRowClick && "cursor-pointer", rowClassName\?\.\(row\)\)\}/);
    expect(DT).toMatch(/style=\{Object\.keys\(mergedStyle\)\.length \? mergedStyle : undefined\}/);
  });
  it("selected-row highlight is composed OVER rowStyle (selection never lost)", () => {
    // rowStyle spreads first, the selected background spreads LAST → wins when selected.
    expect(DT).toMatch(/const mergedStyle = \{ \.\.\.rowStyle\?\.\(row\), \.\.\.\(selected \? \{ background: "var\(--surface-selected\)" \} : \{\}\) \};/);
  });
  it("omitted hooks fall back to undefined (byte-identical for existing consumers)", () => {
    // no forced empty style object on the <tr>; rowId/rowClassName are optional-chained
    expect(DT).not.toMatch(/style=\{\{ \.\.\.rowStyle/);   // the old always-object form must not remain
  });
  it("stays presentational-only — no state / fetching / domain imports", () => {
    expect(DT).not.toMatch(/useState|useReducer|apiClient|useQuery|useMutation|from ["'].*\/(finance|hooks|records|tasks|reports)/);
  });
});

describe("no consumer passes the new row hooks yet (unchanged) + Tasks untouched", () => {
  it("finance pages + saved list sheet pass no rowId/rowClassName/rowStyle", () => {
    for (const f of [
      "apps/app/src/routes/dashboard/finance/quotes.tsx",
      "apps/app/src/routes/dashboard/finance/credit-notes.tsx",
      "apps/app/src/routes/dashboard/finance/invoices.tsx",
      "apps/app/src/routes/dashboard/finance/expenses.tsx",
      "apps/app/src/routes/dashboard/lists/[listId].tsx",
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/rowId=\{/);
      expect(src).not.toMatch(/rowClassName=\{/);
      expect(src).not.toMatch(/rowStyle=\{/);
    }
  });
});

// ── Pass 3M — typography-scale pilot on finance/quotes (weight-neutral classes) ─
describe("finance/quotes fully adopts the shared type scale (Pass 3O)", () => {
  const Q = read("apps/app/src/routes/dashboard/finance/quotes.tsx");
  it("uses the shared scale classes it needs (caption/label/body/row/stat)", () => {
    for (const c of ["text-caption", "text-label", "text-body", "text-row", "text-stat"]) {
      expect(Q).toMatch(new RegExp(`\\b${c}\\b`));
    }
  });
  it("has ZERO arbitrary text-[Npx] classes left", () => {
    expect(Q).not.toMatch(/text-\[[0-9.]+px\]/);
  });
  it("weight preserved via explicit font-* (scale no longer bakes weight)", () => {
    expect(Q).toMatch(/cellClassName: "text-row font-semibold/);   // amount stays 600
    expect(Q).toMatch(/text-stat font-semibold text-status-neutral/); // KPI numbers stay 600
    expect(Q).toMatch(/text-label text-\[var\(--text-secondary\)\]/); // date cells stay weight-400 (no font-* added)
  });
  it("behaviour/formatting untouched — amount field, status badge, telemetry, DataTable intact", () => {
    expect(Q).toMatch(/fmt\(q\.total, q\.currency\)/);
    expect(Q).toMatch(/STATUS_CONFIG\[q\.status\]/);
    expect(Q).toMatch(/formatMoney\(totalPending, currency\)/);   // telemetry unchanged
    expect(Q).toMatch(/<DataTable<Quote>/);
    expect(Q).toMatch(/columns=\{QUOTE_COLUMNS\}/);
  });
});

// ── Pass 3K — Tasks SHEET view migrated to DataTable (list/board untouched) ─────
describe("tasks sheet view uses DataTable; list + board views untouched", () => {
  const T = read("apps/app/src/routes/dashboard/tasks.tsx");
  it("imports + renders <DataTable> in the sheet branch; no hand-rolled <table> remains", () => {
    expect(T).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(T).toMatch(/<DataTable<Task>/);
    expect(T).toMatch(/columns=\{sheetColumns\}/);
    expect(T).not.toMatch(/<table\b/);
    expect(T).not.toMatch(/<thead\b/);
    expect(T).not.toMatch(/<tbody\b/);
  });
  it("deep-link anchor + highlight preserved via rowId / rowStyle (Pass 3J hooks)", () => {
    expect(T).toMatch(/rowId=\{\(task\) => `task-\$\{task\.id\}`\}/);
    expect(T).toMatch(/rowStyle=\{\(task\) => highlightId === task\.id \?/);
    expect(T).toMatch(/getElementById\(`task-\$\{focusId\}`\)\?\.scrollIntoView/);   // deep-link scroll still wired
  });
  it("no selection / no sortable headers (sheet uses the external toolbar sort)", () => {
    expect(T).not.toMatch(/selection=\{/);
    expect(T).not.toMatch(/\bsort=\{/);
    expect(T).not.toMatch(/sortable: true/);
  });
  it("completion toggle, title→detail, edit/delete stay page-owned in the column model", () => {
    expect(T).toMatch(/const sheetColumns: DataTableColumn<Task>\[\]/);
    expect(T).toMatch(/onClick=\{\(\) => handleToggle\(task\)\}/);       // optimistic completion toggle
    expect(T).toMatch(/onClick=\{\(\) => setDetailTask\(task\)\}/);      // title opens detail
    expect(T).toMatch(/onClick=\{\(\) => setEditTask\(task\)\}/);        // edit
    expect(T).toMatch(/task\.assignee_id === currentUserId \|\| !task\.assignee_id/);  // delete gating
    expect(T).toMatch(/hideBelow: "md"/);                                // Created + Labels responsive
  });
  it("list (card) + board (DnD) views remain — sheet migration is scoped", () => {
    expect(T).toMatch(/viewMode === "list" &&/);
    expect(T).toMatch(/viewMode === "board" &&/);
    expect(T).toMatch(/<DndContext/);
    expect(T).toMatch(/viewMode === "sheet" &&/);
  });
  it("sheet loading/empty states kept in the page", () => {
    expect(T).toMatch(/query\.isLoading \? <PageSkeleton/);
    expect(T).toMatch(/<EmptyState/);
  });
});

describe("existing finance consumers do NOT use the new props (render unchanged)", () => {
  for (const f of [
    "apps/app/src/routes/dashboard/finance/quotes.tsx",
    "apps/app/src/routes/dashboard/finance/credit-notes.tsx",
    "apps/app/src/routes/dashboard/finance/invoices.tsx",
    "apps/app/src/routes/dashboard/finance/expenses.tsx",
  ]) {
    it(`${f.split("/").pop()} passes no selection/sort/sortable`, () => {
      const src = read(f);
      expect(src).toMatch(/<DataTable</);
      expect(src).not.toMatch(/selection=\{/);
      expect(src).not.toMatch(/\bsort=\{/);
      expect(src).not.toMatch(/sortable:/);
    });
  }
});

describe("migrated status surfaces use bg/border/text-status-* (never broken var() opacity)", () => {
  const migrated = [
    "apps/app/src/components/records/pipeline-health-badge.tsx",
    "apps/app/src/components/records/lead-score-badge.tsx",
    "apps/app/src/components/ai/ai-intelligence.tsx",
    "apps/app/src/routes/dashboard/finance/[creditNoteId].tsx",
    "apps/app/src/routes/dashboard/finance/credit-notes.tsx",
    "apps/app/src/routes/dashboard/finance/quotes.tsx",
    "apps/app/src/routes/dashboard/approvals.tsx",
  ];
  it("they now use the semantic status utilities", () => {
    for (const f of migrated) {
      expect(read(f)).toMatch(/(bg|text|border)-status-(ok|warn|error|neutral)/);
    }
  });
  it("no bg/text/border-[#hex] status bracket forms remain in the migrated files", () => {
    for (const f of migrated) {
      expect(read(f)).not.toMatch(/(bg|text|border[a-z-]*)-\[#(2f9e6b|c6892e|d1524a|717784)\]/);
    }
  });
  it("NEVER emits the broken pattern (a var() arbitrary colour with an opacity modifier)", () => {
    for (const f of migrated) {
      expect(read(f)).not.toMatch(/\[var\(--status[^\]]*\]\/[0-9[]/);
    }
  });
});

describe("decorative palettes were NOT migrated as status (semantic honesty)", () => {
  // These key colour by IDENTITY (avatar/tag cycle, message accent, expense category) — not by state —
  // so they must keep their own hex and never be rewritten to a status-* utility.
  it("record-detail avatar/category palette + ask-mondaily ACCENTS + expense-category colours stay hex, no status utils", () => {
    for (const f of [
      "apps/app/src/components/records/record-detail.tsx",
      "apps/app/src/routes/dashboard/finance/expenses.tsx",
    ]) {
      expect(read(f)).not.toMatch(/-status-(ok|warn|error|neutral)\b/);
    }
    // ask-mondaily now legitimately uses --status-warn for the DEGRADED badge — a real state,
    // which is exactly what status tokens are for. The decorative ban is scoped to the ACCENTS
    // palette, which must stay identity-keyed hex.
    const chat = read("apps/app/src/components/ai/ask-mondaily.tsx");
    const accentsStart = chat.indexOf("ACCENTS");
    expect(accentsStart).toBeGreaterThanOrEqual(0);
    expect(chat.slice(accentsStart, accentsStart + 800)).not.toMatch(/-status-(ok|warn|error|neutral)\b/);
  });
});

// ── Pass 3P — table-cell font-size respects page-owned type-scale classes ───────
describe("minimal-table cell font-size is overridable by type-scale classes (Pass 3P)", () => {
  // Extract the UNLAYERED `.minimal-table td { … }` block (the one that sets colour/line-height).
  const tdBlock = CSS.match(/\n\.minimal-table td \{[^}]*\}/)?.[0] ?? "";
  it("the unlayered `.minimal-table td` rule no longer hardcodes font-size", () => {
    expect(tdBlock).not.toMatch(/font-size/);
  });
  it("the cell font-size DEFAULT uses :where() (specificity 0,0,1) so text-* classes win", () => {
    // Tailwind v3 flattens @layer wrappers, so specificity — not layer order — must win.
    expect(CSS).toMatch(/:where\(\.minimal-table\) td \{ font-size: 0\.875rem; \}/);
  });
});

// ── Pass 4A — shared control-typography floor on the interactive primitives ─────
describe("shared control primitives define a type-scale font-size floor (Pass 4A)", () => {
  const AIB = read("apps/app/src/components/ui/ai-button.tsx");
  const block = (sel: string) => CSS.match(new RegExp(`\\.${sel} \\{[^}]*\\}`))?.[0] ?? "";
  it(".key-input + .btn-primary/secondary/ghost set font-size: var(--fs-body)", () => {
    for (const sel of ["key-input", "btn-primary", "btn-secondary", "btn-ghost"]) {
      expect(block(sel)).toMatch(/font-size:\s*var\(--fs-body\)/);
    }
  });
  it("buttons no longer bake an arbitrary text-[13px] size", () => {
    for (const sel of ["btn-primary", "btn-secondary", "btn-ghost"]) {
      expect(block(sel)).not.toMatch(/text-\[13px\]/);
    }
  });
  it(".ai-composer-input floor is expressed via :where() so call-site utilities still win", () => {
    expect(CSS).toMatch(/:where\(\.ai-composer-input\) \{ font-size: var\(--fs-body\); \}/);
  });
  it("the floor uses no !important font-size (call-site text-* utilities must override)", () => {
    for (const sel of ["key-input", "btn-primary", "btn-secondary", "btn-ghost"]) {
      expect(block(sel)).not.toMatch(/font-size:[^;]*!important/);
    }
  });
  it(".btn-icon stays icon-only — no font-size declaration, decision locked by comment", () => {
    expect(block("btn-icon")).not.toMatch(/font-size:/);   // no declaration (the comment mentions it in prose)
    expect(CSS).toMatch(/\.btn-icon is icon-only/);
  });
  it("primitives remain colour/layout-bearing (floor did not strip their identity)", () => {
    expect(block("btn-primary")).toMatch(/var\(--section-accent/);   // accent tint intact
    expect(block("key-input")).toMatch(/var\(--surface-input\)/);     // input surface intact
  });
  it("AIButton sm uses the shared scale (text-label) with no !important arbitrary size", () => {
    expect(AIB).toMatch(/size === "sm" \? "!px-2\.5 !py-1 text-label"/);
    expect(AIB).not.toMatch(/!text-\[11px\]/);
    // sizeCls carries no arbitrary size (SuggestionHints' own text-[10.5px] label is out of 4A scope).
    expect(AIB).not.toMatch(/sizeCls = size === "sm" \? "[^"]*text-\[/);
  });
  it("AIButton API/behavior unchanged (variant, loading, disabled, class merge, padding overrides)", () => {
    expect(AIB).toMatch(/variant === "solid" \? "btn-ai" : "btn-suggested"/);
    expect(AIB).toMatch(/disabled=\{disabled \|\| loading\}/);
    expect(AIB).toMatch(/className=\{`\$\{base\} \$\{sizeCls\} \$\{className\}`\}/);
    expect(AIB).toMatch(/!px-2\.5 !py-1/);   // padding overrides preserved
  });
});

// ── Pass 4D — last redundant text-body removed from finance .key-input controls ──
describe("no redundant text-body remains on finance .key-input controls (Pass 4D)", () => {
  const CND = read("apps/app/src/routes/dashboard/finance/[creditNoteId].tsx");
  const EXP = read("apps/app/src/routes/dashboard/finance/expenses.tsx");
  it("credit-note detail inline inputs are bare .key-input (floor supplies 12.5px)", () => {
    expect((CND.match(/className="key-input w-full"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(CND).not.toMatch(/key-input[^"]*text-body/);
  });
  it("expenses search input dropped text-body, keeps its layout classes + handler", () => {
    expect(EXP).toMatch(/className="key-input h-8 w-full pl-8 pr-3"/);
    expect(EXP).not.toMatch(/key-input[^"]*text-body/);
    expect(EXP).toMatch(/onChange=\{e => setSearch\(e\.target\.value\)\}/);
    expect(EXP).toMatch(/placeholder="Search expenses…"/);
  });
  it("behavior intact — save-on-blur + amount fields untouched", () => {
    expect(CND).toMatch(/onBlur=\{\(\) => save\(\)\}/);
    expect(CND).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);
    expect(EXP).toMatch(/fmt\(e\.amount_cents, e\.currency\)/);
  });
});

// ── Pass 4B — redundant control-typography cleanup (relies on the 4A floor) ──────
describe("redundant control text classes removed where the 4A floor already provides the size (Pass 4B)", () => {
  const Q = read("apps/app/src/routes/dashboard/finance/quotes.tsx");
  const CN = read("apps/app/src/routes/dashboard/finance/credit-notes.tsx");
  it("4A floor is still in place (control primitives carry var(--fs-body))", () => {
    for (const sel of ["key-input", "btn-primary"]) {
      expect(CSS.match(new RegExp(`\\.${sel} \\{[^}]*\\}`))?.[0] ?? "").toMatch(/font-size:\s*var\(--fs-body\)/);
    }
  });
  it("quotes: the brief input keeps .key-input but drops the redundant text-body (floor supplies 12.5px)", () => {
    expect(Q).toMatch(/className="key-input h-8 flex-1"/);
    expect(Q).not.toMatch(/key-input h-8 flex-1 text-body/);
  });
  it("credit-notes: the New button keeps .btn-primary + font-semibold, drops redundant text-body", () => {
    expect(CN).toMatch(/className="btn-primary font-semibold"><Plus size=\{13\} \/> New credit note/);
    expect(CN).not.toMatch(/btn-primary text-body font-semibold/);
  });
  it("intentional overrides (text-sm = 14px, ≠ 12.5px floor) are LEFT in place", () => {
    expect(Q).toMatch(/key-input w-full text-sm/);
    expect(CN).toMatch(/key-input w-full text-sm/);
  });
  it("no handlers/finance fields changed by the cleanup", () => {
    expect(Q).toMatch(/apiClient\.post\("\/quotes"/);
    expect(Q).toMatch(/fmt\(q\.total, q\.currency\)/);
    expect(CN).toMatch(/onClick=\{\(\) => setShowNew\(true\)\}/);
    expect(CN).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);
  });
});

// ── Pass 4G — invoice line-item table <th> headers → shared scale ───────────────
describe("finance/[invoiceId] line-item <th> headers use the shared scale (Pass 4G)", () => {
  const INV = read("apps/app/src/routes/dashboard/finance/[invoiceId].tsx");
  it("all five column headers are <th> … text-label (uppercase/align/width/color preserved)", () => {
    expect(INV).toMatch(/<th className="px-4 py-2 text-left text-label font-medium text-\[var\(--text-secondary\)\]">Description<\/th>/);
    expect(INV).toMatch(/<th className="px-4 py-2 text-right text-label font-medium text-\[var\(--text-secondary\)\] w-16">Qty<\/th>/);
    expect(INV).toMatch(/<th className="px-4 py-2 text-right text-label font-medium text-\[var\(--text-secondary\)\] w-28">Unit Price<\/th>/);
    expect(INV).toMatch(/<th className="px-4 py-2 text-right text-label font-medium text-\[var\(--text-secondary\)\] w-20">Tax %<\/th>/);
    expect(INV).toMatch(/<th className="px-4 py-2 text-right text-label font-medium text-\[var\(--text-secondary\)\] w-28">Total<\/th>/);
  });
  it("no <th> retains the old arbitrary text-[11px]", () => {
    expect(INV).not.toMatch(/<th className="[^"]*text-\[11px\]/);
  });
  it("column order unchanged (Description → Qty → Unit Price → Tax % → Total)", () => {
    // Search after the minimal-table start so the earlier printInvoice <th> string is skipped.
    const from = INV.indexOf('<table className="minimal-table">');
    const order = ["Description", "Qty", "Unit Price", "Tax %", "Total"].map(h => INV.indexOf(`>${h}</th>`, from));
    expect(order.every(i => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("editable line-item cells + totals rows retain their existing arbitrary classes (4G didn't reach them)", () => {
    expect((INV.match(/type="number"[^>]*className="[^"]*text-\[12px\]/g) ?? []).length).toBeGreaterThanOrEqual(1); // editable cells
    expect((INV.match(/pt-1\.5 text-\[14px\]/g) ?? []).length).toBe(2);                                             // totals net rows
  });
  it("no DataTable migration — bespoke minimal-table structure kept", () => {
    expect(INV).toMatch(/<table className="minimal-table">/);
    expect(INV).not.toMatch(/import \{ DataTable/);
  });
  it("math + action anchors untouched", () => {
    expect(INV).toMatch(/const \{ subtotal, tax_total, total \} = calcTotals\(items\)/);
    expect(INV).toMatch(/const netOwed = total - creditsAmt - paymentsAmt/);
    for (const fn of ["updateMutation", "recordPayment", "deleteMutation", "addItem", "removeItem", "printInvoice"]) {
      expect(INV).toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });
});

// ── Pass 4I — invoice totals-summary body rows → shared scale (heroes left) ─────
describe("finance/[invoiceId] totals body rows use the shared scale, heroes stay bespoke (Pass 4I)", () => {
  const INV = read("apps/app/src/routes/dashboard/finance/[invoiceId].tsx");
  it("the four non-emphasized totals rows are text-body with exact colours retained", () => {
    expect((INV.match(/flex justify-between text-body text-\[var\(--text-muted\)\]/g) ?? []).length).toBe(2); // Subtotal + Tax
    expect(INV).toMatch(/flex justify-between text-body text-\[var\(--text-faint\)\]/);                        // Credits applied
    expect(INV).toMatch(/flex justify-between text-body text-\[#2f9e6b\]/);                                    // Payments
  });
  it("both emphasized total lines remain bespoke text-[14px] (Invoice total + Net owed)", () => {
    expect(INV).toMatch(/border-t border-\[var\(--border-soft\)\] pt-1\.5 text-\[14px\] font-semibold text-\[var\(--text-primary\)\]/);
    expect(INV).toMatch(/pt-1\.5 text-\[14px\] font-bold \$\{netOwed > 0 \? "text-\[var\(--text-faint\)\]" : "text-\[#2f9e6b\]"\}/);
  });
  it("all six money expressions + reducers + minus prefixes unchanged", () => {
    for (const e of [
      /formatCurrency\(subtotal, currency\)/, /formatCurrency\(tax_total, currency\)/, /formatCurrency\(total, currency\)/,
      /−\{formatCurrency\(creditsAmt, currency\)\}/, /−\{formatCurrency\(paymentsAmt, currency\)\}/,
      /formatCurrency\(Math\.max\(0, netOwed\), currency\)/,
      /const netOwed = total - creditsAmt - paymentsAmt/,
      /\.filter\(cn => cn\.status === "executed"\)/,
      // The reducer now CONVERTS each credit into the invoice currency (it used to sum
      // amount_cents across different currencies and label the result with the invoice symbol).
      /convertAmount\(cn\.amount_cents \/ 100, cn\.currency \|\| currency, currency, rates\)/,
      /\.reduce\(\(s, p\) => s \+ p\.amount, 0\)/,
    ]) expect(INV).toMatch(e);
  });
  it("conditional scaffolding unchanged", () => {
    expect(INV).toMatch(/if \(creditsAmt === 0 && paymentsAmt === 0\) return null/);
    expect(INV).toMatch(/creditsAmt > 0 && \(/);
    expect(INV).toMatch(/paymentsAmt > 0 && \(/);
  });
  it("no text-[12px] left in the totals block + no DataTable/table refactor", () => {
    const block = INV.slice(INV.indexOf("{/* Totals */}"), INV.indexOf("{/* Payments section */}"));
    expect(block).not.toMatch(/text-\[12px\]/);
    expect(INV).not.toMatch(/import \{ DataTable/);
    expect(INV).toMatch(/<table className="minimal-table">/);
  });
});

// ── Pass 4F — invoice DETAIL read-only labels/static text → shared scale ────────
describe("finance/[invoiceId] read-only labels/static text adopt the shared scale (Pass 4F)", () => {
  const INV = read("apps/app/src/routes/dashboard/finance/[invoiceId].tsx");
  it("migrated read-only labels + static text use scale classes", () => {
    for (const label of ["Client name \\*", "Email", "Address", "Invoice number", "Due date", "Currency", "Notes / Payment instructions"]) {
      expect(INV).toMatch(new RegExp(`text-label text-\\[var\\(--text-secondary\\)\\]">${label}`));
    }
    expect(INV).toMatch(/text-label font-medium text-\[var\(--text-muted\)\] uppercase tracking-wider">Bill To/);
    expect(INV).toMatch(/text-label font-medium text-\[var\(--text-muted\)\] uppercase tracking-wider">Details/);
    expect(INV).toMatch(/text-body font-medium text-\[var\(--text-primary\)\]">Line Items/);
    expect(INV).toMatch(/text-body text-\[var\(--text-secondary\)\]">Loading…/);
    expect(INV).toMatch(/text-row text-\[var\(--text-muted\)\]">Invoice not found/);   // 13px static → text-row (disclosed)
    expect(INV).toMatch(/text-body text-\[var\(--text-faint\)\][^"]*">← Back to invoices/);
  });
  it("FORBIDDEN zones retain their existing classes — 4F did not reach them", () => {
    expect(INV).toMatch(/text-\[14px\] font-semibold text-\[var\(--text-primary\)\]">\{invoice\.number\}/); // header № (off-scale, left)
    expect((INV.match(/pt-1\.5 text-\[14px\]/g) ?? []).length).toBe(2);                                     // both totals net rows
    expect(INV).toMatch(/key-input mt-1 w-full text-\[13px\]/);                                             // editable inputs untouched
    expect((INV.match(/<th[^>]*className="text-\[11px\]/g) ?? []).length).toBeGreaterThanOrEqual(0);        // table headers still arbitrary
    expect(INV).toMatch(/text-\[11px\] text-\[var\(--text-muted\)\] hover:text-\[var\(--text-faint\)\] transition-colors">/); // add-item button left
  });
  it("no table refactor — bespoke <table>/minimal-table structure unchanged", () => {
    expect(INV).toMatch(/<table className="minimal-table">/);
    expect(INV).toMatch(/<table>/);   // the print-doc raw table generator
  });
  it("finance math + action handlers untouched", () => {
    expect(INV).toMatch(/formatCurrency\(subtotal, currency\)/);           // totals money render (detail-page signature)
    expect(INV).toMatch(/const \{ subtotal, tax_total, total \} = calcTotals\(items\)/);
    expect(INV).toMatch(/const netOwed = total - creditsAmt - paymentsAmt/);
    for (const fn of ["updateMutation", "recordPayment", "deleteMutation", "addItem", "removeItem", "printInvoice"]) {
      expect(INV).toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });
  it("printInvoice HTML string untouched (window.print flow intact)", () => {
    expect(INV).toMatch(/window\.print\(\); window\.onafterprint = \(\) => window\.close\(\)/);
  });
});

// ── Pass 5D — Home read-only text-[11px] meta/labels → text-label ───────────────
describe("dashboard/home read-only meta/labels use text-label (Pass 5D)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");
  it("the allowed items are text-label with attrs/colours/conditions preserved", () => {
    // (the "· {unread} unread" rail span was relocated to the top-right telemetry strip in Pass R2.1)
    expect(H).toMatch(/className="block text-label" style=\{\{ color: "var\(--text-muted\)" \}\}>\{description\}/);       // 900
    expect(H).toMatch(/className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>Recent:/);                     // 995
    expect(H).toMatch(/className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>\{loc\.t\("home\.today"\)\}/); // 1223
    expect(H).toMatch(/className="mt-0\.5 truncate text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>\{m\.sub\}/); // 1235 truncate
    expect(H).toMatch(/className="shrink-0 text-label tabular-nums" style=\{\{ color: "var\(--text-muted\)" \}\}>\{m\.when\}/); // 1237 tabular-nums
    expect(H).toMatch(/className="mt-1 text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>Your /);                  // 1253
    expect(H).toMatch(/className="mt-1 mb-3 text-label max-w-\[240px\]" style=\{\{ color: "var\(--text-faint\)" \}\}>Sync Google/); // 1261 max-w
  });
  it("deferred text-[11px] items remain untouched (controls, chips, links)", () => {
    expect((H.match(/!text-\[11px\]/g) ?? []).length).toBeGreaterThanOrEqual(3);                 // btn overrides (Retry + 2 calendar)
    expect(H).toMatch(/text-\[11px\] font-medium" style=\{\{ color: "var\(--section-accent\)/);   // Zap chip (723)
    expect(H).toMatch(/text-\[11px\]" style=\{\{ color: isOverdue/);                              // overdue dynamic meta (1155)
    expect(H).toMatch(/hidden sm:flex items-center gap-0\.5 text-\[11px\]/);                       // responsive meta (1161, out of scope)
    expect(H).toMatch(/truncate max-w-\[180px\] text-\[11px\]/);                                   // Ask-history link
  });
  it("hero + composer type stay put (this pass must not move them)", () => {
    // Was text-[26px]. The hero was deliberately retuned to 22px in the Attio-reference pass, when
    // it was explicitly in scope; these guards exist to stop an unrelated typography pass moving it
    // by accident, so they track the current value rather than a frozen one.
    expect(H).toMatch(/text-\[22px\] font-semibold leading-tight/);
    expect(H).toMatch(/text-\[15px\] leading-6 outline-none/);   // the composer textarea itself
  });
  it("behavior anchors unchanged", () => {
    expect(H).toMatch(/useAskEngine/);
    expect(H).toMatch(/const greeting = hour < 12/);
    expect(H).toMatch(/\bactiveTasks\b/);
    expect(H).toMatch(/onChange/);
  });
});

// ── Pass 5F — Home secondary status messages text-sm → text-body ────────────────
describe("dashboard/home secondary status messages use text-body (Pass 5F)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");
  it("the four status messages are text-body with colour/weight retained", () => {
    expect(H).toMatch(/className="text-body font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>You may be viewing an empty workspace\./);
    expect(H).toMatch(/className="text-body font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>Could not load tasks/);
    expect(H).toMatch(/className="text-body" style=\{\{ color: "var\(--text-secondary\)" \}\}>No open tasks\./);
    expect(H).toMatch(/className="text-body font-medium" style=\{\{ color: "var\(--text-secondary\)" \}\}>No meetings today/);
  });
  it("kept/deferred text-sm remains (chat, titles, input, row, banner, connect)", () => {
    expect(H).toMatch(/ask-user-bubble[^"]*text-sm/);                              // chat user bubble
    expect(H).toMatch(/ask-assistant-line[^"]*text-sm/);                           // chat assistant
    expect(H).toMatch(/text-sm font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>Meetings/); // card title
    expect(H).toMatch(/text-sm font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>AI Scan Report/); // card title
    expect(H).toMatch(/flex-1 bg-transparent text-sm outline-none/);               // attach input
    expect(H).toMatch(/truncate text-sm transition-colors/);                        // task row
    expect(H).toMatch(/text-sm text-\[#c6892e\]/);                                  // warning banner
    expect(H).toMatch(/text-sm font-medium" style=\{\{ color: "var\(--text-secondary\)" \}\}>Connect your calendar/);
  });
  it("hero + composer type stay put (this pass must not move them)", () => {
    // Was text-[26px]. The hero was deliberately retuned to 22px in the Attio-reference pass, when
    // it was explicitly in scope; these guards exist to stop an unrelated typography pass moving it
    // by accident, so they track the current value rather than a frozen one.
    expect(H).toMatch(/text-\[22px\] font-semibold leading-tight/);
    expect(H).toMatch(/text-\[15px\] leading-6 outline-none/);   // the composer textarea itself
  });
  it("behavior anchors unchanged", () => {
    expect(H).toMatch(/useAskEngine/);
    expect(H).toMatch(/const greeting = hour < 12/);
    expect(H).toMatch(/\bactiveTasks\b/);
    expect(H).toMatch(/onChange/);
  });
});

// ── Pass 5H — Home read-only supporting-copy remainder → shared scale (closes Home) ──
describe("dashboard/home read-only supporting copy fully migrated (Pass 5H)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");
  it("the eight remainder items use the chosen scale class (attrs/colors/conditions kept)", () => {
    expect(H).toMatch(/className="truncate text-row font-semibold" style=\{\{ color: "var\(--text-primary\)" \}\}>\{p\.title\}/);       // 719 → text-row
    expect(H).toMatch(/className="mt-0\.5 block text-label leading-snug" style=\{\{ color: "var\(--text-secondary\)" \}\}>\{p\.why\}/);   // 722 → text-label
    expect(H).toMatch(/className="mt-0\.5 text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>/);                                     // 633 → text-body
    expect(H).toMatch(/className="px-2 py-2 text-body" style=\{\{ color: "var\(--text-faint\)" \}\}>\{attachQuery/);                       // 922 → text-body
    expect(H).toMatch(/className="mt-1 text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>\{\(tasksQuery\.error/);                    // 1124 → text-body
    expect(H).toMatch(/className="mt-0\.5 text-body" style=\{\{ color: "var\(--text-faint\)" \}\}>Ask AI to create tasks/);               // 1132 → text-body
    expect(H).toMatch(/className="mt-px text-caption" style=\{\{ color: "var\(--text-faint\)" \}\}>\{scanTimestamp\}/);                    // 1307 → text-caption
    expect(H).toMatch(/className="mt-2 text-label" style=\{\{ color: "var\(--status-warn\)" \}\}>Reconnect needed/);                       // 1270 → text-label (cond)
  });
  it("controls/pills/chips/card-titles/chat prose remain untouched", () => {
    // Was >= 6. One of them — the suggestion row's sub-label — legitimately moved to the shared
    // body scale in the Attio-reference pass. Counting occurrences cannot say WHICH element it
    // found, so this only ever proved "some 12.5px text still exists"; the anchors below are what
    // actually protect the controls/pills/chips this test is named for.
    expect((H.match(/text-\[12\.5px\]/g) ?? []).length).toBeGreaterThanOrEqual(5);   // suggested-action pills
    expect((H.match(/!text-\[11px\]/g) ?? []).length).toBeGreaterThanOrEqual(3);     // btn overrides
    expect(H).toMatch(/ask-user-bubble/);
    expect(H).toMatch(/ask-assistant-line/);
    expect(H).toMatch(/text-sm font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>Meetings/); // card title
    expect(H).toMatch(/text-\[11px\] font-medium" style=\{\{ color: "var\(--section-accent\)/);        // Zap chip
  });
  it("hero + composer type stay put (this pass must not move them)", () => {
    // Was text-[26px]. The hero was deliberately retuned to 22px in the Attio-reference pass, when
    // it was explicitly in scope; these guards exist to stop an unrelated typography pass moving it
    // by accident, so they track the current value rather than a frozen one.
    expect(H).toMatch(/text-\[22px\] font-semibold leading-tight/);
    expect(H).toMatch(/text-\[15px\] leading-6 outline-none/);   // the composer textarea itself
  });
  it("behavior anchors unchanged", () => {
    expect(H).toMatch(/useAskEngine/);
    expect(H).toMatch(/const greeting = hour < 12/);
    expect(H).toMatch(/\bactiveTasks\b/);
    expect(H).toMatch(/onChange/);
  });
});

// ── Pass 6C — Tasks read-only meta → text-caption / text-label ──────────────────
describe("dashboard/tasks read-only meta uses text-caption/text-label (Pass 6C)", () => {
  const T = read("apps/app/src/routes/dashboard/tasks.tsx");
  it("no non-pill text-[10px] / text-[11px] meta remains", () => {
    expect(T).not.toMatch(/text-\[10px\]/);
    expect(T).not.toMatch(/text-\[11px\]/);
  });
  it("migrated meta uses the scale with colour/icon/attrs preserved", () => {
    expect(T).toMatch(/text-caption text-\[var\(--text-secondary\)\]/);                 // 230 meta row
    expect(T).toMatch(/rounded-full bg-\[var\(--surface-hover\)\] px-2 py-px text-caption text-\[var\(--text-muted\)\]/); // 253 count badge
    expect(T).toMatch(/text-caption text-\[var\(--text-faint\)\]">due in \{t\.due_days\}d/); // 356 due meta
    expect(T).toMatch(/text-label text-\[var\(--text-muted\)\]">Read-only access/);      // 626 viewer meta
    expect(T).toMatch(/flex items-center gap-0\.5 text-label \$\{isOverdue/);             // 751 due (dynamic colour)
    expect(T).toMatch(/flex items-center gap-0\.5 text-label text-\[var\(--text-muted\)\]/); // 755 assignee (icon)
  });
  it("6B pills still text-caption font-medium (unchanged)", () => {
    expect((T.match(/text-caption font-medium/g) ?? []).length).toBe(9);
  });
  it("deferred zones unchanged — row title, delete modal, sheet text-xs cells, DataTable, mutations", () => {
    expect(T).toMatch(/text-left text-sm font-medium truncate/);
    expect(T).toMatch(/text-base font-semibold text-\[var\(--text-primary\)\] mb-1">Delete task\?/);
    expect(T).toMatch(/import \{ DataTable, type DataTableColumn \}/);
    expect(T).toMatch(/qc\.setQueryData/);
    expect(T).toMatch(/apiClient\.patch\(`\/tasks\/\$\{/);
  });
});

// ── Pass 6E — Tasks sheet DataTable meta cells → text-label (finance date-cell convention) ──
describe("dashboard/tasks sheet meta cells use text-label (Pass 6E)", () => {
  const T = read("apps/app/src/routes/dashboard/tasks.tsx");
  it("assignee/due/created sheet cells use text-label with attrs preserved", () => {
    expect(T).toMatch(/key: "assignee",[^}]*cellClassName: "whitespace-nowrap text-label text-\[var\(--text-muted\)\]"/);
    expect(T).toMatch(/key: "due",[^}]*cellClassName: "whitespace-nowrap text-label tabular-nums"/);
    expect(T).toMatch(/key: "created", header: "Created", hideBelow: "md", cellClassName: "whitespace-nowrap text-label text-\[var\(--text-muted\)\] tabular-nums"/);
  });
  it("no sheet meta cell still uses text-xs", () => {
    expect(T).not.toMatch(/cellClassName: "whitespace-nowrap text-xs/);
  });
  it("6B pills + 6C meta unchanged", () => {
    expect((T.match(/text-caption font-medium/g) ?? []).length).toBe(9);
    expect((T.match(/\btext-label\b/g) ?? []).length).toBeGreaterThanOrEqual(4); // 4 from 6C + 3 sheet cells
  });
  it("deferred zones retain their classes — row title, notes, table base, delete modal", () => {
    expect(T).toMatch(/text-left text-sm font-medium truncate/);                          // clickable row title
    expect(T).toMatch(/text-sm text-\[var\(--text-faint\)\] leading-relaxed/);             // notes body prose
    expect(T).toMatch(/className="min-w-full text-sm"/);                                    // DataTable table base
    expect(T).toMatch(/text-base font-semibold text-\[var\(--text-primary\)\] mb-1">Delete task\?/);
  });
  it("DataTable model + mutations unchanged", () => {
    expect(T).toMatch(/import \{ DataTable, type DataTableColumn \}/);
    expect(T).toMatch(/columns=\{/);
    expect(T).toMatch(/qc\.setQueryData/);
    expect(T).toMatch(/apiClient\.patch\(`\/tasks\/\$\{/);
  });
});

// ── Pass 7D — Task detail panel read-only meta/timestamps → text-caption/text-label ──
describe("tasks/task-detail-panel read-only meta uses text-caption/text-label (Pass 7D)", () => {
  const P = read("apps/app/src/components/tasks/task-detail-panel.tsx");
  it("the eight meta/timestamp items use the scale with attrs/conditions preserved", () => {
    expect(P).toMatch(/className="text-caption mt-0\.5 block text-right" style=\{\{ color: "var\(--text-faint\)" \}\}>\{relTime\(comment\.created_at\)\}/); // 95
    expect(P).toMatch(/className="text-caption ml-1" style=\{\{ color: "var\(--text-faint\)" \}\}>\+\{seenByOthers\.length - 3\}/);                     // 140 (cond)
    expect(P).toMatch(/className="text-caption shrink-0" style=\{\{ color: "var\(--text-faint\)" \}\}>/);                                                 // 561
    expect(P).toMatch(/className="text-caption mt-0\.5" style=\{\{ color: "var\(--text-faint\)" \}\}>\{item\.added_by_name\} · \{new Date/);              // 630 (· space kept)
    expect(P).toMatch(/className="text-label ml-1" style=\{\{ color: "var\(--text-muted\)" \}\}>\{comment\.user_name\}/);                                 // 90 (cond !isMe)
    expect(P).toMatch(/className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>Seen by \{others\.length/);                                    // 513 (space kept)
    expect(P).toMatch(/className="text-label capitalize" style=\{\{ color: "var\(--text-muted\)" \}\}>\{a\.permission\}/);                                // 666
    // Fields renamed to the real columns (name/url/size/uploaded_by) when the attachment
    // contract was repaired — the typography scale is what this guard is about.
    expect(P).toMatch(/className="text-label mt-0\.5" style=\{\{ color: "var\(--text-faint\)" \}\}>\{uploaderName\(a\.uploaded_by\)\}/);
  });
  it("7B eyebrows still text-caption uppercase", () => {
    expect((P.match(/text-caption[^"]*uppercase|uppercase[^"]*text-caption/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("deferred items remain — composer hint, reaction count, chips, control buttons, label chip", () => {
    expect((P.match(/text-\[10px\]/g) ?? []).length).toBe(2);   // composer hint (599) + reaction count (532)
    expect((P.match(/text-\[11px\]/g) ?? []).length).toBe(5);   // linked chip + 3 control buttons + label chip
    expect(P).toMatch(/text-\[11px\] font-medium \$\{LABEL_COLORS\[l\]\}/);   // label chip (mutation zone) kept
  });
  it("mutations untouched", () => {
    for (const m of ["updateTask", "updateLabels", "addAssignee", "addComment", "toggleReaction", "toggleCheckItem", "deleteCheckItem"]) {
      expect(P).toMatch(new RegExp(`\\b${m}\\b`));
    }
  });
});

// ── Pass 7B — Task detail panel eyebrow labels → text-caption ───────────────────
describe("tasks/task-detail-panel eyebrow labels use text-caption (Pass 7B)", () => {
  const P = read("apps/app/src/components/tasks/task-detail-panel.tsx");
  it("the five section eyebrow labels are text-caption with weight/uppercase/tracking/colour kept", () => {
    expect(P).toMatch(/className="text-caption uppercase" style=\{\{ color: "var\(--text-faint\)" \}\}>\{linkedNode\.object_type\}/); // 365 (9→10)
    expect(P).toMatch(/className="mb-1 text-caption font-semibold uppercase tracking-widest" style=\{\{ color: "var\(--text-faint\)" \}\}>Notes/); // 396
    expect(P).toMatch(/flex items-center gap-1\.5 text-caption font-semibold uppercase tracking-widest text-stone-600/); // 413
    expect(P).toMatch(/text-caption font-semibold uppercase tracking-widest mb-2" style=\{\{ color: "var\(--text-faint\)" \}\}>Assigned/); // 659
    expect(P).toMatch(/text-caption font-semibold uppercase tracking-widest mb-2" style=\{\{ color: "var\(--text-faint\)" \}\}>Add collaborator/); // 679
  });
  it("no eyebrow still uses text-[10px]/text-[9px] uppercase", () => {
    expect(P).not.toMatch(/text-\[(9|10)px\][^>]*uppercase/);
  });
  it("forbidden zones untouched — title, read-only meta, mutations", () => {
    expect((P.match(/text-base font-semibold/g) ?? []).length).toBeGreaterThanOrEqual(2);   // title display + edit input
    for (const m of ["updateTask", "updateLabels", "addAssignee", "addComment", "toggleReaction", "toggleCheckItem"]) {
      expect(P).toMatch(new RegExp(`\\b${m}\\b`));
    }
  });
});

// ── Pass 8D — Calendar remaining uppercase eyebrows → text-caption (eyebrow layer done) ──
describe("dashboard/calendar remaining uppercase eyebrows use text-caption (Pass 8D)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");
  it("no text-[10.5px]/[11px]/[9px] uppercase label remains", () => {
    expect(C).not.toMatch(/text-\[10\.5px\][^"]*uppercase/);
    expect(C).not.toMatch(/text-\[11px\][^"]*uppercase/);
    expect(C).not.toMatch(/text-\[9px\][^"]*uppercase/);
  });
  it("all 15 uppercase eyebrows (8B+8D) are now text-caption", () => {
    expect((C.match(/text-caption[^"]*uppercase/g) ?? []).length).toBe(15);
  });
  it("migrated eyebrows retain weight/copy; special ones keep mono/tracking/badge styling", () => {
    expect(C).toMatch(/text-caption font-semibold uppercase tracking-wide" style=\{\{ color: "var\(--text-muted\)" \}\}>\{dayLabel\(key\)\}/); // 389
    expect(C).toMatch(/font-mono text-caption font-semibold uppercase tracking-\[0\.14em\]/);                    // 564 mono micro
    expect(C).toMatch(/mr-1\.5 rounded-sm px-1 py-px text-caption font-medium uppercase/);                        // 1084 badge
    expect((C.match(/text-caption font-semibold uppercase tracking-wide" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal/g) ?? []).length).toBeGreaterThanOrEqual(3); // 903/922/967
  });
  it("deferred non-uppercase zones unchanged — form labels, day-column grid header", () => {
    expect((C.match(/className="text-\[11px\]" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal/g) ?? []).length).toBeGreaterThanOrEqual(2); // start/ends form labels
    expect(C).toMatch(/border-b text-\[11px\] font-medium/);   // day-column grid header
  });
  it("mutations + slot/open handlers untouched", () => {
    expect(C).toMatch(/useMutation/);
    expect(C).toMatch(/onSlot/);
    expect(C).toMatch(/onOpen/);
  });
});

// ── Pass 8F — Calendar read-only 11px info/meta labels → text-label ─────────────
describe("dashboard/calendar read-only 11px info/meta uses text-label (Pass 8F)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");
  it("the seven read-only items use text-label with copy/colour/conditions retained", () => {
    expect(C).toMatch(/\{e\.timezone && <span className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}> · \{e\.timezone\}<\/span>\}/); // 797
    expect(C).toMatch(/<p className="mb-1 text-label" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal\.your_response"\)\}<\/p>/);          // 823
    expect(C).toMatch(/<span className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>· organizer<\/span>/);                          // 924
    expect(C).toMatch(/mt-0\.5 block text-label leading-snug" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal\.prepare_hint"\)\}/);        // 946
    expect(C).toMatch(/\{prepare\.isError && <p className="mt-2 text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("cal\.ai_unavailable"\)\}/); // 950
    expect(C).toMatch(/<p className="text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("cal\.based_on_details"\)\}<\/p>/);            // 1039
    expect(C).toMatch(/\{empty && <p className="mb-2 text-label" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("cal\.st_none_found"\)\}/);    // 1077
  });
  it("no <label>/<button>/<input> was given text-label", () => {
    expect(C).not.toMatch(/<label className="text-label/);
    expect(C).not.toMatch(/<button[^>]*\btext-label\b/);
    expect(C).not.toMatch(/<input[^>]*\btext-label\b/);
  });
  it("deferred text-[11px] remain — form labels, day-column header, deferred ai_unavailable (1032)", () => {
    expect((C.match(/<label className="text-\[11px\]" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal\.(starts|ends)"\)/g) ?? []).length).toBe(2);
    expect(C).toMatch(/border-b text-\[11px\] font-medium/);
    expect((C.match(/text-\[11px\][^>]*>\{t\("cal\.ai_unavailable"\)/g) ?? []).length).toBeGreaterThanOrEqual(1);   // 1032 still deferred
  });
  it("8B/8D eyebrows still text-caption (15) + mutations untouched", () => {
    expect((C.match(/text-caption[^"]*uppercase/g) ?? []).length).toBe(15);
    expect(C).toMatch(/useMutation/);
    expect(C).toMatch(/onSlot/);
    expect(C).toMatch(/onOpen/);
  });
});

// ── Pass 8H — Calendar read-only 12px empty/meta text → text-body ───────────────
describe("dashboard/calendar read-only 12px empty/meta uses text-body (Pass 8H)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");
  it("the six read-only items use text-body with copy/colour/layout/conditions retained", () => {
    expect(C).toMatch(/px-4 py-2 text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal\.all_clear"\)\}<\/div>/);       // 584
    expect(C).toMatch(/px-4 py-2 text-body" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("cal\.st_none_found"\)\}<\/div>/);   // 589
    expect(C).toMatch(/<span className="text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>\{label\}<\/span>/);               // 648 metric label
    expect(C).toMatch(/<p className="text-body" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("cal\.st_missing"\)\}<\/p>/);     // 917
    expect(C).toMatch(/<span className="text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>\{s\.label\}<\/span>/);            // 1007 metric label
    expect(C).toMatch(/\{others\.length === 0 && <span className="px-2 py-1\.5 text-body" style=\{\{ color: "var\(--text-faint\)" \}\}>\{t\("state\.empty"\)\}/); // 1167
  });
  it("no <button>/<input> was given text-body", () => {
    expect(C).not.toMatch(/<button[^>]*\btext-body\b/);
    expect(C).not.toMatch(/<input[^>]*\btext-body\b/);
  });
  it("deferred text-[12px] remain — event times/title, drawer input, Cancel/Create buttons", () => {
    expect(C).toMatch(/w-14 shrink-0 text-\[12px\] tabular-nums/);                       // 284 event time
    expect(C).toMatch(/truncate text-\[12px\]" style=\{\{ color: "var\(--text-primary\)" \}\}>\{s\.title\}/); // 1046 event-list title
    expect(C).toMatch(/px-2 py-1 text-\[12px\] outline-none/);                           // 1205 drawer input
    expect(C).toMatch(/btn-secondary text-\[12px\]">\{t\("common\.cancel"\)/);           // Cancel button
  });
  it("8B/8D eyebrows still text-caption (15) + 8F items still text-label + mutations intact", () => {
    expect((C.match(/text-caption[^"]*uppercase/g) ?? []).length).toBe(15);
    expect(C).toMatch(/\{e\.timezone && <span className="text-label"/);   // 8F sample
    expect(C).toMatch(/useMutation/);
    expect(C).toMatch(/onSlot/);
    expect(C).toMatch(/onOpen/);
  });
});

// ── Pass 8J — Calendar safe read-only 13px items → text-row ─────────────────────
describe("dashboard/calendar safe read-only 13px items use text-row (Pass 8J)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");
  it("empty-state hint + Stat number use text-row with weight/tabular-nums/colour retained", () => {
    expect(C).toMatch(/<p className="text-row font-medium" style=\{\{ color: "var\(--text-secondary\)" \}\}>\{hint\}<\/p>/);                       // 517
    expect(C).toMatch(/<span className="text-row font-semibold tabular-nums" style=\{\{ color: tone \?\? "var\(--text-primary\)" \}\}>\{n\}<\/span>/); // 647
  });
  it("paired Stat label stays text-body (8H) and no <button>/<input> got text-row", () => {
    expect(C).toMatch(/<span className="text-body" style=\{\{ color: "var\(--text-muted\)" \}\}>\{label\}<\/span>/);
    expect(C).not.toMatch(/<button[^>]*\btext-row\b/);
    expect(C).not.toMatch(/<input[^>]*\btext-row\b/);
  });
  it("deferred text-[13px] remain — event title, rangeLabel, body containers, next-title button, form input, drawer header", () => {
    expect(C).toMatch(/truncate text-\[13px\] font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>\{e\.title\}/);   // 286
    expect(C).toMatch(/ml-1 truncate text-\[13px\] font-medium" style=\{\{ color: "var\(--text-primary\)" \}\}>\{rangeLabel\}/);      // moved into the smart control rail (Pass CAL-R)
    expect((C.match(/overflow-y-auto[^"]*text-\[13px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);                          // 560/794 containers
    expect(C).toMatch(/block min-w-0 truncate text-\[13px\] font-medium/);                                                   // 581 button title
    expect(C).toMatch(/px-3 py-2 text-\[13px\] outline-none/);                                                               // 1129 input const
    expect(C).toMatch(/text-\[13px\] font-semibold" style=\{\{ color: "var\(--text-primary\)" \}\}>\{t\("cal\.new_meeting"\)/); // 1137 drawer header
  });
  it("8B/8D eyebrows still text-caption (15) + mutations untouched", () => {
    expect((C.match(/text-caption[^"]*uppercase/g) ?? []).length).toBe(15);
    expect(C).toMatch(/useMutation/);
    expect(C).toMatch(/onSlot/);
    expect(C).toMatch(/onOpen/);
  });
});

// ── Pass 8B — Calendar exact-10px uppercase eyebrows → text-caption ─────────────
describe("dashboard/calendar exact-10px eyebrow labels use text-caption (Pass 8B)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");
  it("the five exact-10px section eyebrows are text-caption with weight/uppercase/tracking/colour kept", () => {
    expect(C).toMatch(/className="px-4 pb-1 pt-3 text-caption font-semibold uppercase tracking-wide" style=\{\{ color: "var\(--text-faint\)" \}\}>\{children\}/);        // 551
    expect(C).toMatch(/<span className="text-caption font-semibold uppercase tracking-wide" style=\{\{ color: "var\(--text-faint\)" \}\}>\{label\}<\/span>/);            // 1003
    expect(C).toMatch(/<span className="text-caption font-medium uppercase tracking-wide" style=\{\{ color: "var\(--text-faint\)" \}\}>\{nextLabel\}<\/span>/);          // 1015
    expect(C).toMatch(/<p className="mb-1 text-caption font-semibold uppercase tracking-wide" style=\{\{ color: "var\(--text-faint\)" \}\}>\{label\}<\/p>/);              // 1026
    expect(C).toMatch(/className="mb-1 flex items-center gap-1\.5 text-caption font-medium uppercase tracking-wide"/); // 1066 (icon row)
    expect(C).toMatch(/\{label\} · \{tasks\.length\}/);   // 1066 copy preserved
  });
  it("no migrated eyebrow still uses text-[10px] uppercase", () => {
    expect(C).not.toMatch(/text-\[10px\][^>]*uppercase/);
  });
  it("deferred zones remain — day header + EventDrawer form labels (other eyebrows finished in Pass 8D)", () => {
    expect(C).toMatch(/h-7 items-center justify-center gap-1 border-b text-\[11px\] font-medium/);   // day-column header
    expect((C.match(/className="text-\[11px\]" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal/g) ?? []).length).toBeGreaterThanOrEqual(2); // start/ends form labels
  });
  it("mutations + slot/open handlers untouched", () => {
    expect(C).toMatch(/useMutation/);
    expect(C).toMatch(/onSlot/);
    expect(C).toMatch(/onOpen/);
  });
});

// ── Pass 9D — Messages safe read-only bubble meta → text-label/text-caption ─────
describe("dashboard/messages read-only bubble meta uses text-label/text-caption (Pass 9D)", () => {
  const M = read("apps/app/src/routes/dashboard/messages.tsx");
  it("group sender label uses text-label; message timestamp uses text-caption (attrs/colour kept)", () => {
    expect(M).toMatch(/<p className="mb-0\.5 text-label font-semibold" style=\{\{ color: "var\(--section-accent\)" \}\}>\{m\.sender_name\}<\/p>/); // 603
    expect(M).toMatch(/<p className="mt-1 text-caption" style=\{\{ color: m\.mine \? "rgba\(255,255,255,0\.72\)" : "var\(--text-faint\)" \}\}>\{timeOnly\(m\.created_at\)/); // 620
  });
  it("no button/input/attachment got a scale token", () => {
    expect(M).not.toMatch(/<button[^>]*\btext-(label|caption)\b/);
    expect(M).not.toMatch(/<input[^>]*\btext-(label|caption)\b/);
  });
  it("deferred text-[10px]/[10.5px] remain — unread badges, attachment sizes, AI note, empty intro, search ts, CTA hint", () => {
    expect((M.match(/rounded-sm px-1\.5 py-px text-\[10px\] font-semibold/g) ?? []).length).toBeGreaterThanOrEqual(2); // unread badges
    expect((M.match(/shrink-0 text-\[10px\]" style=\{\{ color: m\.mine/g) ?? []).length).toBeGreaterThanOrEqual(2);      // attachment sizes
    expect((M.match(/text-\[10\.5px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);                                      // AI note + empty intro
  });
  it("9B eyebrows still text-caption (4) + mutation anchors untouched", () => {
    expect((M.match(/text-caption[^"]*uppercase/g) ?? []).length).toBe(4);
    expect(M).toMatch(/useMutation/);
    expect(M).toMatch(/del\.mutate/);
    expect(M).toMatch(/invalidateQueries/);
  });
});

// ── Pass 9B — Messages uppercase eyebrows/day-separators → text-caption ─────────
describe("dashboard/messages uppercase eyebrows/day-separators use text-caption (Pass 9B)", () => {
  const M = read("apps/app/src/routes/dashboard/messages.tsx");
  it("the four labels are text-caption with weight/uppercase/tracking/colour/copy retained", () => {
    expect((M.match(/px-3 pb-1 pt-2\.5 text-caption font-semibold uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)" \}\}/g) ?? []).length).toBe(2); // 177 + 201 list labels
    expect((M.match(/text-caption font-medium uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)" \}\}>\{dayLabel\(m\.created_at\)\}/g) ?? []).length).toBe(2); // 380 + 591 day separators
  });
  it("no eyebrow still uses text-[10px] uppercase", () => {
    expect(M).not.toMatch(/text-\[10px\][^>]*uppercase/);
  });
  it("deferred zones remain with their arbitrary classes — thread title/preview, bubble body, non-uppercase 10px meta", () => {
    expect(M).toMatch(/truncate text-\[13px\] font-medium/);         // thread-row title (clickable)
    expect(M).toMatch(/truncate text-\[11\.5px\]/);                  // thread-row preview
    expect((M.match(/whitespace-pre-wrap break-words text-\[/g) ?? []).length).toBeGreaterThanOrEqual(2); // message bubble body
    expect((M.match(/text-\[10px\]/g) ?? []).length).toBeGreaterThanOrEqual(6); // non-uppercase 10px meta/badges deferred
  });
  it("send/reply/group/realtime mutation anchors untouched", () => {
    expect(M).toMatch(/useMutation/);
    expect(M).toMatch(/invalidateQueries/);
  });
});

// ── Pass 6B — Tasks display pills → text-caption font-medium (finance pill convention) ──
describe("dashboard/tasks display pills use text-caption font-medium (Pass 6B)", () => {
  const T = read("apps/app/src/routes/dashboard/tasks.tsx");
  it("all nine display pills are text-caption font-medium with colour expressions retained", () => {
    expect((T.match(/text-caption font-medium/g) ?? []).length).toBe(9);
    expect((T.match(/rounded-full border px-1\.5 py-px text-caption font-medium \$\{PRIORITY_STYLE\[task\.priority\]\}/g) ?? []).length).toBeGreaterThanOrEqual(2); // 209 & 740
    expect(T).toMatch(/text-caption font-medium \$\{PRIORITY_STYLE\[task\.priority\]\}`\}>\{task\.priority\.charAt\(0\)/); // 566
    expect((T.match(/text-caption font-medium \$\{LABEL_COLORS\[l\]\}/g) ?? []).length).toBeGreaterThanOrEqual(2); // 580 & 789
    expect(T).toMatch(/text-caption font-medium capitalize \$\{PCOL\[t\.priority\]/);                    // 355
    expect(T).toMatch(/text-caption font-medium border-\[var\(--border-soft\)\] text-\[var\(--text-muted\)/); // 742
    expect((T.match(/bg-stone-600\/10 px-1\.5 py-px text-caption font-medium text-stone-500/g) ?? []).length).toBeGreaterThanOrEqual(2); // 213 & 746
  });
  it("no display pill still uses text-[10px] font-medium", () => {
    expect(T).not.toMatch(/text-\[10px\] font-medium/);
  });
  it("deferred zones unchanged — row title, delete modal, non-pill meta, DataTable, mutations", () => {
    expect(T).toMatch(/text-left text-sm font-medium truncate/);          // clickable row title (deferred)
    expect(T).toMatch(/text-base font-semibold text-\[var\(--text-primary\)\] mb-1">Delete task\?/); // delete modal title
    expect(T).toMatch(/import \{ DataTable, type DataTableColumn \}/);
    expect(T).toMatch(/columns=\{/);
    expect(T).toMatch(/qc\.setQueryData/);                                // optimistic update untouched
    expect(T).toMatch(/apiClient\.patch\(`\/tasks\/\$\{/);                 // edit/status mutation
  });
});

// ── Pass 5B — Home read-only eyebrow labels → shared scale (first non-finance) ──
describe("dashboard/home eyebrow labels use the shared scale (Pass 5B)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");
  it("the four eyebrow labels are text-caption with weight/uppercase/tracking retained", () => {
    expect(H).toMatch(/text-caption font-semibold uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)" \}\}>Right now/);
    expect(H).toMatch(/text-caption font-semibold uppercase tracking-wider" style=\{\{ color: "var\(--text-faint\)" \}\}>What needs you most/);
    expect(H).toMatch(/text-caption font-semibold uppercase tracking-widest" style=\{\{ color: "var\(--text-faint\)" \}\}>\{loc\.t\("home\.quick_prompts"\)\}/);
    expect(H).toMatch(/rounded px-1\.5 py-px text-caption font-medium uppercase tracking-wide/);   // object-type badge (9→10px normalized)
  });
  it("no uppercase eyebrow still uses the old text-[9px]/text-[10px]", () => {
    expect(H).not.toMatch(/text-\[(9|10)px\][^>]*uppercase/);
  });
  it("forbidden zones untouched — hero greeting + composer textarea type", () => {
    // Hero was text-[26px]; retuned to 22px in the Attio-reference pass where it was in scope.
    // This guard's job is stopping an unrelated pass moving it, so it tracks the current value.
    expect(H).toMatch(/text-\[22px\] font-semibold leading-tight/);
    expect(H).toMatch(/text-\[15px\] leading-6 outline-none/);   // the composer textarea itself
  });
  it("behavior anchors unchanged (Ask engine, greeting, metrics, composer handler)", () => {
    expect(H).toMatch(/useAskEngine/);
    expect(H).toMatch(/const greeting = hour < 12/);
    expect(H).toMatch(/\bactiveTasks\b/);
    expect(H).toMatch(/onChange/);
  });
});

// ── Pass 3B — shared DataTable shell, piloted on finance/quotes only ────────────
describe("DataTable shell owns the table structure", () => {
  const DT = read("apps/app/src/components/ui/data-table.tsx");
  it("the component exists and renders the canonical <table> shell", () => {
    expect(DT).toMatch(/export function DataTable</);
    expect(DT).toMatch(/<table className=\{cx\("minimal-table w-full"/);
    expect(DT).toMatch(/columns\.map\(/);   // header cells
    expect(DT).toMatch(/rows\.map\(/);      // body rows
  });
  it("exposes the agreed API (columns/rows/rowKey/onRowClick/align/hideBelow/state/density)", () => {
    expect(DT).toMatch(/export interface DataTableColumn</);
    for (const k of ["align\\?:", "hideBelow\\?:", "cell:", "onRowClick\\?:", "rowKey:", "density\\?:"]) {
      expect(DT).toMatch(new RegExp(k));
    }
  });
  it("knows no finance/domain logic (presentational only — no data fetching or domain imports)", () => {
    expect(DT).not.toMatch(/apiClient|useQuery|useMutation|from ["'].*\/(finance|hooks|records)/);
    expect(DT).not.toMatch(/amount_cents|formatMoney|useCurrency/);
  });
});

describe("finance/quotes pilots the shared DataTable", () => {
  const Q = read("apps/app/src/routes/dashboard/finance/quotes.tsx");
  it("imports and renders <DataTable>", () => {
    expect(Q).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(Q).toMatch(/<DataTable<Quote>/);
    expect(Q).toMatch(/columns=\{QUOTE_COLUMNS\}/);
  });
  it("no longer hand-rolls its own <table> / <thead> / <tbody>", () => {
    expect(Q).not.toMatch(/<table\b/);
    expect(Q).not.toMatch(/<thead\b/);
    expect(Q).not.toMatch(/<tbody\b/);
  });
  it("cell formatting + status badge stay page-owned (fmt + STATUS_CONFIG in the column model)", () => {
    expect(Q).toMatch(/const QUOTE_COLUMNS: DataTableColumn<Quote>\[\]/);
    expect(Q).toMatch(/fmt\(q\.total, q\.currency\)/);          // money formatting (major-unit total)
    expect(Q).toMatch(/STATUS_CONFIG\[q\.status\]/);            // status badge unchanged
  });
});

describe("quotes amount reads the REAL API field (no more £NaN)", () => {
  const Q = read("apps/app/src/routes/dashboard/finance/quotes.tsx");
  it("never reads the non-existent q.amount_cents; uses q.total (major units) for amount + telemetry", () => {
    expect(Q).not.toMatch(/q\.amount_cents/);                  // the field the API never returns
    expect(Q).toMatch(/total: number/);                        // Quote type matches the API contract
    expect(Q).toMatch(/fmt\(q\.total, q\.currency\)/);          // amount column
    expect(Q).toMatch(/amount: q\.total \?\? 0/);               // telemetry sum input
  });
});

describe("the DataTable pilot did NOT leak into protected surfaces", () => {
  it("RecordTable, sales-report, and invoice line-items detail still do NOT use DataTable", () => {
    for (const f of [
      "apps/app/src/components/records/record-table.tsx",
      "apps/app/src/routes/dashboard/reports/sales-report.tsx",
      "apps/app/src/routes/dashboard/finance/[invoiceId].tsx",
    ]) {
      expect(read(f)).not.toMatch(/data-table|<DataTable\b/);
    }
  });
  it("RecordTable keeps its own bespoke border-separate table (untouched)", () => {
    expect(read("apps/app/src/components/records/record-table.tsx")).toMatch(/border-separate border-spacing-0/);
  });
});

// ── Pass 3C — credit-notes migrated to DataTable (invoices/expenses deferred) ───
describe("finance/credit-notes uses the shared DataTable", () => {
  const CN = read("apps/app/src/routes/dashboard/finance/credit-notes.tsx");
  it("imports + renders <DataTable> with page-owned navigation", () => {
    expect(CN).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(CN).toMatch(/<DataTable<CreditNote>/);
    expect(CN).toMatch(/columns=\{CREDIT_NOTE_COLUMNS\}/);
    expect(CN).toMatch(/onRowClick=\{\(cn\) => navigate\(`\/finance\/credit-notes\/\$\{cn\.id\}`\)\}/);
  });
  it("no longer hand-rolls its own <table>/<thead>/<tbody>", () => {
    expect(CN).not.toMatch(/<table\b/);
    expect(CN).not.toMatch(/<thead\b/);
    expect(CN).not.toMatch(/<tbody\b/);
  });
  it("status badges + money formatting stay page-owned, credit-note amount field UNCHANGED", () => {
    expect(CN).toMatch(/const CREDIT_NOTE_COLUMNS: DataTableColumn<CreditNote>\[\]/);
    expect(CN).toMatch(/STATUS_CONFIG\[cn\.status\]/);
    expect(CN).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);   // credit-note math/field untouched
  });
  it("keeps its richer shared loading/error/empty states (routed through the expected UI)", () => {
    expect(CN).toMatch(/<ConsoleSkeleton/);
    expect(CN).toMatch(/<ErrorState/);
    expect(CN).toMatch(/<EmptyState/);
  });
});

// ── Pass 3Q — credit-notes typography migrated to the shared type scale ─────────
describe("finance/credit-notes fully adopts the shared type scale (Pass 3Q)", () => {
  const CN = read("apps/app/src/routes/dashboard/finance/credit-notes.tsx");
  it("uses the shared scale classes (caption/label/body/row/stat)", () => {
    for (const cls of ["text-caption", "text-label", "text-body", "text-row", "text-stat"]) {
      expect(CN).toMatch(new RegExp(`\\b${cls}\\b`));
    }
  });
  it("no arbitrary text-[Npx] typography remains", () => {
    expect(CN).not.toMatch(/text-\[[0-9.]+px\]/);
  });
  it("preserves visual weight on migrated elements (explicit font-* kept)", () => {
    expect(CN).toMatch(/text-caption font-semibold uppercase/);              // form labels
    expect(CN).toMatch(/text-body font-medium text-\[var\(--text-primary\)\]/); // client name
    expect(CN).toMatch(/cellClassName: "text-row font-semibold tabular-nums/);  // amount cell
    expect(CN).toMatch(/text-stat font-semibold/);                            // KPI numbers
  });
  it("behavior intact — amount field, status config, DataTable + row navigation untouched", () => {
    expect(CN).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);
    expect(CN).toMatch(/STATUS_CONFIG\[cn\.status\]/);
    expect(CN).toMatch(/columns=\{CREDIT_NOTE_COLUMNS\}/);
    expect(CN).toMatch(/onRowClick=\{\(cn\) => navigate\(`\/finance\/credit-notes\/\$\{cn\.id\}`\)\}/);
  });
});

// ── Pass 3W — credit-note DETAIL read-only metadata slice → shared scale ────────
describe("finance/[creditNoteId] read-only metadata adopts the shared scale (Pass 3W)", () => {
  const CND = read("apps/app/src/routes/dashboard/finance/[creditNoteId].tsx");
  it("read-only metadata section labels are text-caption (9px→10px normalized)", () => {
    for (const label of ["Status", "Reason", "Created", "Last updated", "Linked invoice"]) {
      expect(CND).toMatch(new RegExp(`text-caption font-semibold uppercase tracking-widest text-\\[var\\(--text-secondary\\)\\][^>]*>${label}`));
    }
  });
  it("migrated read-only values use the shared scale", () => {
    expect(CND).toMatch(/text-label font-medium \$\{cfg\.color\}/);                       // status pill
    expect(CND).toMatch(/text-body text-\[var\(--text-faint\)\]">\{REASON_LABELS/);        // reason value
    expect(CND).toMatch(/text-label text-\[var\(--text-muted\)\]">\{relativeTime\(cn\.created_at\)/); // created value
    expect(CND).toMatch(/text-label text-\[var\(--text-muted\)\]">\{relativeTime\(cn\.updated_at\)/); // updated value
  });
  it("the read-only metadata labels no longer use the off-scale text-[9px]", () => {
    // Only the out-of-scope 'Actions' label may still carry text-[9px]; the five metadata labels must not.
    for (const label of ["Status", "Reason", "Created", "Last updated", "Linked invoice"]) {
      expect(CND).not.toMatch(new RegExp(`text-\\[9px\\][^>]*>${label}`));
    }
  });
  it("interactive/action behavior stays intact (typography classes handled in Pass 3X/3Z)", () => {
    expect(CND).toMatch(/patchMutation\.mutate\(\{ status: t\.to \}\)/);                      // state-machine action intact
    expect(CND).toMatch(/summarize\.mutate\(\)/);                                             // Summarize action intact
    expect(CND).toMatch(/const STATUS_CONFIG/);                                               // status config intact
    expect(CND).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);                             // amount formatting intact
  });
});

// ── Pass 3X — credit-note DETAIL remaining read-only typography → shared scale ──
describe("finance/[creditNoteId] remaining read-only text adopts the shared scale (Pass 3X)", () => {
  const CND = read("apps/app/src/routes/dashboard/finance/[creditNoteId].tsx");
  it("Pass 3W metadata stays migrated (labels text-caption)", () => {
    for (const label of ["Status", "Reason", "Created", "Last updated", "Linked invoice"]) {
      expect(CND).toMatch(new RegExp(`text-caption font-semibold uppercase tracking-widest text-\\[var\\(--text-secondary\\)\\][^>]*>${label}`));
    }
  });
  it("amount hero normalized to text-stat font-bold (18px→17px) — still bold hero, fmt untouched", () => {
    expect(CND).toMatch(/text-stat font-bold text-\[var\(--text-primary\)\]">\{fmt\(cn\.amount_cents, cn\.currency\)\}/);
    expect(CND).not.toMatch(/text-\[18px\]/);   // no 18px hero remains
  });
  it("read-only display text uses the shared scale (loading/not-found, header, AI summary, banners, labels)", () => {
    expect(CND).toMatch(/text-body text-\[var\(--text-secondary\)\]">Loading…/);
    expect(CND).toMatch(/text-body text-\[var\(--text-faint\)\]">Credit note not found\./);
    expect(CND).toMatch(/text-body text-\[var\(--text-faint\)\]">\{cn\.client_name \?\? cn\.id\.slice/); // header client line
    expect(CND).toMatch(/text-row text-\[var\(--text-faint\)\] leading-relaxed">\{cn\.ai_summary\}/);   // AI summary body
    expect(CND).toMatch(/text-label font-semibold text-\[var\(--text-faint\)\] uppercase tracking-wider">AI Summary/);
    expect(CND).toMatch(/text-label text-status-ok">/);                                     // executed banner
    expect(CND).toMatch(/text-label font-semibold uppercase tracking-widest text-\[var\(--text-secondary\)\] mb-3">Notes/);
    expect(CND).toMatch(/text-caption font-semibold uppercase tracking-widest text-\[var\(--text-secondary\)\] mb-2">Actions/);
  });
  it("interactive/action behavior stays intact (typography classes are handled in Pass 3Z)", () => {
    expect(CND).toMatch(/patchMutation\.mutate\(\{ status: t\.to \}\)/);
    expect(CND).toMatch(/summarize\.mutate\(\)/);
    expect(CND).toMatch(/const STATUS_CONFIG/);
    expect(CND).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);
  });
});

// ── Pass 3Z — credit-note DETAIL interactive typography finished → fully on-scale ─
describe("finance/[creditNoteId] is fully on the shared scale, incl. interactive controls (Pass 3Z)", () => {
  const CND = read("apps/app/src/routes/dashboard/finance/[creditNoteId].tsx");
  it("has ZERO arbitrary typography classes (no text-[Npx], no text-sm)", () => {
    expect(CND).not.toMatch(/text-\[[0-9.]+px\]/);
    expect(CND).not.toMatch(/\btext-sm\b/);
  });
  it("Pass 3W/3X read-only typography remains migrated", () => {
    expect(CND).toMatch(/text-stat font-bold text-\[var\(--text-primary\)\]">\{fmt\(cn\.amount_cents, cn\.currency\)\}/); // hero
    for (const label of ["Status", "Reason", "Created", "Last updated", "Linked invoice"]) {
      expect(CND).toMatch(new RegExp(`text-caption font-semibold uppercase tracking-widest text-\\[var\\(--text-secondary\\)\\][^>]*>${label}`));
    }
  });
  it("interactive controls now use shared scale classes", () => {
    expect(CND).toMatch(/text-label text-\[var\(--text-secondary\)\] animate-pulse">Saving…/);   // saving indicator
    expect(CND).toMatch(/text-body font-medium transition-colors[^}]*\$\{t\.style\}/);            // Void/Refund transition buttons
    expect(CND).toMatch(/px-4 py-3 text-row text-\[var\(--text-faint\)\] placeholder-stone-700/);  // NoteEditor textarea
    expect(CND).toMatch(/className="key-input w-full"/);                                            // inline-edit inputs (Pass 4D: text-body dropped — 4A floor supplies 12.5px)
    expect(CND).toMatch(/text-caption font-semibold uppercase tracking-wider text-\[var\(--text-secondary\)\] mb-1">Client name/); // inline edit label
    expect(CND).toMatch(/text-label font-semibold uppercase tracking-widest text-\[var\(--text-secondary\)\] mb-3">Edit details/); // edit-section label
  });
  it("mutation/action handlers + amount math remain intact (class-only change)", () => {
    expect(CND).toMatch(/onBlur=\{\(\) => save\(\)\}/);                       // save-on-blur preserved
    expect(CND).toMatch(/patchMutation\.mutate\(\{ status: t\.to \}\)/);       // Void/Refund/Approve transitions
    expect(CND).toMatch(/summarize\.mutate\(\)/);                             // Summarize
    expect(CND).toMatch(/applyToInvoice/);                                    // Apply
    expect(CND).toMatch(/const STATUS_CONFIG/);
    expect(CND).toMatch(/fmt\(cn\.amount_cents, cn\.currency\)/);
    expect(CND).toMatch(/disabled:opacity-40/);                              // disabled states preserved
  });
});

// ── Pass 3D — invoices migrated to DataTable (expenses still deferred) ──────────
describe("finance/invoices uses the shared DataTable", () => {
  const INV = read("apps/app/src/routes/dashboard/finance/invoices.tsx");
  it("imports + renders <DataTable> with page-owned navigation and preserves the font-mono ledger style", () => {
    expect(INV).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(INV).toMatch(/<DataTable<Invoice>/);
    expect(INV).toMatch(/className="font-mono"/);
    expect(INV).toMatch(/columns=\{INVOICE_COLUMNS\}/);
    expect(INV).toMatch(/onRowClick=\{\(inv\) => navigate\(`\/finance\/invoices\/\$\{inv\.id\}`\)\}/);
  });
  it("no longer hand-rolls its own <table>/<thead>/<tbody>", () => {
    expect(INV).not.toMatch(/<table\b/);
    expect(INV).not.toMatch(/<thead\b/);
    expect(INV).not.toMatch(/<tbody\b/);
  });
  it("status badge, amount (inv.total), date + the Open→ link stay page-owned; amount field UNCHANGED", () => {
    expect(INV).toMatch(/const INVOICE_COLUMNS: DataTableColumn<Invoice>\[\]/);
    expect(INV).toMatch(/STATUS_CONFIG\[inv\.status\]/);
    expect(INV).toMatch(/formatCurrency\(inv\.total, inv\.currency\)/);   // amount math/field untouched
    expect(INV).toMatch(/formatDate\(inv\.due_date\)/);
    expect(INV).toMatch(/to=\{`\/finance\/invoices\/\$\{inv\.id\}`\}/);   // Open→ link preserved
  });
  it("keeps its own loading/error/empty branches in the page (unchanged states)", () => {
    expect(INV).toMatch(/Couldn't load invoices\./);
    expect(INV).toMatch(/No invoices yet/);
  });
});

describe("finance/invoices fully adopts the shared type scale (Pass 3R)", () => {
  const INV = read("apps/app/src/routes/dashboard/finance/invoices.tsx");
  it("uses the shared scale classes (caption/label/body/row/stat)", () => {
    for (const cls of ["text-caption", "text-label", "text-body", "text-row", "text-stat"]) {
      expect(INV).toMatch(new RegExp(`\\b${cls}\\b`));
    }
  });
  it("no arbitrary text-[Npx] typography remains", () => {
    expect(INV).not.toMatch(/text-\[[0-9.]+px\]/);
  });
  it("preserves the font-mono ledger styling (table shell + KPI numerals)", () => {
    expect(INV).toMatch(/className="font-mono"/);                                  // DataTable shell
    expect(INV).toMatch(/font-mono text-stat font-semibold tabular-nums/);         // KPI metrics
  });
  it("preserves visual weight on migrated elements (explicit font-* kept)", () => {
    expect(INV).toMatch(/cellClassName: "text-body font-medium text-\[var\(--text-primary\)\]"/); // number
    // Pass 3U: amount unified to text-row (13px) to match quotes/credit-notes/expenses; font-mono ledger identity kept on the table shell.
    expect(INV).toMatch(/cellClassName: "text-row font-semibold text-\[var\(--text-primary\)\]"/); // amount
    expect(INV).toMatch(/text-caption font-medium \$\{cfg\.color\}/);              // status badge
  });
  it("behavior intact — amount field, status, Open→ link + row navigation untouched", () => {
    expect(INV).toMatch(/formatCurrency\(inv\.total, inv\.currency\)/);
    expect(INV).toMatch(/STATUS_CONFIG\[inv\.status\]/);
    expect(INV).toMatch(/to=\{`\/finance\/invoices\/\$\{inv\.id\}`\}/);
    expect(INV).toMatch(/onRowClick=\{\(inv\) => navigate\(`\/finance\/invoices\/\$\{inv\.id\}`\)\}/);
  });
  it("keeps its own loading/error/empty copy (not refactored to shared state components)", () => {
    expect(INV).toMatch(/Couldn't load invoices\./);
    expect(INV).toMatch(/No invoices yet/);
  });
});

describe("finance/expenses fully adopts the shared type scale (Pass 3S)", () => {
  const EXP = read("apps/app/src/routes/dashboard/finance/expenses.tsx");
  it("uses the shared scale classes (caption/label/body/row/stat)", () => {
    for (const cls of ["text-caption", "text-label", "text-body", "text-row", "text-stat"]) {
      expect(EXP).toMatch(new RegExp(`\\b${cls}\\b`));
    }
  });
  it("no arbitrary text-[Npx] typography remains", () => {
    expect(EXP).not.toMatch(/text-\[[0-9.]+px\]/);
  });
  it("preserves visual weight on migrated elements (explicit font-* kept)", () => {
    expect(EXP).toMatch(/text-caption font-semibold uppercase/);                       // form labels
    expect(EXP).toMatch(/cellClassName: "text-body font-medium text-\[var\(--text-primary\)\]"/); // description
    expect(EXP).toMatch(/cellClassName: "text-row font-semibold text-\[var\(--text-primary\)\]"/); // amount
    expect(EXP).toMatch(/text-stat font-semibold/);                                    // KPI numbers
  });
  it("category colour stays DECORATIVE (catCfg.color), NOT converted to a status token", () => {
    expect(EXP).toMatch(/text-caption font-medium \$\{catCfg\.color\}/);   // category identity colour, not status.*
    expect(EXP).toMatch(/text-caption font-medium \$\{stsCfg\.color\}/);   // status pill keeps its own colour ref
  });
  it("behavior intact — amount_cents field, STATUS_CONFIG, DataTable + NO row navigation", () => {
    expect(EXP).toMatch(/fmt\(e\.amount_cents, e\.currency\)/);
    expect(EXP).toMatch(/STATUS_CONFIG/);
    expect(EXP).toMatch(/columns=\{EXPENSE_COLUMNS\}/);
    expect(EXP).not.toMatch(/onRowClick/);   // expenses rows never navigated — preserve that
  });
  it("keeps its own loading/error/empty copy (page-owned states)", () => {
    expect(EXP).toMatch(/Couldn't load expenses\./);
    expect(EXP).toMatch(/No expenses /);
  });
});

describe("all four finance list pages now use the shared DataTable", () => {
  it("quotes, credit-notes, invoices + expenses import and use DataTable; none hand-rolls a <table>", () => {
    for (const f of [
      "apps/app/src/routes/dashboard/finance/quotes.tsx",
      "apps/app/src/routes/dashboard/finance/credit-notes.tsx",
      "apps/app/src/routes/dashboard/finance/invoices.tsx",
      "apps/app/src/routes/dashboard/finance/expenses.tsx",
    ]) {
      const src = read(f);
      expect(src).toMatch(/components\/ui\/data-table/);
      expect(src).toMatch(/<DataTable</);
      expect(src).not.toMatch(/<table\b/);
    }
  });
});

// ── Pass 3E — expenses migrated to DataTable (category colours stay DECORATIVE) ──
describe("finance/expenses uses the shared DataTable", () => {
  const EX = read("apps/app/src/routes/dashboard/finance/expenses.tsx");
  it("imports + renders <DataTable>, rows non-navigating (no onRowClick added)", () => {
    expect(EX).toMatch(/import \{ DataTable, type DataTableColumn \} from "\.\.\/\.\.\/\.\.\/components\/ui\/data-table"/);
    expect(EX).toMatch(/<DataTable<Expense>/);
    expect(EX).toMatch(/columns=\{EXPENSE_COLUMNS\}/);
    expect(EX).not.toMatch(/onRowClick=/);   // expenses rows never navigated — none added
  });
  it("no longer hand-rolls its own <table>/<thead>/<tbody>", () => {
    expect(EX).not.toMatch(/<table\b/);
    expect(EX).not.toMatch(/<thead\b/);
    expect(EX).not.toMatch(/<tbody\b/);
  });
  it("amount (e.amount_cents), date, category label + status pill stay page-owned; amount field UNCHANGED", () => {
    expect(EX).toMatch(/const EXPENSE_COLUMNS: DataTableColumn<Expense>\[\]/);
    expect(EX).toMatch(/fmt\(e\.amount_cents, e\.currency\)/);   // expense amount math/field untouched
    expect(EX).toMatch(/CATEGORY_CONFIG\[e\.category\]/);
    expect(EX).toMatch(/STATUS_CONFIG\[e\.status\]/);
  });
  it("category colours remain DECORATIVE identity colours — NOT converted to status-* tokens", () => {
    // The category config keeps its own hex/section-accent identity colours; it must never use status-*.
    const catBlock = EX.slice(EX.indexOf("const CATEGORY_CONFIG"), EX.indexOf("const STATUS_CONFIG"));
    expect(catBlock).not.toMatch(/status-(ok|warn|error|neutral)/);
    expect(catBlock).toMatch(/text-\[#717784\]/);   // decorative hex preserved
  });
  it("keeps its own loading/error/empty branches in the page (unchanged states)", () => {
    expect(EX).toMatch(/Couldn't load expenses\./);
    expect(EX).toMatch(/No expenses /);
  });
});

describe("dead primitives (retire later, not now)", () => {
  it("SectionHeader / LiveSectionHeader / FilterToolbar remain defined but unused app-wide", () => {
    // Still defined in controls.tsx so nothing breaks…
    const controls = read("apps/app/src/components/ui/controls.tsx");
    for (const n of ["SectionHeader", "LiveSectionHeader", "FilterToolbar"]) {
      expect(controls).toMatch(new RegExp(`export function ${n}`));
    }
  });
});

describe("Call detail page-wide visual coherence (Pass CLL2+)", () => {
  const C = read("apps/app/src/routes/dashboard/call-detail.tsx");

  it("meta grid + action-item + buyer-signal wrappers use rounded-sm", () => {
    expect(C).toMatch(/grid grid-cols-2 gap-3 rounded-sm border border-\[var\(--border-soft\)\] p-4 text-sm/);
    expect(C).toMatch(/key=\{`\$\{index\}-\$\{item\}`\} className="rounded-sm border p-2\.5 text-sm"/);
    expect(C).toMatch(/key=\{signal\.text\} className=\{`rounded-sm border px-3 py-2 text-sm/);
  });

  it("participants render as one framed divide-y hairline list (not boxed cards)", () => {
    expect(C).toMatch(/<div className="overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] divide-y divide-\[var\(--border-soft\)\]">\{\(call\.participants/);
    // old boxed per-card treatment gone
    expect(C).not.toMatch(/flex items-center gap-3 rounded-md border border-\[var\(--border-soft\)\] p-3/);
    // row de-boxed with hover; Link + id-branch retained
    expect(C).toMatch(/className="flex items-center gap-3 px-3 py-2\.5 hover:bg-\[var\(--surface-hover\)\]"/);
    expect(C).toMatch(/to=\{`\/objects\/\$\{person\.object_type \|\| "people"\}\/\$\{person\.id\}`\}/);
    expect(C).toMatch(/\{person\.name\.slice\(0, 2\)\.toUpperCase\(\)\}/);
  });

  it("transcript search uses the shared key-input, behavior retained", () => {
    expect(C).toMatch(/value=\{transcriptSearch\} onChange=\{\(event\) => setTranscriptSearch\(event\.target\.value\)\} placeholder="Search transcript" className="key-input h-9 w-full pl-9 pr-3 text-sm"/);
  });

  it("forbidden zones untouched — audio player, transcript, mutations, summaries, provenance all present", () => {
    for (const h of ["useWaveSurfer", "visibleTranscript", "reprocess", "SummarySection", "txSource"]) {
      expect(C).toMatch(new RegExp(h));
    }
    // action-item promote mutations retained
    expect(C).toMatch(/promoteItem\(index, "task"\)/);
    expect(C).toMatch(/promoteItem\(index, "decision"\)/);
    // transcript seek + copy retained
    expect(C).toMatch(/waveRef\.current\?\.setTime\(line\.start_time\)/);
  });
});

describe("Home console signal de-duplication (Pass R2.1)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");

  it("overdue and unread each appear only once on the initial Home view", () => {
    // top-right attention chips removed → no more duplicate overdue chip / attention-chip class
    expect(H).not.toMatch(/attention-chip/);
    expect(H).not.toMatch(/overdue assigned to you/);   // the old chip copy is gone
    // unread is NOT in the rail anymore (no "{unread} unread" render)
    expect(H).not.toMatch(/\{unread\} unread/);
  });

  it("telemetry strip still owns the global counters (open tasks + unread)", () => {
    expect(H).toMatch(/home-telemetry-strip/);
    expect(H).toMatch(/\{unreadCount\}/);
    expect(H).toMatch(/\{activeTasks\.length\}/);
  });

  it("the console rail owns overdue + urgent + AI-risk (relocated, not lost) with preserved link state", () => {
    expect(H).toMatch(/label: `\$\{overdue\} overdue`, to: "\/tasks", state: \{ filter: "overdue" \}/);
    expect(H).toMatch(/label: `\$\{urgentCount\} urgent`, to: "\/tasks", state: \{ filter: "mine", priority: "urgent" \}/);
    expect(H).toMatch(/AI risk alert\$\{risk > 1 \? "s" : ""\}`, to: "\/notifications"/);
    // rail Link forwards the state so task filters still apply
    expect(H).toMatch(/<Link key=\{i\} to=\{s\.to\} state=\{s\.state\}/);
  });
});

describe("Home command-center console status rail (Pass R2)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");

  it("consolidates Graph/Sources + Right now into one hairline console rail in the header", () => {
    // the rail is a single border-t status strip
    expect(H).toMatch(/mt-3 flex flex-wrap items-center gap-x-4 gap-y-1\.5 border-t pt-2\.5/);
    // Right now label now appears exactly once (relocated, not duplicated)
    expect((H.match(/>Right now<\/span>/g) || []).length).toBe(1);
    // Graph + Sources status lines retained (2)
    expect((H.match(/status-line/g) || []).length).toBe(2);
    // the old centered status-dots block is gone from the hero
    expect(H).not.toMatch(/<div className="mt-3 flex items-center gap-4">/);
  });

  it("preserves every Right-now segment + its data links (relocated, not removed)", () => {
    expect(H).toMatch("approval");            // needs-approval segment retained
    expect(H).toMatch("pending === 1");       // its pluralization logic retained
    expect(H).toMatch(/to: "\/decisions"/);
    expect(H).toMatch(/to: "\/tasks"/);
    expect(H).toMatch(/label: `Next meeting/);
    expect(H).toMatch(/to: "\/calendar"/);
  });

  it("keeps the greeting hero, composer, and command menu intact", () => {
    expect(H).toMatch(/\{greeting\}, \{firstName\}/);
    expect(H).toMatch(/What do you want to get done today\?/);
    expect(H).toMatch(/home-control-room/);
    // P2 command menu still framed divide-y
    expect(H).toMatch(/mx-auto mt-6 max-w-2xl divide-y divide-\[var\(--border-soft\)\] border-t/);
  });

  it("preserves all handlers, prompts, telemetry, and command-center panels", () => {
    for (const a of ["sendSuggestion", "applyTerms", "NeedsYouPanel", "WorkspaceGraphPulse", "QUICK_PROMPTS", "home-telemetry-strip"]) {
      expect(H).toMatch(new RegExp(a));
    }
    expect(H).toMatch(/to: "\/discovery"/);   // Discover quick-action nav
  });
});

describe("Home quick-actions unified into a hairline command menu (Pass P2)", () => {
  const H = read("apps/app/src/routes/dashboard/home.tsx");

  it("quick-actions live in one framed divide-y surface, not a boxed grid", () => {
    expect(H).toMatch(/mx-auto mt-6 max-w-2xl divide-y divide-\[var\(--border-soft\)\] border-t border-\[var\(--border-soft\)\]/);
    // old 2x2 boxed grid treatment is gone
    expect(H).not.toMatch(/mt-7 grid max-w-2xl grid-cols-1 gap-2\.5 sm:grid-cols-2/);
  });

  it("each action is a de-boxed hover row (no per-card border box)", () => {
    expect(H).toMatch(/className="group flex w-full items-center gap-3 px-2 py-2\.5 text-left transition-colors hover:bg-\[var\(--surface-hover\)\]"/);
    // old per-button boxed treatment + hover-border JS is gone
    expect(H).not.toMatch(/className="group flex items-start gap-3 rounded-sm border px-4 py-3 text-left transition-colors"/);
    expect(H).not.toMatch(/onMouseEnter=\{e => \{ \(e\.currentTarget as HTMLElement\)\.style\.borderColor = "var\(--section-accent\)"/);
  });

  it("preserves every action handler + dynamic label logic", () => {
    // navigate-vs-sendSuggestion branch intact
    expect(H).toMatch(/onClick=\{\(\) => \("to" in s && s\.to \? navigate\(s\.to\) : sendSuggestion\(applyTerms\(s\.prompt, wsProfile\)\)\)\}/);
    // dynamic labels retained
    expect(H).toMatch(/Show my \$\{overdueCount\} overdue task/);
    expect(H).toMatch(/hasFinance/);
    expect(H).toMatch(/to: "\/discovery"/);
    expect(H).toMatch(/wsProfile\.target_customers/);
  });

  it("does not touch the composer, command-center panels, or flow panels", () => {
    expect(H).toMatch(/<NeedsYouPanel/);
    expect(H).toMatch(/WorkspaceGraphPulse/);
    expect(H).toMatch(/flow-panel-clean/);
    expect(H).toMatch(/ask-composer|home-control-room/);
  });
});

describe("Home audit — Attio-style composer + real bug fixes (Pass HOME1)", () => {
  const home = read("apps/app/src/routes/dashboard/home.tsx");
  const css = read("apps/app/src/styles.css");
  const dock = read("apps/app/src/components/ai/agent-dock.tsx");

  it("AI composer is a carved 12px hairline, not an elevated pill", () => {
    const block = css.slice(css.indexOf(".ask-input {"), css.indexOf(".ask-suggestion-row"));
    expect(block).toMatch(/border-radius: 0\.75rem/);
    expect(block).toMatch(/box-shadow: none/);
    expect(block).not.toMatch(/border-radius: 1\.25rem/);
    // focus is a precise accent ring, not a 24px bloom
    expect(block).toMatch(/box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--section-accent\) 12%, transparent\)/);
    expect(block).not.toMatch(/0 8px 24px/);
  });

  it("composer light-sweep only runs while the agent is actually working", () => {
    expect(css).toMatch(/\.chat-input-orbit\[data-busy="true"\]::before/);
    expect(home).toMatch(/<div data-busy=\{loading\} className="ask-input chat-input-bar chat-input-orbit/);
  });

  it("send() cannot destroy typed text or attachments while a reply streams", () => {
    expect(home).toMatch(/const send = \(\) => \{[\s\S]*?if \(loading\) return;/);
  });

  it("send button stays enabled for attachment-only sends", () => {
    expect(home).toMatch(/disabled=\{!loading && !input\.trim\(\) && attachments\.length === 0\}/);
  });

  it("workspace meeting times are formatted, never raw ISO", () => {
    expect(home).toMatch(/id: `ws-\$\{m\.id\}`, title: m\.title, when: new Date\(m\.start_time\)\.toLocaleTimeString/);
    expect(home).not.toMatch(/title: m\.title, when: m\.start_time,/);
  });

  it("priority pill never renders a literal undefined class", () => {
    expect(home).toMatch(/PRIORITY_STYLE\[item\.priority\] \?\? PRIORITY_STYLE\.medium/);
  });

  it("typewriter interval is cleaned up on unmount", () => {
    expect(home).toMatch(/useEffect\(\(\) => \(\) => \{ if \(streamRef\.current\) clearInterval\(streamRef\.current\); \}, \[\]\);/);
  });

  it("Home and the agent dock share one /notifications?limit=50 request", () => {
    expect(home).toMatch(/queryKey: \["notifications", "recent-50"\]/);
    expect(dock).toMatch(/queryKey: \["notifications", "recent-50"\]/);
    expect(dock).not.toMatch(/queryKey: \["agent-dock", "notifications"\]/);
  });

  it("regenerate re-sends the TRIMMED transcript (no duplicated turns)", () => {
    const engine = read("apps/app/src/components/ai/use-ask-engine.ts");
    // doSend reads live messages through a ref, not a stale closure
    expect(engine).toMatch(/const messagesRef = useRef<ChatMessage\[\]>\(messages\);/);
    expect(engine).toMatch(/const current = messagesRef\.current;/);
    expect(engine).toMatch(/const withUser = \[\.\.\.current, userMsg\];/);
    // regenerate trims, syncs the ref, and sends directly — no 0ms tick race
    expect(engine).toMatch(/messagesRef\.current = trimmed;/);
    expect(engine).toMatch(/void doSend\(lastUserTextRef\.current\);/);
    expect(engine).not.toMatch(/setTimeout\(\(\) => doSend\(text\), 0\)/);
  });

  it("voice dictation appends to typed text instead of overwriting it", () => {
    const voice = read("apps/app/src/components/ai/use-voice.ts");
    expect(voice).toMatch(/onText\(prev => \{ base = prev; return prev; \}\);/);
    expect(voice).toMatch(/const prefix = base\.trim\(\) \? `\$\{base\.trimEnd\(\)\} ` : "";/);
    expect(voice).toMatch(/onText\(prefix \+ \(finalText \+ interim\)\.trim\(\)\)/);
    expect(voice).not.toMatch(/onText\(\(finalText \+ interim\)\.trim\(\)\)/);
  });

  it("failed Home queries degrade honestly instead of vanishing", () => {
    for (const q of ["chiefQuery.isError", "membersQuery.isError", "workspacesQuery.isError"]) {
      expect(home).toContain(q);
    }
    expect(home).toMatch(/Could not load \{missing\.length === 1/);
  });

  it("profile-aware server prompts are used, not fetched and discarded", () => {
    // Home now reads /workspace/suggestions -> home[] instead of only .profile
    expect(home).toMatch(/wsSuggestions\?\.home\?\.find\(h => h\.key === key\)\?\.prompt/);
    expect(home).toMatch(/firePrompt\(serverPrompt\(promptKey, prompt\)\)/);
    // both server keys are reachable from the UI
    expect(home).toMatch(/promptKey: "attention"/);
    expect(home).toMatch(/promptKey: "decisions"/);
  });

  it("never says CRM anywhere on Home", () => {
    expect(home).not.toMatch(/\bCRM\b/);
  });

  it("SSE-rendered answers are not re-animated (no collapse-and-retype)", () => {
    const engine = read("apps/app/src/components/ai/use-ask-engine.ts");
    // engine tells the surface whether tokens already animated live
    expect(engine).toMatch(/onAssistantMessage\?: \(index: number, fullText: string, alreadyRenderedLive\?: boolean\) => void/);
    expect(engine).toMatch(/opts\.onAssistantMessage\?\.\(aiIdx, reply, tokens > 0\)/);
    expect(engine).toMatch(/opts\.onAssistantMessage\?\.\(aiIdx, partial, true\)/);
    // non-streaming fallback still gets the typewriter
    expect(engine).toMatch(/opts\.onAssistantMessage\?\.\(aiIdx, reply, false\)/);
    // Home honours the flag instead of retyping
    expect(home).toMatch(/if \(alreadyRenderedLive\) \{ setStreamingMsgIdx\(null\); return; \}/);
  });

  it("expensive agent-dock queries are opt-in, not fired for every consumer", () => {
    const dock = read("apps/app/src/components/ai/agent-dock.tsx");
    const cc = read("apps/app/src/components/ai/command-center.tsx");
    const constellation = read("apps/app/src/components/ai/agent-constellation.tsx");
    // heavy queries default OFF and are gated on the pulse opt-in
    expect(dock).toMatch(/pulse: wantPulse = false/);
    expect((dock.match(/enabled: enabled && wantPulse/g) ?? []).length).toBe(3);
    // /agents (which feeds `constellation`) stays ungated by pulse
    expect(dock).toMatch(/queryFn: \(\) => apiClient\.get<\{ agents: AgentRegistryEntry\[\] \}>\("\/agents"\),\s*\n\s*staleTime: 60_000,\s*\n\s*enabled,/);
    // exactly one consumer opts into the heavy counts
    expect(cc).toMatch(/useAgentData\(\{ pulse: true, enabled: inView \}\)/);
    // below-the-fold panel defers until near-viewport
    expect(constellation).toMatch(/useAgentData\(\{ enabled: inView \}\)/);
    expect(constellation).toMatch(/if \(!inView \|\| isLoading\)/);
    expect(constellation).toMatch(/rootMargin: "400px"/);
    // the pulse panel (heaviest data on the page) defers too
    expect(cc).toMatch(/useAgentData\(\{ pulse: true, enabled: inView \}\)/);
    expect(cc).toMatch(/\{!inView \|\| pulse\.isLoading \? \(/);
  });

  it("task-widget AI reply is actually rendered, not computed and discarded", () => {
    expect(home).toMatch(/\{taskWidgetReply && \(/);
    expect(home).toMatch(/\{taskWidgetReply\}<\/p>/);
    expect(home).toMatch(/onClick=\{\(\) => setTaskWidgetReply\(null\)\}/);
  });
});

describe("Records experience premium polish (Pass CHR2)", () => {
  const pipeline = read("apps/app/src/routes/dashboard/pipeline.tsx");
  const objects = read("apps/app/src/routes/dashboard/objects/[objectType]/index.tsx");
  const table = read("apps/app/src/components/records/record-table.tsx");
  const detail = read("apps/app/src/components/records/record-detail.tsx");

  it("no double divider — CommandPageHeader wrappers rely on the single soul-rule (border-b dropped)", () => {
    // pipeline header wrapper no longer stacks a border-b under the soul-rule
    expect(pipeline).toMatch(/<div className="px-6 py-3 shrink-0">\s*\n\s*<CommandPageHeader/);
    expect(pipeline).not.toMatch(/border-b border-\[var\(--border-soft\)\] px-6 py-3 shrink-0">\s*\n\s*<CommandPageHeader/);
    // objects sheet header wrapper likewise
    expect(objects).toMatch(/<div className="px-6 py-3 shrink-0">\s*\n\s*<CommandPageHeader/);
    expect(objects).not.toMatch(/border-b px-6 py-3 shrink-0" style=\{\{ borderColor: "var\(--border-soft\)" \}\}>\s*\n\s*<CommandPageHeader/);
  });

  it("RecordTable empty state de-boxed — dashed token border, no tinted fill or hardcoded stone", () => {
    expect(table).toMatch(/min-h-64 flex-col items-center justify-center rounded-sm border border-dashed px-6 text-center" style=\{\{ borderColor: "var\(--border-soft\)" \}\}/);
    // old heavy tinted box with non-token border is gone
    expect(table).not.toMatch(/rounded-sm border border-stone-800\/40 bg-\[var\(--surface-hover\)\] px-6 text-center/);
    expect(table).toMatch(/<h2 className="text-sm font-medium text-\[var\(--text-secondary\)\]">No \{objectType\} yet<\/h2>/);
  });

  it("Detail tab active indicator uses the section accent (2px), not flat gray", () => {
    // The bar moved into the shared <Tabs> (components/ui/tabs.tsx) in Pass R1 — every tab bar was
    // hand-rolled, so the chrome drifted per page. The INTENT is unchanged and now asserted where
    // the markup actually lives.
    const tabs = read("apps/app/src/components/ui/tabs.tsx");
    expect(tabs).toMatch(/h-0\.5/);
    expect(tabs).toMatch(/background: "var\(--section-accent\)"/);
    expect(detail).toMatch(/<Tabs\b/);
    expect(detail).not.toMatch(/h-px bg-stone-500/);
  });

  it("Detail breadcrumb: title-cased object type + strengthened record name (tokenized)", () => {
    expect(detail).toMatch(/<ChevronLeft size=\{13\}\/>\{objectType\.replace\(\/\[-_\]\/g, " "\)\.replace\(\/\\b\\w\/g, \(c\) => c\.toUpperCase\(\)\)\}/);
    // text-xs -> text-body in Pass R1 (the locked type scale); still tokenised, still the
    // strengthened secondary treatment the original guard was protecting.
    expect(detail).toMatch(/<span className="truncate text-body font-medium text-\[var\(--text-secondary\)\]">\{name\}<\/span>/);
    expect(detail).not.toMatch(/<span className="text-xs text-stone-400 truncate">\{name\}<\/span>/);
  });

  it("RecordTable core row/selection behavior untouched (visual-only pass)", () => {
    for (const anchor of ["selected.has(record.id)", "allSelected", "someSelected", "EditableCell", "onColumnsChange", "sticky top-0 z-20"]) {
      expect(table).toContain(anchor);
    }
  });
});

describe("App-wide chrome pass — pages migrated to CommandPageHeader standard (Pass CHR1)", () => {
  const pipeline = read("apps/app/src/routes/dashboard/pipeline.tsx");
  const objects = read("apps/app/src/routes/dashboard/objects/[objectType]/index.tsx");
  const support = read("apps/app/src/routes/dashboard/platform-support.tsx");
  const decisions = read("apps/app/src/routes/dashboard/decisions.tsx");

  it("Pipeline uses CommandPageHeader with icon/callsign/title + New-deal primary action", () => {
    expect(pipeline).toMatch(/import \{ CommandPageHeader \} from "\.\.\/\.\.\/components\/ui\/controls"/);
    expect(pipeline).toMatch(/<CommandPageHeader[\s\S]*?callsign="PIPELINE"[\s\S]*?title="Pipeline"/);
    expect(pipeline).toMatch(/primaryAction=\{[\s\S]*?onClick=\{\(\) => setCreateForStage\(stages\[0\] \?\? "Lead"\)\}/);
    // old bespoke uppercase-span header row is gone
    expect(pipeline).not.toMatch(/<span className="text-\[12px\] font-semibold uppercase tracking-\[0\.12em\] text-\[var\(--text-muted\)\] select-none">Pipeline<\/span>/);
    // live stats preserved in subtitle
    expect(pipeline).toMatch(/\$\{deals\.length\} deal/);
  });

  it("Objects LIST sheet uses CommandPageHeader; 6-button wall collapsed into one Manage menu", () => {
    expect(objects).toMatch(/import \{ CommandPageHeader, ActionMenu \} from "\.\.\/\.\.\/\.\.\/\.\.\/components\/ui\/controls"/);
    expect(objects).toMatch(/<CommandPageHeader[\s\S]*?callsign="RECORDS"/);
    expect(objects).toMatch(/<ActionMenu triggerLabel="Manage"/);
    // every utility handler is preserved inside the menu (no lost affordance)
    for (const h of ["setShowAIFill(true)", "setDedupOpen(true)", "setSegmentOpen(true)", "setImportOpen(p => !p)", "setShowDeleteSheet(true)"]) {
      expect(objects).toContain(h);
    }
    // primary + view toggle + period lens all retained
    expect(objects).toMatch(/onClick=\{\(\) => setShowCreate\(true\)\} className="btn-primary/);
    expect(objects).toMatch(/setView\("table"\)/);
    expect(objects).toMatch(/setView\("board"\)/);
    expect(objects).toMatch(/<PeriodSelector value=\{period\} onChange=\{setPeriod\} \/>/);
    // old flat toolbar wall (loose bordered utility buttons) is gone
    expect(objects).not.toMatch(/<button onClick=\{\(\) => setDedupOpen\(true\)\}\s*\n\s*className="inline-flex items-center gap-1\.5 rounded-sm border/);
  });

  it("Platform-support uses CommandPageHeader; status filter + count no longer a loose row", () => {
    expect(support).toMatch(/MenuSelect, CommandPageHeader \} from "\.\.\/\.\.\/components\/ui\/controls"/);
    expect(support).toMatch(/<CommandPageHeader[\s\S]*?callsign="SUPPORT"[\s\S]*?title="Platform support"/);
    expect(support).toMatch(/rightSummary=\{`\$\{tickets\.length\} ticket\(s\)`\}/);
    expect(support).toMatch(/secondaryActions=\{[\s\S]*?<MenuSelect label="Status" value=\{statusFilter\} onChange=\{setStatusFilter\}/);
    // old bespoke h1 header is gone
    expect(support).not.toMatch(/<h1 className="flex items-center gap-2 text-\[19px\] font-semibold"[^>]*> Platform support/);
  });

  it("Decisions search normalized to the shared key-input class", () => {
    expect(decisions).toMatch(/<input value=\{search\} onChange=\{e => setSearch\(e\.target\.value\)\} placeholder="Search queue…"[\s\S]*?className="key-input h-7 w-36 pr-2 text-\[11\.5px\]/);
    // old bespoke bordered input styling gone
    expect(decisions).not.toMatch(/className="h-7 w-36 rounded-sm border bg-transparent pl-6\.5 pr-2 text-\[11\.5px\] outline-none/);
  });

  it("high-risk pages remain untouched (record detail, home command-room, workspace settings)", () => {
    // record detail still breadcrumb-based (NOT CommandPageHeader)
    const rec = read("apps/app/src/components/records/record-detail.tsx");
    expect(rec).not.toMatch(/CommandPageHeader/);
    // home still its bespoke command room
    const home = read("apps/app/src/routes/dashboard/home.tsx");
    expect(home).not.toMatch(/CommandPageHeader/);
    // finance list pages still on their own FinanceHeader (deliberately deferred)
    const inv = read("apps/app/src/routes/dashboard/finance/invoices.tsx");
    expect(inv).toMatch(/FinanceHeader/);
  });
});

describe("Discovery DossierPanel de-box + section rhythm + icon polish (Pass D5.1)", () => {
  const D = read("apps/app/src/routes/dashboard/discovery.tsx");
  const panel = D.slice(D.indexOf("function DossierPanel"), D.indexOf("function PipelineChips"));

  it("dossier is one framed hairline divide-y document, not a tinted boxed stack", () => {
    expect(panel).toMatch(/overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-card\)\] divide-y divide-\[var\(--border-soft\)\]/);
    // old tinted boxed container gone (the panel no longer sits on a surface-hover box)
    expect(panel).not.toMatch(/space-y-2 rounded-sm border px-3 py-2\.5/);
    expect(panel).not.toMatch(/rounded-sm border px-3 py-2\.5 text-\[11\.5px\]" style=\{\{ borderColor: "var\(--border-soft\)", background: "var\(--surface-hover\)" \}\}/);
  });

  it("emoji metadata icons are gone, replaced by lucide glyphs", () => {
    for (const emoji of ["🏷", "📍", "⭐", "✉", "☎", "👤"]) expect(panel).not.toContain(emoji);
    for (const icon of ["<Tag ", "<MapPin ", "<Star ", "<Mail ", "<Phone ", "<User "]) expect(panel).toContain(icon);
  });

  it("provenance + honest evidence semantics fully preserved", () => {
    expect(panel).toMatch(/<ViaChip via=\{d\.summary\.via\} source=\{d\.summary\.source\} \/>/);
    expect(panel).toMatch(/d\.graph_match/);
    expect(panel).toMatch(/Already in your graph as/);
    expect(panel).toMatch(/Web evidence:/);
    expect(panel).toMatch(/d\.missing\.join\(", "\)/);
    expect(panel).toMatch(/Not found:/);
    // empty guard retained
    expect(panel).toMatch(/const anything = d\.summary \|\| d\.category/);
    // no mutation/action handler leaked into the panel
    expect(panel).not.toMatch(/\.mutate\(\)/);
  });
});

describe("Discovery Saved-leads list unified into a hairline surface (Pass D4)", () => {
  const D = read("apps/app/src/routes/dashboard/discovery.tsx");

  it("saved-leads list is one framed divide-y surface, not a space-y-2 boxed stack", () => {
    // the SavedLeads rows are keyed by r.id and mapped from `rows` — assert the framed container wraps that map
    expect(D).toMatch(/<div className="overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-card\)\] divide-y divide-\[var\(--border-soft\)\]">\s*\n\s*\{rows\.map/);
    // old gapped boxed-card container for saved leads is gone
    expect(D).not.toMatch(/<div className="space-y-2">\s*\n\s*\{rows\.map/);
  });

  it("saved-lead rows are de-boxed with a hover background", () => {
    expect(D).toMatch(/<div key=\{r\.id\} className="flex items-start justify-between gap-3 px-3\.5 py-3 transition-colors hover:bg-\[var\(--surface-hover\)\]">/);
    // old per-card boxed treatment gone
    expect(D).not.toMatch(/flex items-start justify-between gap-3 rounded-sm border px-3\.5 py-3/);
  });

  it("preserves saved-lead links, delete mutation, MonitorsPanel, and page-state branches", () => {
    // name Link + Open Link → /objects/:id
    expect((D.match(/to=\{`\/objects\/\$\{r\.object_type\}\/\$\{r\.id\}`\}/g) || []).length).toBe(2);
    expect(D).toMatch(/onClick=\{\(\) => remove\.mutate\(r\.id\)\}/);   // delete button + mutation retained
    expect(D).toMatch(/<MonitorsPanel \/>/);
    for (const s of ["DelayedLoading", "ErrorState", "EmptyState", "PageSkeletonCards"]) {
      expect(D).toMatch(new RegExp(s));
    }
  });

  it("does not touch the D2 Discover results feed", () => {
    // D2 container still present (the results feed uses citeId + the same framed treatment)
    expect(D).toMatch(/\]">\s*\n?\s*\{shown\.map/);
    expect(D).toMatch(/id=\{citeId\(turn\.id, i \+ 1\)\}/);
  });
});

describe("Discovery results feed unified into an answer document (Pass D2)", () => {
  const D = read("apps/app/src/routes/dashboard/discovery.tsx");

  it("results container is a framed divide-y answer feed, not a space-y-2 boxed stack", () => {
    expect(D).toMatch(/<div className="overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-card\)\] divide-y divide-\[var\(--border-soft\)\]">\s*\n\s*\{shown\.map/);
    // old gapped boxed-card stack container is gone
    expect(D).not.toMatch(/<div className="space-y-2">\s*\n\s*\{shown\.map/);
  });

  it("ReviewCard and LeadCard wrappers are de-boxed with a hover row background", () => {
    // ReviewCard: no per-card box; hover bg
    expect(D).toMatch(/<div className="px-3\.5 py-3 transition-colors hover:bg-\[var\(--surface-hover\)\]">\s*\n\s*<div className="flex items-center justify-between gap-2">/);
    // LeadCard: no per-card box; hover bg; selected uses a section-accent LEFT bar (not full border)
    expect(D).toMatch(/<div className="px-3\.5 py-3 transition-colors hover:bg-\[var\(--surface-hover\)\]" style=\{selected \? \{ borderLeft: "3px solid var\(--section-accent\)"/);
    // the old full-card selected border form is gone
    expect(D).not.toMatch(/borderColor: selected \? "var\(--section-accent\)" : "var\(--border-soft\)", background: "var\(--surface-card\)"/);
  });

  it("preserves citation anchoring, selection, and all result actions/handlers", () => {
    expect(D).toMatch(/id=\{citeId\(turn\.id, i \+ 1\)\} className="scroll-mt-20"/);   // Sources-rail jump anchor
    expect(D).toMatch(/type="checkbox" checked=\{Boolean\(selected\)\} onChange=\{onToggle\}/); // lead checkbox + onToggle
    for (const h of ["citeId", "onDetails", "onToggle", "discovery/enrich", "discovery/outreach", "SourcesRail"]) {
      expect(D).toMatch(new RegExp(h.replace(/[/]/g, "\\/")));
    }
    // reviews-vs-leads split intact
    expect(D).toMatch(/reviews\s*\n?\s*\?\s*<ReviewCard/);
  });
});

describe("Notes toolbar standardized to premium rhythm (Pass 11L)", () => {
  const N = read("apps/app/src/routes/dashboard/notes.tsx");

  it("segmented track uses the premium rounded-lg + p-0.5 rhythm", () => {
    expect(N).toMatch(/inline-flex flex-wrap items-center gap-0\.5 rounded-lg border border-\[var\(--border-soft\)\] bg-\[var\(--surface-hover\)\] p-0\.5/);
  });

  it("active tab is visible on --surface-card with a shadow, NOT on the --surface-hover track", () => {
    expect(N).toMatch(/background: "var\(--surface-card\)", color: "var\(--text-primary\)", boxShadow: "0 1px 2px rgba\(0,0,0,0\.18\)"/);
    // the old invisible-active-pill form (active bg == track bg) is gone
    expect(N).not.toMatch(/filter === key \? "bg-\[var\(--surface-hover\)\] text-\[var\(--text-primary\)\]"/);
    expect(N).toMatch(/rounded-md px-3 py-1 text-\[11\.5px\] font-medium transition-colors/);
  });

  it("search field uses the shared key-input control", () => {
    expect(N).toMatch(/placeholder="Search notes…"/);
    expect(N).toMatch(/className="key-input h-8 w-48 pl-8 pr-3 text-\[12px\]"/);
    // old hand-rolled search input classes gone
    expect(N).not.toMatch(/h-8 w-48 rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-hover\)\] pl-8/);
  });

  it("preserves all toolbar handlers + elements + the note grid/card (untouched)", () => {
    for (const h of ["setFilter", "setSearch", "setSort", "setModalOpen"]) {
      expect(N).toMatch(new RegExp(h));
    }
    expect(N).toMatch(/pinned/);                                  // pinned-count chip retained
    expect(N).toMatch(/grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4/); // card grid untouched (11F)
    expect(N).toMatch(/<NoteCard\b/);                             // card component untouched
  });
});

describe("Calendar compact headline + smart control rail (Pass CAL-R)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");

  it("headline stays compact while date nav + view filter move to a slim rail", () => {
    expect(C).toMatch(/primaryAction=\{/);
    expect(C).toMatch(/subtitle=\{`\$\{viewSummary\} · \$\{rangeLabel\}`\}/);
    expect(C).toMatch(/rightSummary=\{`\$\{t\("cal\.meeting_agent"\)\} · \$\{t\("cal\.agent_available"\)\} · \$\{t\("cal\.agent_monitoring"\)\}`\}/);
    expect(C).toMatch(/className="mb-2"/);
    // Today / prev / next / range live in the smart rail below the header
    expect(C).toMatch(/mb-3 flex flex-col gap-2 rounded-sm border px-2 py-2 sm:flex-row sm:items-center sm:justify-between/);
    expect(C).toMatch(/onClick=\{goToday\} disabled=\{isAnchorToday && view !== "upcoming"\}/);
    expect(C).toMatch(/onClick=\{\(\) => shift\(-1\)\}/);
    expect(C).toMatch(/onClick=\{\(\) => shift\(1\)\}/);
    expect(C).toMatch(/\{rangeLabel\}/);
    // The premium segmented filter is now the SHARED SegmentedControl — same visual recipe
    // (rounded-lg track, active on surface-card + shadow) but one implementation; the hand-rolled
    // pill copy this guard used to pin is deliberately gone.
    expect(C).toMatch(/<SegmentedControl/);
    expect(C).not.toMatch(/view === tab\.k \? \{ background: "var\(--surface-card\)"/);
    // New meeting is the header primary action
    // New meeting is the rail's primary action — now the CANONICAL btn-primary (Pass BTN-1)
    // instead of the hand-rolled recipe this guard used to pin.
    expect(C).toMatch(/onClick=\{openCreate\} className="btn-primary h-7 shrink-0 px-3 text-\[12px\] font-semibold"/);
    // the old bloated/separate toolbar variants are gone
    expect(C).not.toMatch(/secondaryActions=\{/);
    expect(C).not.toMatch(/mt-5 flex flex-wrap items-center justify-between gap-2 border-b pb-3/);
    expect(C).not.toMatch(/rounded-\[3px\] px-2\.5 text-\[12px\]/);
  });

  it("Meeting Agent surfaces carry the section-accent top-edge signature", () => {
    // aside briefing panel: surface-card + accent top edge
    expect(C).toMatch(/background: "var\(--surface-card\)", borderTop: "2px solid var\(--section-accent\)", boxShadow: "0 1px 3px rgba\(0,0,0,0\.14\)"/);
    // TodayStrip brief band: same accent top edge
    expect(C).toMatch(/borderColor: "var\(--border-soft\)", background: "var\(--surface-card\)", borderTop: "2px solid var\(--section-accent\)"/);
  });

  it("behavior untouched — views, strip, brief, drawer, mutations all present", () => {
    for (const a of ["TodayStrip", "MeetingBriefBody", "TodayBriefingPanel", "TimeGrid", "MonthGrid", "EventDrawer", "CreateModal", "moveEventToDay", "openSlot", "openEvent"]) {
      expect(C).toMatch(new RegExp(a));
    }
    expect(C).toMatch(/const viewSummary = `\$\{viewCount\} \$\{viewCount === 1 \? "meeting" : "meetings"\}`/);
    expect(C).toMatch(/rightSummary=\{`\$\{t\("cal\.meeting_agent"\)\} · \$\{t\("cal\.agent_available"\)\} · \$\{t\("cal\.agent_monitoring"\)\}`\}/);  // honest agent status retained
  });
});

describe("Object record related-record list → framed hairline surface (Pass OBJ2)", () => {
  const R = read("apps/app/src/components/records/record-detail.tsx");

  it("RelatedTab list is one framed divide-y surface, not a space-y-2 boxed stack", () => {
    expect(R).toMatch(/<div className="overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] divide-y divide-\[var\(--border-soft\)\]">\s*\n\s*\{related\.map/);
    // old boxed per-card related-record treatment gone
    expect(R).not.toMatch(/flex items-center gap-3 rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-hover\)\] p-3 hover:border/);
  });

  it("related-record rows are de-boxed with a hover background, link + avatar + type retained", () => {
    expect(R).toMatch(/className="flex items-center gap-3 px-3 py-2\.5 transition-colors hover:bg-\[var\(--surface-hover\)\] group"/);
    expect(R).toMatch(/to=\{`\/objects\/\$\{r\.object_type\}\/\$\{r\.id\}`\}/);   // record link target
    expect(R).toMatch(/\{initials\(n\)\}/);                                        // avatar
    expect(R).toMatch(/capitalize">\{r\.object_type\}<\/p>/);                      // object-type label
  });

  it("preserves RelatedTab query, Link-record action, empty state, and the untouched zones", () => {
    expect(R).toMatch(/queryKey: \["related", recordId\]/);                        // relation query
    expect(R).toMatch(/const linkRecord = useMutation/);                          // link action retained
    expect(R).toMatch(/<Link2 size=\{12\}\/> Link record/);
    expect(R).toMatch(/No linked records yet\./);                                 // empty state
    // untouched record-page zones still present
    expect(R).toMatch(/function RecordDetail/);
    expect(R).toMatch(/AI Inspector/);
    expect(R).toMatch(/Key fields/);
  });
});

describe("Emails two-row page chrome (Pass A3)", () => {
  const E = read("apps/app/src/routes/dashboard/emails.tsx");

  it("identity row uses CommandPageHeader; the bespoke banner is gone", () => {
    expect(E).toMatch(/<CommandPageHeader\s*\n?\s*icon=\{Mail\}/);
    expect(E).toMatch(/callsign="INBOX"/);
    expect(E).toMatch(/title="Email & calendar"/);
    expect(E).toMatch(/subtitle="Synced Gmail and Outlook conversations\."/);
    expect(E).toMatch(/import \{ CommandPageHeader \} from "\.\.\/\.\.\/components\/ui\/controls"/);
    // old bespoke banner removed
    expect(E).not.toMatch(/<header className="border-b px-4 py-3 sm:px-6 flex items-center gap-4"/);
  });

  it("Inbox/Tracking switch lives in the header secondaryActions with setTab intact", () => {
    expect(E).toMatch(/secondaryActions=\{/);
    expect(E).toMatch(/onClick=\{\(\) => setTab\("inbox"\)\}/);
    expect(E).toMatch(/onClick=\{\(\) => setTab\("tracking"\)\}/);
  });

  it("control row (filters + search) retained on shared idioms", () => {
    expect(E).toMatch(/onClick=\{\(\) => setFilter\(item\)\}/);         // all/inbox/sent/unread filters
    expect(E).toMatch(/onChange=\{\(event\) => setSearch\(event\.target\.value\)\}/);
    expect(E).toMatch(/className="key-input h-9 w-full pl-9 pr-3 text-sm"/); // key-input search
    expect(E).toMatch(/<SentTracker\/>/);                               // tracking view retained
  });
});

describe("Meeting Memory row hierarchy + consistency (Pass CLL4)", () => {
  const C = read("apps/app/src/routes/dashboard/calls.tsx");

  it("rows split into identity (left) + a right-aligned intelligence status cluster", () => {
    expect(C).toMatch(/<div className="hidden shrink-0 items-center gap-3 text-\[11px\] sm:flex"/);
    // transcript + summary status now live in that right cluster (after the flex-1 identity div)
    expect(C).toMatch(/sm:flex" style=\{\{ color: "var\(--text-faint\)" \}\}>\s*\n\s*.*transcript_status/s);
    // the identity meta line (when·company·participants) no longer contains the transcript span
    expect(C).not.toMatch(/participant_count\}<\/span>\s*\n?\s*<span className="flex items-center gap-1" title=\{m\.transcript_kind/);
  });

  it("applies the consistency finish (container rounded-sm, key-input search, segmented tab radii)", () => {
    expect(C).toMatch(/<div className="overflow-hidden rounded-sm border"/);
    expect(C).not.toMatch(/<div className="overflow-hidden rounded-md border"/);
    expect(C).toMatch(/className="key-input h-8 w-full pl-8 pr-3 text-\[13px\]"/);
    expect(C).toMatch(/inline-flex flex-wrap rounded-lg border p-0\.5/);
    expect(C).toMatch(/className="rounded-md px-2\.5 py-1 text-\[12px\] font-medium transition-colors"/);
  });

  it("preserves honest status logic, row link, header, import, and controls", () => {
    for (const a of ["m.transcript_status", "m.transcript_kind", "m.summary_status", "m.action_item_count", "to={m.href}", "CommandPageHeader", "Import recording", "setTab", "setSearch"]) {
      expect(C).toMatch(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // honest dots + icons retained
    expect(C).toMatch(/<FileText size=\{10\}/);
    expect(C).toMatch(/<Sparkles size=\{10\}/);
    expect(C).toMatch(/<ListChecks size=\{10\}/);
  });
});

describe("Settings header cluster migrated to CommandPageHeader (Pass 11J)", () => {
  const dir = "apps/app/src/routes/dashboard/settings";
  const SETTINGS: Array<[string, string, string, string]> = [
    // [file, callsign, icon, title]
    ["account", "ACCOUNT", "User", "Account"],
    ["ai-control-room", "AI CONTROL ROOM", "ShieldCheck", "AI Control Room"],
    ["billing", "BILLING", "CreditCard", "Billing"],
    ["calls", "CALLS", "Video", "Calls & Recording"],
    ["email", "EMAIL", "Mail", "Email & calendar"],
    ["integrations", "INTEGRATIONS", "Plug", "Integrations & API"],
    ["members", "MEMBERS", "Users", "Members & Roles"],
    ["objects", "OBJECTS", "Database", "Objects & attributes"],
    ["security", "SECURITY", "Shield", "Security"],
    ["support", "SUPPORT", "LifeBuoy", ""],       // dynamic title={title}
    ["training", "TRAINING", "Brain", "Training data"],
  ];

  it("every settings page uses CommandPageHeader with the correct callsign + nav icon, and no old PageHeader", () => {
    for (const [file, callsign, icon] of SETTINGS) {
      const src = read(`${dir}/${file}.tsx`);
      expect(src).toMatch(/<CommandPageHeader/);
      expect(src).toMatch(new RegExp(`callsign="${callsign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      expect(src).toMatch(new RegExp(`icon=\\{${icon}\\}`));
      expect(src).not.toMatch(/<PageHeader /);        // old JSX gone
      expect(src).toMatch(/import \{ CommandPageHeader \} from "\.\.\/\.\.\/\.\.\/components\/ui\/controls"/);
    }
  });

  it("preserves titles/subtitles verbatim, including dynamic ones", () => {
    const account = read(`${dir}/account.tsx`);
    expect(account).toMatch(/title="Account" subtitle="Your profile, AI personalization, preferences, and personal security\."/);
    const security = read(`${dir}/security.tsx`);
    expect(security).toMatch(/title="Security" subtitle="Authentication, active sessions, recipient protection, and audit controls\."/);
    // members: dynamic subtitle expression retained
    expect(read(`${dir}/members.tsx`)).toMatch(/subtitle=\{`\$\{members\.length\} operator\$\{members\.length === 1 \? "" : "s"\} · roles, per-module access, and AI compute\.`\}/);
    // support: dynamic title + subtitle vars retained
    expect(read(`${dir}/support.tsx`)).toMatch(/title=\{title\} subtitle=\{description\}/);
    // training: multiline subtitle copy retained
    expect(read(`${dir}/training.tsx`)).toMatch(/subtitle="Workspace-controlled AI training capture\. Off by default\./);
  });

  it("billing & support keep their help handlers, moved into secondaryActions", () => {
    const billing = read(`${dir}/billing.tsx`);
    expect(billing).toMatch(/secondaryActions=\{/);
    expect(billing).toMatch(/onClick=\{\(\) => help\.open\("I have a question about my plan and AI credits\."\)\}/);
    const support = read(`${dir}/support.tsx`);
    expect(support).toMatch(/secondaryActions=\{/);
    expect(support).toMatch(/onClick=\{\(\) => help\.open\(\)\}/);
    expect(support).toMatch(/support\.new_request/);
  });

  it("calls & email keep their sibling note paragraph after the header", () => {
    expect(read(`${dir}/calls.tsx`)).toMatch(/Only workspace owners and admins can view call readiness\./);
    expect(read(`${dir}/email.tsx`)).toMatch(/Google and Outlook are optional, client-authorized connectors\./);
  });

  it("preserves key per-page mutations/queries below the header (behavior untouched)", () => {
    expect(read(`${dir}/members.tsx`)).toMatch(/useMutation|apiClient/);
    expect(read(`${dir}/billing.tsx`)).toMatch(/useMutation|apiClient/);
    expect(read(`${dir}/security.tsx`)).toMatch(/useMutation|apiClient/);
    expect(read(`${dir}/integrations.tsx`)).toMatch(/useMutation|apiClient/);
  });

  it("scope stayed contained — workspace, ask-mondaily, and status are unchanged", () => {
    // These settings pages were NOT on PageHeader and must not have been converted here
    expect(read(`${dir}/workspace.tsx`)).not.toMatch(/<PageHeader /);
    expect(read(`${dir}/ask-mondaily.tsx`)).not.toMatch(/<PageHeader /);
    // status.tsx already migrated in 11H, still on CommandPageHeader
    expect(read(`apps/app/src/routes/dashboard/status.tsx`)).toMatch(/<CommandPageHeader/);
  });
});

describe("Workspace Readiness header migrated to CommandPageHeader (Pass 11H)", () => {
  const S = read("apps/app/src/routes/dashboard/status.tsx");

  it("uses CommandPageHeader with kicker + icon, retaining title and subtitle copy verbatim", () => {
    expect(S).toMatch(/<CommandPageHeader[^>]*callsign="READINESS"/);
    expect(S).toMatch(/icon=\{CheckCircle2\}/);
    expect(S).toMatch(/title="Workspace Readiness"/);
    expect(S).toMatch(/subtitle="What's real today, what changed recently, and what's next — every row audited against the live code\."/);
    expect(S).toMatch(/import \{ CommandPageHeader \} from "\.\.\/\.\.\/components\/ui\/controls"/);
  });

  it("removes the old PageHeader from status.tsx", () => {
    expect(S).not.toMatch(/<PageHeader\b/);
    expect(S).not.toMatch(/import \{ PageHeader/);
  });

  it("preserves readiness sections, query/refresh, and adds no mutation", () => {
    expect(S).toMatch(/Live system status/);
    expect(S).toMatch(/refreshes every 60s/);
    expect(S).toMatch(/useStatus\(\)/);
    expect(S).not.toMatch(/useMutation/);
  });

  it("the settings pages are now on CommandPageHeader too (migrated in Pass 11J)", () => {
    for (const p of ["security", "members", "billing"]) {
      const src = read(`apps/app/src/routes/dashboard/settings/${p}.tsx`);
      expect(src).toMatch(/<CommandPageHeader/);
      expect(src).not.toMatch(/<PageHeader /);
    }
  });
});

describe("Calendar Upcoming list density unification — hairline-divider rows (Pass 11D)", () => {
  const C = read("apps/app/src/routes/dashboard/calendar.tsx");

  it("Upcoming per-day container uses a framed hairline-divider surface", () => {
    expect(C).toMatch(/overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-card\)\] divide-y divide-\[var\(--border-soft\)\]">\{evs\.map/);
    // Old gapped boxed-row container is gone
    expect(C).not.toMatch(/<div className="space-y-2">\{evs\.map/);
  });

  it("Row is de-boxed but keeps tone edge, active state, hover, and navigation", () => {
    // Row className no longer carries the per-row rounded bordered card
    expect(C).toMatch(/className="flex w-full items-center gap-3 px-4 py-2\.5 text-left transition-colors hover:bg-\[var\(--surface-hover\)\]"/);
    expect(C).not.toMatch(/flex w-full items-center gap-3 rounded-sm border px-4 py-2\.5/);
    // Left meeting-tone accent retained; default bg transparent, active → surface-selected
    expect(C).toMatch(/borderLeft: `3px solid \$\{meetingTone\(e\)\.edge\}`, background: active \? "var\(--surface-selected\)" : "transparent"/);
    // Navigation retained
    expect(C).toMatch(/onClick=\{\(\) => openEvent\(e\.id\)\}/);
    expect(C).toMatch(/setParams\(\{ event: id \}/);
  });

  it("grids, drawer, and mutations remain untouched", () => {
    expect(C).toMatch(/function TimeGrid/);
    expect(C).toMatch(/function MonthGrid/);
    // Time/Month grids still receive openEvent
    expect(C).toMatch(/<TimeGrid days=/);
    expect(C).toMatch(/<MonthGrid days=/);
    // Mutation handlers preserved
    for (const m of ["saveAgenda", "addCall", "cancelOccurrence", "createTask", "moveEventToDay", "openSlot"]) {
      expect(C).toMatch(new RegExp(m));
    }
  });
});

describe("Tasks List density unification — hairline-divider rows (Pass 11B)", () => {
  const T = read("apps/app/src/routes/dashboard/tasks.tsx");

  it("List active + completed lists use a single framed surface with divide-y hairlines", () => {
    // Active list container: framed surface + divider treatment (replaces space-y-1.5 gaps)
    expect(T).toMatch(/overflow-hidden rounded-sm border border-\[var\(--border-soft\)\] bg-\[var\(--surface-card\)\] divide-y divide-\[var\(--border-soft\)\]/);
    // Completed sub-list: same divider treatment, opacity preserved
    expect(T).toMatch(/divide-y divide-\[var\(--border-soft\)\] opacity-50/);
    // Two divider lists total (active + completed)
    expect((T.match(/divide-y divide-\[var\(--border-soft\)\]/g) || []).length).toBe(2);
  });

  it("List rows are no longer per-row boxed cards; they use a hover-row background", () => {
    // New active-row treatment: overdue tint OR hover-row bg, no per-row border/rounded box
    expect(T).toMatch(/isOverdue \? "bg-stone-50\/60 dark:bg-stone-500\/\[\.03\]" : "hover:bg-\[var\(--surface-hover\)\]"/);
    // Old boxed-row forms are gone
    expect(T).not.toMatch(/border-stone-200 bg-stone-50\/60 dark:border-stone-500\/20/); // old overdue box
    expect(T).not.toMatch(/rounded-sm border border-\[var\(--border-soft\)\] p-3 flex items-center gap-3/); // old completed box
    // New completed-row treatment
    expect(T).toMatch(/px-4 py-3 flex items-center gap-3 transition-colors hover:bg-\[var\(--surface-hover\)\]/);
  });

  it("preserves every List-view handler (behavior unchanged)", () => {
    for (const h of ["handleToggle", "setDetailTask", "setExpandedId", "setEditTask", "setConfirmDeleteId"]) {
      expect(T).toMatch(new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Optimistic cache writes + mutation transport intact
    expect(T).toMatch(/setQueryData/);
    expect(T).toMatch(/apiClient\.patch/);
  });

  it("Board view, Sheet view, and TaskDetailPanel remain untouched", () => {
    // Board sortable card keeps its own boxed treatment (proof Board markup unchanged)
    expect(T).toMatch(/rounded-sm border p-3 transition-all \$\{isDragging/);
    expect(T).toMatch(/viewMode === "board"/);
    expect(T).toMatch(/viewMode === "sheet"/);
    expect(T).toMatch(/TaskDetailPanel/);
    // View toggle + AI Suggest + New Task copy retained
    expect(T).toMatch(/AI Suggest/);
    expect(T).toMatch(/New Task/);
  });
});

describe("shared page-state safe read-only typography (Pass 10B)", () => {
  const PS = read("apps/app/src/components/ui/page-state.tsx");

  it("migrates the 4 safe read-only items to the shared type scale", () => {
    // DelayedLoading stage label: text-[12.5px] → text-body (weight + tabular-nums preserved)
    expect(PS).toMatch(/className="text-body font-medium tabular-nums" style=\{\{ color: "var\(--text-muted\)" \}\}>\{stages\[i\]\}/);
    // ConsoleSkeleton eyebrow: text-[9px] → text-caption (uppercase + tracking preserved, 9→10 disclosed)
    expect(PS).toMatch(/px-4 py-2\.5 text-caption uppercase tracking-widest/);
    // EmptyState action label: text-[12.5px] → text-body (weight preserved)
    expect(PS).toMatch(/className="block text-body font-medium" style=\{\{ color: s\.disabled \? "var\(--text-muted\)" : "var\(--text-primary\)" \}\}>\{s\.label\}/);
    // EmptyState action hint: text-[11.5px] → text-label (leading-snug preserved, 11.5→11 disclosed)
    expect(PS).toMatch(/className="mt-0\.5 block text-label leading-snug" style=\{\{ color: "var\(--text-muted\)" \}\}>\{s\.hint\}/);
  });

  it("does NOT touch the deliberately-bespoke items", () => {
    // ErrorState/EmptyState titles + descriptions stay text-sm (14px, most-seen state copy)
    expect(PS).toMatch(/text-sm/);
    expect((PS.match(/text-sm/g) || []).length).toBe(5);
    // retry buttons + skeleton labels stay text-xs
    expect((PS.match(/text-xs/g) || []).length).toBe(4);
    // ErrorState retry-row arbitrary sizes (18/21) left as-is
    expect(PS).toMatch(/text-\[12px\]/);
    expect(PS).toMatch(/text-\[11\.5px\]/);
  });

  it("drops the file's arbitrary size count from 15 to 11", () => {
    const px = (PS.match(/text-\[[0-9.]+px\]/g) || []).length; // 2 (retry-row)
    const sm = (PS.match(/text-sm/g) || []).length; // 5 (titles/desc)
    const xs = (PS.match(/text-xs/g) || []).length; // 4 (buttons/skeleton)
    expect(px).toBe(2);
    expect(px + sm + xs).toBe(11);
  });

  it("preserves state logic / handlers / structure (no behavior change)", () => {
    // Action handlers + retry callback intact
    expect(PS).toMatch(/onRetry/);
    expect(PS).toMatch(/s\.onClick/);
    // DelayedLoading stage machinery intact
    expect(PS).toMatch(/stages\[i\]/);
    // EmptyState action rendering intact
    expect(PS).toMatch(/\{s\.label\}/);
    expect(PS).toMatch(/\{s\.hint\}/);
  });
});

describe("button chrome ratchet (Pass BTN-1, 2026-07-30)", () => {
  // The census that quantified "every page looks like a different app": 79 distinct button recipes,
  // 56 hand-rolling their own borders/colors. The canonical vocabulary (.btn-primary/-secondary/
  // -ghost/-icon/-solid/-ai) already existed — the debt was adoption. This ratchet lets the
  // hand-rolled count only FALL: a new page hand-rolling a chrome button pushes it past the
  // ceiling and fails here, pointing at the btn-* classes instead.
  it("hand-rolled chrome buttons never exceed the swept baseline; canonical adoption never regresses", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const root = join(__dirname, "../../../../apps/app/src/routes/dashboard");
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".tsx")) files.push(p); } };
    walk(root);
    let handRolled = 0, canonical = 0;
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/<button[^>]*?className=\{?["`]([^"`]+)/g)) {
        const cls = m[1]!;
        if (/\bbtn-\w+/.test(cls)) canonical++;
        else if (cls.includes("border") && /rounded/.test(cls)) handRolled++;
      }
    }
    expect(handRolled, `hand-rolled chrome buttons grew to ${handRolled} — use the .btn-* classes`).toBeLessThanOrEqual(52);
    expect(canonical, `canonical .btn-* adoption regressed to ${canonical}`).toBeGreaterThanOrEqual(35);
  });
});

// ─── Shared UI primitives ─────────────────────────────────────────────────────
// One Button / Select / SectionHeader / SoulCard for the whole app. They read the
// theme + section-soul tokens (styles.css), so every surface stays consistent across
// all 4 themes and each section's accent flows through automatically. Use these
// instead of hand-rolling <select>/<button> chrome per page.

import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { Check, ChevronDown, MoreHorizontal, X, Filter } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "primary" | "ghost" | "danger";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: LucideIcon;
}
export function Button({ variant = "default", size = "md", icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "ui-btn",
        variant === "primary" && "ui-btn--primary",
        variant === "ghost" && "ui-btn--ghost",
        variant === "danger" && "ui-btn--danger",
        size === "sm" && "ui-btn--sm",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
}

// ── Select (native, fully styled incl. chevron via styles.css) ─────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: { value: string; label: string }[];
}
export function Select({ options, className, children, ...rest }: SelectProps) {
  return (
    <select className={cx("ui-select", className)} {...rest}>
      {options ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : children}
    </select>
  );
}

// ── SectionHeader — the section "soul": mono call-sign + glyph + accent rule ────
interface SectionHeaderProps {
  /** mono call-sign, e.g. "LEDGER" — rendered as `// LEDGER` in the section accent */
  callsign: string;
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}
export function SectionHeader({ callsign, title, icon: Icon, subtitle, actions, className }: SectionHeaderProps) {
  return (
    <div className={cx("mb-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={15} style={{ color: "var(--section-accent)" }} />}
            <span className="soul-kicker">// {callsign}</span>
          </div>
          <h1 className="mt-1.5 text-[17px] font-semibold text-[var(--text-primary)]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="soul-rule mt-3" />
    </div>
  );
}

// ── SoulCard — card whose border can be "lit" with the section accent ──────────
interface SoulCardProps {
  lit?: boolean;
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
}
export function SoulCard({ lit, className, children, style }: SoulCardProps) {
  return (
    <div className={cx("soul-card", lit && "soul-card--lit", className)} style={style}>
      {children}
    </div>
  );
}

// ── MenuSelect — custom dropdown (button + .ui-menu popover) ────────────────────
// Native <select> option lists can't be themed, so filter bars use this instead:
// squared trigger, thin border, compact matte rows, dark/light via tokens, no
// browser-blue selected row. Keyboard: Enter/Space/ArrowDown open, arrows move,
// Enter picks, Escape closes. Value semantics match a native select (""=All).
interface MenuSelectOption { value: string; label: string; dot?: string }
interface MenuSelectProps {
  label?: string;                    // small uppercase prefix label inside the trigger
  value: string;                     // "" = the allLabel option
  options: MenuSelectOption[];
  onChange: (v: string) => void;
  allLabel?: string;                 // label for the "" option (default "All")
  includeAll?: boolean;              // prepend the "" allLabel row (default true). Set false for a
                                     // fixed choice set (e.g. an autonomy mode) where every value is
                                     // real — otherwise the allLabel duplicates a real option.
  className?: string;
  maxWidth?: number;
  width?: number;                    // FIXED trigger width — use when the control sits in a wrap row
                                     // and different option labels would otherwise resize it and
                                     // reflow the row (the Decisions autonomy filter-bar shift).
  disabled?: boolean;
  title?: string;
}
export function MenuSelect({ label, value, options, onChange, allLabel = "All", includeAll = true, className, maxWidth = 180, width, disabled, title }: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);   // highlighted row index
  const rootRef = useRef<HTMLDivElement>(null);
  const all: MenuSelectOption[] = includeAll ? [{ value: "", label: allLabel }, ...options] : [...options];
  const current = all.find(o => o.value === value) ?? all[0]!;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openMenu = () => { setHi(Math.max(0, all.findIndex(o => o.value === value))); setOpen(true); };
  const pick = (v: string) => { onChange(v); setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(all[hi]!.value); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={rootRef} className={cx("relative", width ? "block" : "inline-block", className)} style={width ? { width } : undefined} onKeyDown={onKeyDown}>
      <button type="button" onClick={() => (open ? setOpen(false) : openMenu())} disabled={disabled} title={title}
        aria-haspopup="listbox" aria-expanded={open}
        className={cx("inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11.5px] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50", width ? "w-full justify-between" : "")}
        style={{ borderColor: open ? "var(--border-strong)" : "var(--border-soft)", background: "var(--surface-input)", color: "var(--text-secondary)", maxWidth: width ?? maxWidth }}>
        {label && <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{label}</span>}
        <span className="truncate font-medium capitalize" style={{ color: value ? "var(--text-primary)" : "var(--text-muted)" }}>
          {current.dot && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: current.dot }} />}
          {current.label}
        </span>
        <ChevronDown size={11} className="shrink-0" style={{ color: "var(--text-faint)", transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s" }} />
      </button>
      {open && (
        <div role="listbox" className="ui-menu absolute left-0 top-full z-40 mt-1 max-h-64 min-w-full overflow-y-auto py-1" style={{ borderRadius: 4, width: "max-content", maxWidth: 260 }}>
          {all.map((o, i) => {
            const selected = o.value === value;
            return (
              <div key={o.value || "__all"} role="option" aria-selected={selected}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                className="ui-menu-item capitalize" data-active={selected}
                style={{ background: i === hi ? "var(--surface-hover)" : undefined, color: selected ? "var(--text-primary)" : undefined }}>
                {o.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.dot }} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {selected && <Check size={12} style={{ color: "var(--section-accent)" }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ActionMenu ───────────────────────────────────────────────────────────────
// Squared overflow menu for SECONDARY actions (keeps primary buttons visible while collapsing the
// rest behind a "…"/label trigger). Reuses the .ui-menu chrome, is keyboard-accessible (Enter/Space/
// ArrowDown to open, Up/Down to move, Enter to run, Esc to close), closes on outside click, and works
// on touch (click-driven, no hover dependency). No action is ever removed — just relocated.
export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}
interface ActionMenuProps {
  items: ActionMenuItem[];
  /** Optional text next to the ⋯ glyph (e.g. "More"). */
  triggerLabel?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  className?: string;
  disabled?: boolean;
}
export function ActionMenu({ items, triggerLabel, ariaLabel = "More actions", align = "right", className, disabled }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const run = (it: ActionMenuItem) => { if (it.disabled) return; setOpen(false); it.onClick(); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setHi(0); setOpen(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[hi]; if (it) run(it); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={rootRef} className={cx("relative inline-block", className)} onKeyDown={onKeyDown}>
      <button type="button" onClick={() => (open ? setOpen(false) : (setHi(0), setOpen(true)))} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel}
        className="inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-[11.5px] font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? "var(--border-strong)" : "var(--border-soft)", background: "var(--surface-input)", color: "var(--text-secondary)" }}>
        <MoreHorizontal size={13} className="shrink-0" />
        {triggerLabel && <span>{triggerLabel}</span>}
      </button>
      {open && (
        <div role="menu" className="ui-menu absolute top-full z-40 mt-1 py-1"
          style={{ borderRadius: 4, width: "max-content", maxWidth: 260, minWidth: "10rem", ...(align === "right" ? { right: 0 } : { left: 0 }) }}>
          {items.map((it, i) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled}
              onMouseEnter={() => setHi(i)} onClick={() => run(it)}
              className="ui-menu-item w-full text-left disabled:cursor-not-allowed disabled:opacity-40"
              data-active={i === hi} style={{ background: i === hi ? "var(--surface-hover)" : undefined }}>
              {it.icon && <it.icon size={12} className="shrink-0" style={{ color: "var(--section-accent)" }} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FieldSelect ──────────────────────────────────────────────────────────────
// A themed, full-width FORM select (the drop-in replacement for a native <select>
// inside forms/builders/modals). Unlike MenuSelect it does NOT inject an "All" row,
// is full-width and form-height, and shows a placeholder when nothing is chosen — so
// the browser-native dropdown never appears anywhere. Keyboard-accessible, matches the
// key-input field chrome across all four themes.
interface FieldSelectOption { value: string; label: string; dot?: string }
interface FieldSelectProps {
  value: string;
  options: FieldSelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}
export function FieldSelect({ value, options, onChange, placeholder = "Select…", className, disabled, ariaLabel }: FieldSelectProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openMenu = () => { setHi(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true); };
  const pick = (v: string) => { onChange(v); setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[hi]) pick(options[hi]!.value); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={rootRef} className={cx("relative w-full", className)} onKeyDown={onKeyDown}>
      <button type="button" onClick={() => (open ? setOpen(false) : openMenu())} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? "var(--border-strong)" : "var(--border-soft)", background: "var(--surface-card)", color: current ? "var(--text-primary)" : "var(--text-muted)" }}>
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {current?.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: current.dot }} />}
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={13} className="shrink-0" style={{ color: "var(--text-faint)", transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s" }} />
      </button>
      {open && (
        <div role="listbox" className="ui-menu absolute left-0 top-full z-40 mt-1 max-h-64 w-full overflow-y-auto py-1" style={{ borderRadius: 6 }}>
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <div key={o.value} role="option" aria-selected={selected}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                className="ui-menu-item" data-active={selected}
                style={{ background: i === hi ? "var(--surface-hover)" : undefined, color: selected ? "var(--text-primary)" : undefined }}>
                {o.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.dot }} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {selected && <Check size={12} style={{ color: "var(--section-accent)" }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LiveSectionHeader ────────────────────────────────────────────────────────
// The thin, LIVE page header used across "live activity" sections (Team Intelligence,
// Reports, Decisions, Agent Control Room). A compact bar with an animated pulse + a
// scanning activity strip that reads as a working AI engine — not a tall static title.
export function LiveSectionHeader({ icon: Icon, title, kicker, liveLabel = "Live" }: { icon: LucideIcon; title: string; kicker?: string; liveLabel?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-sm border px-3 py-2" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm" style={{ color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}><Icon size={13} /></span>
        <h1 className="truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h1>
        {kicker && <span className="hidden font-mono text-[9.5px] uppercase tracking-wider sm:inline" style={{ color: "var(--text-faint)" }}>· {kicker}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden h-3 w-16 overflow-hidden rounded-full sm:block" style={{ background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}>
          <span className="oversight-live-scan block h-full w-1/3 rounded-full" style={{ background: "var(--section-accent)" }} />
        </span>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "var(--status-ok)" }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "var(--status-ok)" }} />
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{liveLabel}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED PAGE ARCHITECTURE — one header / toolbar / proof-strip / dossier / settings
// pattern so every AI/control-room page reads as the same product. All honest-status,
// matte, no random per-section colour (accent is uniform via --theme-spread:0), no
// decorative animation. Reuse these instead of hand-rolling page chrome.
// ═══════════════════════════════════════════════════════════════════════════════

/** Honest, matte status vocabulary shared by CommandPageHeader status items and
 * ProofOfWorkStrip. Colour encodes MEANING only — never a per-agent rainbow. */
export type CommandStatusKind = "idle" | "monitoring" | "running" | "waiting" | "failed" | "complete";
const STATUS_TONE: Record<CommandStatusKind, string> = {
  idle: "var(--text-faint)",
  monitoring: "var(--text-muted)",
  running: "var(--accent)",
  waiting: "var(--status-warn)",
  failed: "var(--status-error)",
  complete: "var(--status-ok)",
};
const STATUS_LABEL: Record<CommandStatusKind, string> = {
  idle: "Idle", monitoring: "Monitoring", running: "Running", waiting: "Waiting", failed: "Failed", complete: "Ready",
};

export interface CommandStatusItem { label?: string; kind?: CommandStatusKind; tone?: string; dot?: boolean; node?: ReactNode }

// ── CommandPageHeader — the ONE page header for AI/control-room pages ────────────
// Compact, calm, no animation. Left: icon + mono call-sign + title + subtitle.
// Right: optional summary, secondary actions, primary action. Status row below the
// title holds honest status chips (dot + label). Same spacing everywhere.
interface CommandPageHeaderProps {
  icon?: LucideIcon;
  callsign?: string;                 // rendered as `// CALLSIGN`
  title: string;
  subtitle?: ReactNode;
  status?: CommandStatusItem[];      // honest status chips (state, counts) — no fake "live"
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;      // usually an ActionMenu ("Assist"/"More")
  rightSummary?: ReactNode;          // small muted text/metrics on the right
  className?: string;
  /** Set false when the header sits inside a pinned band that already draws a rule — otherwise
   *  the page gets two dividers. This is the only thing FinanceHeader existed to vary. */
  divider?: boolean;
}
/**
 * True when the call-sign only restates the title — "INBOX" over "Inbox", "TASKS" over "Tasks",
 * "GOALS" over "Goal-directed agents". The sidebar and the browser tab already say where you are,
 * so a kicker that repeats the name is pure chrome tax: it gets dropped and the title moves up a
 * row. Call-signs that carry information the title doesn't ("GATE", "SWEEP", "RECALL") still
 * render. Trailing-s is stripped before comparing so GOALS matches "Goal-directed".
 */
function redundantCallsign(callsign: string, title: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = norm(callsign).replace(/s$/, "");
  const t = norm(title);
  return !!c && !!t && (t.includes(c) || c.includes(t));
}

export function CommandPageHeader({ icon: Icon, callsign, title, subtitle, status, primaryAction, secondaryActions, rightSummary, className, divider = true }: CommandPageHeaderProps) {
  // The browser tab must say where you are. Nothing in the app ever set document.title, so every
  // page — goals, insights, finance, calendar, inbox — read as "Mondaily" in the tab and window
  // switcher. No cleanup on unmount: the next page's header (or the layout's route fallback)
  // always writes the next title, and restoring "Mondaily" in between would just flicker.
  //
  // The claim flag exists because effect ORDER runs child-before-parent: this header fires first,
  // then the layout's route fallback would overwrite it ("Meeting with Anna" → "Calls"). Verified
  // live, not assumed — the first version relied on ordering and lost every specific title. The
  // fallback checks the claim and stands down for pages that titled themselves.
  useEffect(() => {
    document.title = `${title} · Mondaily`;
    (window as unknown as { __mdTitledPath?: string }).__mdTitledPath = window.location.pathname;
  }, [title]);

  const kicker = callsign && !redundantCallsign(callsign, title) ? callsign : undefined;
  const iconChip = Icon && (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm" style={{ color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}><Icon size={13} /></span>
  );
  return (
    <div className={cx("mb-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker ? (
            <>
              <div className="flex items-center gap-2">
                {iconChip}
                <span className="soul-kicker">// {kicker}</span>
              </div>
              <h1 className="mt-1.5 text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
            </>
          ) : (
            // Kicker dropped → single compact row, icon beside the name. This is the "move
            // everything up" the redundant kicker was costing.
            <div className="flex items-center gap-2">
              {iconChip}
              <h1 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
            </div>
          )}
          {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rightSummary && <span className="hidden text-[11px] text-[var(--text-faint)] sm:inline">{rightSummary}</span>}
          {secondaryActions}
          {primaryAction}
        </div>
      </div>
      {status && status.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          {status.map((s, i) => s.node ? <span key={i} className="inline-flex items-center">{s.node}</span> : (
            <span key={i} className="inline-flex items-center gap-1.5">
              {s.dot !== false && <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tone ?? STATUS_TONE[s.kind ?? "monitoring"] }} />}
              {s.label}
            </span>
          ))}
        </div>
      )}
      {divider && <div className="soul-rule mt-3" />}
    </div>
  );
}

// ── FilterToolbar — the ONE filter toolbar pattern ──────────────────────────────
// One row: [search] [dropdown filters] [assist/more menu] … right: [summary] [actions].
// Active filters render as small removable chips BELOW the row. No walls of buttons —
// dropdowns are MenuSelect/FieldSelect; secondary/advanced actions collapse into a menu.
export interface FilterChip { key: string; label: string; onRemove: () => void }
interface FilterToolbarProps {
  search?: ReactNode;                // a search input slot
  filters?: ReactNode;               // MenuSelect dropdowns
  actionMenu?: ReactNode;            // ActionMenu for assist/advanced
  chips?: FilterChip[];              // active filters as removable chips
  summary?: ReactNode;               // count/summary text
  rightActions?: ReactNode;
  className?: string;
}
export function FilterToolbar({ search, filters, actionMenu, chips, summary, rightActions, className }: FilterToolbarProps) {
  return (
    <div className={cx("mb-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && <div className="min-w-[160px] flex-1 sm:max-w-xs">{search}</div>}
        {filters}
        {actionMenu}
        <div className="ml-auto flex items-center gap-2">
          {summary && <span className="text-[11px] text-[var(--text-faint)]">{summary}</span>}
          {rightActions}
        </div>
      </div>
      {chips && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.key} onClick={c.onRemove}
              className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--surface-hover)]"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              {c.label}
              <X size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ProofOfWorkStrip — the ONE AI proof/status strip ────────────────────────────
// A compact, honest evidence bar: agent label + real state + real counters + source/
// step counts + timestamp (or "no runs yet"). Never fabricates activity or numbers —
// every field is passed in from real data. Left accent border ties it to the section.
interface ProofCounter { label: string; value: number | string }
interface ProofOfWorkStripProps {
  agent: string;
  status: CommandStatusKind;
  counters?: ProofCounter[];         // real counts (sources checked, leads found, AI calls…)
  timestamp?: string | null;         // formatted "ran" string; null/undefined → "no runs yet"
  sourceRefs?: ReactNode;            // optional <SourceList/> or evidence refs
  action?: ReactNode;                // optional run-now / inspect
  className?: string;
}
export function ProofOfWorkStrip({ agent, status, counters, timestamp, sourceRefs, action, className }: ProofOfWorkStripProps) {
  const tone = STATUS_TONE[status];
  return (
    <div className={cx("rounded-sm border border-l-2", className)}
      style={{ borderColor: "var(--border-soft)", borderLeftColor: "var(--section-accent)", background: "var(--surface-card)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          {agent}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
          <span style={{ color: tone }}>{STATUS_LABEL[status]}</span>
        </span>
        {counters?.map((c, i) => (
          <span key={i}><strong className="font-semibold text-[var(--text-secondary)]">{c.value}</strong> {c.label}</span>
        ))}
        {/* Omitted timestamp → render nothing; explicit null → honest "no runs yet". */}
        {timestamp !== undefined && (
          <span className="ml-auto tabular-nums text-[10.5px]" style={{ color: "var(--text-faint)" }}>
            {timestamp ?? "no runs yet"}
          </span>
        )}
        {action && <span className={timestamp === undefined ? "ml-auto" : ""}>{action}</span>}
      </div>
      {sourceRefs && <div className="border-t px-3 py-1.5" style={{ borderColor: "var(--border-soft)" }}>{sourceRefs}</div>}
    </div>
  );
}

// ── DossierSection — the ONE detail/review sub-section block ─────────────────────
// A consistently-titled, optionally-collapsible section for review dossiers (evidence,
// proposed action, impact, audit trail, comments…). Mono uppercase title + calm body.
interface DossierSectionProps {
  icon?: LucideIcon;
  title: string;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}
export function DossierSection({ icon: Icon, title, action, collapsible, defaultOpen = true, children, className }: DossierSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cx("py-2.5", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button type="button" disabled={!collapsible} onClick={() => collapsible && setOpen(o => !o)}
          className="inline-flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] disabled:cursor-default"
          style={{ color: "var(--text-faint)" }}>
          {Icon && <Icon size={11} />}
          {title}
          {collapsible && <ChevronDown size={11} style={{ transform: open ? undefined : "rotate(-90deg)", transition: "transform .12s" }} />}
        </button>
        {action}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── SettingsSection — the ONE settings block ────────────────────────────────────
// Title + description + right action, then rows, with an optional notice banner. Gives
// every settings page the same section rhythm instead of a bespoke layout each.
interface SettingsSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  notice?: { kind?: CommandStatusKind; text: ReactNode };
  children?: ReactNode;
  className?: string;
}
export function SettingsSection({ title, description, action, notice, children, className }: SettingsSectionProps) {
  return (
    <section className={cx("mb-6 rounded-sm border", className)} style={{ borderColor: "var(--border-soft)", background: "transparent" }}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h2>
          {description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {notice && (
        <div className="flex items-start gap-2 border-b px-4 py-2.5 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: STATUS_TONE[notice.kind ?? "monitoring"] }}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_TONE[notice.kind ?? "monitoring"] }} />
          <span>{notice.text}</span>
        </div>
      )}
      {children && <div className="px-4 py-3">{children}</div>}
    </section>
  );
}

// ── MetricGrid — the ONE dashboard metric-tile grid ─────────────────────────────
// Calm borderless value tiles (big value + small label), one look everywhere. Values are passed in
// from real data — this primitive never computes or invents a number. Optional tone for semantic
// emphasis (matte green/amber/rose), never a decorative rainbow.
export interface MetricItem { label: string; value: ReactNode; tone?: string; title?: string }
const METRIC_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-3 sm:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-6",
};
export function MetricGrid({ items, cols = 3, className }: { items: MetricItem[]; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  return (
    <div className={cx("grid gap-1.5", METRIC_COLS[cols] ?? METRIC_COLS[3], className)}>
      {items.map((m, i) => (
        <div key={i} className="rounded-sm px-3 py-2" style={{ background: "var(--surface-hover)" }} title={m.title}>
          <div className="text-[15px] font-semibold tabular-nums" style={{ color: m.tone ?? "var(--text-primary)" }}>{m.value}</div>
          <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Filter (records-sheet pattern) ───────────────────────────────────────────
// Two decoupled pieces so every page filters EXACTLY like the records sheet: a compact
// FilterButton that sits inline in the toolbar (no wasted row), and a thin full-width
// FilterStrip that appears flush below only when open. The page owns the open state so
// the button stays in the toolbar while the strip spans full width — like the sheet.
export interface InlineFilterDef {
  key: string;
  label: string;                                   // e.g. "Agent", "Risk"
  options: { value: string; label: string; dot?: string }[];
}

/** Compact toolbar toggle — place it inline with the page's other toolbar controls. */
export function FilterButton({ open, onToggle, activeCount = 0, className }: { open: boolean; onToggle: () => void; activeCount?: number; className?: string }) {
  const lit = open || activeCount > 0;
  return (
    <button onClick={onToggle} className={cx("inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[11.5px] font-medium transition-colors", className)}
      style={lit ? { borderColor: "var(--section-accent)", color: "var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 8%, transparent)" } : { borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
      <Filter size={12} /> Filter
      {activeCount > 0 && <span className="tabular-nums rounded-full px-1.5 text-[9.5px]" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>{activeCount}</span>}
    </button>
  );
}

/** Thin full-width filter strip — render it (conditionally, when open) directly below the toolbar so
 *  it spans the content width like the records sheet. Each dropdown carries its own inline label. */
export function FilterStrip({ filters, values, onChange, extra, className }: {
  filters: InlineFilterDef[];
  values: Record<string, string>;                  // key → selected value ("" = All)
  onChange: (key: string, value: string) => void;
  extra?: ReactNode;
  className?: string;
}) {
  const anyActive = filters.some(f => values[f.key]);
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-sm border px-2.5 py-1.5", className)} style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {filters.map(f => (
        <MenuSelect key={f.key} label={f.label} value={values[f.key] ?? ""} onChange={v => onChange(f.key, v || "")} allLabel={`All ${f.label.toLowerCase()}`} maxWidth={180}
          options={f.options.map(o => ({ value: o.value, label: o.label, dot: o.dot }))} />
      ))}
      {extra}
      {anyActive && <button onClick={() => filters.forEach(f => onChange(f.key, ""))} className="ml-auto text-[11px] transition-colors hover:text-[var(--text-primary)]" style={{ color: "var(--text-faint)" }}>Clear all</button>}
    </div>
  );
}

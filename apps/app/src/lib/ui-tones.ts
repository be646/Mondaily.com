/**
 * THE shared matte tone palette for the flat-line design system — the single place that defines
 * semantic UI colors. Import from here instead of hardcoding bright Tailwind utilities.
 *
 * Semantics:
 *   green  = healthy / ready / success
 *   amber  = needs attention / pending
 *   rose   = risk / error / destructive
 *   slate  = AI / source / informational
 *   stone  = idle / neutral / unknown
 *
 * All values are matte (desaturated) opacity tints, so one class string works in both light and
 * dark mode. IMPORTANT: every class string below is a COMPLETE STATIC LITERAL — Tailwind's JIT
 * scanner only generates CSS for classes it sees verbatim in source, so never build these with
 * template interpolation.
 */
export const TONE_HEX = {
  green: "#2f9e6b",
  amber: "#c6892e",
  rose:  "#d1524a",
  slate: "#717784",
} as const;
export type Tone = keyof typeof TONE_HEX | "stone";

/** Small status pill: thin border + tint + matte text. */
const PILL: Record<Tone, string> = {
  green: "bg-[#2f9e6b]/10 text-[#2f9e6b] border border-[#2f9e6b]/25",
  amber: "bg-[#c6892e]/10 text-[#c6892e] border border-[#c6892e]/25",
  rose:  "bg-[#d1524a]/10 text-[#d1524a] border border-[#d1524a]/25",
  slate: "bg-[#717784]/10 text-[#717784] border border-[#717784]/25",
  stone: "bg-stone-500/[.08] text-stone-500 dark:text-stone-400 border border-stone-500/20",
};
export function tonePill(tone: Tone): string { return PILL[tone]; }

/** Status dot class. */
const DOT: Record<Tone, string> = {
  green: "bg-[#2f9e6b]",
  amber: "bg-[#c6892e]",
  rose:  "bg-[#d1524a]",
  slate: "bg-[#717784]",
  stone: "bg-stone-500",
};
export function toneDot(tone: Tone): string { return DOT[tone]; }

/** Matte text-only class per tone. */
const TEXT: Record<Tone, string> = {
  green: "text-[#2f9e6b]",
  amber: "text-[#c6892e]",
  rose:  "text-[#d1524a]",
  slate: "text-[#717784]",
  stone: "text-stone-500 dark:text-stone-400",
};
export function toneText(tone: Tone): string { return TEXT[tone]; }

/** Filter chip / segmented option: neutral base, subtle active. */
export const CHIP_BASE = "rounded-sm border px-2.5 py-1 text-[12px] font-medium transition-colors";
export const CHIP_IDLE = "border-[var(--border-soft)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]";
export const CHIP_ACTIVE = "border-[var(--border-strong)] bg-[var(--surface-selected)] text-[var(--text-primary)]";

/** Buttons: primary = high-contrast neutral, secondary = thin border, danger = muted rose. */
export const BTN_PRIMARY = "rounded-sm border border-[var(--border-strong)] bg-[var(--surface-card-2)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50";
export const BTN_SECONDARY = "rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50";
export const BTN_DANGER = "rounded-sm border border-[#d1524a]/40 px-3 py-1.5 text-[12px] font-medium text-[#d1524a] transition-colors hover:bg-[#d1524a]/10 disabled:opacity-50";

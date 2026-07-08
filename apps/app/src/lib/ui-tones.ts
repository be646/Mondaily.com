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
  green: "#5f8169",
  amber: "#97824f",
  rose:  "#9c6b72",
  slate: "#717784",
} as const;
export type Tone = keyof typeof TONE_HEX | "stone";

/** Small status pill: thin border + tint + matte text. */
const PILL: Record<Tone, string> = {
  green: "bg-[#5f8169]/10 text-[#5f8169] border border-[#5f8169]/25",
  amber: "bg-[#97824f]/10 text-[#97824f] border border-[#97824f]/25",
  rose:  "bg-[#9c6b72]/10 text-[#9c6b72] border border-[#9c6b72]/25",
  slate: "bg-[#717784]/10 text-[#717784] border border-[#717784]/25",
  stone: "bg-stone-500/[.08] text-stone-500 dark:text-stone-400 border border-stone-500/20",
};
export function tonePill(tone: Tone): string { return PILL[tone]; }

/** Status dot class. */
const DOT: Record<Tone, string> = {
  green: "bg-[#5f8169]",
  amber: "bg-[#97824f]",
  rose:  "bg-[#9c6b72]",
  slate: "bg-[#717784]",
  stone: "bg-stone-500",
};
export function toneDot(tone: Tone): string { return DOT[tone]; }

/** Matte text-only class per tone. */
const TEXT: Record<Tone, string> = {
  green: "text-[#5f8169]",
  amber: "text-[#97824f]",
  rose:  "text-[#9c6b72]",
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
export const BTN_DANGER = "rounded-sm border border-[#9c6b72]/40 px-3 py-1.5 text-[12px] font-medium text-[#9c6b72] transition-colors hover:bg-[#9c6b72]/10 disabled:opacity-50";

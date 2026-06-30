// ─── Shared UI primitives ─────────────────────────────────────────────────────
// One Button / Select / SectionHeader / SoulCard for the whole app. They read the
// theme + section-soul tokens (styles.css), so every surface stays consistent across
// all 4 themes and each section's accent flows through automatically. Use these
// instead of hand-rolling <select>/<button> chrome per page.

import type { ButtonHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
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

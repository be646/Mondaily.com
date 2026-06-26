import React from "react";
import { LogoMark } from "../logo";

/**
 * AIMark — Mondaily's AI identity lockup: the orbital mark + the word "AI".
 * The logo alone isn't legible enough as "this is AI", so we always pair them.
 * Reuse this anywhere an AI action needs its mark (buttons, chips, headers).
 */
export function AIMark({ size = 13, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <span className="ai-mark" aria-label="AI">
      <LogoMark size={size} thinking={thinking} />
      <span className="ai-mark-label">AI</span>
    </span>
  );
}

/**
 * AIButton — the single, consistent button for every AI action across the app.
 * Carries the AIMark (orbital logo + "AI"), not a bare icon. Two weights:
 *   - "solid"  : high-contrast command block (.btn-ai) — primary AI action
 *   - "subtle" : light chip (.btn-suggested) — secondary / inline suggestion
 */
export function AIButton({
  children,
  onClick,
  variant = "solid",
  size = "md",
  loading = false,
  disabled = false,
  title,
  className = "",
  type = "button",
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: "solid" | "subtle";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const base = variant === "solid" ? "btn-ai" : "btn-suggested";
  const sizeCls = size === "sm" ? "!px-2.5 !py-1 !text-[11px]" : "";
  const markSize = size === "sm" ? 12 : 14;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`${base} ${sizeCls} ${className}`}
    >
      <AIMark size={markSize} thinking={loading} />
      {children}
    </button>
  );
}

import React from "react";
import { LogoMark } from "../logo";

/**
 * AIButton — the single, consistent button for every AI action across the app.
 *
 * It carries Mondaily's own AI identity (the orbital LogoMark), not the generic
 * sparkle icon, so AI actions read the same everywhere. Two visual weights:
 *   - "solid"  : high-contrast command block (.btn-ai) — primary AI action
 *   - "subtle" : light chip (.btn-suggested) — secondary / inline suggestion
 *
 * Use this for: Ask, "AI improve", agent "Run", "Explain reasoning", draft, etc.
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
  children: React.ReactNode;
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
      <LogoMark size={markSize} thinking={loading} />
      {children}
    </button>
  );
}

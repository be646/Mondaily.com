import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";

export const SAGE = "#8fcf7f";

/** Centered dark "Neural Operation Center" auth canvas — font-mono, thin borders, zero jitter. */
export function AuthShell({ kicker, title, subtitle, children, footer }: {
  kicker: string; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 font-mono text-zinc-300">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-[400px] overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/40 shadow-2xl">
        <div className="border-b border-zinc-800 px-6 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: SAGE, boxShadow: `0 0 8px ${SAGE}` }} />
            <span className="text-[10.5px] uppercase tracking-[0.2em] text-zinc-500">{kicker}</span>
          </div>
        </div>
        <div className="px-6 py-6">
          <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="border-t border-zinc-800 px-6 py-3.5 text-[11.5px] text-zinc-500">{footer}</div>}
      </motion.div>
    </div>
  );
}

/** Capsule input with a label, mono text, and a sage focus ring. */
export function CapsuleInput({ label, hint, error, ...props }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        {...props}
        className={`w-full rounded-sm border bg-zinc-950 px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 disabled:opacity-60 ${error ? "border-[#d1524a]" : "border-zinc-800 focus:border-[#8fcf7f]"}`}
      />
      {error ? <span className="mt-1 block text-[10.5px] text-[#d1524a]">{error}</span>
        : hint ? <span className="mt-1 block text-[10.5px] text-zinc-600">{hint}</span> : null}
    </label>
  );
}

/** Sage-outlined glow button with an inline spinner slot. */
export function GlowButton({ children, loading, ...props }: { children: ReactNode; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-sm border px-4 py-2.5 text-[12.5px] font-semibold tracking-wide transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: SAGE, color: SAGE, background: `${SAGE}12`, boxShadow: `0 0 18px ${SAGE}22` }}
    >
      {children}
    </button>
  );
}

"use client";
import { cn } from "../lib/utils";

interface Props {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}

export function MondailyLogo({ className, size = 36, showWordmark = false }: Props) {
  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      {/* Squircle icon */}
      <div
        style={{ width: size, height: size }}
        className="relative shrink-0 rounded-[28%] border border-white/10 bg-[#0c0c14] p-[2px] shadow-[0_0_0_1px_rgba(99,102,241,0.15),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        {/* Gradient border overlay */}
        <div className="absolute inset-0 rounded-[28%] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-pink-500/30 opacity-60 pointer-events-none" />
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 h-full w-full"
        >
          {/* Double-loop M glyph */}
          <path
            d="M6 22 L6 10 L11 18 L16 10 L21 18 L26 10 L26 22"
            stroke="url(#m-grad)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Data vector underline */}
          <path
            d="M8 25 Q16 22 24 25"
            stroke="url(#d-grad)"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.7"
          />
          {/* Node dots */}
          <circle cx="6"  cy="10" r="1.4" fill="#818cf8" opacity="0.9" />
          <circle cx="16" cy="10" r="1.4" fill="#a78bfa" opacity="0.9" />
          <circle cx="26" cy="10" r="1.4" fill="#f472b6" opacity="0.9" />
          <defs>
            <linearGradient id="m-grad" x1="6" y1="10" x2="26" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#818cf8" />
              <stop offset="50%"  stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
            <linearGradient id="d-grad" x1="8" y1="25" x2="24" y2="25" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#6366f1" stopOpacity="0" />
              <stop offset="50%"  stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
          Mondaily
        </span>
      )}
    </div>
  );
}

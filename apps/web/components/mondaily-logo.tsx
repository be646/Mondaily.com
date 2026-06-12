"use client";

interface Props {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}

export function MondailyLogo({ className = "", size = 36, showWordmark = false }: Props) {
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Clean rounded square background */}
        <rect width="40" height="40" rx="10" fill="#111318"/>
        <rect width="40" height="40" rx="10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
        {/* M letterform — clean, geometric, no effects */}
        <path
          d="M9 28 L9 13 L20 24 L31 13 L31 28"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Mondaily
        </span>
      )}
    </div>
  );
}

"use client";

// Flat-top hexagon outer shell + bold almond eye + iris circle.
// No eyelashes, no arrows, no rings. Pure stroke, currentColor.
export function Logo({ size = 40 }: { size?: number }) {
  const fs = Math.round(size * 0.38);

  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: "block" }}
      >
        {/*
          Flat-top hexagon: 6 vertices at 30° increments starting from top-right.
          cx=50 cy=50 r=46
          0°→(96,50) 60°→(73,90) 120°→(27,90) 180°→(4,50) 240°→(27,10) 300°→(73,10)
        */}
        <polygon
          points="96,50 73,90 27,90 4,50 27,10 73,10"
          stroke="currentColor"
          fill="none"
          strokeWidth="5"
          strokeLinejoin="round"
        />

        {/* Bold almond eye — spans ~60% of hex width */}
        <path
          d="M18,50 Q50,24 82,50 Q50,76 18,50 Z"
          stroke="currentColor"
          fill="none"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Iris — clean open circle */}
        <circle
          cx="50" cy="50" r="13"
          stroke="currentColor"
          fill="none"
          strokeWidth="3.5"
        />

        {/* Pupil — solid fill using currentColor */}
        <circle cx="50" cy="50" r="5.5" fill="currentColor" />
      </svg>

      <span
        className="font-orbitron"
        style={{
          fontWeight: 600,
          fontSize: `${fs}px`,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "currentColor",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}

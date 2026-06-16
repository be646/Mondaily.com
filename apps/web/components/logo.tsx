"use client";

export function Logo({ size = 48 }: { size?: number }) {
  const fs = Math.round(size * 0.36);

  return (
    <div className="flex items-center" style={{ gap: Math.round(size * 0.28) }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        {/* ── Outer hexagon ── */}
        <polygon
          points="120,10 208,62 208,178 120,230 32,178 32,62"
          stroke="white" fill="none" strokeWidth="4" strokeLinejoin="round" opacity="0.9"
        />

        {/* Corner bracket notches — open L at each of 6 corners */}
        <polyline points="156,19 188,37 188,58"   stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
        <polyline points="206,96  220,120 206,144" stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
        <polyline points="156,221 188,203 188,182" stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
        <polyline points="84,221  52,203  52,182"  stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
        <polyline points="34,96   20,120  34,144"  stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
        <polyline points="84,19   52,37   52,58"   stroke="white" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>

        {/* ── Middle hexagon ── */}
        <polygon
          points="120,38 188,78 188,162 120,202 52,162 52,78"
          stroke="white" fill="none" strokeWidth="2" strokeLinejoin="round" opacity="0.22"
        />

        {/* ── Inner hexagon ── */}
        <polygon
          points="120,66 168,93 168,147 120,174 72,147 72,93"
          stroke="white" fill="none" strokeWidth="1.5" strokeLinejoin="round" opacity="0.12"
        />

        {/* ── Eye — almond shape ── */}
        <path
          d="M58,120 Q120,70 182,120 Q120,170 58,120Z"
          stroke="white" fill="none" strokeWidth="3.5" strokeLinejoin="round"
        />

        {/* Iris ring */}
        <circle cx="120" cy="120" r="28" stroke="white" fill="none" strokeWidth="2" opacity="0.45"/>

        {/* Pupil — white filled */}
        <circle cx="120" cy="120" r="14" fill="white"/>

        {/* Violet core */}
        <circle cx="120" cy="120" r="9" fill="#7c3aed"/>

        {/* Glint */}
        <path d="M129,109 Q138,104 136,113" stroke="white" fill="none" strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>

        {/* Eyelash rays — 8 lines */}
        <line x1="120" y1="88"  x2="120" y2="70"  stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="146" y1="95"  x2="156" y2="81"  stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="154" y1="120" x2="170" y2="120" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="146" y1="145" x2="156" y2="159" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="120" y1="152" x2="120" y2="170" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="94"  y1="145" x2="84"  y2="159" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="86"  y1="120" x2="70"  y2="120" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="94"  y1="95"  x2="84"  y2="81"  stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>

        {/* Double-headed arrow left side */}
        <line x1="50" y1="120" x2="74" y2="120" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
        <polyline points="55,115 50,120 55,125" stroke="white" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
        <polyline points="69,115 74,120 69,125" stroke="white" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
      </svg>

      {/* Wordmark */}
      <span
        className="font-orbitron"
        style={{
          fontWeight: 500,
          fontSize: `${fs}px`,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "white",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}

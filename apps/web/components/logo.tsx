"use client";

export function Logo({ size = 44, thinking = false }: { size?: number; thinking?: boolean }) {
  const pd = thinking ? "1.6s" : "4s";
  const bd = thinking ? "1.4s" : "6s";
  const sd = thinking ? "0.9s" : "3s";

  return (
    <div className="flex items-center gap-3">
      <>
        <style>{`
          @keyframes ml-pulse-outer { 0%,100%{opacity:1;stroke-width:3} 50%{opacity:0.45;stroke-width:2} }
          @keyframes ml-pulse-mid   { 0%,100%{opacity:0.9;stroke-width:2.5} 50%{opacity:0.3;stroke-width:1.5} }
          @keyframes ml-blink       { 0%,44%,56%,100%{opacity:1} 48%,52%{opacity:0} }
          @keyframes ml-scan        { 0%{stroke-dashoffset:60} 100%{stroke-dashoffset:-60} }
          @keyframes ml-glint       { 0%,78%,100%{opacity:0} 84%,92%{opacity:1} }
          @keyframes ml-notch       { 0%,100%{opacity:0.35} 50%{opacity:1} }
          .ml-hex-outer { animation: ml-pulse-outer var(--ml-pd) ease-in-out infinite; }
          .ml-hex-mid   { animation: ml-pulse-mid   var(--ml-pd) ease-in-out infinite 0.4s; }
          .ml-eye-group { animation: ml-blink var(--ml-bd) ease-in-out infinite; }
          .ml-scan-line { animation: ml-scan  var(--ml-sd) linear infinite; }
          .ml-glint     { animation: ml-glint var(--ml-bd) ease-in-out infinite; }
          .ml-notch     { animation: ml-notch var(--ml-pd) ease-in-out infinite; }
        `}</style>
        <svg
          width={size}
          height={size}
          viewBox="0 0 160 160"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            color: "white",
            ["--ml-pd" as string]: pd,
            ["--ml-bd" as string]: bd,
            ["--ml-sd" as string]: sd,
          }}
        >
          <defs>
            <clipPath id="ml-hex-clip">
              <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" />
            </clipPath>
          </defs>

          {/* Outer hex */}
          <polygon
            className="ml-hex-outer"
            points="80,10 140,45 140,115 80,150 20,115 20,45"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            opacity="0.95"
          />

          {/* Notch ticks */}
          {[
            { x1: 80,  y1: 10,  x2: 80,  y2: 24,  d: "0s"   },
            { x1: 20,  y1: 59,  x2: 30,  y2: 65,  d: "0.3s" },
            { x1: 20,  y1: 97,  x2: 30,  y2: 91,  d: "0.6s" },
            { x1: 140, y1: 59,  x2: 130, y2: 65,  d: "0.9s" },
            { x1: 140, y1: 97,  x2: 130, y2: 91,  d: "1.2s" },
            { x1: 80,  y1: 150, x2: 80,  y2: 136, d: "1.5s" },
          ].map((n, i) => (
            <line
              key={i}
              className="ml-notch"
              x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2}
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              style={{ animationDelay: n.d }}
            />
          ))}

          {/* Mid hex */}
          <polygon
            className="ml-hex-mid"
            points="80,28 122,52 122,108 80,132 38,108 38,52"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            opacity="0.25"
          />

          {/* Eye group */}
          <g className="ml-eye-group">
            <path
              d="M48,80 Q80,50 112,80 Q80,110 48,80Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <circle cx="80" cy="80" r="16" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
            <circle cx="80" cy="80" r="7" fill="currentColor" />
            <circle cx="80" cy="80" r="4.5" fill="#7c3aed" opacity="0.85" />
            <path
              className="ml-glint"
              d="M87,72 Q93,68 91,74"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.7"
            />
          </g>

          {/* Scan line */}
          <line
            className="ml-scan-line"
            x1="48" y1="80" x2="112" y2="80"
            stroke="#7c3aed"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeDasharray="10 6"
            clipPath="url(#ml-hex-clip)"
            opacity="0.65"
          />
        </svg>
      </>

      {/* Wordmark — Orbitron, matched to symbol height */}
      <span
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 400,
          fontSize: `${size * 0.38}px`,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "white",
          lineHeight: 1,
          display: "block",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}

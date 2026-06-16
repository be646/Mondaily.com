"use client";

export function Logo({ size = 44, thinking = false }: { size?: number; thinking?: boolean }) {
  const pd = thinking ? "1.6s" : "4s";
  const bd = thinking ? "1.4s" : "6s";
  const sd = thinking ? "0.9s" : "3s";

  // Wordmark font size matches symbol cap height
  const fontSize = Math.round(size * 0.37);

  return (
    <div className="flex items-center" style={{ gap: Math.round(size * 0.28) }}>
      <>
        <style>{`
          @keyframes ml-pulse-outer { 0%,100%{opacity:1} 50%{opacity:0.5} }
          @keyframes ml-pulse-mid   { 0%,100%{opacity:0.8} 50%{opacity:0.2} }
          @keyframes ml-blink       { 0%,42%,58%,100%{opacity:1} 48%,52%{opacity:0.05} }
          @keyframes ml-scan        { 0%{stroke-dashoffset:80} 100%{stroke-dashoffset:-80} }
          @keyframes ml-glint       { 0%,75%,100%{opacity:0} 82%,92%{opacity:1} }
          @keyframes ml-notch       { 0%,100%{opacity:0.3} 50%{opacity:0.9} }
          @keyframes ml-pupil-glow  { 0%,100%{r:5} 50%{r:6.5} }
          .ml-hex-outer { animation: ml-pulse-outer var(--ml-pd) ease-in-out infinite; }
          .ml-hex-mid   { animation: ml-pulse-mid   var(--ml-pd) ease-in-out infinite 0.5s; }
          .ml-eye-group { animation: ml-blink var(--ml-bd) ease-in-out infinite; }
          .ml-scan-line { animation: ml-scan  var(--ml-sd) linear infinite; }
          .ml-glint     { animation: ml-glint var(--ml-bd) ease-in-out infinite; }
          .ml-notch     { animation: ml-notch var(--ml-pd) ease-in-out infinite; }
        `}</style>
        <svg
          width={size}
          height={size}
          viewBox="0 0 200 200"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            color: "white",
            ["--ml-pd" as string]: pd,
            ["--ml-bd" as string]: bd,
            ["--ml-sd" as string]: sd,
            flexShrink: 0,
          }}
        >
          <defs>
            <clipPath id="ml-hex-clip">
              <polygon points="100,8 176,52 176,148 100,192 24,148 24,52"/>
            </clipPath>
            <radialGradient id="ml-pupil-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#a78bfa"/>
              <stop offset="100%" stopColor="#5b21b6"/>
            </radialGradient>
          </defs>

          {/* Outer hexagon — clean flat-top orientation */}
          <polygon
            className="ml-hex-outer"
            points="100,8 176,52 176,148 100,192 24,148 24,52"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinejoin="round"
          />

          {/* Notch ticks at each vertex */}
          {[
            { x1:100, y1:8,   x2:100, y2:26,  d:"0s"    },
            { x1:24,  y1:52,  x2:38,  y2:60,  d:"0.25s" },
            { x1:24,  y1:148, x2:38,  y2:140, d:"0.5s"  },
            { x1:100, y1:192, x2:100, y2:174, d:"0.75s" },
            { x1:176, y1:148, x2:162, y2:140, d:"1s"    },
            { x1:176, y1:52,  x2:162, y2:60,  d:"1.25s" },
          ].map((n, i) => (
            <line
              key={i}
              className="ml-notch"
              x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2}
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              style={{ animationDelay: n.d }}
            />
          ))}

          {/* Inner ring — subtle depth */}
          <polygon
            className="ml-hex-mid"
            points="100,32 156,64 156,136 100,168 44,136 44,64"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Eye group */}
          <g className="ml-eye-group">
            {/* Eye outline — almond shape */}
            <path
              d="M42,100 Q100,54 158,100 Q100,146 42,100Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            {/* Iris */}
            <circle cx="100" cy="100" r="22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35"/>
            {/* Pupil — white with violet core */}
            <circle cx="100" cy="100" r="11" fill="currentColor"/>
            <circle cx="100" cy="100" r="7" fill="url(#ml-pupil-grad)"/>
            {/* Glint */}
            <path
              className="ml-glint"
              d="M108,90 Q116,85 114,93"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.8"
            />
          </g>

          {/* Violet scan line */}
          <line
            className="ml-scan-line"
            x1="42" y1="100" x2="158" y2="100"
            stroke="#7c3aed"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="12 8"
            clipPath="url(#ml-hex-clip)"
            opacity="0.7"
          />
        </svg>
      </>

      {/* Orbitron wordmark */}
      <span
        className="font-orbitron"
        style={{
          fontWeight: 400,
          fontSize: `${fontSize}px`,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "white",
          lineHeight: 1,
          display: "block",
          whiteSpace: "nowrap",
        }}
      >
        MONDAILY
      </span>
    </div>
  );
}

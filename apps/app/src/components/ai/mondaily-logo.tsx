/**
 * Animated Mondaily logo — hexagon eye mark + wordmark.
 * Pass `thinking={true}` to speed up the scan line and blink on repeat.
 */
export function MondailyLogo({
  size = 40,
  showWordmark = false,
  thinking = false,
}: {
  size?: number;
  showWordmark?: boolean;
  thinking?: boolean;
}) {
  const thinkStyle = thinking
    ? {
        "--scan-dur": "0.9s",
        "--blink-dur": "1.4s",
        "--pulse-dur": "1.6s",
      } as React.CSSProperties
    : {
        "--scan-dur": "3s",
        "--blink-dur": "6s",
        "--pulse-dur": "4s",
      } as React.CSSProperties;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: showWordmark ? 14 : 0 }}>
      <style>{`
        @keyframes md-pulse-outer { 0%,100%{opacity:1;stroke-width:2.5} 50%{opacity:0.4;stroke-width:1.5} }
        @keyframes md-pulse-mid   { 0%,100%{opacity:1;stroke-width:2}   50%{opacity:0.55;stroke-width:1.2} }
        @keyframes md-pulse-inner { 0%,100%{opacity:1;stroke-width:1.5} 50%{opacity:0.7;stroke-width:1} }
        @keyframes md-blink       { 0%,45%,55%,100%{opacity:1} 48%,52%{opacity:0} }
        @keyframes md-scan        { 0%{stroke-dashoffset:60} 100%{stroke-dashoffset:-60} }
        @keyframes md-glint       { 0%,80%,100%{opacity:0} 85%,92%{opacity:0.9} }
        @keyframes md-notch       { 0%,100%{opacity:0.3} 50%{opacity:1} }
        .md-hex-outer { animation: md-pulse-outer var(--pulse-dur,4s) ease-in-out infinite; }
        .md-hex-mid   { animation: md-pulse-mid   var(--pulse-dur,4s) ease-in-out infinite 0.4s; }
        .md-hex-inner { animation: md-pulse-inner var(--pulse-dur,4s) ease-in-out infinite 0.8s; }
        .md-eye-group { animation: md-blink var(--blink-dur,6s) ease-in-out infinite; }
        .md-scan-line { animation: md-scan  var(--scan-dur,3s)  linear infinite; }
        .md-glint     { animation: md-glint var(--blink-dur,6s) ease-in-out infinite; }
        .md-notch     { animation: md-notch var(--pulse-dur,4s) ease-in-out infinite; }
      `}</style>

      <svg
        width={size}
        height={size}
        viewBox="0 0 160 160"
        xmlns="http://www.w3.org/2000/svg"
        style={thinkStyle}
      >
        <defs>
          <clipPath id="md-hex-clip">
            <polygon points="80,12 138,44 138,108 80,140 22,108 22,44" />
          </clipPath>
        </defs>

        {/* Outer hex */}
        <polygon
          className="md-hex-outer"
          points="80,12 138,44 138,108 80,140 22,108 22,44"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          opacity="0.85"
        />

        {/* Notch ticks */}
        {[
          { x1: 80, y1: 12,  x2: 80, y2: 20,  delay: "0s"   },
          { x1: 22, y1: 62,  x2: 29, y2: 66,  delay: "0.3s" },
          { x1: 22, y1: 90,  x2: 29, y2: 86,  delay: "0.6s" },
          { x1: 138,y1: 62,  x2: 131,y2: 66,  delay: "0.9s" },
          { x1: 138,y1: 90,  x2: 131,y2: 86,  delay: "1.2s" },
          { x1: 80, y1: 140, x2: 80, y2: 132, delay: "1.5s" },
        ].map((n, i) => (
          <line
            key={i}
            className="md-notch"
            x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animationDelay: n.delay }}
            opacity="0.7"
          />
        ))}

        {/* Mid hex */}
        <polygon
          className="md-hex-mid"
          points="80,28 122,52 122,100 80,124 38,100 38,52"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          opacity="0.45"
        />

        {/* Inner hex */}
        <polygon
          className="md-hex-inner"
          points="80,44 108,60 108,92 80,108 52,92 52,60"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.25"
        />

        {/* Eye group */}
        <g className="md-eye-group">
          <path
            d="M52,76 Q80,52 108,76 Q80,100 52,76Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="80" cy="76" r="13" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
          <circle cx="80" cy="76" r="5" fill="currentColor" />
          <path
            className="md-glint"
            d="M85,70 Q89,67 88,71"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          {/* Eyelash lines */}
          <line x1="80" y1="44" x2="80" y2="55" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="62" y1="50" x2="66" y2="59" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="98" y1="50" x2="94" y2="59" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="80" y1="108" x2="80" y2="97" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="62" y1="102" x2="66" y2="93" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <line x1="98" y1="102" x2="94" y2="93" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          {/* Side arrows */}
          <polyline points="44,76 51,71 51,81" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
          <line x1="44" y1="76" x2="51" y2="76" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
          <polyline points="116,76 109,71 109,81" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
          <line x1="116" y1="76" x2="109" y2="76" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
        </g>

        {/* Scan line */}
        <line
          className="md-scan-line"
          x1="52" y1="76" x2="108" y2="76"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeDasharray="8 6"
          clipPath="url(#md-hex-clip)"
          opacity="0.5"
        />
      </svg>

      {showWordmark && (
        <span
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 200,
            fontSize: size * 0.58,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            lineHeight: 1,
            color: "currentColor",
          }}
        >
          MONDAILY
        </span>
      )}
    </span>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const base = size / 36;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glowR" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0"/>
        </radialGradient>
        <filter id="gb" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5"/>
        </filter>
      </defs>
      <circle cx="18" cy="18" r="16" fill="url(#glowR)" filter="url(#gb)"/>
      <circle cx="18" cy="18" r="3.5" fill="#ef4444"/>
      <circle cx="18" cy="18" r="3.5" fill="#ef4444" opacity="0.4" filter="url(#gb)"/>
      <circle cx="18" cy="18" r="8" fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.75"/>
      <circle cx="18" cy="18" r="13" fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.4"/>
      <circle cx="18" cy="18" r="17.5" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.18"/>
    </svg>
  );
}

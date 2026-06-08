export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glowR" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0"/>
        </radialGradient>
        <filter id="gb" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4"/>
        </filter>
        <filter id="sb" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2"/>
        </filter>
      </defs>
      <!-- Outer glow blob -->
      <circle cx="22" cy="22" r="20" fill="url(#glowR)" filter="url(#gb)"/>
      <!-- Rings -->
      <circle cx="22" cy="22" r="18" fill="none" stroke="#ef4444" strokeWidth="0.6" opacity="0.15"/>
      <circle cx="22" cy="22" r="14" fill="none" stroke="#ef4444" strokeWidth="0.8" opacity="0.3"/>
      <circle cx="22" cy="22" r="10" fill="none" stroke="#ef4444" strokeWidth="1.2" opacity="0.55"/>
      <circle cx="22" cy="22" r="6" fill="none" stroke="#ef4444" strokeWidth="1.8" opacity="0.8"/>
      <!-- Center dot with glow -->
      <circle cx="22" cy="22" r="3" fill="#ef4444" filter="url(#sb)" opacity="0.6"/>
      <circle cx="22" cy="22" r="2.5" fill="#ef4444"/>
    </svg>
  );
}

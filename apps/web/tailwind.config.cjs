/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        orbitron: ['var(--font-orbitron)', 'sans-serif'],
        // Dual-font tokens registered for monorepo parity. The landing keeps its next/font mono
        // (var(--font-mono)) + Inter as the rendered brand; Geist/JetBrains stand in as fallbacks.
        sans: ['var(--font-sans)', '"Geist Sans"', '"Geist"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        // UI / structure — sidebar, tabs, headers, labels, buttons, modals.
        sans: ['"Geist Sans"', '"Geist"', "Inter", "system-ui", "sans-serif"],
        // Data / AI — terminal logs, ABI matrices, token meters, ledger rows, timestamps, IPs, code.
        mono: ['"JetBrains Mono"', '"Fira Code"', '"SF Mono"', "monospace"],
      },
      colors: {
        background: "#0b0d10",
        foreground: "#f8fafc",
        // Semantic status palette — the ONE source for agent/health/proof status colours.
        // Defined as rgb(var(--…) / <alpha-value>) so opacity modifiers work: bg-status-ok/10,
        // border-status-warn/25, text-status-error. Channels alias the Pass 1 matte hex tokens
        // (styles.css --status-*-rgb), so this is pixel-neutral with the old bg-[#hex]/NN forms.
        status: {
          ok:      "rgb(var(--status-ok-rgb) / <alpha-value>)",
          warn:    "rgb(var(--status-warn-rgb) / <alpha-value>)",
          error:   "rgb(var(--status-error-rgb) / <alpha-value>)",
          neutral: "rgb(var(--status-neutral-rgb) / <alpha-value>)",
          info:    "rgb(var(--status-info-rgb) / <alpha-value>)",
        },
      }
    }
  },
  plugins: []
};

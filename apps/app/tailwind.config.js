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
        foreground: "#f8fafc"
      }
    }
  },
  plugins: []
};

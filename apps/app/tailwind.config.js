/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        background: "#0b0d10",
        foreground: "#f8fafc"
      }
    }
  },
  plugins: []
};

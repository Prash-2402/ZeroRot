/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: "#17645F", coral: "#FF684A", ivory: "#F3EEE8",
        ink: { DEFAULT: "#0A2624", 900: "#0A2624", 800: "#0F3533", 700: "#134541", 600: "#17645F", 500: "#2C7A74", 400: "#6A9893", 300: "#A9C6C1" },
        paper: { DEFAULT: "#F3EEE8", 50: "#FAF7F3", 100: "#F3EEE8", 200: "#E8E1D8", 300: "#D9D0C4", 400: "#BDB2A4" },
        gold: { DEFAULT: "#FF684A", 50: "#FFF0EB", 100: "#FFD9CF", 400: "#FF8467", 500: "#FF684A", 600: "#E5533A", 700: "#B83F2A" },
        cold: "#2F80ED", coldlight: "#7FC4FF", warn: "#FFC900", abnormal: "#F2994A", critical: "#EB4D3D", ok: "#5FB37C",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Consolas", "monospace"],
      },
      borderRadius: { DEFAULT: "4px", md: "6px", lg: "8px" },
    },
  },
  plugins: [],
};

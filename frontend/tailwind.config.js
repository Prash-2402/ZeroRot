/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#08090B", 900: "#08090B", 800: "#111317", 700: "#1A1D22", 600: "#262A31", 500: "#3A3F47", 400: "#5B616B", 300: "#8A9099" },
        paper: { DEFAULT: "#F5F3EF", 50: "#FBFAF8", 100: "#F5F3EF", 200: "#E9E6DF", 300: "#D6D2C9", 400: "#B9B4A9" },
        gold: { DEFAULT: "#FFC900", 50: "#FFF7D6", 100: "#FFEDA3", 400: "#FFD43B", 500: "#FFC900", 600: "#E0B000", 700: "#A88400" },
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

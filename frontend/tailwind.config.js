/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: "#1F4D3A", 50: "#EEF4F0", 100: "#D7E6DC", 700: "#1F4D3A", 800: "#183D2E", 900: "#112B21" },
        leaf: { DEFAULT: "#3E8E5A", 400: "#5BA676", 600: "#357A4D" },
        cream: { DEFAULT: "#F7F3E8", 50: "#FCFBF7", 100: "#F7F3E8", 200: "#EEE7D4" },
        sage: { DEFAULT: "#A9BFA8", 300: "#C5D4C4", 500: "#A9BFA8", 700: "#6F8A6E" },
        charcoal: { DEFAULT: "#2B2B2B", 500: "#5A5A55", 400: "#7A7A72", 300: "#A3A39A" },
        night: { DEFAULT: "#0F1A17", 800: "#14231F", 700: "#1A2D27", 600: "#243B34", 500: "#355048" },
        amber: { DEFAULT: "#D99A2B", 50: "#FBF3E2", 600: "#B67E1C" },
        rot: { DEFAULT: "#C2463B", 50: "#FAE9E7", 600: "#A3372D" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Consolas", "monospace"],
      },
      boxShadow: { soft: "0 1px 2px rgba(31,77,58,0.06), 0 4px 16px rgba(31,77,58,0.06)" },
      borderRadius: { xl: "0.875rem" },
    },
  },
  plugins: [],
};

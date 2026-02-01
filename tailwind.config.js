/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Custom dark theme colors
        surface: {
          DEFAULT: "#1a1a1a",
          raised: "#242424",
          hover: "#2a2a2a",
          border: "#3a3a3a",
        },
        accent: {
          DEFAULT: "#646cff",
          hover: "#747bff",
        },
        score: {
          low: "#ef4444",
          medium: "#eab308",
          high: "#22c55e",
        },
      },
    },
  },
  plugins: [],
};

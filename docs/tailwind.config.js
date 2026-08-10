const { fontFamily } = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", ...fontFamily.sans],
        mono: ["var(--font-mono)", ...fontFamily.mono],
      },
      colors: {
        brandPrimary: "#F36C06",
        brandSecondary: "#FFF4D8",
        surface: "#F9F9F9",
        primary: {
          50: "#fff9ed",
          100: "#fff1d4",
          200: "#ffdfa8",
          300: "#ffc770",
          400: "#ffa337",
          500: "#ff8710",
          600: "#f36c06",
          700: "#c75007",
          800: "#9e3f0e",
          900: "#7f360f",
          950: "#451905",
        },
      },
      borderRadius: {
        ui: "8px",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

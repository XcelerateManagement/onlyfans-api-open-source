import {heroui} from "@heroui/theme"

/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        brand: {
          50: '#fff5ed',
          100: '#ffe8d5',
          200: '#ffc9a0',
          300: '#ffa366',
          400: '#ff7a30',
          500: '#f54900',
          600: '#d63e00',
          700: '#b03000',
          800: '#8a2600',
          900: '#6e1f00',
          950: '#3b0f00',
        },
        accent: {
          DEFAULT: 'rgb(var(--theme-accent-tw) / <alpha-value>)',
          hover: 'rgb(var(--theme-accent-hover-tw) / <alpha-value>)',
        },
      },
      animation: {
        'spin-slow': 'spin 30s linear infinite',
      },
    },
  },
  darkMode: "class",
  plugins: [
    heroui({
      themes: {
        dark: {
          colors: {
            background: "#000000",
            foreground: "#FFFFFF",
            primary: {
              50: '#fff5ed',
              100: '#ffe8d5',
              200: '#ffc9a0',
              300: '#ffa366',
              400: '#ff7a30',
              500: '#f54900',
              600: '#d63e00',
              700: '#b03000',
              800: '#8a2600',
              900: '#6e1f00',
              DEFAULT: '#f54900',
              foreground: '#FFFFFF',
            },
            focus: '#f54900',
          },
        },
      },
    }),
  ],
}

export default config;

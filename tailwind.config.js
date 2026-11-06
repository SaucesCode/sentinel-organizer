/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        surface: {
          950: '#070a12',
          900: '#090d16',
          850: '#0e1424',
          800: '#131b2e',
          750: '#1a243d',
          border: '#1f2b48',
          hover: '#243254',
        }
      },
      fontFamily: {
        mono: ['Cascadia Code', 'JetBrains Mono', 'Consolas', 'monospace'],
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

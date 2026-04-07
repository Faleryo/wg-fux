/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  safelist: [
    { 
      pattern: /^(bg|text|border)-(indigo|emerald|rose|slate)-(400|500|600)$/ 
    },
    { 
      pattern: /^shadow-(indigo|emerald|rose|slate)-500\/20$/ 
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
      colors: {
        slate: {
          850: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
      }
    },
  },
  plugins: [],
}

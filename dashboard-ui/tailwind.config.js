/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  safelist: [
    { 
      pattern: /^(bg|text|border|shadow|ring|from|to|fill|stroke)-(indigo|cyan|rose|emerald|amber|red|purple|slate)-(50|100|200|300|400|500|600|700|800|900|950)(\/[0-9]+)?$/ ,
      variants: ['hover']
    },
    { 
      pattern: /^shadow-(indigo|cyan|rose|emerald|amber|red|purple|slate)-(400|500|600)\/(20|30|50)$/ 
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

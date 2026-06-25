/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  // Components compose Tailwind classes like `bg-${theme}-600` at runtime —
  // the JIT compiler can't see them statically, so we safelist the precise
  // shades/variants actually used. Keep this tight: each line costs ~3 KB in
  // the prod CSS bundle.
  safelist: [
    // Solid backgrounds, text, borders, rings used in toggles, CTA, badges
    {
      pattern:
        /^(bg|text|border|ring|accent|focus:ring)-(indigo|cyan|rose|green|teal|red)-(300|400|500|600)$/,
    },
    // Alpha-channel / shadow for translucent badges / glows
    {
      pattern:
        /^(bg|shadow|ring|text|border)-(indigo|cyan|rose|green|teal|red)-(300|400|500|600)\/(10|20|30|40|50|80)$/,
    },
    // Gradient endpoints used by hero CTAs
    {
      pattern:
        /^(from|via|to)-(indigo|cyan|rose|green|teal|red)-(300|400|500|600)(\/(10|20|30|40|50))?$/,
    },
    // Container color-map (ClientList, NetworkMap, OptimizationSection, etc.)
    {
      pattern:
        /^(bg|text|border|from|shadow|via)-(emerald|amber|purple|sky|indigo|cyan|rose|green|teal|red)-(300|400|500|600|900)(\/(5|10|15|20|30|40|50|80|90))?$/,
    },
    // group-hover variants for gradient/tint overlays
    {
      pattern:
        /^group-hover:(bg|text|border|from|via|shadow)-(indigo|cyan|rose|emerald|amber|purple|sky|green|teal|red)-(400|500|600)(\/(10|20|30|40|50))?$/,
    },
    // hover state variants
    {
      pattern:
        /^hover:(bg|text|border)-(indigo|cyan|rose|emerald|amber|purple|sky|green|teal|red)-(400|500|600)(\/(10|20|30|40|50))?$/,
    },
    // shadow with color opacity (Sidebar, LogTabs, QRCodeModal, etc.)
    {
      pattern:
        /^shadow-(indigo|cyan|rose|emerald|amber|purple|sky|green|teal|red)-(400|500|600)\/(20|30|40|50)$/,
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
      },
    },
  },
  plugins: [],
};

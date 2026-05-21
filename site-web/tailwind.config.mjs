/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Palette de marque
        brand: {
          50:  '#f1f5f9',
          100: '#e2e8f0',
          200: '#cbd5e1',
          300: '#94a3b8',
          400: '#64748b',
          500: '#475569',
          600: '#334155',
          700: '#1e293b',
          800: '#1f3a5f',  // Bleu profond — couleur principale
          900: '#0f1e3a',
        },
        accent: {
          500: '#0f766e',  // Teal d'accent (liens, CTA)
          600: '#0d5e58',
          700: '#0a4a45',
        },
      },
      fontFamily: {
        // Pile système : aucune dépendance externe, chargement instantané
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'Monaco', 'monospace'],
      },
      maxWidth: {
        prose: '65ch',
      },
    },
  },
  plugins: [],
};

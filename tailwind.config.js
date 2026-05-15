/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        arena: {
          bg:      '#0a0a0f',
          surface: '#12121a',
          border:  '#1e1e2e',
          neon:    '#a855f7',
          cyan:    '#06b6d4',
          red:     '#ef4444',
          gold:    '#f59e0b',
        },
      },
      fontFamily: {
        hebrew: ['Rubik', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        neon: '0 0 20px rgba(168, 85, 247, 0.5)',
        cyan: '0 0 20px rgba(6, 182, 212, 0.5)',
        card: '0 4px 32px rgba(0,0,0,0.6)',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 10px rgba(168,85,247,0.3)' },
          '100%': { boxShadow: '0 0 30px rgba(168,85,247,0.8)' },
        },
      },
      animation: {
        glow: 'glow 2s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
}

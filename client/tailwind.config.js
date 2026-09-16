/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      keyframes: {
        'shiny-text': {
          '0%, 90%, 100%': {
            'background-position': 'calc(-100% - var(--shiny-width, 0px)) 0',
          },
          '30%, 60%': {
            'background-position': 'calc(100% + var(--shiny-width, 0px)) 0',
          },
        },
      },
      animation: {
        'shiny-text': 'shiny-text 8s infinite',
      },
    },
  },
  plugins: [],
}

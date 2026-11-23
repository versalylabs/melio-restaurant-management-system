/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Melio brand orange. Prefer these tokens over raw orange-* / hex values
        // so the brand colour can change in one place.
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        // `primary` was an unused blue; it now means the brand colour.
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        // Neutral surfaces used by the staff app (light / dark).
        surface: {
          DEFAULT: '#faf9f7',
          card: '#ffffff',
          dark: '#0b0b0f',
          'dark-card': '#121218',
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        vazir: ['Vazirmatn', 'Tahoma', 'sans-serif'],
        local: ['"IRANSans"', '"BNazanin"', 'Tahoma', 'sans-serif'],
        system: ['system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#2f80ed',
          600: '#1d64d6',
          700: '#184fab',
          800: '#184486',
          900: '#193b6f',
        },
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

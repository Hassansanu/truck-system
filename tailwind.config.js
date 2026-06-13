/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17202a',
        muted: '#6f7a88',
        canvas: '#f4f6f8',
        brand: {
          50: '#effaf5',
          100: '#d9f3e7',
          500: '#1f9d68',
          600: '#168458',
          700: '#126a49',
          900: '#0a3828',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, .04), 0 12px 32px rgba(15, 23, 42, .06)',
      },
    },
  },
  plugins: [],
}

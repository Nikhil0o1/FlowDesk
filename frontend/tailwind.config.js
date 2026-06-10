/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark app surfaces — true black base with minimal elevation steps
        ink: {
          950: '#000000', // page background
          900: '#050505', // content background
          850: '#0A0A0B', // panel / sidebar
          800: '#111113', // raised (cards, inputs)
          750: '#18181B', // hover
          700: '#202023', // borders
          600: '#2E2E33', // strong borders
        },
        fg: {
          DEFAULT: '#ECECEE',
          secondary: '#9B9DA5',
          muted: '#6C6F77',
        },
        brand: {
          DEFAULT: '#8C5BFF',
          hover: '#9D73FF',
          soft: 'rgba(140,91,255,0.16)',
        },
        priority: {
          urgent: '#E5484D',
          high: '#F2994A',
          normal: '#5B9FF0',
          low: '#87909E',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        popover: '0 8px 30px rgba(0,0,0,0.45)',
        card: '0 1px 3px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
}

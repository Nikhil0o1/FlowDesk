import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // VITE_* vars come from the single .env at the repository root
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in dev so the httpOnly refresh cookie works without CORS
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

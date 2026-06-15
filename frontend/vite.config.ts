import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in dev so the httpOnly refresh cookie works without CORS
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

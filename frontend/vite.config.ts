import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'

import { resolveManualChunk } from './src/lib/build/manualChunks'
import { BASE_SECURITY_HEADERS, SECURITY_HEADERS } from './src/lib/securityHeaders'

/** Google GIS checks window.location.origin — must match FRONTEND_URL (localhost, not 127.0.0.1). */
const DEV_HOST = 'localhost'

/** Redirect 127.0.0.1 → localhost so GIS origin matches Google Console JS origins. */
function loopbackOAuthAlignPlugin(): Plugin {
  type ConnectRequest = { headers: { host?: string }; url?: string }
  type ConnectResponse = {
    writeHead: (code: number, headers: Record<string, string>) => void
    end: () => void
  }

  return {
    name: 'loopback-oauth-align',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const request = req as ConnectRequest
        const response = res as ConnectResponse
        const host = request.headers.host ?? ''
        if (!host.startsWith('127.0.0.1:')) {
          next()
          return
        }
        const port = host.slice('127.0.0.1:'.length)
        const target = `http://${DEV_HOST}:${port}${request.url ?? '/'}`
        response.writeHead(301, { Location: target })
        response.end()
      })
    },
  }
}

/** Dev proxy target — reads BACKEND_URL from the workspace root .env (shared with the API). */
function devApiTarget(mode: string): string {
  const env = loadEnv(mode, '..', '')
  return (env.VITE_API_URL || env.BACKEND_URL || 'http://localhost:8001').replace(/\/+$/, '')
}

export default defineConfig(({ mode }) => ({  
  envDir: '.',
  plugins: [react(), ...(mode === 'development' ? [loopbackOAuthAlignPlugin()] : [])],
  // Excalidraw reads process.env.IS_PREACT at runtime — shim it for the browser build
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  server: {
    host: DEV_HOST,
    port: 5174,
    strictPort: true,
    cors: false,
    // BASE_SECURITY_HEADERS: all headers except CSP. CSP is intentionally omitted
    // in dev because Vite HMR injects inline scripts that a strict CSP blocks.
    headers: BASE_SECURITY_HEADERS,
    // CSP is enforced in production via vercel.json headers.
    proxy: {
      // Same-origin /api in dev so the httpOnly refresh cookie works without CORS.
      // WebSockets connect directly to VITE_BACKEND_URL (see src/lib/ws.ts) — no ws proxy.
      '/api': {
        target: devApiTarget(mode),
        changeOrigin: true,
        ws: false,
      },
    },
  },
  preview: {
    host: DEV_HOST,
    port: 5174,
    strictPort: true,
    cors: false,
    headers: SECURITY_HEADERS,
    proxy: {
      '/api': {
        target: devApiTarget(mode),
        changeOrigin: true,
        ws: false,
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle MSAL in dev — loaded lazily at runtime but must resolve cleanly.
    include: ['@azure/msal-browser'],
  },
  build: {
    // The largest emitted assets are lazy Excalidraw editor internals
    // (font subsetting/locales). Keep the warning budget above those while
    // preserving route-level chunks for the app shell and normal workspace UI.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
}))

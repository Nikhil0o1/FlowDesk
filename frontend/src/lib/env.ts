/**
 * API origin for dev (Vite proxy) vs production (split or same-origin deploy).
 *
 * Dev: leave VITE_API_URL empty — requests go to same-origin /api/v1 and Vite
 * proxies to BACKEND_URL from the workspace root .env.
 *
 * Production: set VITE_API_URL to the deployed API origin when UI and API are
 * on different hostnames. Leave empty when a reverse proxy serves /api on the
 * UI origin.
 */

/** Production API origin (split deploy from flowdesk.brightcone.ai). */
export const CANONICAL_API_ORIGIN = 'https://flowdesk-api-mvwt.onrender.com'

function resolveApiOrigin(): string {
  const fromEnv = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')
  if (fromEnv) return fromEnv

  // Fallback when the UI build omitted VITE_API_URL.
  if (import.meta.env.PROD && typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    if (hostname === 'flowdesk.brightcone.ai') {
      return CANONICAL_API_ORIGIN
    }
    if (hostname.endsWith('.onrender.com') && hostname.includes('-ui.')) {
      return `${protocol}//${hostname.replace('-ui.', '-api.')}`
    }
  }
  return ''
}

export const API_ORIGIN = resolveApiOrigin()

/**
 * Direct backend origin for dev realtime WebSockets.
 * REST stays on the Vite /api proxy (httpOnly cookies); WS uses ticket auth and
 * connects here to avoid Vite ws-proxy ECONNRESET noise when the API reloads.
 */
export const DEV_BACKEND_ORIGIN = import.meta.env.DEV
  ? (
      (import.meta.env.VITE_BACKEND_URL as string | undefined) || 'http://localhost:8001'
    ).replace(/\/+$/, '')
  : ''

/** REST base path. Empty origin in dev → same-origin /api/v1 via Vite proxy. */
export const API_BASE = API_ORIGIN ? `${API_ORIGIN}/api/v1` : '/api/v1'

/** True when the browser calls a different site than the UI (split Render deploy). */
export const IS_CROSS_SITE_API =
  typeof window !== 'undefined' &&
  !!API_ORIGIN &&
  new URL(API_ORIGIN).origin !== window.location.origin

/**
 * API avatars are stored as `/api/v1/users/{id}/avatar?...` paths. Prefix the API
 * origin when UI and API are on different hosts so <img> tags load correctly.
 */
export function resolveAvatarUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/api/')) {
    return API_ORIGIN ? `${API_ORIGIN}${trimmed}` : trimmed
  }
  return trimmed
}

/** Fail fast in production if the API URL was not configured at build time. */
export function assertProductionApiConfig(): void {
  if (import.meta.env.PROD && !API_ORIGIN && typeof window !== 'undefined') {
    const { hostname } = window.location
    const hasRenderFallback =
      hostname === 'flowdesk.brightcone.ai' ||
      (hostname.endsWith('.onrender.com') && hostname.includes('-ui.'))
    if (!hasRenderFallback) {
      throw new Error(
        'VITE_API_URL is not set. Add it in your host settings (e.g. https://flowdesk-api.onrender.com) before deploying.',
      )
    }
  }
}

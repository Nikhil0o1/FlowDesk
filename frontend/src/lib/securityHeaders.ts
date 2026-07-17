/**
 * Security response headers — single source of truth for all delivery paths.
 *
 * Delivery (VAPT #8 / #1):
 *  - Vercel: vercel.json (auto)
 *  - Render: render.yaml → link Blueprint or paste Settings → Headers
 *  - Cloudflare: deploy/cloudflare-response-headers.json → Transform Rules
 *  - Local dev: vite.config.ts (BASE_SECURITY_HEADERS only; no CSP — HMR needs inline scripts)
 *
 * After edits: mirror values in vercel.json, then `npm run sync:deploy-headers`.
 * CI enforces parity: tests/security/deployHeaders.security.test.ts
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://www.clarity.ms https://scripts.clarity.ms https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "frame-src 'self' blob: https://accounts.google.com https://login.microsoftonline.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export const REFERRER_POLICY = 'strict-origin-when-cross-origin'
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'

export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': REFERRER_POLICY,
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

export const SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
}

/** Production UI canonical host (custom domain). */
export const CANONICAL_UI_ORIGIN = 'https://flowdesk.brightcone.ai'

/** Legacy Render hostnames that should 301 to the canonical domain. */
export const LEGACY_UI_HOSTS = new Set(['flowdesk-ui.onrender.com'])

/**
 * Redirect legacy Render URLs to the canonical custom domain.
 * Preserves path, query, and hash (OAuth / deep links).
 * @returns true when a navigation was started
 */
export function redirectToCanonicalOriginIfNeeded(): boolean {
  if (!import.meta.env.PROD) return false
  if (!LEGACY_UI_HOSTS.has(window.location.hostname)) return false

  const canonical = new URL(CANONICAL_UI_ORIGIN)
  const target = new URL(window.location.href)
  target.protocol = canonical.protocol
  target.hostname = canonical.hostname
  if (canonical.port) target.port = canonical.port

  window.location.replace(target.toString())
  return true
}

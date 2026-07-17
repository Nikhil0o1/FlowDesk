/** Read a token from the URL fragment (#token=...) — never sent to the server on navigation. */
export function parseFragmentToken(name = 'token'): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const value = params.get(name)
  return value?.trim() ? value : null
}

/** Read a token from ?token= query param. */
export function parseQueryToken(name = 'token'): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get(name)
  return value?.trim() ? value : null
}

/**
 * Pure read — no side effects. Safe inside useMemo even under React Strict Mode
 * double-invocation (the URL isn't modified so the second call returns the same value).
 */
export function readAuthTokenFromUrl(
  pathToken?: string | null,
  name = 'token',
): string | null {
  if (typeof window === 'undefined') return null
  const decodedPath = pathToken?.trim() ? decodeURIComponent(pathToken.trim()) : null
  return parseFragmentToken(name) ?? parseQueryToken(name) ?? decodedPath
}

/**
 * Read token and strip it from the address bar.
 * Call only from a useEffect — not during render.
 */
export function consumeAuthTokenFromUrl(
  route: 'activate-invite' | 'reset-password',
  pathToken?: string | null,
  name = 'token',
): string | null {
  const token = readAuthTokenFromUrl(pathToken, name)
  if (token) {
    window.history.replaceState(null, '', `/${route}`)
  }
  return token
}

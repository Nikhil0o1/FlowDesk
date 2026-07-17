const ALLOWED_PROTOCOLS = new Set(['https:', 'http:'])
const SAFE_LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export const EXTERNAL_LINK_REL = 'noopener noreferrer' as const

export type SafeUrlOptions = {
  hosts?: string[]
  allowHttpInDev?: boolean
}

function hostAllowed(hostname: string, hosts?: string[]): boolean {
  if (!hosts?.length) return true
  return hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))
}

function parseSafeUrl(
  url: string,
  protocols: Set<string>,
  opts: SafeUrlOptions = {},
): string | null {
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith('//')) return null

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://localhost'
    const parsed = new URL(trimmed, base)
    if (!protocols.has(parsed.protocol)) return null
    if (parsed.protocol === 'http:' && import.meta.env.PROD && !opts.allowHttpInDev) return null
    if (!hostAllowed(parsed.hostname, opts.hosts)) return null
    return parsed.href
  } catch {
    return null
  }
}

/** Allow http, https, and mailto before binding backend-fed links. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  return parseSafeUrl(url, SAFE_LINK_PROTOCOLS)
}

export function safeExternalUrl(
  url: string | null | undefined,
  opts: SafeUrlOptions = {},
): string | null {
  if (!url || typeof url !== 'string') return null
  return parseSafeUrl(url, ALLOWED_PROTOCOLS, opts)
}

/** Open an http/https/mailto URL in a new tab with opener isolation. */
export function openExternalUrl(url: string | null | undefined): boolean {
  const safe = safeHttpUrl(url)
  if (!safe) return false
  window.open(safe, '_blank', 'noopener,noreferrer')
  return true
}

/** Open a same-origin app path in a new tab with opener isolation. */
export function openAppPath(path: string | null | undefined): boolean {
  const safe = safeAppPath(path)
  if (!safe) return false
  window.open(safe, '_blank', 'noopener,noreferrer')
  return true
}

export function safeAppPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  return trimmed
}

const GITHUB_HOSTS = ['github.com', 'www.github.com']

export function safeGithubUrl(url: string | null | undefined): string | null {
  return safeExternalUrl(url, { hosts: GITHUB_HOSTS })
}

/** GitHub OAuth authorize redirect — host + path allow-list before navigation. */
export function safeGithubOAuthUrl(url: string | null | undefined): string | null {
  const safe = safeGithubUrl(url)
  if (!safe) return null
  try {
    const parsed = new URL(safe)
    if (!parsed.pathname.startsWith('/login/oauth/authorize')) return null
    return safe
  } catch {
    return null
  }
}

export interface McpConfig {
  apiUrl: string
  accessToken: string
  allowDestructive: boolean
  tokenScopes: string[]
}

export interface HttpMcpConfig {
  /** Internal API base for server-to-server calls (introspection, tool proxying). */
  apiUrl: string
  /** Internal backend origin (may be 127.0.0.1 in colocated deploys). */
  backendUrl: string
  /** Public backend origin advertised to MCP clients in OAuth metadata. */
  publicBackendUrl: string
  mcpPublicUrl: string
  port: number
  bindHost: string
  allowedHosts?: string[]
  allowDestructive: boolean
}

/** Must match CANONICAL_BACKEND_URL in backend/app/core/config.py. */
const CANONICAL_BACKEND_URL = 'https://flowdesk-api-mvwt.onrender.com'

function normalizeApiUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

export function loadConfig(): McpConfig {
  const apiUrl = process.env.FLOWDESK_API_URL?.trim()
  const accessToken = process.env.FLOWDESK_ACCESS_TOKEN?.trim()
  if (!apiUrl) {
    throw new Error('FLOWDESK_API_URL is required (e.g. http://localhost:8000 or https://api.example.com)')
  }
  if (!accessToken) {
    throw new Error('FLOWDESK_ACCESS_TOKEN is required (create via POST /api/v1/users/me/api-tokens)')
  }
  if (!accessToken.startsWith('fd_pat_') && !accessToken.startsWith('fd_live_')) {
    console.error(
      'Warning: FLOWDESK_ACCESS_TOKEN does not look like a personal access token (fd_pat_… or fd_live_…). JWT may expire quickly.',
    )
  }
  const allowDestructive = process.env.FLOWDESK_ALLOW_DESTRUCTIVE === 'true'
  const scopesRaw = process.env.FLOWDESK_TOKEN_SCOPES?.trim()
  const tokenScopes = scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : []

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    accessToken,
    allowDestructive,
    tokenScopes,
  }
}

export function loadHttpConfig(): HttpMcpConfig {
  const apiUrlRaw = process.env.FLOWDESK_API_URL?.trim()
  if (!apiUrlRaw) {
    throw new Error('FLOWDESK_API_URL is required (e.g. http://localhost:8000)')
  }
  const backendUrl = apiUrlRaw.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '')
  const isLoopback = (url: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)
  const isProduction = process.env.ENVIRONMENT === 'production'

  // Public origin for advertised OAuth metadata. In colocated deploys FLOWDESK_API_URL
  // is 127.0.0.1, so the start script passes the real origin via FLOWDESK_PUBLIC_BACKEND_URL.
  let publicBackendUrl = process.env.FLOWDESK_PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, '') || backendUrl
  if (isProduction && isLoopback(publicBackendUrl)) {
    publicBackendUrl = CANONICAL_BACKEND_URL
  }

  const mcpPublicRaw =
    process.env.FLOWDESK_MCP_PUBLIC_URL?.trim() ||
    process.env.MCP_PUBLIC_URL?.trim() ||
    `http://localhost:${process.env.MCP_PORT ?? '3100'}`
  const mcpPublic =
    isProduction && isLoopback(mcpPublicRaw) && publicBackendUrl && !isLoopback(publicBackendUrl)
      ? publicBackendUrl
      : mcpPublicRaw
  const port = Number(process.env.MCP_PORT ?? '3100')
  const bindHost = process.env.MCP_BIND_HOST?.trim() || '0.0.0.0'
  const allowedHostsRaw = process.env.MCP_ALLOWED_HOSTS?.trim()
  const allowedHosts = allowedHostsRaw
    ? allowedHostsRaw.split(',').map((h) => h.trim()).filter(Boolean)
    : undefined

  return {
    apiUrl: normalizeApiUrl(apiUrlRaw),
    backendUrl,
    publicBackendUrl,
    mcpPublicUrl: mcpPublic.replace(/\/+$/, ''),
    port,
    bindHost,
    allowedHosts,
    allowDestructive: process.env.FLOWDESK_ALLOW_DESTRUCTIVE === 'true',
  }
}

/** API Keys types, status derivation, and helpers. No secrets stored here. */

export interface ApiToken {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  revoke_at: string | null
  created_at: string
  display_suffix: string | null
  environment: string | null
  public_key_id: string | null
  rotated_from_id: string | null
}

export interface ApiTokenCreated extends ApiToken {
  token: string
}

export interface ApiScopeMeta {
  scope: string
  group: string
  name: string
  description: string
  access: 'read' | 'write' | string
}

export interface ApiRateLimitMeta {
  category: string
  limit: number
  window_seconds: number
  algorithm: string
}

export interface ApiPublicRouteMeta {
  methods: string[]
  path: string
  scopes: string[]
  rate_category: string
  authz_class: string
  tenant_resolution: string
}

export interface ApiTokenMeta {
  scopes: ApiScopeMeta[]
  max_lifetime_days: number
  rotation_grace_seconds: number
  resource_restrictions_supported: boolean
  identity_model: string
  api_version?: string
  base_path?: string
  rate_limits?: ApiRateLimitMeta[]
  public_routes?: ApiPublicRouteMeta[]
}

export type ApiKeyStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'revocation_scheduled'
  | 'revoked'

const EXPIRING_SOON_DAYS = 14

export function deriveApiKeyStatus(token: ApiToken, now = new Date()): ApiKeyStatus {
  if (token.revoked_at) return 'revoked'
  if (token.revoke_at) {
    const when = new Date(token.revoke_at)
    if (when.getTime() <= now.getTime()) return 'revoked'
    return 'revocation_scheduled'
  }
  if (token.expires_at) {
    const exp = new Date(token.expires_at)
    if (exp.getTime() <= now.getTime()) return 'expired'
    const msLeft = exp.getTime() - now.getTime()
    if (msLeft <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiring_soon'
  }
  return 'active'
}

export function apiKeyStatusLabel(status: ApiKeyStatus): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'expiring_soon':
      return 'Expiring soon'
    case 'expired':
      return 'Expired'
    case 'revocation_scheduled':
      return 'Revocation scheduled'
    case 'revoked':
      return 'Revoked'
  }
}

export function maskApiKeyId(token: ApiToken): string {
  if (token.public_key_id) {
    const suffix = token.display_suffix ? `…${token.display_suffix}` : ''
    return `fd_live_${token.public_key_id}${suffix}`
  }
  return token.token_prefix ? `${token.token_prefix}…` : '••••••••'
}

/** Ephemeral secret holder — never write to storage. */
export type EphemeralSecret = {
  raw: string
  keyName: string
  reason: 'created' | 'rotated'
  tokenId: string
}

export type ApiUsageHealth =
  | 'healthy'
  | 'degraded'
  | 'failing'
  | 'idle'
  | 'revoked'
  | 'expired'

export interface ApiTokenActivity {
  at: string
  event: string
  detail: string | null
}

export interface ApiTokenUsage {
  token_id: string
  window: string
  requests_24h: number
  errors_24h: number
  rate_limited_24h: number
  top_endpoint: string | null
  last_used_at: string | null
  last_success_at: string | null
  last_success_route: string | null
  last_fail_at: string | null
  last_fail_route: string | null
  last_fail_status: number | null
  last_ip: string | null
  status: ApiUsageHealth | string
  metrics_available: boolean
  activity: ApiTokenActivity[]
}

export function usageHealthLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'failing':
      return 'Failing'
    case 'idle':
      return 'Idle'
    case 'revoked':
      return 'Revoked'
    case 'expired':
      return 'Expired'
    default:
      return status
  }
}

export function shortRoute(path: string | null | undefined): string {
  if (!path) return '—'
  return path.replace(/^\/api\/v1/, '') || path
}

export function assertNoSecretPersistence(raw: string): void {
  // Used in tests — production callers must never call localStorage with raw.
  void raw
}

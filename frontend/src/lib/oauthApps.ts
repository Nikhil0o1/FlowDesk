export interface OAuthApp {
  id: string
  organization_id: string
  name: string
  client_id: string
  redirect_uris: string[]
  default_scopes: string[]
  display_suffix: string
  created_at: string
  updated_at: string
  revoked_at: string | null
}

/** Apps the current user has connected via OAuth (API tokens → Custom Apps). */
export interface AuthorizedOAuthApp {
  app_id: string
  name: string
  client_id: string
  organization_id: string
  workspace_count: number
  authorized_at: string
  scopes: string[]
  pat_id: string
}

export interface OAuthAppCreated extends OAuthApp {
  client_secret: string
  env_snippet: string
  authorize_url_template: string
  token_url: string
}

export type EphemeralOAuthSecret = {
  appId: string
  clientId: string
  clientSecret: string
  envSnippet: string
  authorizeUrlTemplate: string
  tokenUrl: string
  reason: 'created' | 'regenerated'
}

export function maskClientId(clientId: string): string {
  if (clientId.length <= 16) return clientId
  return `${clientId.slice(0, 12)}…${clientId.slice(-4)}`
}

/** Mask a client secret for display (ClickUp-style dots). */
export function maskSecretDots(length = 40): string {
  return '•'.repeat(length)
}

export function suggestRedirectFromCallbackBase(base: string): string {
  const cleaned = base.trim().replace(/\/+$/, '')
  if (!cleaned) return ''
  // If they already pasted a full callback URL, keep it
  if (cleaned.includes('/oauth') || cleaned.includes('/callback')) return cleaned
  return `${cleaned}/api/v1/tools/config/oauth/callback`
}

export function suggestWebhookFromAppBase(base: string): string {
  const cleaned = base.trim().replace(/\/+$/, '')
  if (!cleaned) return ''
  if (cleaned.includes('/webhooks')) return cleaned
  return `${cleaned}/api/v1/webhooks/flowdesk`
}

/** @deprecated Use suggestRedirectFromCallbackBase */
export const suggestRedirectFromHolocronBase = suggestRedirectFromCallbackBase
/** @deprecated Use suggestWebhookFromAppBase */
export const suggestWebhookFromHolocronBase = suggestWebhookFromAppBase

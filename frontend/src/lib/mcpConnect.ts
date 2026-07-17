import { API_ORIGIN, CANONICAL_API_ORIGIN } from './env'
import { CANONICAL_UI_ORIGIN } from './canonicalOrigin'

export interface McpConnectInfo {
  mcp_url: string
  oauth_issuer: string
  scopes_supported: string[]
  cursor_deeplink: string
  claude_desktop_deeplink: string
  claude_code_install_command: string
  claude_code_reset_command: string
  cursor_config: { mcpServers: Record<string, { url: string }> }
  claude_config: { mcpServers: Record<string, { url: string }> }
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/** Best public API origin for MCP/OAuth URLs shown in the settings UI. */
export function resolvePublicApiOrigin(): string {
  if (API_ORIGIN) return API_ORIGIN
  if (import.meta.env.PROD && typeof window !== 'undefined') {
    if (window.location.hostname === 'flowdesk.brightcone.ai') return CANONICAL_API_ORIGIN
    if (window.location.hostname.endsWith('.onrender.com') && window.location.hostname.includes('-ui.')) {
      return `${window.location.protocol}//${window.location.hostname.replace('-ui.', '-api.')}`
    }
  }
  return ''
}

function resolveMcpUrl(apiReturned: string): string {
  const origin = resolvePublicApiOrigin()
  const prodMcp = origin ? `${origin.replace(/\/+$/, '')}/mcp` : ''
  if (prodMcp && (!apiReturned || isLoopbackUrl(apiReturned))) return prodMcp
  return apiReturned
}

function resolveOAuthIssuer(apiReturned: string): string {
  const origin = resolvePublicApiOrigin()
  if (origin && (!apiReturned || isLoopbackUrl(apiReturned))) return origin
  return apiReturned
}

export function buildCursorDeeplink(mcpUrl: string): string {
  const config = { url: mcpUrl }
  const encoded = btoa(JSON.stringify(config))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=flowdesk&config=${encoded}`
}

/** Claude Desktop / claude.ai web connectors — not Claude Code in VS Code. */
export function buildClaudeDesktopDeeplink(mcpUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: 'FlowDesk',
    connectorUrl: mcpUrl,
  })
  return `https://claude.ai/customize/connectors?${params.toString()}`
}

/**
 * One command, any shell (PowerShell / bash / zsh). `--scope user` writes to
 * ~/.claude.json, which the Claude Code CLI and IDE extensions share.
 */
export function buildClaudeCodeInstallCommand(mcpUrl: string): string {
  return `claude mcp add --transport http flowdesk ${mcpUrl} --scope user`
}

/** Troubleshooting: clear stale flowdesk entries from every scope, re-add, verify. */
export function buildClaudeCodeResetCommand(mcpUrl: string): string {
  return [
    'claude mcp remove flowdesk --scope user',
    'claude mcp remove flowdesk --scope local',
    'claude mcp remove flowdesk --scope project',
    `claude mcp add --transport http flowdesk ${mcpUrl} --scope user`,
    'claude mcp list',
  ].join('\n')
}

function buildMcpServerConfig(mcpUrl: string): { mcpServers: Record<string, { url: string }> } {
  return { mcpServers: { flowdesk: { url: mcpUrl } } }
}

/**
 * Normalize connect-info from the API so production UI never shows localhost MCP URLs.
 */
export function resolveMcpConnectInfo(info: McpConnectInfo): McpConnectInfo {
  const onProdUi =
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    (window.location.origin === CANONICAL_UI_ORIGIN ||
      window.location.hostname.endsWith('.onrender.com'))

  if (!onProdUi && !resolvePublicApiOrigin()) return info

  const mcp_url = resolveMcpUrl(info.mcp_url)
  const oauth_issuer = resolveOAuthIssuer(info.oauth_issuer)
  const serverConfig = buildMcpServerConfig(mcp_url)

  return {
    ...info,
    mcp_url,
    oauth_issuer,
    cursor_deeplink: buildCursorDeeplink(mcp_url),
    claude_desktop_deeplink: buildClaudeDesktopDeeplink(mcp_url),
    claude_code_install_command: buildClaudeCodeInstallCommand(mcp_url),
    claude_code_reset_command: buildClaudeCodeResetCommand(mcp_url),
    cursor_config: serverConfig,
    claude_config: serverConfig,
  }
}

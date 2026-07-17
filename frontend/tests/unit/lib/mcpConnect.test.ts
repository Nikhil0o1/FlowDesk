import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildClaudeCodeInstallCommand,
  buildClaudeCodeResetCommand,
  buildClaudeDesktopDeeplink,
  resolveMcpConnectInfo,
  type McpConnectInfo,
} from '@/lib/mcpConnect'

const loopbackInfo: McpConnectInfo = {
  mcp_url: 'http://localhost:3100/mcp',
  oauth_issuer: 'http://localhost:8000',
  scopes_supported: ['tasks:read'],
  cursor_deeplink: 'cursor://anysphere.cursor-deeplink/mcp/install?name=flowdesk&config=e30=',
  claude_desktop_deeplink: 'https://claude.ai/customize/connectors?modal=add-custom-connector',
  claude_code_install_command: 'claude mcp add --transport http flowdesk http://localhost:3100/mcp --scope user',
  claude_code_reset_command: 'claude mcp remove flowdesk --scope user\nclaude mcp add --transport http flowdesk http://localhost:3100/mcp --scope user\nclaude mcp list',
  cursor_config: { mcpServers: { flowdesk: { url: 'http://localhost:3100/mcp' } } },
  claude_config: { mcpServers: { flowdesk: { url: 'http://localhost:3100/mcp' } } },
}

describe('resolveMcpConnectInfo', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rewrites loopback MCP URLs on the production UI', async () => {
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'flowdesk.brightcone.ai', origin: 'https://flowdesk.brightcone.ai', protocol: 'https:' },
      writable: true,
      configurable: true,
    })
    await import('@/lib/env')

    const resolved = resolveMcpConnectInfo(loopbackInfo)
    expect(resolved.mcp_url).toBe('https://flowdesk-api-mvwt.onrender.com/mcp')
    expect(resolved.oauth_issuer).toBe('https://flowdesk-api-mvwt.onrender.com')
    expect(resolved.claude_code_install_command).toContain('https://flowdesk-api-mvwt.onrender.com/mcp')
    expect(resolved.claude_desktop_deeplink).toContain('claude.ai/customize/connectors')
    expect(resolved.cursor_deeplink).toContain('cursor://')
  })

  it('leaves dev loopback URLs unchanged', async () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_API_URL', '')
    await import('@/lib/env')

    const resolved = resolveMcpConnectInfo(loopbackInfo)
    expect(resolved.mcp_url).toBe('http://localhost:3100/mcp')
    expect(resolved.oauth_issuer).toBe('http://localhost:8000')
  })

  it('builds Claude Desktop install deeplink with encoded MCP URL', () => {
    const link = buildClaudeDesktopDeeplink('https://flowdesk-api-mvwt.onrender.com/mcp')
    expect(link).toContain('modal=add-custom-connector')
    expect(link).toContain('connectorName=FlowDesk')
    expect(link).toContain('connectorUrl=https%3A%2F%2Fflowdesk-api-mvwt.onrender.com%2Fmcp')
  })

  it('builds a single-line Claude Code install command at user scope', () => {
    const cmd = buildClaudeCodeInstallCommand('https://flowdesk-api-mvwt.onrender.com/mcp')
    expect(cmd).toBe(
      'claude mcp add --transport http flowdesk https://flowdesk-api-mvwt.onrender.com/mcp --scope user',
    )
    expect(cmd).not.toContain('\n')
  })

  it('builds Claude Code reset commands with remove, add, and list', () => {
    const cmd = buildClaudeCodeResetCommand('https://flowdesk-api-mvwt.onrender.com/mcp')
    expect(cmd).toContain('claude mcp remove flowdesk --scope user')
    expect(cmd).toContain('claude mcp remove flowdesk --scope local')
    expect(cmd).toContain('claude mcp remove flowdesk --scope project')
    expect(cmd).toContain('claude mcp add --transport http flowdesk https://flowdesk-api-mvwt.onrender.com/mcp --scope user')
    expect(cmd).toContain('claude mcp list')
  })

  it('rewrites the reset command on the production UI', async () => {
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'flowdesk.brightcone.ai', origin: 'https://flowdesk.brightcone.ai', protocol: 'https:' },
      writable: true,
      configurable: true,
    })
    await import('@/lib/env')

    const resolved = resolveMcpConnectInfo(loopbackInfo)
    expect(resolved.claude_code_reset_command).toContain('https://flowdesk-api-mvwt.onrender.com/mcp')
  })
})

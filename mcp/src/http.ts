#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Request, Response } from 'express'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { loadHttpConfig } from './config.js'
import { requestContext, runtimeFromToken } from './context.js'
import { createServer } from './server.js'

const cfg = loadHttpConfig()
const mcpPublicBase = cfg.mcpPublicUrl.replace(/\/+$/, '')
const mcpServerUrl = new URL(`${mcpPublicBase}/mcp`)
// Advertised to MCP clients — must be the public origin, never 127.0.0.1.
const backendBase = cfg.publicBackendUrl.replace(/\/+$/, '')
// Server-to-server (introspection) — internal origin, loopback in colocated deploys.
const internalBackendBase = cfg.backendUrl.replace(/\/+$/, '')

const iconPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'flowdesk-icon.png')
let iconBytes: Buffer
try {
  iconBytes = readFileSync(iconPath)
} catch {
  console.warn(`MCP icon not found at ${iconPath} — /icon.png will 404`)
  iconBytes = Buffer.alloc(0)
}

const oauthMetadata = {
  issuer: backendBase,
  authorization_endpoint: `${backendBase}/api/v1/oauth/authorize`,
  token_endpoint: `${backendBase}/api/v1/oauth/token`,
  registration_endpoint: `${backendBase}/api/v1/oauth/register`,
  scopes_supported: [
    'tasks:read',
    'tasks:write',
    'projects:read',
    'inbox:read',
    'inbox:write',
    'comments:write',
    'search:read',
    'sprints:read',
    'sprints:write',
    'time:read',
    'time:write',
    'members:read',
    'templates:read',
    'templates:write',
    'chat:read',
    'chat:write',
    'docs:read',
    'docs:write',
    'forms:read',
    'whiteboards:read',
    'github:read',
    'github:write',
  ],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  introspection_endpoint: `${backendBase}/api/v1/oauth/introspect`,
}

const introspectionUrl = `${internalBackendBase}/api/v1/oauth/introspect`

const tokenVerifier = {
  verifyAccessToken: async (token: string) => {
    const response = await fetch(introspectionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Invalid or expired token: ${text}`)
    }
    const data = (await response.json()) as {
      active?: boolean
      sub?: string
      client_id?: string
      scope?: string
      exp?: number
    }
    if (!data.active) {
      throw new Error('Token is not active')
    }
    return {
      token,
      clientId: data.client_id ?? 'flowdesk',
      scopes: data.scope ? data.scope.split(' ').filter(Boolean) : [],
      expiresAt: data.exp,
    }
  },
}

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpServerUrl)
const authMiddleware = requireBearerAuth({
  verifier: tokenVerifier,
  resourceMetadataUrl,
})

const app = createMcpExpressApp({ host: cfg.bindHost, allowedHosts: cfg.allowedHosts })
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: oauthMetadata.scopes_supported,
    resourceName: 'FlowDesk',
  }),
)

const transports: Record<string, StreamableHTTPServerTransport> = {}

function toolRuntimeFromAuth(auth: { token: string; scopes: string[] }) {
  return runtimeFromToken(auth.token, auth.scopes, cfg.apiUrl, cfg.allowDestructive)
}

async function withAuth<T>(req: Request & { auth?: { token: string; scopes: string[] } }, fn: () => Promise<T>) {
  if (!req.auth) {
    throw new Error('Missing auth')
  }
  return requestContext.run(toolRuntimeFromAuth(req.auth), fn)
}

const mcpPostHandler = async (req: Request & { auth?: { token: string; scopes: string[] } }, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  try {
    await withAuth(req, async () => {
      let transport: StreamableHTTPServerTransport
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
        await transport.handleRequest(req, res, req.body)
        return
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport
          },
        })
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports[sid]) {
            delete transports[sid]
          }
        }
        const server = createServer({ publicUrl: mcpPublicBase })
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      }
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      })
    })
  } catch (error) {
    console.error('MCP POST error:', error)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
}

const mcpGetHandler = async (req: Request & { auth?: { token: string; scopes: string[] } }, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID')
    return
  }
  try {
    await withAuth(req, async () => {
      await transports[sessionId].handleRequest(req, res)
    })
  } catch (error) {
    console.error('MCP GET error:', error)
    if (!res.headersSent) {
      res.status(500).send('Internal server error')
    }
  }
}

const mcpDeleteHandler = async (req: Request & { auth?: { token: string; scopes: string[] } }, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID')
    return
  }
  try {
    await withAuth(req, async () => {
      await transports[sessionId].handleRequest(req, res)
    })
  } catch (error) {
    console.error('MCP DELETE error:', error)
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination')
    }
  }
}

app.post('/mcp', authMiddleware, mcpPostHandler)
app.get('/mcp', authMiddleware, mcpGetHandler)
app.delete('/mcp', authMiddleware, mcpDeleteHandler)

app.get('/icon.png', (_req, res) => {
  if (!iconBytes.length) {
    res.status(404).send('Icon not found')
    return
  }
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(iconBytes)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'flowdesk-mcp' })
})

app.listen(cfg.port, cfg.bindHost, () => {
  console.log(`FlowDesk MCP HTTP server listening on http://${cfg.bindHost}:${cfg.port}/mcp`)
  console.log(`OAuth issuer: ${backendBase}`)
  console.log(`Public MCP URL: ${mcpServerUrl}`)
})

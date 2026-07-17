import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { extractResourceIds, logToolInvocation } from './audit.js'
import { getToolRuntime } from './context.js'
import { getFlowdeskPrompt, promptDefinitions } from './prompts.js'
import { readFlowdeskResource, resourceTemplates, staticResources } from './resources.js'
import { handleToolCall, toolDefinitions } from './tools/index.js'

export interface McpServerOptions {
  /** Public base URL of this MCP HTTP server (no trailing slash). */
  publicUrl: string
}

const SERVER_INSTRUCTIONS = `FlowDesk MCP — automate tasks, inbox, sprints, docs, and projects with your real permissions.

Start with flowdesk_whoami or read resource flowdesk://user/me.
Use flowdesk_search to find tasks and projects.
To set or change a task status by name (To Do, In Progress, In Review, etc.), call flowdesk_list_project_statuses first and use the returned status id — never invent status_id from other tasks; empty columns still have statuses.
Destructive deletes require confirm=true and FLOWDESK_ALLOW_DESTRUCTIVE=true.`

export function createServer(options?: McpServerOptions): Server {
  const publicUrl = options?.publicUrl?.replace(/\/+$/, '') ?? ''
  const iconUrl = publicUrl ? `${publicUrl}/icon.png` : ''

  const server = new Server(
    {
      name: 'flowdesk',
      title: 'FlowDesk',
      version: '1.0.0',
      description: 'FlowDesk workspace automation — tasks, inbox, sprints, docs, and chat.',
      websiteUrl: publicUrl ? publicUrl.replace(/\/mcp$/, '') : undefined,
      icons: iconUrl
        ? [{ src: iconUrl, mimeType: 'image/png', sizes: ['any' as const] }]
        : undefined,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const started = Date.now()
    const runtime = getToolRuntime()
    const toolName = request.params.name
    const toolArgs = request.params.arguments ?? {}

    try {
      const result = await handleToolCall(toolName, toolArgs, runtime)
      const isError = Boolean(result && typeof result === 'object' && 'isError' in result && result.isError)
      void logToolInvocation(runtime.client, {
        tool: toolName,
        args: toolArgs,
        status: isError ? 'error' : 'ok',
        resourceIds: extractResourceIds(result),
        errorMessage: isError && result && typeof result === 'object' && 'content' in result
          ? String((result as { content: Array<{ text?: string }> }).content?.[0]?.text ?? '')
          : undefined,
        durationMs: Date.now() - started,
      })
      return result
    } catch (err) {
      void logToolInvocation(runtime.client, {
        tool: toolName,
        args: toolArgs,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      })
      throw err
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...staticResources],
  }))

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [...resourceTemplates],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const text = await readFlowdeskResource(request.params.uri, getToolRuntime())
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text,
        },
      ],
    }
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptDefinitions.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required ?? false,
      })),
    })),
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getFlowdeskPrompt(request.params.name, request.params.arguments, getToolRuntime())
  })

  return server
}

export async function runStdioServer(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

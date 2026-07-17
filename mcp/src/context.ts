import { AsyncLocalStorage } from 'node:async_hooks'

import { FlowDeskClient } from './client.js'
import { loadConfig } from './config.js'

export interface ToolRuntime {
  client: FlowDeskClient
  tokenScopes: string[]
  allowDestructive: boolean
}

export const requestContext = new AsyncLocalStorage<ToolRuntime>()

export function getDefaultRuntime(): ToolRuntime {
  const cfg = loadConfig()
  return {
    client: new FlowDeskClient(cfg.apiUrl, cfg.accessToken),
    tokenScopes: cfg.tokenScopes,
    allowDestructive: cfg.allowDestructive,
  }
}

export function getToolRuntime(): ToolRuntime {
  return requestContext.getStore() ?? getDefaultRuntime()
}

export function runtimeFromToken(
  token: string,
  scopes: string[],
  apiUrl: string,
  allowDestructive: boolean,
): ToolRuntime {
  return {
    client: new FlowDeskClient(apiUrl, token),
    tokenScopes: scopes,
    allowDestructive,
  }
}

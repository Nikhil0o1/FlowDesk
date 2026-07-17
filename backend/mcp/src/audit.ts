import { createHash } from 'node:crypto'

import type { FlowDeskClient } from './client.js'

export interface AuditEntry {
  tool: string
  args: unknown
  status: 'ok' | 'error'
  httpStatus?: number
  resourceIds?: string[]
  errorMessage?: string
  durationMs?: number
}

export function hashToolArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex')
}

/** Best-effort extraction of UUIDs from tool JSON results for audit.resource_ids. */
export function extractResourceIds(result: unknown): string[] {
  const ids = new Set<string>()
  const uuidRe =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

  const visit = (value: unknown, depth = 0) => {
    if (depth > 6 || value == null) return
    if (typeof value === 'string') {
      for (const m of value.matchAll(uuidRe)) ids.add(m[0].toLowerCase())
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>
      for (const key of ['id', 'task_id', 'project_id', 'document_id', 'sprint_id']) {
        const v = rec[key]
        if (typeof v === 'string' && uuidRe.test(v)) ids.add(v.toLowerCase())
      }
      for (const v of Object.values(rec)) visit(v, depth + 1)
    }
  }

  visit(result)
  return [...ids].slice(0, 25)
}

export async function logToolInvocation(client: FlowDeskClient, entry: AuditEntry): Promise<void> {
  try {
    await client.post('/mcp/audit', {
      tool: entry.tool,
      args_hash: hashToolArgs(entry.args),
      status: entry.status,
      http_status: entry.httpStatus,
      resource_ids: entry.resourceIds ?? [],
      error_message: entry.errorMessage,
      duration_ms: entry.durationMs,
    })
  } catch {
    // Audit must never break tool execution.
  }
}

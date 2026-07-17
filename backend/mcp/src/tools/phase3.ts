import { z } from 'zod'

import { errorResult, jsonResult } from '../client.js'
import { type ToolRuntime } from '../context.js'
import { requireScopes, SCOPES } from '../scopes.js'

function guard(runtime: ToolRuntime, ...scopes: string[]) {
  const have = runtime.tokenScopes.length ? runtime.tokenScopes : undefined
  requireScopes(have, scopes as never[])
}

export const phase3ToolDefinitions = [
  {
    name: 'flowdesk_list_documents',
    description: 'List documents in a workspace (optional search, folder, wiki filter).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        q: { type: 'string', description: 'Title search' },
        folder_id: { type: 'string' },
        is_wiki: { type: 'boolean' },
        scope: { type: 'string', enum: ['all', 'mine', 'shared', 'private'] },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_get_document',
    description: 'Get a document by ID including content.',
    inputSchema: {
      type: 'object' as const,
      properties: { document_id: { type: 'string' } },
      required: ['document_id'],
    },
  },
  {
    name: 'flowdesk_create_document',
    description: 'Create a document or wiki page in a workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        folder_id: { type: 'string' },
        is_wiki: { type: 'boolean', default: false },
        status: { type: 'string', enum: ['draft', 'published'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['workspace_id', 'title'],
    },
  },
  {
    name: 'flowdesk_update_document',
    description: 'Update document title, content, status, tags, or folder.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        document_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published'] },
        folder_id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        create_version: { type: 'boolean', description: 'Save a version snapshot' },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'flowdesk_list_forms',
    description: 'List intake forms in a workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_get_form',
    description: 'Get form definition including fields.',
    inputSchema: {
      type: 'object' as const,
      properties: { form_id: { type: 'string' } },
      required: ['form_id'],
    },
  },
  {
    name: 'flowdesk_list_form_submissions',
    description: 'List submissions for a form (workspace admin required).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        form_id: { type: 'string' },
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['form_id'],
    },
  },
  {
    name: 'flowdesk_list_whiteboards',
    description: 'List whiteboards in a workspace (filtered by your project access).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_get_whiteboard',
    description: 'Get whiteboard metadata and canvas content.',
    inputSchema: {
      type: 'object' as const,
      properties: { whiteboard_id: { type: 'string' } },
      required: ['whiteboard_id'],
    },
  },
  {
    name: 'flowdesk_get_project_github_connection',
    description: 'Get GitHub connection status for a project.',
    inputSchema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'flowdesk_create_github_issue_for_task',
    description: 'Create a GitHub issue linked to a task (project must have GitHub connected).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        repository_id: { type: 'string' },
        repo_full_name: { type: 'string', description: 'owner/repo for personal repos' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_sync_github_issue_status',
    description: 'Sync task status from linked GitHub issue state.',
    inputSchema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_bulk_update_tasks',
    description:
      'Update multiple tasks with the same fields (max 25). Returns per-task results. For status changes, resolve status_id via flowdesk_list_project_statuses first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 25 },
        status_id: {
          type: 'string',
          description: 'From flowdesk_list_project_statuses — do not invent from tasks alone',
        },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        clear_priority: { type: 'boolean' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        clear_due_date: { type: 'boolean' },
        is_archived: { type: 'boolean' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_ids'],
    },
  },
] as const

export async function handlePhase3ToolCall(name: string, args: unknown, runtime: ToolRuntime) {
  try {
    switch (name) {
      case 'flowdesk_list_documents': {
        guard(runtime, SCOPES.DOCS_READ)
        const p = z
          .object({
            workspace_id: z.string().uuid(),
            q: z.string().optional(),
            folder_id: z.string().uuid().optional(),
            is_wiki: z.boolean().optional(),
            scope: z.enum(['all', 'mine', 'shared', 'private']).optional(),
          })
          .parse(args)
        const { workspace_id, ...query } = p
        return jsonResult(
          await runtime.client.get(`/workspaces/${workspace_id}/documents`, {
            q: query.q,
            folder_id: query.folder_id,
            is_wiki: query.is_wiki,
            scope: query.scope,
          }),
        )
      }
      case 'flowdesk_get_document': {
        guard(runtime, SCOPES.DOCS_READ)
        const { document_id } = z.object({ document_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/documents/${document_id}`))
      }
      case 'flowdesk_create_document': {
        guard(runtime, SCOPES.DOCS_WRITE)
        const p = z
          .object({
            workspace_id: z.string().uuid(),
            title: z.string().min(1),
            content: z.string().optional(),
            folder_id: z.string().uuid().optional(),
            is_wiki: z.boolean().optional(),
            status: z.enum(['draft', 'published']).optional(),
            tags: z.array(z.string()).optional(),
          })
          .parse(args)
        const { workspace_id, ...body } = p
        return jsonResult(await runtime.client.post(`/workspaces/${workspace_id}/documents`, body))
      }
      case 'flowdesk_update_document': {
        guard(runtime, SCOPES.DOCS_WRITE)
        const p = z
          .object({
            document_id: z.string().uuid(),
            title: z.string().optional(),
            content: z.string().optional(),
            status: z.enum(['draft', 'published']).optional(),
            folder_id: z.string().uuid().optional(),
            tags: z.array(z.string()).optional(),
            create_version: z.boolean().optional(),
          })
          .parse(args)
        const { document_id, ...body } = p
        return jsonResult(await runtime.client.patch(`/documents/${document_id}`, body))
      }
      case 'flowdesk_list_forms': {
        guard(runtime, SCOPES.FORMS_READ)
        const { workspace_id } = z.object({ workspace_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/workspaces/${workspace_id}/forms`))
      }
      case 'flowdesk_get_form': {
        guard(runtime, SCOPES.FORMS_READ)
        const { form_id } = z.object({ form_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/forms/${form_id}`))
      }
      case 'flowdesk_list_form_submissions': {
        guard(runtime, SCOPES.FORMS_READ)
        const p = z
          .object({
            form_id: z.string().uuid(),
            page: z.number().optional(),
            page_size: z.number().optional(),
          })
          .parse(args)
        return jsonResult(
          await runtime.client.get(`/forms/${p.form_id}/submissions`, {
            page: p.page,
            page_size: p.page_size,
          }),
        )
      }
      case 'flowdesk_list_whiteboards': {
        guard(runtime, SCOPES.WHITEBOARDS_READ)
        const { workspace_id } = z.object({ workspace_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/workspaces/${workspace_id}/whiteboards`))
      }
      case 'flowdesk_get_whiteboard': {
        guard(runtime, SCOPES.WHITEBOARDS_READ)
        const { whiteboard_id } = z.object({ whiteboard_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/whiteboards/${whiteboard_id}`))
      }
      case 'flowdesk_get_project_github_connection': {
        guard(runtime, SCOPES.GITHUB_READ)
        const { project_id } = z.object({ project_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/github/projects/${project_id}/connection`))
      }
      case 'flowdesk_create_github_issue_for_task': {
        guard(runtime, SCOPES.GITHUB_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            repository_id: z.string().uuid().optional(),
            repo_full_name: z.string().optional(),
          })
          .parse(args)
        const { task_id, ...body } = p
        const payload =
          body.repository_id || body.repo_full_name ? body : undefined
        return jsonResult(await runtime.client.post(`/github/tasks/${task_id}/create-issue`, payload))
      }
      case 'flowdesk_sync_github_issue_status': {
        guard(runtime, SCOPES.GITHUB_WRITE)
        const { task_id } = z.object({ task_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.post(`/github/tasks/${task_id}/sync-issue-status`))
      }
      case 'flowdesk_bulk_update_tasks': {
        guard(runtime, SCOPES.TASKS_WRITE)
        const p = z
          .object({
            task_ids: z.array(z.string().uuid()).min(1).max(25),
            status_id: z.string().uuid().optional(),
            priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
            clear_priority: z.boolean().optional(),
            due_date: z.string().optional(),
            clear_due_date: z.boolean().optional(),
            is_archived: z.boolean().optional(),
            labels: z.array(z.string()).optional(),
          })
          .parse(args)
        const { task_ids, ...body } = p
        const hasField = Object.values(body).some((v) => v !== undefined)
        if (!hasField) {
          throw new Error('Provide at least one field to update (status_id, priority, due_date, etc.)')
        }
        const results: Array<{ task_id: string; ok: boolean; ref?: string; error?: string }> = []
        for (const task_id of task_ids) {
          try {
            const updated = (await runtime.client.patch(`/tasks/${task_id}`, body)) as { ref?: string }
            results.push({ task_id, ok: true, ref: updated.ref })
          } catch (err) {
            results.push({
              task_id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
        return jsonResult({
          total: task_ids.length,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        })
      }
      default:
        return null
    }
  } catch (err) {
    return errorResult(err)
  }
}

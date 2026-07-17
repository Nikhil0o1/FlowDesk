import { z } from 'zod'

import { errorResult, jsonResult } from '../client.js'
import { getToolRuntime, type ToolRuntime } from '../context.js'
import { requireScopes, SCOPES } from '../scopes.js'
import { handlePhase2ToolCall, phase2ToolDefinitions } from './phase2.js'
import { handlePhase3ToolCall, phase3ToolDefinitions } from './phase3.js'

function guard(runtime: ToolRuntime, ...scopes: string[]) {
  const have = runtime.tokenScopes.length ? runtime.tokenScopes : undefined
  requireScopes(have, scopes as never[])
}

const phase1ToolDefinitions = [
  {
    name: 'flowdesk_whoami',
    description:
      'Get the authenticated user profile, login context, and role summary. Call this first to learn organization/workspace scope.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'flowdesk_search',
    description: 'Global search across tasks, projects, comments, and users (min 2 characters).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', minLength: 2, description: 'Search query' },
        limit: { type: 'number', minimum: 1, maximum: 25, default: 8 },
      },
      required: ['query'],
    },
  },
  {
    name: 'flowdesk_list_my_tasks',
    description: 'List tasks for the current user (assigned, created, or delegated).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        relation: { type: 'string', enum: ['assigned', 'created', 'delegated'], default: 'assigned' },
        workspace_id: { type: 'string', description: 'Optional workspace UUID filter' },
        due: { type: 'string', enum: ['today', 'week', 'overdue'] },
        include_completed: { type: 'boolean', default: false },
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'flowdesk_get_task',
    description: 'Get full details for a task by UUID.',
    inputSchema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string', description: 'Task UUID' } },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_create_task',
    description: 'Create a task in a project with optional assignees, priority, dates, and description.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        assignee_ids: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        status_id: {
          type: 'string',
          description:
            'Custom status UUID from flowdesk_list_project_statuses (match by name). Do not invent IDs from tasks alone — empty columns still have statuses.',
        },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        list_id: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        time_estimate_seconds: { type: 'number', minimum: 0, description: 'Estimate in total seconds (supports days+hours+min+sec)' },
      },
      required: ['project_id', 'title'],
    },
  },
  {
    name: 'flowdesk_update_task',
    description:
      'Update task fields (title, description, status, priority, dates, labels, etc.). To change status by name (e.g. In Progress), first call flowdesk_list_project_statuses and pass the matching status id — never invent status_id from other tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        clear_priority: { type: 'boolean' },
        status_id: {
          type: 'string',
          description:
            'Custom status UUID from flowdesk_list_project_statuses. Empty status columns still have IDs — list statuses; do not infer from task list.',
        },
        due_date: { type: 'string' },
        clear_due_date: { type: 'boolean' },
        start_date: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        is_archived: { type: 'boolean' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_delete_task',
    description:
      'Permanently delete a task. Requires confirm=true. Blocked unless FLOWDESK_ALLOW_DESTRUCTIVE=true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        confirm: { type: 'boolean', description: 'Must be true to delete' },
      },
      required: ['task_id', 'confirm'],
    },
  },
  {
    name: 'flowdesk_assign_task',
    description: 'Add assignees to a task, or remove one assignee.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        add_user_ids: { type: 'array', items: { type: 'string' } },
        remove_user_id: { type: 'string', description: 'Single user UUID to unassign' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_list_organizations',
    description: 'List organizations the current user belongs to.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'flowdesk_list_workspaces',
    description: 'List workspaces in an organization.',
    inputSchema: {
      type: 'object' as const,
      properties: { organization_id: { type: 'string' } },
      required: ['organization_id'],
    },
  },
  {
    name: 'flowdesk_list_projects',
    description: 'List projects in a workspace, optionally filtered by space.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        space_id: { type: 'string' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_get_project',
    description: 'Get project metadata by UUID.',
    inputSchema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'flowdesk_list_project_statuses',
    description:
      'List all custom statuses for a project (id, name, color, category, position). Use this before setting status_id on create/update — statuses exist even when no tasks are in that column.',
    inputSchema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'flowdesk_add_comment',
    description: 'Add a comment on a task. Supports @mention markup @[Name](user-id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        body: { type: 'string', minLength: 1 },
        parent_comment_id: { type: 'string' },
      },
      required: ['task_id', 'body'],
    },
  },
  {
    name: 'flowdesk_list_inbox',
    description: 'List inbox notifications (Primary/Other/Later/Cleared tabs or Replies view).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tab: { type: 'string', enum: ['primary', 'other', 'later', 'cleared', 'all'] },
        view: { type: 'string', enum: ['inbox', 'replies', 'assigned_comments'] },
        unread_only: { type: 'boolean' },
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 100, default: 30 },
      },
    },
  },
  {
    name: 'flowdesk_mark_notification_read',
    description: 'Mark a single notification as read.',
    inputSchema: {
      type: 'object' as const,
      properties: { notification_id: { type: 'string' } },
      required: ['notification_id'],
    },
  },
  {
    name: 'flowdesk_clear_notification',
    description: 'Clear (archive) a single notification from the inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: { notification_id: { type: 'string' } },
      required: ['notification_id'],
    },
  },
] as const

export const toolDefinitions = [...phase1ToolDefinitions, ...phase2ToolDefinitions, ...phase3ToolDefinitions]

export async function handleToolCall(name: string, args: unknown, runtime?: ToolRuntime) {
  const rt = runtime ?? getToolRuntime()
  try {
    switch (name) {
      case 'flowdesk_whoami': {
        const me = await rt.client.get('/auth/me')
        const roles = await rt.client.get('/users/me/roles')
        return jsonResult({ me, roles })
      }
      case 'flowdesk_search': {
        guard(rt, SCOPES.SEARCH_READ)
        const { query, limit = 8 } = z.object({ query: z.string().min(2), limit: z.number().optional() }).parse(args)
        return jsonResult(await rt.client.get('/search', { q: query, limit }))
      }
      case 'flowdesk_list_my_tasks': {
        guard(rt, SCOPES.TASKS_READ)
        const p = z
          .object({
            relation: z.enum(['assigned', 'created', 'delegated']).optional(),
            workspace_id: z.string().uuid().optional(),
            due: z.enum(['today', 'week', 'overdue']).optional(),
            include_completed: z.boolean().optional(),
            page: z.number().optional(),
            page_size: z.number().optional(),
          })
          .parse(args)
        return jsonResult(
          await rt.client.get('/me/tasks', {
            relation: p.relation ?? 'assigned',
            workspace_id: p.workspace_id,
            due: p.due,
            include_completed: p.include_completed,
            page: p.page,
            page_size: p.page_size,
          }),
        )
      }
      case 'flowdesk_get_task': {
        guard(rt, SCOPES.TASKS_READ)
        const { task_id } = z.object({ task_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.get(`/tasks/${task_id}`))
      }
      case 'flowdesk_create_task': {
        guard(rt, SCOPES.TASKS_WRITE)
        const p = z
          .object({
            project_id: z.string().uuid(),
            title: z.string().min(1),
            description: z.string().optional(),
            assignee_ids: z.array(z.string().uuid()).optional(),
            priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
            status_id: z.string().uuid().optional(),
            due_date: z.string().optional(),
            start_date: z.string().optional(),
            list_id: z.string().uuid().optional(),
            labels: z.array(z.string()).optional(),
            time_estimate_seconds: z.number().optional(),
          })
          .parse(args)
        const { project_id, ...body } = p
        return jsonResult(await rt.client.post(`/projects/${project_id}/tasks`, body))
      }
      case 'flowdesk_update_task': {
        guard(rt, SCOPES.TASKS_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            title: z.string().optional(),
            description: z.string().optional(),
            priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
            clear_priority: z.boolean().optional(),
            status_id: z.string().uuid().optional(),
            due_date: z.string().optional(),
            clear_due_date: z.boolean().optional(),
            start_date: z.string().optional(),
            labels: z.array(z.string()).optional(),
            is_archived: z.boolean().optional(),
          })
          .parse(args)
        const { task_id, ...body } = p
        return jsonResult(await rt.client.patch(`/tasks/${task_id}`, body))
      }
      case 'flowdesk_delete_task': {
        guard(rt, SCOPES.TASKS_WRITE)
        const { task_id, confirm } = z.object({ task_id: z.string().uuid(), confirm: z.boolean() }).parse(args)
        if (!confirm) throw new Error('Set confirm=true to delete a task')
        if (!rt.allowDestructive) {
          throw new Error('Destructive actions disabled. Set FLOWDESK_ALLOW_DESTRUCTIVE=true to allow task deletion.')
        }
        return jsonResult(await rt.client.delete(`/tasks/${task_id}`))
      }
      case 'flowdesk_assign_task': {
        guard(rt, SCOPES.TASKS_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            add_user_ids: z.array(z.string().uuid()).optional(),
            remove_user_id: z.string().uuid().optional(),
          })
          .parse(args)
        if (p.add_user_ids?.length) {
          await rt.client.post(`/tasks/${p.task_id}/assignees`, { user_ids: p.add_user_ids })
        }
        if (p.remove_user_id) {
          await rt.client.delete(`/tasks/${p.task_id}/assignees/${p.remove_user_id}`)
        }
        return jsonResult({ detail: 'Assignees updated' })
      }
      case 'flowdesk_list_organizations': {
        guard(rt, SCOPES.PROJECTS_READ)
        return jsonResult(await rt.client.get('/organizations'))
      }
      case 'flowdesk_list_workspaces': {
        guard(rt, SCOPES.PROJECTS_READ)
        const { organization_id } = z.object({ organization_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.get(`/organizations/${organization_id}/workspaces`))
      }
      case 'flowdesk_list_projects': {
        guard(rt, SCOPES.PROJECTS_READ)
        const p = z.object({ workspace_id: z.string().uuid(), space_id: z.string().uuid().optional() }).parse(args)
        return jsonResult(
          await rt.client.get(`/workspaces/${p.workspace_id}/projects`, { space_id: p.space_id }),
        )
      }
      case 'flowdesk_get_project': {
        guard(rt, SCOPES.PROJECTS_READ)
        const { project_id } = z.object({ project_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.get(`/projects/${project_id}`))
      }
      case 'flowdesk_list_project_statuses': {
        guard(rt, SCOPES.PROJECTS_READ)
        const { project_id } = z.object({ project_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.get(`/projects/${project_id}/statuses`))
      }
      case 'flowdesk_add_comment': {
        guard(rt, SCOPES.COMMENTS_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            body: z.string().min(1),
            parent_comment_id: z.string().uuid().optional(),
          })
          .parse(args)
        const { task_id, ...body } = p
        return jsonResult(await rt.client.post(`/tasks/${task_id}/comments`, body))
      }
      case 'flowdesk_list_inbox': {
        guard(rt, SCOPES.INBOX_READ)
        const p = z
          .object({
            tab: z.enum(['primary', 'other', 'later', 'cleared', 'all']).optional(),
            view: z.enum(['inbox', 'replies', 'assigned_comments']).optional(),
            unread_only: z.boolean().optional(),
            page: z.number().optional(),
            page_size: z.number().optional(),
          })
          .parse(args)
        return jsonResult(
          await rt.client.get('/notifications', {
            tab: p.tab,
            view: p.view,
            unread_only: p.unread_only,
            page: p.page,
            page_size: p.page_size,
          }),
        )
      }
      case 'flowdesk_mark_notification_read': {
        guard(rt, SCOPES.INBOX_WRITE)
        const { notification_id } = z.object({ notification_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.post(`/notifications/${notification_id}/read`))
      }
      case 'flowdesk_clear_notification': {
        guard(rt, SCOPES.INBOX_WRITE)
        const { notification_id } = z.object({ notification_id: z.string().uuid() }).parse(args)
        return jsonResult(await rt.client.post(`/notifications/${notification_id}/clear`))
      }
      default: {
        const phase2Result = await handlePhase2ToolCall(name, args, rt)
        if (phase2Result !== null) {
          return phase2Result
        }
        const phase3Result = await handlePhase3ToolCall(name, args, rt)
        if (phase3Result !== null) {
          return phase3Result
        }
        throw new Error(`Unknown tool: ${name}`)
      }
    }
  } catch (err) {
    return errorResult(err)
  }
}

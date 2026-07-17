import { z } from 'zod'

import { errorResult, jsonResult } from '../client.js'
import { type ToolRuntime } from '../context.js'
import { requireScopes, SCOPES } from '../scopes.js'

function guard(runtime: ToolRuntime, ...scopes: string[]) {
  const have = runtime.tokenScopes.length ? runtime.tokenScopes : undefined
  requireScopes(have, scopes as never[])
}

export const phase2ToolDefinitions = [
  {
    name: 'flowdesk_list_sprints',
    description: 'List sprints in a workspace, optionally filtered by project or status (planned, active, completed).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        status: { type: 'string', enum: ['planned', 'active', 'completed'] },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_get_sprint',
    description: 'Get sprint details including task counts and story points.',
    inputSchema: {
      type: 'object' as const,
      properties: { sprint_id: { type: 'string' } },
      required: ['sprint_id'],
    },
  },
  {
    name: 'flowdesk_create_sprint',
    description: 'Create a sprint in a workspace (workspace admin required).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        name: { type: 'string', minLength: 1 },
        goal: { type: 'string' },
        project_id: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        scrum_master_id: { type: 'string' },
        delegate_scrum_master_id: { type: 'string' },
      },
      required: ['workspace_id', 'name'],
    },
  },
  {
    name: 'flowdesk_start_sprint',
    description: 'Start a planned sprint (sprint manager required).',
    inputSchema: {
      type: 'object' as const,
      properties: { sprint_id: { type: 'string' } },
      required: ['sprint_id'],
    },
  },
  {
    name: 'flowdesk_complete_sprint',
    description: 'Complete an active sprint. Optionally move incomplete tasks to another sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprint_id: { type: 'string' },
        move_incomplete_to: { type: 'string', description: 'Target sprint UUID for rollover' },
      },
      required: ['sprint_id'],
    },
  },
  {
    name: 'flowdesk_list_sprint_tasks',
    description: 'List all tasks in a sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: { sprint_id: { type: 'string' } },
      required: ['sprint_id'],
    },
  },
  {
    name: 'flowdesk_add_sprint_tasks',
    description: 'Add one or more tasks to a sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprint_id: { type: 'string' },
        task_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['sprint_id', 'task_ids'],
    },
  },
  {
    name: 'flowdesk_remove_sprint_task',
    description: 'Remove a task from a sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprint_id: { type: 'string' },
        task_id: { type: 'string' },
      },
      required: ['sprint_id', 'task_id'],
    },
  },
  {
    name: 'flowdesk_log_time_on_task',
    description: 'Log a manual time entry on a task (started_at and ended_at as ISO datetimes).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        started_at: { type: 'string', description: 'ISO 8601 datetime' },
        ended_at: { type: 'string', description: 'ISO 8601 datetime' },
        description: { type: 'string' },
      },
      required: ['task_id', 'started_at', 'ended_at'],
    },
  },
  {
    name: 'flowdesk_start_timer',
    description: 'Start a running timer on a task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'flowdesk_stop_timer',
    description: 'Stop the current running timer for the authenticated user.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'flowdesk_get_current_timer',
    description: 'Get the currently running timer, if any.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'flowdesk_list_my_time_entries',
    description: 'List time entries for the current user, optionally filtered by date range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start: { type: 'string', description: 'ISO 8601 datetime (inclusive)' },
        end: { type: 'string', description: 'ISO 8601 datetime (exclusive)' },
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 500, default: 50 },
      },
    },
  },
  {
    name: 'flowdesk_list_project_members',
    description: 'List members of a project (read-only).',
    inputSchema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'flowdesk_list_workspace_members',
    description: 'List members of a workspace (read-only).',
    inputSchema: {
      type: 'object' as const,
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_list_templates',
    description: 'List workspace templates (project or space kind).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'string' },
        kind: { type: 'string', enum: ['project', 'space'] },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_apply_template',
    description: 'Apply a template to create a new project (needs target_space_id) or space.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template_id: { type: 'string' },
        name: { type: 'string' },
        target_space_id: { type: 'string', description: 'Required for project templates' },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'flowdesk_list_channels',
    description: 'List chat channels in a workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
  },
  {
    name: 'flowdesk_post_channel_message',
    description: 'Post a message to a chat channel. Supports @mention markup @[Name](user-id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel_id: { type: 'string' },
        body: { type: 'string', minLength: 1 },
        parent_message_id: { type: 'string' },
      },
      required: ['channel_id', 'body'],
    },
  },
] as const

export async function handlePhase2ToolCall(name: string, args: unknown, runtime: ToolRuntime) {
  try {
    switch (name) {
      case 'flowdesk_list_sprints': {
        guard(runtime, SCOPES.SPRINTS_READ)
        const p = z
          .object({
            workspace_id: z.string().uuid(),
            project_id: z.string().uuid().optional(),
            status: z.enum(['planned', 'active', 'completed']).optional(),
          })
          .parse(args)
        return jsonResult(
          await runtime.client.get(`/workspaces/${p.workspace_id}/sprints`, {
            project_id: p.project_id,
            status: p.status,
          }),
        )
      }
      case 'flowdesk_get_sprint': {
        guard(runtime, SCOPES.SPRINTS_READ)
        const { sprint_id } = z.object({ sprint_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/sprints/${sprint_id}`))
      }
      case 'flowdesk_create_sprint': {
        guard(runtime, SCOPES.SPRINTS_WRITE)
        const p = z
          .object({
            workspace_id: z.string().uuid(),
            name: z.string().min(1),
            goal: z.string().optional(),
            project_id: z.string().uuid().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            scrum_master_id: z.string().uuid().optional(),
            delegate_scrum_master_id: z.string().uuid().optional(),
          })
          .parse(args)
        const { workspace_id, ...body } = p
        return jsonResult(await runtime.client.post(`/workspaces/${workspace_id}/sprints`, body))
      }
      case 'flowdesk_start_sprint': {
        guard(runtime, SCOPES.SPRINTS_WRITE)
        const { sprint_id } = z.object({ sprint_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.post(`/sprints/${sprint_id}/start`))
      }
      case 'flowdesk_complete_sprint': {
        guard(runtime, SCOPES.SPRINTS_WRITE)
        const p = z
          .object({
            sprint_id: z.string().uuid(),
            move_incomplete_to: z.string().uuid().optional(),
          })
          .parse(args)
        const body = p.move_incomplete_to ? { move_incomplete_to: p.move_incomplete_to } : {}
        return jsonResult(await runtime.client.post(`/sprints/${p.sprint_id}/complete`, body))
      }
      case 'flowdesk_list_sprint_tasks': {
        guard(runtime, SCOPES.SPRINTS_READ)
        const { sprint_id } = z.object({ sprint_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/sprints/${sprint_id}/tasks`))
      }
      case 'flowdesk_add_sprint_tasks': {
        guard(runtime, SCOPES.SPRINTS_WRITE)
        const p = z
          .object({
            sprint_id: z.string().uuid(),
            task_ids: z.array(z.string().uuid()).min(1),
          })
          .parse(args)
        return jsonResult(
          await runtime.client.post(`/sprints/${p.sprint_id}/tasks`, { task_ids: p.task_ids }),
        )
      }
      case 'flowdesk_remove_sprint_task': {
        guard(runtime, SCOPES.SPRINTS_WRITE)
        const p = z
          .object({
            sprint_id: z.string().uuid(),
            task_id: z.string().uuid(),
          })
          .parse(args)
        return jsonResult(await runtime.client.delete(`/sprints/${p.sprint_id}/tasks/${p.task_id}`))
      }
      case 'flowdesk_log_time_on_task': {
        guard(runtime, SCOPES.TIME_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            started_at: z.string().min(1),
            ended_at: z.string().min(1),
            description: z.string().optional(),
          })
          .parse(args)
        const { task_id, ...body } = p
        return jsonResult(await runtime.client.post(`/tasks/${task_id}/time-entries`, body))
      }
      case 'flowdesk_start_timer': {
        guard(runtime, SCOPES.TIME_WRITE)
        const p = z
          .object({
            task_id: z.string().uuid(),
            description: z.string().optional(),
          })
          .parse(args)
        const { task_id, description } = p
        return jsonResult(
          await runtime.client.post(`/tasks/${task_id}/timer/start`, description ? { description } : {}),
        )
      }
      case 'flowdesk_stop_timer': {
        guard(runtime, SCOPES.TIME_WRITE)
        return jsonResult(await runtime.client.post('/timer/stop'))
      }
      case 'flowdesk_get_current_timer': {
        guard(runtime, SCOPES.TIME_READ)
        return jsonResult(await runtime.client.get('/timer/current'))
      }
      case 'flowdesk_list_my_time_entries': {
        guard(runtime, SCOPES.TIME_READ)
        const p = z
          .object({
            start: z.string().optional(),
            end: z.string().optional(),
            page: z.number().optional(),
            page_size: z.number().optional(),
          })
          .parse(args)
        return jsonResult(
          await runtime.client.get('/me/time-entries', {
            start: p.start,
            end: p.end,
            page: p.page,
            page_size: p.page_size,
          }),
        )
      }
      case 'flowdesk_list_project_members': {
        guard(runtime, SCOPES.MEMBERS_READ)
        const { project_id } = z.object({ project_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/projects/${project_id}/members`))
      }
      case 'flowdesk_list_workspace_members': {
        guard(runtime, SCOPES.MEMBERS_READ)
        const { workspace_id } = z.object({ workspace_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/workspaces/${workspace_id}/members`))
      }
      case 'flowdesk_list_templates': {
        guard(runtime, SCOPES.TEMPLATES_READ)
        const p = z
          .object({
            workspace_id: z.string().uuid(),
            kind: z.enum(['project', 'space']).optional(),
          })
          .parse(args)
        return jsonResult(
          await runtime.client.get(`/workspaces/${p.workspace_id}/templates`, { kind: p.kind }),
        )
      }
      case 'flowdesk_apply_template': {
        guard(runtime, SCOPES.TEMPLATES_WRITE)
        const p = z
          .object({
            template_id: z.string().uuid(),
            name: z.string().optional(),
            target_space_id: z.string().uuid().optional(),
          })
          .parse(args)
        const { template_id, ...body } = p
        return jsonResult(await runtime.client.post(`/templates/${template_id}/apply`, body))
      }
      case 'flowdesk_list_channels': {
        guard(runtime, SCOPES.CHAT_READ)
        const { workspace_id } = z.object({ workspace_id: z.string().uuid() }).parse(args)
        return jsonResult(await runtime.client.get(`/workspaces/${workspace_id}/channels`))
      }
      case 'flowdesk_post_channel_message': {
        guard(runtime, SCOPES.CHAT_WRITE)
        const p = z
          .object({
            channel_id: z.string().uuid(),
            body: z.string().min(1),
            parent_message_id: z.string().uuid().optional(),
          })
          .parse(args)
        const { channel_id, ...body } = p
        return jsonResult(await runtime.client.post(`/channels/${channel_id}/messages`, body))
      }
      default:
        return null
    }
  } catch (err) {
    return errorResult(err)
  }
}

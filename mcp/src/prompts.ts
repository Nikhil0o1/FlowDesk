import type { ToolRuntime } from './context.js'
import { requireScopes, SCOPES } from './scopes.js'

export const promptDefinitions = [
  {
    name: 'triage-my-inbox',
    title: 'Triage my inbox',
    description:
      'Step through Primary inbox notifications: summarize each, suggest mark-read or clear, and draft replies where needed.',
    arguments: [
      {
        name: 'unread_only',
        description: 'Only unread Primary tab items (default true)',
        required: false,
      },
    ],
  },
  {
    name: 'sprint-standup',
    title: 'Sprint standup',
    description:
      'Summarize an active sprint: completed work, in progress, blockers, and overdue tasks for standup.',
    arguments: [
      {
        name: 'sprint_id',
        description: 'Sprint UUID (optional — uses first active sprint in workspace if omitted)',
        required: false,
      },
      {
        name: 'workspace_id',
        description: 'Workspace UUID when sprint_id is omitted',
        required: false,
      },
    ],
  },
  {
    name: 'create-tasks-from-notes',
    title: 'Create tasks from notes',
    description:
      'Parse meeting notes or bullet list into tasks in a project. Creates tasks with titles, optional due dates, and assignees when mentioned.',
    arguments: [
      {
        name: 'project_id',
        description: 'Target project UUID',
        required: true,
      },
      {
        name: 'notes',
        description: 'Raw notes or bullet list to convert into tasks',
        required: true,
      },
    ],
  },
] as const

function guard(runtime: ToolRuntime, ...scopes: string[]) {
  const have = runtime.tokenScopes.length ? runtime.tokenScopes : undefined
  requireScopes(have, scopes as never[])
}

export async function getFlowdeskPrompt(
  name: string,
  args: Record<string, string> | undefined,
  runtime: ToolRuntime,
) {
  switch (name) {
    case 'triage-my-inbox': {
      guard(runtime, SCOPES.INBOX_READ)
      const unreadOnly = args?.unread_only !== 'false'
      const inbox = await runtime.client.get('/notifications', {
        tab: 'primary',
        view: 'inbox',
        unread_only: unreadOnly,
        page_size: 30,
      })
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are triaging my FlowDesk Primary inbox.',
                'For each notification below:',
                '1. Summarize what happened in one line',
                '2. Recommend: mark read, clear, open linked task, or reply',
                '3. Group duplicates if any',
                '',
                'Use flowdesk_mark_notification_read / flowdesk_clear_notification when I confirm.',
                '',
                JSON.stringify(inbox, null, 2),
              ].join('\n'),
            },
          },
        ],
      }
    }
    case 'sprint-standup': {
      guard(runtime, SCOPES.SPRINTS_READ, SCOPES.TASKS_READ)
      let sprintId = args?.sprint_id
      if (!sprintId) {
        const workspaceId = args?.workspace_id
        if (!workspaceId) {
          throw new Error('Provide sprint_id or workspace_id')
        }
        const sprints = (await runtime.client.get(`/workspaces/${workspaceId}/sprints`, {
          status: 'active',
        })) as Array<{ id: string; name: string }>
        if (!sprints.length) throw new Error('No active sprint in workspace')
        sprintId = sprints[0].id
      }
      const [sprint, tasks] = await Promise.all([
        runtime.client.get(`/sprints/${sprintId}`),
        runtime.client.get(`/sprints/${sprintId}/tasks`),
      ])
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'Prepare a concise sprint standup from this FlowDesk data.',
                'Sections: Done since last standup | In progress | Blocked | Overdue | Risks',
                'Use task refs and assignee names. Keep it scannable for a live meeting.',
                '',
                'Sprint:',
                JSON.stringify(sprint, null, 2),
                '',
                'Tasks:',
                JSON.stringify(tasks, null, 2),
              ].join('\n'),
            },
          },
        ],
      }
    }
    case 'create-tasks-from-notes': {
      guard(runtime, SCOPES.TASKS_WRITE)
      const projectId = args?.project_id
      const notes = args?.notes
      if (!projectId || !notes) {
        throw new Error('project_id and notes are required')
      }
      const project = await runtime.client.get(`/projects/${projectId}`)
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Create tasks in FlowDesk project "${(project as { name?: string }).name ?? projectId}" from these notes.`,
                'For each distinct action item:',
                '- Propose title, description, priority, due date if inferable',
                '- If setting a status by name, call flowdesk_list_project_statuses first and use that status id',
                '- Then call flowdesk_create_task for each after I confirm (or if notes are unambiguous)',
                '',
                'Notes:',
                notes,
              ].join('\n'),
            },
          },
        ],
      }
    }
    default:
      throw new Error(`Unknown prompt: ${name}`)
  }
}

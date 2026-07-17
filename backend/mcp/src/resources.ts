import type { ToolRuntime } from './context.js'
import { requireScopes, SCOPES } from './scopes.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const resourceTemplates = [
  {
    uriTemplate: 'flowdesk://task/{task_id}',
    name: 'task',
    title: 'Task',
    description: 'JSON summary of a task by UUID',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'flowdesk://project/{project_id}',
    name: 'project',
    title: 'Project',
    description: 'Project metadata, task counts, and full custom status list (ids + names)',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'flowdesk://workspace/{workspace_id}/projects',
    name: 'workspace-projects',
    title: 'Workspace projects',
    description: 'Projects in a workspace the user can access',
    mimeType: 'application/json',
  },
] as const

export const staticResources = [
  {
    uri: 'flowdesk://user/me',
    name: 'current-user',
    title: 'Current user',
    description: 'Authenticated user profile, login context, and roles',
    mimeType: 'application/json',
  },
] as const

function guard(runtime: ToolRuntime, ...scopes: string[]) {
  const have = runtime.tokenScopes.length ? runtime.tokenScopes : undefined
  requireScopes(have, scopes as never[])
}

export async function readFlowdeskResource(uri: string, runtime: ToolRuntime) {
  if (uri === 'flowdesk://user/me') {
    const me = await runtime.client.get('/auth/me')
    const roles = await runtime.client.get('/users/me/roles')
    return JSON.stringify({ me, roles }, null, 2)
  }

  const taskMatch = uri.match(/^flowdesk:\/\/task\/([^/]+)$/i)
  if (taskMatch) {
    guard(runtime, SCOPES.TASKS_READ)
    const taskId = taskMatch[1]
    if (!UUID_RE.test(taskId)) throw new Error('Invalid task_id in resource URI')
    const task = await runtime.client.get(`/tasks/${taskId}`)
    return JSON.stringify(task, null, 2)
  }

  const projectMatch = uri.match(/^flowdesk:\/\/project\/([^/]+)$/i)
  if (projectMatch) {
    guard(runtime, SCOPES.PROJECTS_READ)
    const projectId = projectMatch[1]
    if (!UUID_RE.test(projectId)) throw new Error('Invalid project_id in resource URI')
    const [project, statuses] = await Promise.all([
      runtime.client.get(`/projects/${projectId}`),
      runtime.client.get(`/projects/${projectId}/statuses`),
    ])
    return JSON.stringify({ project, statuses }, null, 2)
  }

  const workspaceMatch = uri.match(/^flowdesk:\/\/workspace\/([^/]+)\/projects$/i)
  if (workspaceMatch) {
    guard(runtime, SCOPES.PROJECTS_READ)
    const workspaceId = workspaceMatch[1]
    if (!UUID_RE.test(workspaceId)) throw new Error('Invalid workspace_id in resource URI')
    const projects = await runtime.client.get(`/workspaces/${workspaceId}/projects`)
    return JSON.stringify(projects, null, 2)
  }

  throw new Error(`Unknown resource URI: ${uri}`)
}

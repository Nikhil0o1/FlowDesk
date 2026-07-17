import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import type { MyTasksSummary, Page, Project, Task } from './types'
import { useCurrentContext } from './queries'

export type MyTasksRelation = 'assigned' | 'created' | 'delegated'

/** Backend `/me/tasks` rejects page_size > 200. */
export const MY_TASKS_MAX_PAGE_SIZE = 200

export type MyTasksQueryParams = {
  relation?: MyTasksRelation
  /** When set, limits tasks to one workspace; default is all accessible projects (org-wide). */
  workspaceId?: string | null
  due?: 'today' | 'week' | 'overdue'
  includeCompleted?: boolean
  pageSize?: number
}

function buildMyTasksQuery(params: MyTasksQueryParams): string {
  const qs = new URLSearchParams()
  qs.set('relation', params.relation ?? 'assigned')
  qs.set('page_size', String(Math.min(params.pageSize ?? 200, MY_TASKS_MAX_PAGE_SIZE)))
  if (params.workspaceId) qs.set('workspace_id', params.workspaceId)
  if (params.due) qs.set('due', params.due)
  if (params.includeCompleted) qs.set('include_completed', 'true')
  return qs.toString()
}

export function useMyTasksSummary(workspaceId?: string | null) {
  const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
  return useQuery({
    queryKey: ['my-tasks-summary', workspaceId ?? 'all'],
    queryFn: () => api.get<MyTasksSummary>(`/me/tasks/summary${qs}`),
    staleTime: 30_000,
  })
}

export function useMyTasks(params: MyTasksQueryParams = {}) {
  const queryString = buildMyTasksQuery(params)
  return useQuery({
    queryKey: ['my-tasks', queryString],
    queryFn: () => api.get<Page<Task>>(`/me/tasks?${queryString}`),
  })
}

export function usePersonalListProject() {
  const { workspace } = useCurrentContext()
  return useQuery({
    queryKey: ['personal-list', workspace?.id],
    queryFn: () => api.get<Project>(`/me/personal-list?workspace_id=${workspace!.id}`),
    enabled: !!workspace?.id,
  })
}

export function invalidateMyTasks(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['my-tasks-summary'] })
  void queryClient.invalidateQueries({ queryKey: ['personal-list'] })
}

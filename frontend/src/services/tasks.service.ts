import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import { api } from '../lib/api'
import { useCurrentContext, useProjects } from '../lib/queries'
import type { Page, Task } from '../lib/types'

/** A task decorated with its owning project's display name. */
export interface AllTasksItem extends Task {
  projectName: string
}

/**
 * "All Tasks" data — every task across all projects the user can access.
 *
 * FlowDesk has no single "all tasks" endpoint, so we fan out to the existing
 * per-project task endpoint and flatten. React Query dedupes and caches each
 * project's request.
 *
 * TODO(backend): a dedicated `GET /tasks` (assigned + created + watching +
 * shared, incl. completed/archived) would replace this client-side aggregation.
 */
export function useAllTasks() {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const projectList = projects.data ?? []

  const results = useQueries({
    queries: projectList.map((project) => ({
      queryKey: ['tasks', project.id, 'all-tasks'],
      queryFn: () => api.get<Page<Task>>(`/projects/${project.id}/tasks?page_size=500`),
      enabled: !!project.id,
    })),
  })

  const data = useMemo<AllTasksItem[]>(() => {
    return results.flatMap((result, index) => {
      const projectName = projectList[index]?.name ?? 'Unknown project'
      return (result.data?.items ?? [])
        .filter((task) => !task.parent_task_id)
        .map((task) => ({ ...task, projectName }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(','), projectList])

  return {
    data,
    isLoading: projects.isLoading || results.some((r) => r.isLoading),
    error: projects.error ?? results.find((r) => r.error)?.error ?? null,
  }
}

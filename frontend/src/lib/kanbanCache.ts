import type { QueryClient } from '@tanstack/react-query'

import type { CustomStatus, Task } from './types'

/** React-query roots that back Kanban columns across the app. */
export const KANBAN_PROJECT_TASKS_KEY = 'tasks' as const
export const KANBAN_SPRINT_TASKS_KEY = 'sprint-tasks' as const

/** Invalidate every task list that Kanban boards may render from. */
export function invalidateKanbanTaskQueries(
  queryClient: QueryClient,
  taskListQueryKey?: readonly unknown[],
) {
  void queryClient.invalidateQueries({ queryKey: [KANBAN_PROJECT_TASKS_KEY] })
  void queryClient.invalidateQueries({ queryKey: [KANBAN_SPRINT_TASKS_KEY] })
  if (taskListQueryKey?.length) {
    void queryClient.invalidateQueries({ queryKey: taskListQueryKey })
  }
}

/** Optimistic status move for query data shaped as Task[]. */
export function patchTaskStatusInCache(
  queryClient: QueryClient,
  taskListQueryKey: readonly unknown[],
  taskId: string,
  status: CustomStatus,
) {
  queryClient.setQueryData<Task[]>(taskListQueryKey, (old) => {
    if (!old) return old
    return old.map((t) => (t.id === taskId ? { ...t, status } : t))
  })
}

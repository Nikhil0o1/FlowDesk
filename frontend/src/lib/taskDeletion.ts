import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { removeRecent } from './recents'
import { useRealtime } from './ws'

const TASK_DELETE_QUERY_KEYS = [
  ['tasks'],
  ['my-tasks'],
  ['planner-week-tasks'],
  ['planner-overdue-tasks'],
  ['sprint-tasks'],
  ['sprints'],
  ['backlog'],
  ['timesheet'],
  ['my-time'],
  ['workspace-task-stats'],
  ['search'],
  ['timer'],
]

export function cleanupDeletedTask(queryClient: QueryClient, taskId?: string | null) {
  if (taskId) {
    removeRecent('task', taskId)
    queryClient.removeQueries({ queryKey: ['task', taskId] })
  }

  for (const queryKey of TASK_DELETE_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

export function useDeletedTaskCleanup() {
  const queryClient = useQueryClient()

  useRealtime(
    'task.deleted',
    (event) => {
      cleanupDeletedTask(queryClient, event.task_id)
    },
    [queryClient],
  )
}

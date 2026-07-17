import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api'
import { plannerWeekTasksPath } from '../../lib/planner'
import type { Page, Task } from '../../lib/types'

export function usePlannerWeekTasks(weekStart: Date, days = 7) {
  return useQuery({
    queryKey: ['planner-week-tasks', weekStart.toISOString(), days],
    queryFn: () => api.get<Page<Task>>(plannerWeekTasksPath(weekStart, days)),
  })
}

export function usePlannerOverdueTasks() {
  return useQuery({
    queryKey: ['planner-overdue-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?relation=assigned&due=overdue&page_size=20'),
  })
}

export function invalidatePlannerTasks(queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void }) {
  void queryClient.invalidateQueries({ queryKey: ['planner-week-tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['planner-overdue-tasks'] })
}

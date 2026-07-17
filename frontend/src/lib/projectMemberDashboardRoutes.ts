import { sprintPageUrl } from './sprintRoutes'

export function isFullHeightDashboardPath(pathname: string): boolean {
  return (
    pathname === '/app/dashboard' ||
    pathname === '/app/notifications' ||
    pathname === '/app/my-analytics' ||
    pathname.startsWith('/app/developers')
  )
}

export type TaskDueFilter = 'today' | 'week' | 'overdue'

/** My Tasks list — assigned work across projects. */
export function myTasksPageUrl(options?: { due?: TaskDueFilter; includeCompleted?: boolean }): string {
  if (options?.due === 'today' || options?.due === 'overdue') {
    return '/app/my-tasks/today-overdue'
  }
  const params = new URLSearchParams()
  if (options?.includeCompleted) params.set('include_completed', 'true')
  const qs = params.toString()
  return qs ? `/app/my-tasks/assigned?${qs}` : '/app/my-tasks/assigned'
}

/** My Tasks dashboard hub (card grid). */
export function myTasksHubUrl(): string {
  return '/app/my-tasks'
}

/** Project task list with optional due-date and assignee filters. */
export function projectTasksPageUrl(
  projectId: string,
  options?: {
    due?: TaskDueFilter
    assigneeMe?: boolean
    openOnly?: boolean
    view?: 'list' | 'board'
  },
): string {
  const params = new URLSearchParams()
  params.set('view', options?.view ?? 'list')
  if (options?.due) params.set('due', options.due)
  if (options?.assigneeMe) params.set('assignee', 'me')
  if (options?.openOnly) params.set('open_only', '1')
  return `/app/projects/${projectId}?${params.toString()}`
}

export function projectMemberKpiNavigation(
  projectId: string,
  isViewer: boolean,
  activeSprintId?: string | null,
) {
  const assigneeMe = !isViewer
  return {
    openTasks: () => projectTasksPageUrl(projectId, { assigneeMe, openOnly: true }),
    dueToday: () => projectTasksPageUrl(projectId, { due: 'today', assigneeMe }),
    overdue: () => projectTasksPageUrl(projectId, { due: 'overdue', assigneeMe }),
    dueThisWeek: () => projectTasksPageUrl(projectId, { due: 'week', assigneeMe }),
    completedThisWeek: () => projectTasksPageUrl(projectId, { assigneeMe }),
    projectProgress: () => `/app/projects/${projectId}`,
    activeSprints: () =>
      activeSprintId ? sprintPageUrl({ sprintId: activeSprintId }) : sprintPageUrl(),
  }
}

export function parseTaskDueFilter(value: string | null | undefined): TaskDueFilter | '' {
  if (value === 'today' || value === 'week' || value === 'overdue') return value
  return ''
}

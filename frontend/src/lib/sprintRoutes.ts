export const SPRINT_TAB_PARAM = 'tab'
export const SPRINT_ID_PARAM = 'sprint'

export const SPRINT_TABS = ['board', 'backlog', 'burndown', 'standups', 'retrospective'] as const
export type SprintTab = (typeof SPRINT_TABS)[number]

export function parseSprintTab(value: string | null | undefined): SprintTab {
  if (value && (SPRINT_TABS as readonly string[]).includes(value)) return value as SprintTab
  return 'board'
}

export function sprintPageUrl(options?: { sprintId?: string | null; tab?: SprintTab | null }): string {
  const params = new URLSearchParams()
  if (options?.sprintId) params.set(SPRINT_ID_PARAM, options.sprintId)
  if (options?.tab && options.tab !== 'board') params.set(SPRINT_TAB_PARAM, options.tab)
  const query = params.toString()
  return query ? `/app/sprints?${query}` : '/app/sprints'
}

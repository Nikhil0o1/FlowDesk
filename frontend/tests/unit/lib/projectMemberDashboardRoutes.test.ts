import { describe, expect, it } from 'vitest'

import {
  isFullHeightDashboardPath,
  myTasksPageUrl,
  parseTaskDueFilter,
  projectMemberKpiNavigation,
  projectTasksPageUrl,
} from '@/lib/projectMemberDashboardRoutes'

describe('projectMemberDashboardRoutes', () => {
  it('builds my tasks list URLs', () => {
    expect(myTasksPageUrl()).toBe('/app/my-tasks/assigned')
    expect(myTasksPageUrl({ due: 'overdue' })).toBe('/app/my-tasks/today-overdue')
    expect(myTasksPageUrl({ includeCompleted: true })).toBe(
      '/app/my-tasks/assigned?include_completed=true',
    )
  })

  it('builds project task list URLs', () => {
    expect(projectTasksPageUrl('p-1')).toBe('/app/projects/p-1?view=list')
    expect(projectTasksPageUrl('p-1', { due: 'week', assigneeMe: true })).toBe(
      '/app/projects/p-1?view=list&due=week&assignee=me',
    )
  })

  it('parses due filters', () => {
    expect(parseTaskDueFilter('week')).toBe('week')
    expect(parseTaskDueFilter('bad')).toBe('')
    expect(parseTaskDueFilter(null)).toBe('')
  })

  it('maps member KPI navigation to project-scoped task lists', () => {
    const nav = projectMemberKpiNavigation('p-1', false, 'sprint-9')
    expect(nav.openTasks()).toBe('/app/projects/p-1?view=list&assignee=me&open_only=1')
    expect(nav.dueToday()).toBe('/app/projects/p-1?view=list&due=today&assignee=me')
    expect(nav.overdue()).toBe('/app/projects/p-1?view=list&due=overdue&assignee=me')
    expect(nav.dueThisWeek()).toBe('/app/projects/p-1?view=list&due=week&assignee=me')
    expect(nav.completedThisWeek()).toBe('/app/projects/p-1?view=list&assignee=me')
    expect(nav.activeSprints()).toBe('/app/sprints?sprint=sprint-9')
  })

  it('maps viewer KPI navigation to project scope without assignee filter', () => {
    const nav = projectMemberKpiNavigation('p-1', true)
    expect(nav.openTasks()).toBe('/app/projects/p-1?view=list&open_only=1')
    expect(nav.overdue()).toBe('/app/projects/p-1?view=list&due=overdue')
    expect(nav.activeSprints()).toBe('/app/sprints')
  })

  it('treats developer docs and my-analytics as full-height panel paths', () => {
    expect(isFullHeightDashboardPath('/app/developers')).toBe(true)
    expect(isFullHeightDashboardPath('/app/developers/examples')).toBe(true)
    expect(isFullHeightDashboardPath('/app/my-analytics')).toBe(true)
    expect(isFullHeightDashboardPath('/app/settings')).toBe(false)
  })
})

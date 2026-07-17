import { describe, expect, it } from 'vitest'

import { parseSprintTab, sprintPageUrl } from '@/lib/sprintRoutes'

describe('sprintRoutes', () => {
  it('parses valid sprint tabs', () => {
    expect(parseSprintTab('standups')).toBe('standups')
    expect(parseSprintTab('burndown')).toBe('burndown')
    expect(parseSprintTab('retrospective')).toBe('retrospective')
  })

  it('defaults unknown tabs to board', () => {
    expect(parseSprintTab(null)).toBe('board')
    expect(parseSprintTab('invalid')).toBe('board')
  })

  it('builds sprint page URLs', () => {
    expect(sprintPageUrl()).toBe('/app/sprints')
    expect(sprintPageUrl({ tab: 'standups' })).toBe('/app/sprints?tab=standups')
    expect(sprintPageUrl({ sprintId: 'sprint-1', tab: 'standups' })).toBe(
      '/app/sprints?sprint=sprint-1&tab=standups',
    )
    expect(sprintPageUrl({ sprintId: 'sprint-1', tab: 'board' })).toBe('/app/sprints?sprint=sprint-1')
    expect(sprintPageUrl({ sprintId: 'sprint-1', tab: 'retrospective' })).toBe(
      '/app/sprints?sprint=sprint-1&tab=retrospective',
    )
  })
})

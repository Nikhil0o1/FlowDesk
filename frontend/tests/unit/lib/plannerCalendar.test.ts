import { describe, expect, it } from 'vitest'

import {
  buildPlannerWeekView,
  collectLinkedGoogleEventIds,
  filterExternalCalendarEvents,
} from '@/lib/plannerCalendar'
import { partitionPlannerTasks } from '@/lib/planner'
import type { CalendarEvent, Task } from '@/lib/types'

function task(partial: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    list_id: null,
    parent_task_id: null,
    number: 1,
    ref: 'PROJ-1',
    title: 'Test',
    description: null,
    priority: null,
    task_type: 'task',
    start_date: null,
    due_date: null,
    planned_start_at: null,
    planned_end_at: null,
    google_calendar_event_id: null,
    story_points: null,
    position: 0,
    labels: [],
    is_archived: false,
    completed_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    status: null,
    assignees: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    github_issue_number: null,
    github_issue_url: null,
    ...partial,
  }
}

function event(id: string): CalendarEvent {
  return {
    id,
    title: 'Event',
    start: '2026-06-17T09:00:00Z',
    end: '2026-06-17T10:00:00Z',
    all_day: false,
    source: 'google',
  }
}

describe('collectLinkedGoogleEventIds', () => {
  it('collects google_calendar_event_id from tasks', () => {
    const ids = collectLinkedGoogleEventIds([
      task({ google_calendar_event_id: 'g-1' }),
      task({ id: 't2', google_calendar_event_id: null }),
      task({ id: 't3', google_calendar_event_id: 'g-2' }),
    ])
    expect(ids).toEqual(new Set(['g-1', 'g-2']))
  })
})

describe('filterExternalCalendarEvents', () => {
  it('returns all events when nothing is linked', () => {
    const events = [event('e1'), event('e2')]
    expect(filterExternalCalendarEvents(events, new Set())).toEqual(events)
  })

  it('drops events that mirror synced tasks', () => {
    const events = [event('g-1'), event('external')]
    expect(filterExternalCalendarEvents(events, new Set(['g-1']))).toEqual([event('external')])
  })
})

describe('buildPlannerWeekView', () => {
  it('merges partitions and dedupes calendar events', () => {
    const timed = task({
      id: 'timed',
      due_date: '2026-06-17',
      planned_start_at: '2026-06-17T09:00:00Z',
      planned_end_at: '2026-06-17T10:00:00Z',
      google_calendar_event_id: 'g-synced',
    })
    const allDay = task({ id: 'allday', due_date: '2026-06-18' })
    const view = buildPlannerWeekView(
      [timed, allDay],
      [event('g-synced'), event('other')],
      partitionPlannerTasks,
    )
    expect(view.timedTasks).toEqual([timed])
    expect(view.tasksByDay.get('2026-06-18')).toEqual([allDay])
    expect(view.linkedGoogleEventIds).toEqual(new Set(['g-synced']))
    expect(view.calendarEvents).toEqual([event('other')])
  })
})

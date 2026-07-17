import { describe, expect, it } from 'vitest'

import {
  AGENDA_DUE_BLOCK_HEIGHT_PX,
  AGENDA_DUE_STACK_GAP_PX,
  PLANNER_HOUR_PX,
  addDays,
  dayKey,
  isTimedPlannerTask,
  partitionPlannerTasks,
  plannerWeekTasksPath,
  startOfWeek,
  tasksByDayMap,
  layoutDueDateTasksOnTimeline,
  dueDateOnlyTasksForDay,
} from '@/lib/planner'
import type { Task } from '@/lib/types'

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

describe('PLANNER_HOUR_PX', () => {
  it('is 60 pixels per hour', () => {
    expect(PLANNER_HOUR_PX).toBe(60)
  })
})

describe('startOfWeek', () => {
  it('returns Monday for a Wednesday input', () => {
    const wed = new Date(2026, 5, 17) // Wed Jun 17 2026
    const mon = startOfWeek(wed)
    expect(mon.getDay()).toBe(1)
    expect(mon.getDate()).toBe(15)
  })
})

describe('addDays', () => {
  it('adds days without mutating the original', () => {
    const base = new Date(2026, 0, 10)
    const next = addDays(base, 5)
    expect(base.getDate()).toBe(10)
    expect(next.getDate()).toBe(15)
  })
})

describe('dayKey', () => {
  it('formats local YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 5, 7))).toBe('2026-06-07')
  })
})

describe('isTimedPlannerTask', () => {
  it('is true when both planned times are set', () => {
    expect(
      isTimedPlannerTask(
        task({ planned_start_at: '2026-06-17T09:00:00Z', planned_end_at: '2026-06-17T10:00:00Z' }),
      ),
    ).toBe(true)
  })

  it('is false when only one planned time is set', () => {
    expect(isTimedPlannerTask(task({ planned_start_at: '2026-06-17T09:00:00Z' }))).toBe(false)
  })
})

describe('tasksByDayMap', () => {
  it('groups all-day tasks by due_date and skips timed tasks', () => {
    const allDay = task({ id: 'a', due_date: '2026-06-17' })
    const timed = task({
      id: 'b',
      due_date: '2026-06-17',
      planned_start_at: '2026-06-17T09:00:00Z',
      planned_end_at: '2026-06-17T10:00:00Z',
    })
    const map = tasksByDayMap([allDay, timed])
    expect(map.get('2026-06-17')).toEqual([allDay])
  })
})

describe('partitionPlannerTasks', () => {
  it('splits timed and all-day tasks', () => {
    const allDay = task({ id: 'a', due_date: '2026-06-18' })
    const timed = task({
      id: 'b',
      due_date: '2026-06-17',
      planned_start_at: '2026-06-17T09:00:00Z',
      planned_end_at: '2026-06-17T10:00:00Z',
    })
    const { timed: timedOut, allDay: allDayOut } = partitionPlannerTasks([allDay, timed])
    expect(timedOut).toEqual([timed])
    expect(allDayOut.get('2026-06-18')).toEqual([allDay])
  })

  it('collects due-date-only tasks for a day', () => {
    const due = task({ id: 'd1', due_date: '2026-06-20' })
    const timed = task({
      id: 'd2',
      due_date: '2026-06-20',
      planned_start_at: '2026-06-20T09:00:00Z',
      planned_end_at: '2026-06-20T10:00:00Z',
    })
    const other = task({ id: 'd3', due_date: '2026-06-21' })
    expect(dueDateOnlyTasksForDay([due, timed, other], '2026-06-20').map((t) => t.id)).toEqual(['d1'])
  })

  it('stacks due-date tasks vertically at 9 AM', () => {
    const layouts = layoutDueDateTasksOnTimeline(
      [task({ id: 'a', due_date: '2026-06-20' }), task({ id: 'b', due_date: '2026-06-20' })],
      '2026-06-20',
    )
    const baseTop = 9 * PLANNER_HOUR_PX
    const stride = AGENDA_DUE_BLOCK_HEIGHT_PX + AGENDA_DUE_STACK_GAP_PX
    expect(layouts).toHaveLength(2)
    expect(layouts[0].top).toBe(baseTop)
    expect(layouts[0].height).toBe(AGENDA_DUE_BLOCK_HEIGHT_PX)
    expect(layouts[0].stackIndex).toBe(0)
    expect(layouts[1].top).toBe(baseTop + stride)
    expect(layouts[1].stackIndex).toBe(1)
  })
})

describe('plannerWeekTasksPath', () => {
  it('builds a week query with due range and page size', () => {
    const weekStart = new Date(2026, 5, 15) // Mon Jun 15
    expect(plannerWeekTasksPath(weekStart)).toBe(
      '/me/tasks?relation=assigned&due_from=2026-06-15&due_to=2026-06-21&page_size=140',
    )
  })
})

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  KANBAN_PROJECT_TASKS_KEY,
  KANBAN_SPRINT_TASKS_KEY,
  invalidateKanbanTaskQueries,
  patchTaskStatusInCache,
} from '@/lib/kanbanCache'
import type { CustomStatus, Task } from '@/lib/types'

const status: CustomStatus = {
  id: 's1',
  project_id: 'proj-1',
  name: 'Done',
  color: '#000',
  category: 'done',
  position: 0,
}

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

describe('kanban cache keys', () => {
  it('exports stable query roots', () => {
    expect(KANBAN_PROJECT_TASKS_KEY).toBe('tasks')
    expect(KANBAN_SPRINT_TASKS_KEY).toBe('sprint-tasks')
  })
})

describe('patchTaskStatusInCache', () => {
  it('optimistically updates task status in a Task[] cache', () => {
    const qc = new QueryClient()
    const key = ['tasks', 'proj-1'] as const
    qc.setQueryData<Task[]>(key, [task()])
    patchTaskStatusInCache(qc, key, 'task-1', status)
    expect(qc.getQueryData<Task[]>(key)?.[0].status).toEqual(status)
  })

  it('leaves cache unchanged when data is missing', () => {
    const qc = new QueryClient()
    const key = ['tasks', 'proj-1'] as const
    patchTaskStatusInCache(qc, key, 'task-1', status)
    expect(qc.getQueryData(key)).toBeUndefined()
  })

  it('leaves non-matching tasks unchanged', () => {
    const qc = new QueryClient()
    const key = ['tasks', 'proj-1'] as const
    qc.setQueryData<Task[]>(key, [task({ id: 'other-task' })])
    patchTaskStatusInCache(qc, key, 'task-1', status)
    expect(qc.getQueryData<Task[]>(key)?.[0].status).toBeNull()
  })
})

describe('invalidateKanbanTaskQueries', () => {
  it('invalidates project and sprint task lists plus optional custom key', () => {
    const qc = new QueryClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    invalidateKanbanTaskQueries(qc, ['tasks', 'proj-99'])
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sprint-tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'proj-99'] })
  })

  it('skips optional invalidation when no custom key is provided', () => {
    const qc = new QueryClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    invalidateKanbanTaskQueries(qc)
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
  })
})

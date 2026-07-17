import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  cancelTaskCaches,
  invalidateTaskCaches,
  patchTaskInCaches,
  restoreTaskCaches,
  snapshotTaskCaches,
} from '@/lib/taskCache'
import type { Task } from '@/lib/types'

function task(partial: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    list_id: null,
    parent_task_id: null,
    number: 1,
    ref: 'PROJ-1',
    title: 'Original',
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

describe('patchTaskInCaches', () => {
  it('patches tasks in array caches and paginated caches', () => {
    const qc = new QueryClient()
    const t = task()
    qc.setQueryData(['tasks', 'proj-1'], { items: [t], total: 1, page: 1, page_size: 50 })
    qc.setQueryData(['sprint-tasks', 's1'], [t])
    qc.setQueryData(['task', 'task-1'], t)

    patchTaskInCaches(qc, 'task-1', (x) => ({ ...x, title: 'Updated' }))

    expect(qc.getQueryData<{ items: Task[] }>(['tasks', 'proj-1'])?.items[0].title).toBe('Updated')
    expect(qc.getQueryData<Task[]>(['sprint-tasks', 's1'])?.[0].title).toBe('Updated')
    expect(qc.getQueryData<Task>(['task', 'task-1'])?.title).toBe('Updated')
  })
})

describe('snapshotTaskCaches / restoreTaskCaches', () => {
  it('round-trips cached task data', () => {
    const qc = new QueryClient()
    const t = task()
    qc.setQueryData(['backlog', 's1'], [t])
    const snap = snapshotTaskCaches(qc)
    patchTaskInCaches(qc, 'task-1', (x) => ({ ...x, title: 'Changed' }))
    restoreTaskCaches(qc, snap)
    expect(qc.getQueryData<Task[]>(['backlog', 's1'])?.[0].title).toBe('Original')
  })
})

describe('cancelTaskCaches', () => {
  it('cancels in-flight queries for task list roots', async () => {
    const qc = new QueryClient()
    const cancelSpy = vi.spyOn(qc, 'cancelQueries')
    await cancelTaskCaches(qc)
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ['my-tasks'] })
  })
})

describe('invalidateTaskCaches', () => {
  it('invalidates list roots and optional task detail', () => {
    const qc = new QueryClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    invalidateTaskCaches(qc, 'task-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['task', 'task-1'] })
  })
})

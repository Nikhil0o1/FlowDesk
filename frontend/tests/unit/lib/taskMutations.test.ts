import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  useTaskPatch,
  withAssignees,
  withDueDate,
  withPriority,
  withStartDate,
  withStatus,
} from '@/lib/taskMutations'
import type { CustomStatus, Task, UserBrief } from '@/lib/types'

const doneStatus: CustomStatus = {
  id: 's-done',
  project_id: 'proj-1',
  name: 'Done',
  color: '#000',
  category: 'done',
  position: 0,
}

const todoStatus: CustomStatus = {
  id: 's-todo',
  project_id: 'proj-1',
  name: 'Todo',
  color: '#000',
  category: 'todo',
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
    priority: 'normal',
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
    status: todoStatus,
    assignees: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    github_issue_number: null,
    github_issue_url: null,
    ...partial,
  }
}

describe('withStatus', () => {
  it('sets completed_at when moving to done', () => {
    const updated = withStatus(doneStatus)(task())
    expect(updated.status).toEqual(doneStatus)
    expect(updated.completed_at).toBeTypeOf('string')
  })

  it('clears completed_at when leaving done', () => {
    const updated = withStatus(todoStatus)(task({ completed_at: '2026-01-01T00:00:00Z' }))
    expect(updated.completed_at).toBeNull()
  })

  it('preserves existing completed_at when already done', () => {
    const stamp = '2026-01-01T00:00:00Z'
    const updated = withStatus(doneStatus)(task({ completed_at: stamp }))
    expect(updated.completed_at).toBe(stamp)
  })
})

describe('withPriority', () => {
  it('updates priority', () => {
    expect(withPriority('urgent')(task()).priority).toBe('urgent')
  })
})

describe('withDueDate', () => {
  it('updates due_date', () => {
    expect(withDueDate('2026-06-17')(task()).due_date).toBe('2026-06-17')
  })
})

describe('withStartDate', () => {
  it('updates start_date', () => {
    expect(withStartDate('2026-06-10')(task()).start_date).toBe('2026-06-10')
  })
})

describe('withAssignees', () => {
  it('replaces assignees', () => {
    const assignees: UserBrief[] = [
      { id: 'u1', email: 'a@example.com', full_name: 'Alice', avatar_url: null },
    ]
    expect(withAssignees(assignees)(task()).assignees).toEqual(assignees)
  })
})

describe('useTaskPatch', () => {
  function wrapper(client: QueryClient) {
    return ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
  }

  it('patches tasks and rolls back on error', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(['task', 'task-1'], task())
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('patch failed'))

    const { result } = renderHook(() => useTaskPatch(), { wrapper: wrapper(client) })
    result.current.mutate({
      taskId: 'task-1',
      body: { priority: 'high' },
      apply: withPriority('high'),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(api.patch).toHaveBeenCalledWith('/tasks/task-1', { priority: 'high' })
    expect(client.getQueryData<Task>(['task', 'task-1'])?.priority).toBe('normal')
  })

  it('patches without optimistic apply', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    vi.mocked(api.patch).mockResolvedValueOnce(task({ priority: 'low' }))

    const { result } = renderHook(() => useTaskPatch(), { wrapper: wrapper(client) })
    result.current.mutate({ taskId: 'task-1', body: { priority: 'low' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.patch).toHaveBeenCalled()
  })
})

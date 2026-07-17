import { describe, expect, it, vi, beforeEach } from 'vitest'

import { buildStatusUpdate, pendingSubtaskCount } from '@/lib/taskStatusChange'
import type { CustomStatus, Task } from '@/lib/types'

const doneStatus: CustomStatus = {
  id: 'done',
  name: 'Complete',
  color: '#000',
  category: 'done',
  position: 3,
}

const inProgressStatus: CustomStatus = {
  id: 'ip',
  name: 'In Progress',
  color: '#000',
  category: 'in_progress',
  position: 1,
}

const askMock = vi.fn()

vi.mock('@/stores/completeSubtasksConfirm', () => ({
  askCompleteWithSubtasks: (...args: unknown[]) => askMock(...args),
}))

describe('taskStatusChange', () => {
  beforeEach(() => {
    askMock.mockReset()
  })

  it('counts pending subtasks from subtasks array or counts', () => {
    const task: Pick<Task, 'subtask_count' | 'subtask_done_count' | 'subtasks'> = {
      subtask_count: 3,
      subtask_done_count: 1,
      subtasks: [
        { completed_at: null } as Task,
        { completed_at: '2024-01-01' } as Task,
        { completed_at: null } as Task,
      ],
    }
    expect(pendingSubtaskCount(task)).toBe(2)
  })

  it('buildStatusUpdate returns force flag after confirm', async () => {
    askMock.mockResolvedValue(true)
    const body = await buildStatusUpdate(
      { subtask_count: 2, subtask_done_count: 0, title: 'Parent' },
      doneStatus,
    )
    expect(askMock).toHaveBeenCalledWith({ pendingCount: 2, taskTitle: 'Parent' })
    expect(body).toEqual({ status_id: 'done', force_complete_subtasks: true })
  })

  it('buildStatusUpdate returns null when user cancels', async () => {
    askMock.mockResolvedValue(false)
    const body = await buildStatusUpdate({ subtask_count: 2, subtask_done_count: 0 }, doneStatus)
    expect(body).toBeNull()
  })

  it('buildStatusUpdate skips confirm when no pending subtasks', async () => {
    const body = await buildStatusUpdate({ subtask_count: 2, subtask_done_count: 2 }, doneStatus)
    expect(body).toEqual({ status_id: 'done' })
    expect(askMock).not.toHaveBeenCalled()
  })

  it('buildStatusUpdate skips confirm for non-done transitions', async () => {
    const body = await buildStatusUpdate({ subtask_count: 2, subtask_done_count: 0 }, inProgressStatus)
    expect(body).toEqual({ status_id: 'ip' })
    expect(askMock).not.toHaveBeenCalled()
  })
})

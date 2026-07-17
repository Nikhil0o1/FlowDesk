import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { cleanupDeletedTask } from '@/lib/taskDeletion'

vi.mock('@/lib/recents', () => ({
  removeRecent: vi.fn(),
}))

import { removeRecent } from '@/lib/recents'

describe('cleanupDeletedTask', () => {
  it('removes recent entry, detail cache, and invalidates task-related queries', () => {
    const qc = new QueryClient()
    qc.setQueryData(['task', 'task-99'], { id: 'task-99' })
    const removeSpy = vi.spyOn(qc, 'removeQueries')
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    cleanupDeletedTask(qc, 'task-99')

    expect(removeRecent).toHaveBeenCalledWith('task', 'task-99')
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['task', 'task-99'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['planner-week-tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timer'] })
  })

  it('skips task-specific cleanup when taskId is missing', () => {
    const qc = new QueryClient()
    const removeSpy = vi.spyOn(qc, 'removeQueries')
    cleanupDeletedTask(qc, null)
    expect(removeRecent).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })
})

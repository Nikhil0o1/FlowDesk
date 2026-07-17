import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { emptyPage, mockTask } from '@tests/mockData'

vi.unmock('@/components/planner/usePlannerTasks')

import {
  invalidatePlannerTasks,
  usePlannerOverdueTasks,
  usePlannerWeekTasks,
} from '@/components/planner/usePlannerTasks'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('usePlannerWeekTasks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('fetches week tasks for the given anchor date', async () => {
    const weekStart = new Date('2024-06-03T00:00:00.000Z')
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [mockTask()], total: 1 })
    const { result } = renderHook(() => usePlannerWeekTasks(weekStart, 7), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalled()
    expect(result.current.data?.items).toHaveLength(1)
  })
})

describe('usePlannerOverdueTasks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('fetches overdue assigned tasks', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [mockTask({ title: 'Overdue' })], total: 1 })
    const { result } = renderHook(() => usePlannerOverdueTasks(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/me/tasks?relation=assigned&due=overdue&page_size=20')
  })
})

describe('invalidatePlannerTasks', () => {
  it('invalidates planner query keys', () => {
    const invalidateQueries = vi.fn()
    invalidatePlannerTasks({ invalidateQueries })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-week-tasks'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-overdue-tasks'] })
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  invalidateMyTasks,
  useMyTasks,
  useMyTasksSummary,
  MY_TASKS_MAX_PAGE_SIZE,
} from '@/lib/myTasksQueries'
import { mockProject } from '@tests/mockData'
import { emptyPage } from '@tests/mockData'

const workspaceState = vi.hoisted(() => ({ id: 'ws-1' as string | undefined }))

vi.mock('@/lib/queries', () => ({
  useCurrentContext: () => ({ workspace: workspaceState.id ? { id: workspaceState.id } : null }),
}))

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('myTasksQueries', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    workspaceState.id = 'ws-1'
  })

  it('loads my tasks summary', async () => {
    vi.mocked(api.get).mockResolvedValue({
      assigned: 3,
      today_and_overdue: 2,
      personal_list_count: 1,
      delegated: 0,
    })
    const { result } = renderHook(() => useMyTasksSummary('ws-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/me/tasks/summary?workspace_id=ws-1')
  })

  it('loads my tasks summary org-wide', async () => {
    vi.mocked(api.get).mockResolvedValue({
      assigned: 1,
      today_and_overdue: 0,
      personal_list_count: 0,
      delegated: 0,
    })
    const { result } = renderHook(() => useMyTasksSummary(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/me/tasks/summary')
  })

  it('loads tasks with default assigned relation', async () => {
    vi.mocked(api.get).mockResolvedValue(emptyPage)
    const { result } = renderHook(() => useMyTasks(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('relation=assigned'))
  })

  it('loads assigned tasks with query params', async () => {
    vi.mocked(api.get).mockResolvedValue(emptyPage)
    const { result } = renderHook(
      () =>
        useMyTasks({
          relation: 'delegated',
          due: 'today',
          includeCompleted: true,
          workspaceId: 'ws-9',
          pageSize: 999,
        }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = vi.mocked(api.get).mock.calls[0][0] as string
    expect(url).toContain('relation=delegated')
    expect(url).toContain('due=today')
    expect(url).toContain('include_completed=true')
    expect(url).toContain('workspace_id=ws-9')
    expect(url).toContain(`page_size=${MY_TASKS_MAX_PAGE_SIZE}`)
  })

  it('invalidates my tasks queries', async () => {
    const client = new QueryClient()
    await client.prefetchQuery({ queryKey: ['my-tasks'], queryFn: () => emptyPage })
    await client.prefetchQuery({ queryKey: ['personal-list'], queryFn: () => mockProject })
    invalidateMyTasks(client)
    expect(client.getQueryState(['my-tasks'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['personal-list'])?.isInvalidated).toBe(true)
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  groupNotificationsByDate,
  inboxListKey,
  invalidateInbox,
  repliesListKey,
  useClearInboxTab,
  useClearNotification,
  useInboxNotifications,
  useInboxSettings,
  usePatchInboxSettings,
  usePatchNotificationPreference,
  useRepliesNotifications,
  useRepliesUnreadCount,
  useSnoozeNotification,
} from '@/lib/inboxQueries'
import type { AppNotification } from '@/lib/types'

function mockNotification(createdAt: string, id = 'n1'): AppNotification {
  return {
    id,
    type: 'task_assigned',
    title: 'Assigned',
    body: 'You were assigned',
    read_at: null,
    created_at: createdAt,
    data: {},
    importance: 'primary',
    tab: 'primary',
    snoozed_until: null,
    cleared_at: null,
  }
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('inboxQueries helpers', () => {
  it('builds stable query keys', () => {
    expect(inboxListKey({ tab: 'primary', filter: 'mentions', page: 2 })).toEqual([
      'notifications',
      'inbox',
      { tab: 'primary', filter: 'mentions', page: 2 },
    ])
    expect(repliesListKey({ tab: 'unread', page: 1 })).toEqual([
      'notifications',
      'replies',
      { tab: 'unread', page: 1 },
    ])
  })

  it('invalidates inbox-related queries', async () => {
    const client = new QueryClient()
    await client.prefetchQuery({ queryKey: ['notifications', 'inbox'], queryFn: () => null })
    await client.prefetchQuery({ queryKey: ['notifications-unread'], queryFn: () => null })
    invalidateInbox(client)
    expect(client.getQueryState(['notifications', 'inbox'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['notifications-unread'])?.isInvalidated).toBe(true)
  })

  it('groups notifications by today, yesterday, and older', () => {
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const older = new Date('2026-01-01T12:00:00')

    const groups = groupNotificationsByDate([
      mockNotification(today.toISOString(), 't'),
      mockNotification(yesterday.toISOString(), 'y'),
      mockNotification(older.toISOString(), 'o'),
    ])

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', expect.any(String)])
    expect(groups[0].items).toHaveLength(1)
    expect(groups[1].items[0].id).toBe('y')
  })
})

describe('inboxQueries hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('loads inbox settings and replies unread count', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ sort_newest_first: true, browser_notifications: false })
      .mockResolvedValueOnce({ count: 4 })

    const settings = renderHook(() => useInboxSettings(), { wrapper: wrapper() })
    const replies = renderHook(() => useRepliesUnreadCount(), { wrapper: wrapper() })

    await waitFor(() => expect(settings.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(replies.result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/notifications/inbox-settings')
    expect(api.get).toHaveBeenCalledWith('/notifications/replies-unread-count')
    expect(replies.result.current.data?.count).toBe(4)
  })

  it('loads inbox and replies notification lists', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 30 })
    const inbox = renderHook(
      () => useInboxNotifications({ tab: 'cleared', filter: 'mentions', page: 2 }),
      { wrapper: wrapper() },
    )
    const replies = renderHook(
      () => useRepliesNotifications({ tab: 'read', page: 1 }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(inbox.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(replies.result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('tab=cleared'))
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('view=replies'))
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('read_only=true'))
  })

  it('patches inbox settings and clears a notification', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 30 })
    vi.mocked(api.patch).mockResolvedValue({ sort_newest_first: false, browser_notifications: true })
    vi.mocked(api.post).mockResolvedValue(mockNotification(new Date().toISOString(), 'n99'))

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    const wrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const settings = renderHook(() => usePatchInboxSettings(), { wrapper: wrap })
    await settings.result.current.mutateAsync({ browser_notifications: true })
    expect(api.patch).toHaveBeenCalledWith('/notifications/inbox-settings', {
      browser_notifications: true,
    })

    const clear = renderHook(() => useClearNotification(), { wrapper: wrap })
    await clear.result.current.mutateAsync('n99')
    expect(api.post).toHaveBeenCalledWith('/notifications/n99/clear')
  })

  it('runs snooze, clear-tab, and preference mutations', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 30 })
    vi.mocked(api.post).mockResolvedValue(mockNotification(new Date().toISOString(), 'n1'))
    vi.mocked(api.patch).mockResolvedValue({ types: {} })

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    const wrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const snooze = renderHook(() => useSnoozeNotification(), { wrapper: wrap })
    await snooze.result.current.mutateAsync({ id: 'n1', until: '2026-07-08T12:00:00Z' })
    expect(api.post).toHaveBeenCalledWith('/notifications/n1/snooze', {
      until: '2026-07-08T12:00:00Z',
    })

    const clearTab = renderHook(() => useClearInboxTab(), { wrapper: wrap })
    await clearTab.result.current.mutateAsync('primary')
    expect(api.post).toHaveBeenCalledWith('/notifications/clear-tab?tab=primary&view=inbox')

    const pref = renderHook(() => usePatchNotificationPreference(), { wrapper: wrap })
    await pref.result.current.mutateAsync({ type: 'task_assigned', important: true })
    expect(api.patch).toHaveBeenCalledWith('/notifications/preferences', {
      type: 'task_assigned',
      important: true,
    })
  })
})

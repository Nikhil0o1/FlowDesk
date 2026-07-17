import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import type {
  AppNotification,
  InboxFilter,
  InboxSettings,
  InboxSummary,
  InboxTab,
  NotificationPreferences,
  Page,
} from './types'
import { toast } from '../stores/toast'

const inboxQueryOptions = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
}

export function inboxListKey(params: {
  tab: InboxTab
  filter?: InboxFilter | null
  page: number
}) {
  return ['notifications', 'inbox', params] as const
}

export function useInboxNotifications(params: {
  tab: InboxTab
  filter?: InboxFilter | null
  page: number
  pageSize?: number
}) {
  const { tab, filter, page, pageSize = 30 } = params
  const qs = new URLSearchParams({
    tab,
    view: 'inbox',
    page: String(page),
    page_size: String(pageSize),
  })
  if (filter) qs.set('filter', filter)

  return useQuery({
    queryKey: inboxListKey({ tab, filter: filter ?? null, page }),
    queryFn: () => api.get<Page<AppNotification>>(`/notifications?${qs}`),
    ...inboxQueryOptions,
  })
}

export function useInboxSummary(tab: InboxTab) {
  return useQuery({
    queryKey: ['notifications', 'summary', tab],
    queryFn: () => api.get<InboxSummary>(`/notifications/summary?tab=${tab}&view=inbox`),
  })
}

export function useInboxSettings() {
  return useQuery({
    queryKey: ['notifications', 'inbox-settings'],
    queryFn: () => api.get<InboxSettings>('/notifications/inbox-settings'),
  })
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<NotificationPreferences>('/notifications/preferences'),
  })
}

export function invalidateInbox(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['notifications'], refetchType: 'all' })
  void queryClient.invalidateQueries({ queryKey: ['notifications-unread'], refetchType: 'all' })
  void queryClient.invalidateQueries({ queryKey: ['replies-unread'], refetchType: 'all' })
}

export type RepliesTab = 'unread' | 'read'

export function repliesListKey(params: { tab: RepliesTab; page: number }) {
  return ['notifications', 'replies', params] as const
}

export function useRepliesNotifications(params: { tab: RepliesTab; page: number; pageSize?: number }) {
  const { tab, page, pageSize = 30 } = params
  const qs = new URLSearchParams({
    view: 'replies',
    page: String(page),
    page_size: String(pageSize),
  })
  if (tab === 'unread') qs.set('unread_only', 'true')
  else qs.set('read_only', 'true')

  return useQuery({
    queryKey: repliesListKey({ tab, page }),
    queryFn: () => api.get<Page<AppNotification>>(`/notifications?${qs}`),
    ...inboxQueryOptions,
  })
}

export function useRepliesUnreadCount() {
  return useQuery({
    queryKey: ['replies-unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/replies-unread-count'),
  })
}

export function usePatchInboxSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<InboxSettings>) =>
      api.patch<InboxSettings>('/notifications/inbox-settings', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['notifications', 'inbox-settings'], data)
      invalidateInbox(queryClient)
    },
  })
}

export function usePatchNotificationPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { type: string; important: boolean }) =>
      api.patch<NotificationPreferences>('/notifications/preferences', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['notifications', 'preferences'], data)
      invalidateInbox(queryClient)
    },
  })
}

export function useResetNotificationPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<NotificationPreferences>('/notifications/preferences/reset'),
    onSuccess: (data) => {
      queryClient.setQueryData(['notifications', 'preferences'], data)
      invalidateInbox(queryClient)
    },
  })
}

export function useClearInboxTab() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tab: InboxTab) => api.post(`/notifications/clear-tab?tab=${tab}&view=inbox`),
    onSuccess: () => {
      invalidateInbox(queryClient)
      toast.success('Notifications cleared')
    },
    onError: (err: Error) => toast.error(err.message || 'Could not clear notifications'),
  })
}

export function useSnoozeNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, until }: { id: string; until?: string }) =>
      api.post<AppNotification>(`/notifications/${id}/snooze`, until ? { until } : {}),
    onSuccess: () => {
      invalidateInbox(queryClient)
      toast.success('Snoozed until tomorrow')
    },
    onError: (err: Error) => toast.error(err.message || 'Could not snooze notification'),
  })
}

export function useClearNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<AppNotification>(`/notifications/${id}/clear`),
    onSuccess: () => invalidateInbox(queryClient),
    onError: (err: Error) => toast.error(err.message || 'Could not clear notification'),
  })
}

export function groupNotificationsByDate(items: AppNotification[]) {
  const groups: { label: string; items: AppNotification[] }[] = []
  const map = new Map<string, AppNotification[]>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  for (const item of items) {
    const d = new Date(item.created_at)
    d.setHours(0, 0, 0, 0)
    let label: string
    if (d.getTime() === today.getTime()) label = 'Today'
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday'
    else label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(item)
  }
  for (const [label, groupItems] of map) {
    groups.push({ label, items: groupItems })
  }
  return groups
}

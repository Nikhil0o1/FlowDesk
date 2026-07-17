import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, CheckCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../../lib/api'
import type { AppNotification, Page } from '../../lib/types'
import { timeAgo } from '../../lib/utils'
import { useWorkspaceStore } from '../../stores/workspace'
import { CenteredSpinner } from '../ui/Spinner'

export function notificationTarget(n: AppNotification): string {
  const data = n.data as Record<string, string | null>
  if (data.document_id) return `/app/docs/${data.document_id}`
  if (data.url) return data.url.replace(/^https?:\/\/[^/]+/, '') || data.url
  if (data.task_id) return `/app/tasks/${data.task_id}`
  if (data.chat_message_id || n.type === 'chat_mention') return '/app/chat'
  if (data.sprint_id) return `/app/sprints?sprint=${data.sprint_id}`
  if (n.type.startsWith('github')) return data.project_id ? `/app/projects/${data.project_id}` : '/app/dashboard'
  if (data.invite_id) return `/activate-invite?invite=${data.invite_id}&existing=1`
  // Legacy notifications created before invites moved to id-based acceptance.
  if (data.invite_token) return `/activate-invite?token=${data.invite_token}&existing=1`
  if (n.project_id) return `/app/projects/${n.project_id}`
  return '/app/notifications'
}

export function navigateToNotification(
  n: AppNotification,
  navigate: (path: string) => void,
  pathOverride?: string,
) {
  if (n.workspace_id) {
    useWorkspaceStore.getState().setWorkspace(n.workspace_id)
  }
  navigate(pathOverride ?? notificationTarget(n))
}

export function NotificationsDropdown({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'dropdown'],
    queryFn: () => api.get<Page<AppNotification>>('/notifications?page_size=8&unread_only=true'),
  })

  const markAllRead = async () => {
    await api.post('/notifications/read-all')
    const readAt = new Date().toISOString()
    queryClient.setQueriesData<Page<AppNotification>>({ queryKey: ['notifications', 'page'] }, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((notification) => ({ ...notification, read_at: notification.read_at ?? readAt })),
          }
        : old,
    )
    queryClient.setQueryData<Page<AppNotification>>(['notifications', 'dropdown'], (old) =>
      old ? { ...old, items: [], total: 0, page: 1 } : old,
    )
    queryClient.setQueryData(['notifications-unread'], { count: 0 })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  const open = async (n: AppNotification) => {
    onClose()
    if (!n.read_at) {
      void api.post(`/notifications/${n.id}/read`).then(() => {
        const readAt = new Date().toISOString()
        queryClient.setQueriesData<Page<AppNotification>>({ queryKey: ['notifications', 'page'] }, (old) =>
          old
            ? {
                ...old,
                items: old.items.map((notification) =>
                  notification.id === n.id ? { ...notification, read_at: readAt } : notification,
                ),
              }
            : old,
        )
        queryClient.setQueryData<Page<AppNotification>>(['notifications', 'dropdown'], (old) =>
          old
            ? {
                ...old,
                items: old.items.filter((notification) => notification.id !== n.id),
                total: Math.max(0, old.total - 1),
              }
            : old,
        )
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
      })
    }
    navigateToNotification(n, navigate)
  }

  return (
    <div className="max-h-[480px]">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-sm font-semibold text-fg">Notifications</p>
        <button onClick={markAllRead} className="btn-ghost !px-2 !py-1 text-xs">
          <CheckCheck size={13} /> Mark all read
        </button>
      </div>
      <div className="h-px bg-ink-700" />
      {isLoading ? (
        <CenteredSpinner />
      ) : (data?.items.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <BellOff size={20} className="text-fg-muted" />
          <p className="text-sm text-fg-secondary">You're all caught up</p>
        </div>
      ) : (
        <div className="py-1">
          {data!.items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink-750"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-brand'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-fg-secondary">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-fg-muted">{timeAgo(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="h-px bg-ink-700" />
      <Link
        to="/app/notifications"
        onClick={onClose}
        className="block px-3 py-2.5 text-center text-xs font-medium text-brand hover:text-brand-hover"
      >
        View all notifications
      </Link>
    </div>
  )
}

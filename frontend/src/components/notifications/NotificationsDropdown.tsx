import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, CheckCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../../lib/api'
import type { AppNotification, Page } from '../../lib/types'
import { timeAgo } from '../../lib/utils'
import { CenteredSpinner } from '../ui/Spinner'

export function notificationTarget(n: AppNotification): string {
  const data = n.data as Record<string, string | null>
  if (data.task_id) return `/app/tasks/${data.task_id}`
  if (data.chat_message_id || n.type === 'chat_mention') return '/app/chat'
  if (data.sprint_id) return `/app/sprints?sprint=${data.sprint_id}`
  if (n.type.startsWith('github')) return data.project_id ? `/app/projects/${data.project_id}` : '/app/dashboard'
  if (data.invite_token) return `/activate-invite?token=${data.invite_token}&existing=1`
  if (n.project_id) return `/app/projects/${n.project_id}`
  return '/app/notifications'
}

export function NotificationsDropdown({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'dropdown'],
    queryFn: () => api.get<Page<AppNotification>>('/notifications?page_size=8'),
  })

  const markAllRead = async () => {
    await api.post('/notifications/read-all')
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  const open = async (n: AppNotification) => {
    onClose()
    if (!n.read_at) {
      void api.post(`/notifications/${n.id}/read`).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
      })
    }
    navigate(notificationTarget(n))
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

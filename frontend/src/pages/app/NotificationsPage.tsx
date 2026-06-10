import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../../lib/api'
import type { AppNotification, Page } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { notificationTarget } from '../../components/notifications/NotificationsDropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', page, unreadOnly],
    queryFn: () =>
      api.get<Page<AppNotification>>(`/notifications?page=${page}&page_size=30&unread_only=${unreadOnly}`),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  const markAllRead = async () => {
    await api.post('/notifications/read-all')
    refresh()
  }

  const open = async (n: AppNotification) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`)
    refresh()
    navigate(notificationTarget(n))
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold text-fg">Notifications</h1>
        <span className="flex-1" />
        <button
          className={cn('btn-ghost text-xs', unreadOnly && 'bg-brand-soft !text-fg')}
          onClick={() => {
            setUnreadOnly((v) => !v)
            setPage(1)
          }}
        >
          Unread only
        </button>
        <button className="btn-secondary !py-1.5 text-xs" onClick={markAllRead}>
          <CheckCheck size={13} /> Mark all read
        </button>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="Mentions, assignments and updates will show up here." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {data!.items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={cn(
                'flex w-full items-start gap-3 border-b border-ink-700/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-ink-850',
                n.read_at ? 'bg-ink-900' : 'bg-ink-850/70',
              )}
            >
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{n.title}</p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{n.body}</p>}
                <p className="mt-1 text-[11px] text-fg-muted">
                  {n.type.replace(/_/g, ' ')} · {timeAgo(n.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-xs text-fg-muted">
            Page {page} of {totalPages}
          </span>
          <button className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

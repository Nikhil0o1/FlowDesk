import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { InboxNotificationList } from '../../components/inbox/InboxNotificationList'
import { RepliesEmptyState } from '../../components/replies/RepliesEmptyState'
import { notificationTarget, navigateToNotification } from '../../components/notifications/NotificationsDropdown'
import { api } from '../../lib/api'
import { invalidateInbox, useRepliesNotifications, type RepliesTab } from '../../lib/inboxQueries'
import type { AppNotification } from '../../lib/types'
import { cn } from '../../lib/utils'

function parseTab(value: string | null): RepliesTab {
  return value === 'read' ? 'read' : 'unread'
}

export default function RepliesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)

  const tab = parseTab(searchParams.get('tab'))
  const listQuery = useRepliesNotifications({ tab, page })
  const items = listQuery.data?.items ?? []
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / listQuery.data.page_size)) : 1

  useEffect(() => {
    setPage(1)
  }, [tab])

  const setTab = (next: RepliesTab) => {
    setPage(1)
    const params = new URLSearchParams(searchParams)
    if (next === 'unread') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const openNotification = async (n: AppNotification) => {
    if (!n.read_at) {
      await api.post(`/notifications/${n.id}/read`)
      invalidateInbox(queryClient)
    }
    const target = notificationTarget(n)
    const data = n.data as Record<string, string | undefined>
    if (data.comment_id && data.task_id) {
      navigateToNotification(
        n,
        navigate,
        `${target}${target.includes('?') ? '&' : '?'}comment=${data.comment_id}`,
      )
      return
    }
    navigateToNotification(n, navigate)
  }

  const toggleRead = async (n: AppNotification) => {
    if (n.read_at) {
      await api.post(`/notifications/${n.id}/unread`)
    } else {
      await api.post(`/notifications/${n.id}/read`)
    }
    invalidateInbox(queryClient)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fafafa]">
      <div className="border-b border-[#e8eaed] bg-white px-6 py-5">
        <h1 className="text-[22px] font-semibold text-[#1a1d21]">Replies</h1>
        <p className="mt-1 text-[13px] text-[#6b7280]">
          Comment thread replies you follow — unread until you open them.
        </p>
      </div>

      <div className="border-b border-[#e8eaed] bg-white">
        <div className="flex px-6">
          {(['unread', 'read'] as const).map((id) => {
            const selected = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'relative px-4 py-3 text-[14px] font-medium capitalize transition-colors',
                  selected ? 'text-[#1a1d21]' : 'text-[#6b7280] hover:text-[#374151]',
                )}
              >
                {id}
                {selected && (
                  <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[#1a1d21]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center text-[14px] text-[#9ca3af]">Loading…</div>
      ) : items.length === 0 ? (
        <RepliesEmptyState tab={tab} onShowRead={tab === 'unread' ? () => setTab('read') : undefined} />
      ) : (
        <InboxNotificationList
          items={items}
          loading={false}
          showClearedBanner={false}
          showRowActions
          rowVariant="replies"
          onOpen={openNotification}
          onSnooze={() => {}}
          onClear={() => {}}
          onToggleRead={toggleRead}
        />
      )}

      {items.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-[#e8eaed] bg-white py-3 text-[13px]">
          <button
            className="rounded-md px-2 py-1 text-[#4b5563] hover:bg-[#f3f4f6] disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="text-[#9ca3af]">
            Page {page} of {totalPages}
          </span>
          <button
            className="rounded-md px-2 py-1 text-[#4b5563] hover:bg-[#f3f4f6] disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

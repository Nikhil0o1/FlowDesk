import { Archive, Clock3, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'

import { notificationTarget } from '../notifications/NotificationsDropdown'
import type { AppNotification } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'

export function InboxNotificationRow({
  notification,
  displayMode,
  selected,
  rowRef,
  onOpen,
  onSnooze,
  onClear,
  onSelect,
  onToggleRead,
  showActions = true,
  variant = 'inbox',
}: {
  notification: AppNotification
  displayMode: 'fullscreen' | 'inline'
  selected?: boolean
  rowRef?: (el: HTMLDivElement | null) => void
  onOpen: (n: AppNotification) => void
  onSnooze: (n: AppNotification) => void
  onClear: (n: AppNotification) => void
  onSelect?: (n: AppNotification) => void
  onToggleRead?: (n: AppNotification) => void
  showActions?: boolean
  variant?: 'inbox' | 'replies'
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const unread = !notification.read_at

  return (
    <div
      ref={rowRef}
      className={cn(
        'group relative border-b border-[#eef0f2] transition-colors hover:bg-[#f9fafb]',
        displayMode === 'fullscreen' ? 'px-5 py-4' : 'px-4 py-3',
        unread && 'bg-[#fafbff]',
        selected && 'bg-[#f3f0ff] ring-1 ring-inset ring-[#c4b5fd]',
      )}
    >
      <button
        onClick={() => {
          onSelect?.(notification)
          onOpen(notification)
        }}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className={cn(
            'mt-2 h-2 w-2 shrink-0 rounded-full',
            unread ? 'bg-[#7c3aed]' : 'bg-transparent',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[#1a1d21]', displayMode === 'fullscreen' ? 'text-[15px] font-medium' : 'text-[14px]')}>
            {notification.title}
          </p>
          {notification.body && (
            <p
              className={cn(
                'mt-0.5 text-[#6b7280]',
                displayMode === 'fullscreen' ? 'line-clamp-3 text-[14px]' : 'line-clamp-2 text-[13px]',
              )}
            >
              {notification.body}
            </p>
          )}
          <p className="mt-1.5 text-[12px] text-[#9ca3af]">
            {notification.type.replace(/_/g, ' ')} · {timeAgo(notification.created_at)}
          </p>
        </div>
      </button>

      {showActions && variant === 'replies' && onToggleRead && (
        <button
          type="button"
          onClick={() => onToggleRead(notification)}
          className="absolute right-3 top-3 rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] font-medium text-[#374151] opacity-0 transition-opacity hover:bg-[#f9fafb] group-hover:opacity-100"
        >
          {unread ? 'Mark read' : 'Mark unread'}
        </button>
      )}

      {showActions && variant === 'inbox' && (
      <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          title="Snooze"
          onClick={() => {
            onSelect?.(notification)
            onSnooze(notification)
          }}
          className="rounded p-1 text-[#6b7280] hover:bg-[#eef0f2]"
        >
          <Clock3 size={14} />
        </button>
        <button
          title="Clear"
          onClick={() => {
            onSelect?.(notification)
            onClear(notification)
          }}
          className="rounded p-1 text-[#6b7280] hover:bg-[#eef0f2]"
        >
          <Archive size={14} />
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded p-1 text-[#6b7280] hover:bg-[#eef0f2]"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      )}

      {showActions && variant === 'inbox' && menuOpen && (
        <div className="absolute right-3 top-10 z-20 w-44 rounded-lg border border-[#e5e7eb] bg-white py-1 shadow-lg">
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#f9fafb]"
            onClick={() => {
              onOpen(notification)
              setMenuOpen(false)
            }}
          >
            Open {notificationTarget(notification).replace('/app/', '')}
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#f9fafb]"
            onClick={() => {
              onSnooze(notification)
              setMenuOpen(false)
            }}
          >
            Snooze until tomorrow
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#f9fafb]"
            onClick={() => {
              onClear(notification)
              setMenuOpen(false)
            }}
          >
            Clear
          </button>
          {onToggleRead && (
            <button
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#f9fafb]"
              onClick={() => {
                onToggleRead(notification)
                setMenuOpen(false)
              }}
            >
              {unread ? 'Mark as read' : 'Mark as unread'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

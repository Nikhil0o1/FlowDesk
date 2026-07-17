import { Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AppNotification, InboxSettings } from '../../lib/types'
import { groupNotificationsByDate } from '../../lib/inboxQueries'
import { CenteredSpinner } from '../ui/Spinner'
import { InboxClearedLearnMore } from './InboxClearedLearnMore'
import { InboxEmptyState } from './InboxEmptyState'
import { InboxNotificationRow } from './InboxNotificationRow'

export function InboxNotificationList({
  items,
  loading,
  settings,
  showClearedBanner,
  selectedId,
  onSelect,
  onOpen,
  onSnooze,
  onClear,
  onToggleRead,
  showRowActions = true,
  rowVariant = 'inbox',
}: {
  items: AppNotification[]
  loading: boolean
  settings?: InboxSettings
  showClearedBanner: boolean
  selectedId?: string | null
  onSelect?: (n: AppNotification) => void
  onOpen: (n: AppNotification) => void
  onSnooze: (n: AppNotification) => void
  onClear: (n: AppNotification) => void
  onToggleRead?: (n: AppNotification) => void
  showRowActions?: boolean
  rowVariant?: 'inbox' | 'replies'
}) {
  const [learnMoreOpen, setLearnMoreOpen] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!selectedId) return
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const rowProps = (n: AppNotification) => ({
    notification: n,
    selected: selectedId === n.id,
    rowRef: (el: HTMLDivElement | null) => {
      if (el) rowRefs.current.set(n.id, el)
      else rowRefs.current.delete(n.id)
    },
    onSelect,
    onOpen,
    onSnooze,
    onClear,
    onToggleRead,
    showActions: showRowActions,
    variant: rowVariant,
  })
  if (loading) return <CenteredSpinner />

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <InboxClearedLearnMore open={learnMoreOpen} onClose={() => setLearnMoreOpen(false)} />
      {showClearedBanner && (
        <div className="flex items-center gap-2 border-b border-[#e8eaed] bg-[#f3f4f6] px-4 py-2.5 text-[13px] text-[#4b5563]">
          <Info size={14} className="shrink-0 text-[#6b7280]" />
          <span>Cleared notifications are permanently deleted from your Inbox after 30 days.</span>
          <button
            type="button"
            onClick={() => setLearnMoreOpen(true)}
            className="ml-1 rounded border border-[#d1d5db] px-2 py-0.5 text-[12px] font-medium hover:bg-white"
          >
            Learn more
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <InboxEmptyState />
      ) : settings?.group_by_date ? (
        groupNotificationsByDate(items).map((group) => (
          <div key={group.label}>
            <p className="sticky top-0 z-10 border-b border-[#eef0f2] bg-[#fafafa]/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">
              {group.label}
            </p>
            {group.items.map((n) => (
              <InboxNotificationRow
                key={n.id}
                displayMode={settings.display_mode}
                {...rowProps(n)}
              />
            ))}
          </div>
        ))
      ) : (
        items.map((n) => (
          <InboxNotificationRow
            key={n.id}
            displayMode={settings?.display_mode ?? 'fullscreen'}
            {...rowProps(n)}
          />
        ))
      )}
    </div>
  )
}

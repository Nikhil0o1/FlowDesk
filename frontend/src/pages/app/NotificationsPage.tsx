import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CustomizeImportancePanel } from '../../components/inbox/CustomizeImportancePanel'
import { CustomizeInboxPanel } from '../../components/inbox/CustomizeInboxPanel'
import { InboxKeyboardShortcutsModal } from '../../components/inbox/InboxKeyboardShortcutsModal'
import { InboxNotificationList } from '../../components/inbox/InboxNotificationList'
import { InboxNotificationSettingsPanel } from '../../components/inbox/InboxNotificationSettingsPanel'
import { InboxTabs } from '../../components/inbox/InboxTabs'
import { InboxToolbar } from '../../components/inbox/InboxToolbar'
import { navigateToNotification } from '../../components/notifications/NotificationsDropdown'
import { useInboxKeyboardShortcuts, type InboxUndoAction } from '../../hooks/useInboxKeyboardShortcuts'
import { api } from '../../lib/api'
import {
  invalidateInbox,
  useClearInboxTab,
  useClearNotification,
  useInboxNotifications,
  useInboxSettings,
  useInboxSummary,
  useSnoozeNotification,
} from '../../lib/inboxQueries'
import type { AppNotification, InboxFilter, InboxTab } from '../../lib/types'

type InboxSidePanel = 'customize' | 'importance' | 'notificationSettings' | 'keyboardShortcuts' | null
type ImportanceBackTarget = 'customize' | 'notificationSettings'

function parseTab(value: string | null): InboxTab {
  if (value === 'other' || value === 'later' || value === 'cleared' || value === 'all') return value
  return 'primary'
}

function parseFilter(value: string | null): InboxFilter | null {
  if (value === 'mentions' || value === 'assigned' || value === 'unread' || value === 'reminders') return value
  return null
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [sidePanel, setSidePanel] = useState<InboxSidePanel>(null)
  const [importanceBack, setImportanceBack] = useState<ImportanceBackTarget>('customize')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const undoRef = useRef<InboxUndoAction | null>(null)

  const tab = parseTab(searchParams.get('tab'))
  const filter = parseFilter(searchParams.get('filter'))

  useEffect(() => {
    setPage(1)
    setSelectedId(null)
  }, [tab, filter])

  const settingsQuery = useInboxSettings()
  const listQuery = useInboxNotifications({ tab, filter, page })
  const summaryQuery = useInboxSummary(tab)
  const clearTab = useClearInboxTab()
  const snooze = useSnoozeNotification()
  const clearOne = useClearNotification()

  const items = listQuery.data?.items ?? []
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / listQuery.data.page_size)) : 1

  const setParam = (key: string, value: string | null) => {
    setPage(1)
    const next = new URLSearchParams(searchParams)
    if (!value) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const setTab = (next: InboxTab) => setParam('tab', next === 'primary' ? null : next)

  const toggleFilter = (next: InboxFilter) => {
    setParam('filter', filter === next ? null : next)
  }

  const openNotification = async (n: AppNotification) => {
    if (!n.read_at) {
      await api.post(`/notifications/${n.id}/read`)
      invalidateInbox(queryClient)
    }
    navigateToNotification(n, navigate)
  }

  const snoozeNotification = (n: AppNotification) => {
    const until = new Date()
    until.setDate(until.getDate() + 1)
    until.setHours(9, 0, 0, 0)
    snooze.mutate({ id: n.id, until: until.toISOString() })
  }

  const openImportance = (from: ImportanceBackTarget) => {
    setImportanceBack(from)
    setSidePanel('importance')
  }

  const closePanels = () => setSidePanel(null)

  const selected = items.find((n) => n.id === selectedId) ?? null

  const pushUndo = useCallback((action: InboxUndoAction) => {
    undoRef.current = action
  }, [])

  const handleUndo = useCallback(async () => {
    const action = undoRef.current
    if (!action) return
    undoRef.current = null
    if (action.kind === 'clear') {
      await api.post(`/notifications/${action.id}/unclear`)
    } else if (action.kind === 'snooze') {
      await api.post(`/notifications/${action.id}/unsnooze`)
    } else if (action.kind === 'read') {
      if (action.wasRead) {
        await api.post(`/notifications/${action.id}/read`)
      } else {
        await api.post(`/notifications/${action.id}/unread`)
      }
    }
    invalidateInbox(queryClient)
  }, [queryClient])

  const shortcutsEnabled =
    sidePanel !== 'keyboardShortcuts' &&
    sidePanel !== 'notificationSettings' &&
    !(sidePanel === 'importance' && importanceBack === 'notificationSettings')

  useInboxKeyboardShortcuts({
    enabled: shortcutsEnabled,
    items,
    selectedId,
    setSelectedId,
    tab,
    filter,
    showAllTab: settingsQuery.data?.show_all_tab ?? false,
    onTabChange: setTab,
    onFilterToggle: toggleFilter,
    onOpenSelected: () => {
      if (selected) void openNotification(selected)
    },
    onClearSelected: () => {
      if (selected) clearOne.mutate(selected.id)
    },
    onClearAll: () => clearTab.mutate(tab),
    onSnoozeSelected: () => {
      if (selected) snoozeNotification(selected)
    },
    onToggleReadSelected: async () => {
      if (!selected) return
      if (selected.read_at) {
        await api.post(`/notifications/${selected.id}/unread`)
      } else {
        await api.post(`/notifications/${selected.id}/read`)
      }
      invalidateInbox(queryClient)
    },
    onRefresh: () => {
      void listQuery.refetch()
      void summaryQuery.refetch()
    },
    onCloseUi: () => {
      setFilterOpen(false)
      if (sidePanel === 'customize' || sidePanel === 'importance') {
        setSidePanel(null)
      }
    },
    onUndo: () => {
      void handleUndo()
    },
    pushUndo,
  })

  if (sidePanel === 'notificationSettings' && settingsQuery.data) {
    return (
      <InboxNotificationSettingsPanel
        settings={settingsQuery.data}
        onBack={() => setSidePanel('customize')}
        onClose={closePanels}
        onOpenImportance={() => openImportance('notificationSettings')}
      />
    )
  }

  if (sidePanel === 'importance' && importanceBack === 'notificationSettings') {
    return (
      <CustomizeImportancePanel
        fullScreen
        onBack={() => setSidePanel('notificationSettings')}
        onClose={closePanels}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-[#fafafa]">
      <InboxKeyboardShortcutsModal
        open={sidePanel === 'keyboardShortcuts'}
        onClose={() => setSidePanel('customize')}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <InboxTabs
          active={tab}
          onChange={setTab}
          settings={settingsQuery.data}
        />

        <InboxToolbar
          summary={summaryQuery.data}
          activeFilter={filter}
          onFilterChange={(f) => setParam('filter', f)}
          onOpenSettings={() => setSidePanel('customize')}
          onClearAll={() => clearTab.mutate(tab)}
          clearing={clearTab.isPending}
          canClear={(listQuery.data?.total ?? 0) > 0}
          filterOpen={filterOpen}
          onFilterOpenChange={setFilterOpen}
        />

        <InboxNotificationList
          items={items}
          loading={listQuery.isLoading}
          settings={settingsQuery.data}
          showClearedBanner={tab === 'cleared'}
          selectedId={selectedId}
          onSelect={(n) => setSelectedId(n.id)}
          onOpen={openNotification}
          onSnooze={snoozeNotification}
          onClear={(n) => clearOne.mutate(n.id)}
        />

        {totalPages > 1 && (
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

      {sidePanel === 'customize' && settingsQuery.data && (
        <CustomizeInboxPanel
          settings={settingsQuery.data}
          onClose={closePanels}
          onOpenImportance={() => openImportance('customize')}
          onOpenNotificationSettings={() => setSidePanel('notificationSettings')}
          onOpenKeyboardShortcuts={() => setSidePanel('keyboardShortcuts')}
        />
      )}

      {sidePanel === 'importance' && importanceBack === 'customize' && (
        <CustomizeImportancePanel
          onBack={() => setSidePanel('customize')}
          onClose={closePanels}
        />
      )}
    </div>
  )
}

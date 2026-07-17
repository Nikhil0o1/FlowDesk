import { useEffect, useRef } from 'react'

import { INBOX_FILTER_BY_INDEX, INBOX_TAB_BY_KEY } from '../lib/inboxShortcuts'
import type { AppNotification, InboxFilter, InboxTab } from '../lib/types'

export type InboxUndoAction =
  | { kind: 'clear'; id: string }
  | { kind: 'snooze'; id: string }
  | { kind: 'read'; id: string; wasRead: boolean }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useInboxKeyboardShortcuts({
  enabled,
  items,
  selectedId,
  setSelectedId,
  showAllTab,
  onTabChange,
  onFilterToggle,
  onOpenSelected,
  onClearSelected,
  onClearAll,
  onSnoozeSelected,
  onToggleReadSelected,
  onRefresh,
  onCloseUi,
  onUndo,
  pushUndo,
}: {
  enabled: boolean
  items: AppNotification[]
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  tab: InboxTab
  filter: InboxFilter | null
  showAllTab: boolean
  onTabChange: (tab: InboxTab) => void
  onFilterToggle: (filter: InboxFilter) => void
  onOpenSelected: () => void
  onClearSelected: () => void
  onClearAll: () => void
  onSnoozeSelected: () => void
  onToggleReadSelected: () => void
  onRefresh: () => void
  onCloseUi: () => void
  onUndo: () => void
  pushUndo: (action: InboxUndoAction) => void
}) {
  const itemsRef = useRef(items)
  const selectedRef = useRef(selectedId)
  itemsRef.current = items
  selectedRef.current = selectedId

  useEffect(() => {
    if (!enabled) return

    const selectByIndex = (index: number) => {
      const list = itemsRef.current
      if (!list.length) {
        setSelectedId(null)
        return
      }
      const clamped = Math.max(0, Math.min(index, list.length - 1))
      setSelectedId(list[clamped].id)
    }

    const currentIndex = () => {
      const list = itemsRef.current
      const id = selectedRef.current
      if (!id) return -1
      return list.findIndex((item) => item.id === id)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      const mod = e.ctrlKey || e.metaKey
      const key = e.key
      const lower = key.toLowerCase()

      if (key === 'Escape') {
        e.preventDefault()
        setSelectedId(null)
        onCloseUi()
        return
      }

      if (mod && lower === 'z' && !e.shiftKey) {
        e.preventDefault()
        onUndo()
        return
      }

      if (e.shiftKey && !mod && INBOX_TAB_BY_KEY[lower]) {
        const nextTab = INBOX_TAB_BY_KEY[lower]
        if (nextTab === 'all' && !showAllTab) return
        e.preventDefault()
        onTabChange(nextTab)
        setSelectedId(null)
        return
      }

      if (e.shiftKey && !mod && INBOX_FILTER_BY_INDEX[key]) {
        e.preventDefault()
        onFilterToggle(INBOX_FILTER_BY_INDEX[key])
        return
      }

      if (e.shiftKey && !mod && lower === 'e') {
        e.preventDefault()
        onClearAll()
        return
      }

      if (!mod && !e.shiftKey && lower === 'j') {
        e.preventDefault()
        const idx = currentIndex()
        selectByIndex(idx < 0 ? 0 : idx + 1)
        return
      }

      if (!mod && !e.shiftKey && lower === 'k') {
        e.preventDefault()
        const idx = currentIndex()
        selectByIndex(idx < 0 ? 0 : idx - 1)
        return
      }

      if (!mod && !e.shiftKey && key === 'ArrowDown') {
        e.preventDefault()
        const idx = currentIndex()
        selectByIndex(idx < 0 ? 0 : idx + 1)
        return
      }

      if (!mod && !e.shiftKey && key === 'ArrowUp') {
        e.preventDefault()
        const idx = currentIndex()
        selectByIndex(idx < 0 ? 0 : idx - 1)
        return
      }

      if (e.shiftKey && !mod && key === 'ArrowDown') {
        e.preventDefault()
        selectByIndex(itemsRef.current.length - 1)
        return
      }

      if (e.shiftKey && !mod && key === 'ArrowUp') {
        e.preventDefault()
        selectByIndex(0)
        return
      }

      if (!mod && !e.shiftKey && (key === 'Enter' || lower === 'o')) {
        if (!selectedRef.current) return
        e.preventDefault()
        onOpenSelected()
        return
      }

      if (!mod && !e.shiftKey && lower === 'e') {
        if (!selectedRef.current) return
        e.preventDefault()
        pushUndo({ kind: 'clear', id: selectedRef.current })
        onClearSelected()
        return
      }

      if (!mod && !e.shiftKey && lower === 'z') {
        if (!selectedRef.current) return
        e.preventDefault()
        pushUndo({ kind: 'snooze', id: selectedRef.current })
        onSnoozeSelected()
        return
      }

      if (!mod && !e.shiftKey && lower === 'u') {
        if (!selectedRef.current) return
        e.preventDefault()
        const item = itemsRef.current.find((n) => n.id === selectedRef.current)
        if (!item) return
        pushUndo({ kind: 'read', id: item.id, wasRead: Boolean(item.read_at) })
        onToggleReadSelected()
        return
      }

      if (!mod && !e.shiftKey && key === ' ') {
        e.preventDefault()
        onRefresh()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    enabled,
    onClearAll,
    onClearSelected,
    onCloseUi,
    onFilterToggle,
    onOpenSelected,
    onRefresh,
    onSnoozeSelected,
    onTabChange,
    onToggleReadSelected,
    onUndo,
    pushUndo,
    setSelectedId,
    showAllTab,
  ])
}

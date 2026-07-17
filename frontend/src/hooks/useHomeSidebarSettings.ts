import { useCallback, useMemo } from 'react'

import { HOME_ITEMS } from '../constants/homeItems'
import { useHomeSidebarStore } from '../stores/homeSidebar'
import type { HomeItemId } from '../types/sidebarSettings'

/**
 * Reads/writes Home shortcut visibility with the product rule baked in:
 * at least one shortcut must always remain visible (the last one can't be
 * unchecked). Exposes a memoized visible list plus safe mutators.
 */
export function useHomeSidebarSettings() {
  const visibility = useHomeSidebarStore((s) => s.visibility)
  const setVisible = useHomeSidebarStore((s) => s.setVisible)

  const isVisible = useCallback((id: HomeItemId) => visibility[id] ?? true, [visibility])

  const visibleItems = useMemo(
    () => HOME_ITEMS.filter((item) => isVisible(item.id)),
    [isVisible],
  )

  /** Shortcuts hidden from the sidebar — surfaced in the "More" overflow menu. */
  const hiddenItems = useMemo(
    () => HOME_ITEMS.filter((item) => !isVisible(item.id)),
    [isVisible],
  )

  const visibleCount = visibleItems.length

  /** True when unchecking this item is not allowed (it's the last visible one). */
  const isLocked = useCallback(
    (id: HomeItemId) => isVisible(id) && visibleCount <= 1,
    [isVisible, visibleCount],
  )

  const setItemVisible = useCallback(
    (id: HomeItemId, visible: boolean) => {
      if (!visible && visibleCount <= 1) return
      setVisible(id, visible)
    },
    [setVisible, visibleCount],
  )

  const toggleItem = useCallback(
    (id: HomeItemId) => setItemVisible(id, !isVisible(id)),
    [isVisible, setItemVisible],
  )

  return {
    items: HOME_ITEMS,
    visibleItems,
    hiddenItems,
    isVisible,
    isLocked,
    setItemVisible,
    toggleItem,
  }
}

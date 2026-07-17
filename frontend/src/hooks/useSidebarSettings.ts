import { useCallback, useMemo } from 'react'

import { NAVIGATION_ITEMS, NAV_ITEM_BY_ID } from '../constants/navigationItems'
import { useSidebarNavStore } from '../stores/sidebarNav'
import type { NavItemId } from '../types/sidebarSettings'

/**
 * Reads/writes navigation visibility with the product rules baked in:
 * - Locked items (Home) can never be hidden.
 * - The last remaining visible item can never be hidden.
 * Consumers get a stable, memoized list of currently-visible items plus
 * safe mutators so no component needs to re-implement the invariants.
 */
export function useSidebarSettings() {
  const visibility = useSidebarNavStore((s) => s.visibility)
  const setVisible = useSidebarNavStore((s) => s.setVisible)
  const appearance = useSidebarNavStore((s) => s.appearance)
  const setAppearance = useSidebarNavStore((s) => s.setAppearance)

  const isVisible = useCallback(
    (id: NavItemId) => {
      if (NAV_ITEM_BY_ID[id]?.locked) return true
      return visibility[id] ?? true
    },
    [visibility],
  )

  const visibleItems = useMemo(
    () => NAVIGATION_ITEMS.filter((item) => isVisible(item.id)),
    [isVisible],
  )

  const visibleCount = visibleItems.length

  /** True when unchecking this item is not allowed (locked, or it's the last one). */
  const isLocked = useCallback(
    (id: NavItemId) => {
      if (NAV_ITEM_BY_ID[id]?.locked) return true
      return isVisible(id) && visibleCount <= 1
    },
    [isVisible, visibleCount],
  )

  const setItemVisible = useCallback(
    (id: NavItemId, visible: boolean) => {
      if (NAV_ITEM_BY_ID[id]?.locked) return
      if (!visible && visibleCount <= 1) return
      setVisible(id, visible)
    },
    [setVisible, visibleCount],
  )

  const toggleItem = useCallback(
    (id: NavItemId) => setItemVisible(id, !isVisible(id)),
    [isVisible, setItemVisible],
  )

  return {
    items: NAVIGATION_ITEMS,
    visibleItems,
    isVisible,
    isLocked,
    setItemVisible,
    toggleItem,
    appearance,
    setAppearance,
  }
}

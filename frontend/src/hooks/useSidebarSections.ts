import { useCallback, useMemo } from 'react'

import { SECTION_TITLE, isBuiltInSection } from '../constants/sidebarSections'
import { useSidebarSectionsStore } from '../stores/sidebarSections'
import type { ResolvedSection, SectionId } from '../types/sidebarSections'

/**
 * Read/write access to sidebar section order + visibility with everything
 * resolved for rendering. The sidebar and the Sections tab both consume this so
 * they stay perfectly in sync.
 */
export function useSidebarSections() {
  const order = useSidebarSectionsStore((s) => s.order)
  const hidden = useSidebarSectionsStore((s) => s.hidden)
  const custom = useSidebarSectionsStore((s) => s.custom)
  const reorder = useSidebarSectionsStore((s) => s.reorder)
  const hide = useSidebarSectionsStore((s) => s.hide)
  const restore = useSidebarSectionsStore((s) => s.restore)
  const createCustom = useSidebarSectionsStore((s) => s.createCustom)
  const removeCustom = useSidebarSectionsStore((s) => s.removeCustom)

  const titleOf = useCallback(
    (id: SectionId): string =>
      SECTION_TITLE[id] ?? custom.find((c) => c.id === id)?.name ?? id,
    [custom],
  )

  const resolve = useCallback(
    (id: SectionId): ResolvedSection => ({
      id,
      title: titleOf(id),
      isCustom: !isBuiltInSection(id),
    }),
    [titleOf],
  )

  const hiddenSet = useMemo(() => new Set(hidden), [hidden])

  /** All sections in order (for the Customize tab). */
  const sections = useMemo(() => order.map(resolve), [order, resolve])

  /** Only the visible sections in order (for the sidebar). */
  const visibleSections = useMemo(
    () => order.filter((id) => !hiddenSet.has(id)).map(resolve),
    [order, hiddenSet, resolve],
  )

  /** Hidden sections (for the "Hidden Sections" restore list). */
  const hiddenSections = useMemo(
    () => order.filter((id) => hiddenSet.has(id)).map(resolve),
    [order, hiddenSet, resolve],
  )

  const isHidden = useCallback((id: SectionId) => hiddenSet.has(id), [hiddenSet])

  return {
    sections,
    visibleSections,
    hiddenSections,
    isHidden,
    reorder,
    hide,
    restore,
    createCustom,
    removeCustom,
  }
}

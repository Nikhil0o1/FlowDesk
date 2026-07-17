import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_SECTION_ORDER } from '../constants/sidebarSections'
import type { CustomSection, SectionId, SidebarSectionsState } from '../types/sidebarSections'

interface SidebarSectionsStore extends SidebarSectionsState {
  /** Move `id` so it sits at `toIndex` within the current order. */
  reorder: (id: SectionId, toIndex: number) => void
  hide: (id: SectionId) => void
  restore: (id: SectionId) => void
  createCustom: (name: string) => void
  removeCustom: (id: SectionId) => void
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Persisted per-browser section order/visibility + custom sections. Mirrors the
 * other sidebar stores so the sidebar reacts instantly and preferences survive
 * reloads. Swap the persistence layer here to sync with a backend later.
 */
export const useSidebarSectionsStore = create<SidebarSectionsStore>()(
  persist(
    (set) => ({
      order: [...DEFAULT_SECTION_ORDER],
      hidden: [],
      custom: [],

      reorder: (id, toIndex) =>
        set((s) => {
          const from = s.order.indexOf(id)
          if (from === -1) return s
          const next = [...s.order]
          next.splice(from, 1)
          const clamped = Math.max(0, Math.min(toIndex, next.length))
          next.splice(clamped, 0, id)
          return { order: next }
        }),

      hide: (id) =>
        set((s) => (s.hidden.includes(id) ? s : { hidden: [...s.hidden, id] })),

      restore: (id) => set((s) => ({ hidden: s.hidden.filter((h) => h !== id) })),

      createCustom: (name) =>
        set((s) => {
          const trimmed = name.trim()
          if (!trimmed) return s
          const taken = new Set([...s.order, ...s.custom.map((c) => c.id)])
          const section: CustomSection = {
            id: uniqueId(slugify(trimmed), taken),
            name: trimmed,
            items: [],
          }
          return {
            custom: [...s.custom, section],
            order: [...s.order, section.id],
          }
        }),

      removeCustom: (id) =>
        set((s) => ({
          custom: s.custom.filter((c) => c.id !== id),
          order: s.order.filter((o) => o !== id),
          hidden: s.hidden.filter((h) => h !== id),
        })),
    }),
    {
      name: 'flowdesk-sidebar-sections',
      // Reconcile persisted state with the current built-in catalog:
      // - keep saved order, but drop ids that no longer exist
      // - append any new built-in sections (visible) so upgrades "just work"
      merge: (persisted, current) => {
        const saved = persisted as Partial<SidebarSectionsState> | undefined
        const custom = saved?.custom ?? []
        const known = new Set<string>([
          ...DEFAULT_SECTION_ORDER,
          ...custom.map((c) => c.id),
        ])
        const savedOrder = (saved?.order ?? []).filter((id) => known.has(id))
        // Append built-ins/customs missing from the saved order.
        for (const id of [...DEFAULT_SECTION_ORDER, ...custom.map((c) => c.id)]) {
          if (!savedOrder.includes(id)) savedOrder.push(id)
        }
        const hidden = (saved?.hidden ?? []).filter((id) => known.has(id))
        return { ...current, order: savedOrder, hidden, custom }
      },
    },
  ),
)

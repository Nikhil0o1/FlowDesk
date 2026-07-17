import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_HOME_SETTINGS } from '../constants/homeItems'
import type { HomeItemId, HomeSidebarSettings } from '../types/sidebarSettings'

interface HomeSidebarState {
  visibility: HomeSidebarSettings
  setVisible: (id: HomeItemId, visible: boolean) => void
  toggle: (id: HomeItemId) => void
}

/**
 * Persisted per-browser visibility for the Home section shortcuts. Mirrors the
 * navigation store so the sidebar reacts instantly and preferences survive
 * reloads. Swap the persistence layer here to sync with a backend later.
 */
export const useHomeSidebarStore = create<HomeSidebarState>()(
  persist(
    (set) => ({
      visibility: DEFAULT_HOME_SETTINGS,
      setVisible: (id, visible) =>
        set((s) => ({ visibility: { ...s.visibility, [id]: visible } })),
      toggle: (id) => set((s) => ({ visibility: { ...s.visibility, [id]: !s.visibility[id] } })),
    }),
    {
      name: 'flowdesk-home-sidebar',
      // Layer saved values over defaults so new shortcuts appear (visible) and
      // unknown/stale keys fall back to defaults.
      merge: (persisted, current) => {
        const saved = (persisted as Partial<HomeSidebarState> | undefined)?.visibility ?? {}
        return { ...current, visibility: { ...DEFAULT_HOME_SETTINGS, ...saved } }
      },
    },
  ),
)

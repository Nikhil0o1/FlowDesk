import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_NAV_SETTINGS } from '../constants/navigationItems'
import type { NavAppearance, NavItemId, SidebarNavSettings } from '../types/sidebarSettings'

const DEFAULT_APPEARANCE: NavAppearance = 'labels'

interface SidebarNavState {
  visibility: SidebarNavSettings
  appearance: NavAppearance
  setVisible: (id: NavItemId, visible: boolean) => void
  toggle: (id: NavItemId) => void
  setAppearance: (appearance: NavAppearance) => void
}

/**
 * Persisted per-browser navigation preferences. Uses zustand `persist`
 * (the app's existing state pattern) so the rail reacts instantly with no
 * refresh and survives reloads. If/when a backend user-preferences endpoint
 * exists, this store is the single place to hydrate from / sync to.
 */
export const useSidebarNavStore = create<SidebarNavState>()(
  persist(
    (set) => ({
      visibility: DEFAULT_NAV_SETTINGS,
      appearance: DEFAULT_APPEARANCE,
      setVisible: (id, visible) =>
        set((s) => ({ visibility: { ...s.visibility, [id]: visible } })),
      toggle: (id) => set((s) => ({ visibility: { ...s.visibility, [id]: !s.visibility[id] } })),
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: 'flowdesk-sidebar-navigation',
      // Always layer persisted values on top of the current defaults so that
      // newly-added navigation items appear (default visible) and unknown/stale
      // keys fall back to sensible defaults.
      merge: (persisted, current) => {
        const saved = persisted as Partial<SidebarNavState> | undefined
        return {
          ...current,
          visibility: { ...DEFAULT_NAV_SETTINGS, ...(saved?.visibility ?? {}) },
          appearance: saved?.appearance ?? current.appearance,
        }
      },
    },
  ),
)

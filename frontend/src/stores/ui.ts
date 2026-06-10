import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SectionKey = 'home' | 'planner' | 'teams' | 'whiteboards' | 'forms' | 'timesheet' | 'apps'

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  expandSidebar: () => void
  /** Section previewed on rail hover. Rendered in the sidebar slot (pushes content). */
  flyoutSection: SectionKey | null
  setFlyout: (section: SectionKey | null) => void
  scheduleFlyoutHide: () => void
  cancelFlyoutHide: () => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  inviteOpen: boolean
  setInviteOpen: (open: boolean) => void
  /** Hides unread badges; data keeps flowing underneath. */
  notificationsMuted: boolean
  toggleNotificationsMuted: () => void
}

let flyoutTimer: number | null = null

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      expandSidebar: () => set({ sidebarCollapsed: false }),
      flyoutSection: null,
      setFlyout: (flyoutSection) => {
        if (flyoutTimer) window.clearTimeout(flyoutTimer)
        set({ flyoutSection })
      },
      scheduleFlyoutHide: () => {
        if (flyoutTimer) window.clearTimeout(flyoutTimer)
        flyoutTimer = window.setTimeout(() => set({ flyoutSection: null }), 180)
      },
      cancelFlyoutHide: () => {
        if (flyoutTimer) window.clearTimeout(flyoutTimer)
      },
      searchOpen: false,
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      inviteOpen: false,
      setInviteOpen: (inviteOpen) => set({ inviteOpen }),
      notificationsMuted: false,
      toggleNotificationsMuted: () => set((s) => ({ notificationsMuted: !s.notificationsMuted })),
    }),
    {
      name: 'flowdesk-ui',
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        notificationsMuted: s.notificationsMuted,
      }),
    },
  ),
)

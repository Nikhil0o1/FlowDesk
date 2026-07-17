import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { type AccentKey, DEFAULT_ACCENT } from '../lib/accents'
import {
  clampSecondarySidebarWidth,
  SECONDARY_SIDEBAR_DEFAULT_WIDTH,
} from '../lib/sidebarLayout'
import type { MyTasksCardSize } from '../lib/myTasksCardLayout'
import {
  DEFAULT_MY_TASKS_VISIBLE_CARDS,
  MY_TASKS_CARD_IDS,
  sanitizeMyTasksCards,
  type MyTasksCardId,
} from '../lib/myTasksCards'

export type SectionKey = 'home' | 'planner' | 'goals' | 'teams' | 'docs' | 'whiteboards' | 'forms' | 'timesheet' | 'apps'
export type ThemeMode = 'dark' | 'light' | 'auto'

interface UIState {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  accent: AccentKey
  setAccent: (accent: AccentKey) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  expandSidebar: () => void
  secondarySidebarWidth: number
  setSecondarySidebarWidth: (width: number) => void
  resetSecondarySidebarWidth: () => void
  /** Section previewed on rail hover. Rendered in the sidebar slot (pushes content). */
  flyoutSection: SectionKey | null
  setFlyout: (section: SectionKey | null) => void
  scheduleFlyoutHide: () => void
  cancelFlyoutHide: () => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  inviteOpen: boolean
  setInviteOpen: (open: boolean) => void
  inviteWorkspaceId: string | null
  setInviteWorkspaceId: (id: string | null) => void
  inviteFlowKind: 'workspace' | 'space' | 'project' | null
  setInviteFlowKind: (kind: 'workspace' | 'space' | 'project' | null) => void
  inviteSpaceId: string | null
  setInviteSpaceId: (id: string | null) => void
  inviteProjectId: string | null
  setInviteProjectId: (id: string | null) => void
  peopleInviteChoiceOpen: boolean
  setPeopleInviteChoiceOpen: (open: boolean) => void
  existingPeopleOpen: boolean
  setExistingPeopleOpen: (open: boolean) => void
  /** Hides unread badges; data keeps flowing underneath. */
  notificationsMuted: boolean
  toggleNotificationsMuted: () => void
  myTasksExpanded: boolean
  setMyTasksExpanded: (expanded: boolean) => void
  toggleMyTasksExpanded: () => void
  myTasksVisibleCards: string[]
  setMyTasksVisibleCards: (cards: string[]) => void
  reorderMyTasksCards: (cards: MyTasksCardId[]) => void
  hideMyTasksCard: (id: MyTasksCardId) => void
  showMyTasksCard: (id: MyTasksCardId) => void
  resetMyTasksVisibleCards: () => void
  /** Dashboard card bodies collapsed (header-only), like sidebar section collapse. */
  myTasksCardsCollapsed: MyTasksCardId[]
  toggleMyTasksCardCollapsed: (id: MyTasksCardId) => void
  myTasksCardSizes: Partial<Record<MyTasksCardId, Partial<MyTasksCardSize>>>
  setMyTasksCardSize: (id: MyTasksCardId, patch: Partial<MyTasksCardSize>) => void
  myWorkCardSettings: MyWorkCardSettings
  setMyWorkCardSetting: <K extends keyof MyWorkCardSettings>(key: K, value: MyWorkCardSettings[K]) => void
  assignedToMeCardSettings: AssignedToMeCardSettings
  setAssignedToMeCardSetting: <K extends keyof AssignedToMeCardSettings>(
    key: K,
    value: AssignedToMeCardSettings[K],
  ) => void
}

export type AssignedToMeCardSettings = {
  showEmptyStatuses: boolean
  wrapText: boolean
  showTaskLocations: boolean
  showSubtaskParentNames: boolean
  showClosedTasks: boolean
  subtasksExpanded: boolean
  groupBy: 'status' | 'priority' | 'none'
  groupAscending: boolean
  alsoGroupByList: boolean
}

const DEFAULT_ASSIGNED_TO_ME_CARD_SETTINGS: AssignedToMeCardSettings = {
  showEmptyStatuses: false,
  wrapText: false,
  showTaskLocations: false,
  showSubtaskParentNames: false,
  showClosedTasks: false,
  subtasksExpanded: false,
  groupBy: 'status',
  groupAscending: true,
  alsoGroupByList: false,
}

export type MyWorkCardSettings = {
  showSubtaskParentNames: boolean
  showTaskLocations: boolean
  includeStartDateOnly: boolean
}

const DEFAULT_MY_WORK_CARD_SETTINGS: MyWorkCardSettings = {
  showSubtaskParentNames: false,
  showTaskLocations: false,
  includeStartDateOnly: false,
}

let flyoutTimer: number | null = null

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark' as ThemeMode,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      accent: DEFAULT_ACCENT,
      setAccent: (accent) => set({ accent }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      expandSidebar: () => set({ sidebarCollapsed: false }),
      secondarySidebarWidth: SECONDARY_SIDEBAR_DEFAULT_WIDTH,
      setSecondarySidebarWidth: (width) =>
        set({ secondarySidebarWidth: clampSecondarySidebarWidth(width) }),
      resetSecondarySidebarWidth: () =>
        set({ secondarySidebarWidth: SECONDARY_SIDEBAR_DEFAULT_WIDTH }),
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
      inviteWorkspaceId: null,
      setInviteWorkspaceId: (inviteWorkspaceId) => set({ inviteWorkspaceId }),
      inviteFlowKind: null,
      setInviteFlowKind: (inviteFlowKind) => set({ inviteFlowKind }),
      inviteSpaceId: null,
      setInviteSpaceId: (inviteSpaceId) => set({ inviteSpaceId }),
      inviteProjectId: null,
      setInviteProjectId: (inviteProjectId) => set({ inviteProjectId }),
      peopleInviteChoiceOpen: false,
      setPeopleInviteChoiceOpen: (peopleInviteChoiceOpen) => set({ peopleInviteChoiceOpen }),
      existingPeopleOpen: false,
      setExistingPeopleOpen: (existingPeopleOpen) => set({ existingPeopleOpen }),
      notificationsMuted: false,
      toggleNotificationsMuted: () => set((s) => ({ notificationsMuted: !s.notificationsMuted })),
      myTasksExpanded: true,
      setMyTasksExpanded: (myTasksExpanded) => set({ myTasksExpanded }),
      toggleMyTasksExpanded: () => set((s) => ({ myTasksExpanded: !s.myTasksExpanded })),
      myTasksVisibleCards: [...DEFAULT_MY_TASKS_VISIBLE_CARDS],
      setMyTasksVisibleCards: (myTasksVisibleCards) =>
        set({ myTasksVisibleCards: sanitizeMyTasksCards(myTasksVisibleCards) }),
      reorderMyTasksCards: (cards) => set({ myTasksVisibleCards: [...cards] }),
      hideMyTasksCard: (id) =>
        set((s) => ({
          myTasksVisibleCards: s.myTasksVisibleCards.filter((c) => c !== id),
        })),
      showMyTasksCard: (id) =>
        set((s) =>
          s.myTasksVisibleCards.includes(id)
            ? s
            : { myTasksVisibleCards: [...s.myTasksVisibleCards, id] },
        ),
      resetMyTasksVisibleCards: () =>
        set({ myTasksVisibleCards: [...DEFAULT_MY_TASKS_VISIBLE_CARDS] }),
      myTasksCardsCollapsed: [],
      toggleMyTasksCardCollapsed: (id) =>
        set((s) => ({
          myTasksCardsCollapsed: s.myTasksCardsCollapsed.includes(id)
            ? s.myTasksCardsCollapsed.filter((c) => c !== id)
            : [...s.myTasksCardsCollapsed, id],
        })),
      myTasksCardSizes: {},
      setMyTasksCardSize: (id, patch) =>
        set((s) => ({
          myTasksCardSizes: {
            ...s.myTasksCardSizes,
            [id]: { ...s.myTasksCardSizes[id], ...patch },
          },
        })),
      myWorkCardSettings: { ...DEFAULT_MY_WORK_CARD_SETTINGS },
      setMyWorkCardSetting: (key, value) =>
        set((s) => ({
          myWorkCardSettings: { ...s.myWorkCardSettings, [key]: value },
        })),
      assignedToMeCardSettings: { ...DEFAULT_ASSIGNED_TO_ME_CARD_SETTINGS },
      setAssignedToMeCardSetting: (key, value) =>
        set((s) => ({
          assignedToMeCardSettings: { ...s.assignedToMeCardSettings, [key]: value },
        })),
    }),
    {
      name: 'flowdesk-ui',
      merge: (persisted, current) => {
        const p = persisted as Partial<UIState> | undefined
        return {
          ...current,
          ...p,
          myTasksVisibleCards: (() => {
            const sanitized = sanitizeMyTasksCards(
              p?.myTasksVisibleCards ?? current.myTasksVisibleCards,
            )
            return sanitized.length > 0 ? sanitized : [...DEFAULT_MY_TASKS_VISIBLE_CARDS]
          })(),
          myTasksCardsCollapsed: (p?.myTasksCardsCollapsed ?? []).filter((id): id is MyTasksCardId =>
            (MY_TASKS_CARD_IDS as readonly string[]).includes(id),
          ),
          myWorkCardSettings: {
            ...DEFAULT_MY_WORK_CARD_SETTINGS,
            ...(p?.myWorkCardSettings ?? {}),
          },
          assignedToMeCardSettings: {
            ...DEFAULT_ASSIGNED_TO_ME_CARD_SETTINGS,
            ...(p?.assignedToMeCardSettings ?? {}),
          },
        }
      },
      partialize: (s) => ({
        theme: s.theme,
        accent: s.accent,
        sidebarCollapsed: s.sidebarCollapsed,
        secondarySidebarWidth: s.secondarySidebarWidth,
        notificationsMuted: s.notificationsMuted,
        myTasksExpanded: s.myTasksExpanded,
        myTasksVisibleCards: s.myTasksVisibleCards,
        myTasksCardsCollapsed: s.myTasksCardsCollapsed,
        myTasksCardSizes: s.myTasksCardSizes,
        myWorkCardSettings: s.myWorkCardSettings,
        assignedToMeCardSettings: s.assignedToMeCardSettings,
      }),
    },
  ),
)

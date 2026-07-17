import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUIStore } from '@/stores/ui'
import { DEFAULT_MY_TASKS_VISIBLE_CARDS } from '@/lib/myTasksCards'

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      theme: 'dark',
      sidebarCollapsed: false,
      flyoutSection: null,
      searchOpen: false,
      inviteOpen: false,
      notificationsMuted: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('toggles theme', () => {
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('light')
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('dark')
  })

  it('toggles and expands sidebar', () => {
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    useUIStore.getState().expandSidebar()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  it('sets flyout section immediately', () => {
    useUIStore.getState().setFlyout('planner')
    expect(useUIStore.getState().flyoutSection).toBe('planner')
    useUIStore.getState().setFlyout(null)
    expect(useUIStore.getState().flyoutSection).toBeNull()
  })

  it('schedules flyout hide after a delay', () => {
    vi.useFakeTimers()
    useUIStore.getState().setFlyout('teams')
    useUIStore.getState().scheduleFlyoutHide()
    vi.advanceTimersByTime(179)
    expect(useUIStore.getState().flyoutSection).toBe('teams')
    vi.advanceTimersByTime(2)
    expect(useUIStore.getState().flyoutSection).toBeNull()
  })

  it('cancelFlyoutHide prevents scheduled hide', () => {
    vi.useFakeTimers()
    useUIStore.getState().setFlyout('forms')
    useUIStore.getState().scheduleFlyoutHide()
    useUIStore.getState().cancelFlyoutHide()
    vi.advanceTimersByTime(500)
    expect(useUIStore.getState().flyoutSection).toBe('forms')
  })

  it('controls search and invite modals', () => {
    useUIStore.getState().setSearchOpen(true)
    useUIStore.getState().setInviteOpen(true)
    expect(useUIStore.getState().searchOpen).toBe(true)
    expect(useUIStore.getState().inviteOpen).toBe(true)
  })

  it('toggles notification mute', () => {
    useUIStore.getState().toggleNotificationsMuted()
    expect(useUIStore.getState().notificationsMuted).toBe(true)
  })

  it('manages secondary sidebar width', () => {
    useUIStore.getState().setSecondarySidebarWidth(320)
    expect(useUIStore.getState().secondarySidebarWidth).toBe(320)
    useUIStore.getState().resetSecondarySidebarWidth()
    expect(useUIStore.getState().secondarySidebarWidth).toBe(256)
  })

  it('manages my tasks cards and settings', () => {
    useUIStore.getState().hideMyTasksCard('recents')
    expect(useUIStore.getState().myTasksVisibleCards).not.toContain('recents')
    useUIStore.getState().showMyTasksCard('recents')
    expect(useUIStore.getState().myTasksVisibleCards).toContain('recents')
    useUIStore.getState().toggleMyTasksCardCollapsed('agenda')
    expect(useUIStore.getState().myTasksCardsCollapsed).toContain('agenda')
    useUIStore.getState().toggleMyTasksCardCollapsed('agenda')
    expect(useUIStore.getState().myTasksCardsCollapsed).not.toContain('agenda')
    const before = useUIStore.getState().myTasksVisibleCards
    useUIStore.getState().showMyTasksCard('assigned')
    expect(useUIStore.getState().myTasksVisibleCards).toBe(before)
    useUIStore.getState().setMyTasksCardSize('my_work', { h: 2 })
    expect(useUIStore.getState().myTasksCardSizes.my_work?.h).toBe(2)
    useUIStore.getState().setMyWorkCardSetting('showSubtaskParentNames', true)
    expect(useUIStore.getState().myWorkCardSettings.showSubtaskParentNames).toBe(true)
    useUIStore.getState().setAssignedToMeCardSetting('groupBy', 'priority')
    expect(useUIStore.getState().assignedToMeCardSettings.groupBy).toBe('priority')
    useUIStore.getState().toggleMyTasksExpanded()
    expect(useUIStore.getState().myTasksExpanded).toBe(false)
    useUIStore.getState().resetMyTasksVisibleCards()
    expect(useUIStore.getState().myTasksVisibleCards.length).toBeGreaterThan(0)
    useUIStore.getState().reorderMyTasksCards(['assigned', 'agenda', 'recents', 'my_work', 'assigned_comments', 'personal_list'])
    expect(useUIStore.getState().myTasksVisibleCards[0]).toBe('assigned')
    useUIStore.getState().setMyTasksVisibleCards(['assigned', 'bogus', 'agenda'])
    expect(useUIStore.getState().myTasksVisibleCards).not.toContain('bogus')
  })

  it('sanitizes persisted my tasks settings on merge', () => {
    const merge = (
      useUIStore as unknown as {
        persist: { getOptions: () => { merge?: (p: object, c: object) => object } }
      }
    ).persist.getOptions().merge
    expect(merge).toBeTypeOf('function')
    const merged = merge!(
      {
        myTasksVisibleCards: ['lineup', 'assigned'],
        myTasksCardsCollapsed: ['bogus', 'agenda'],
        myWorkCardSettings: { showSubtaskParentNames: true },
        assignedToMeCardSettings: { groupBy: 'priority' },
      },
      { myTasksVisibleCards: [...DEFAULT_MY_TASKS_VISIBLE_CARDS] },
    ) as ReturnType<typeof useUIStore.getState>
    expect(merged.myTasksVisibleCards).not.toContain('lineup')
    expect(merged.myTasksCardsCollapsed).toEqual(['agenda'])
    expect(merged.assignedToMeCardSettings.groupBy).toBe('priority')
  })
})

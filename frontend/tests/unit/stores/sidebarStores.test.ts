import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_HOME_SETTINGS } from '@/constants/homeItems'
import { DEFAULT_NAV_SETTINGS } from '@/constants/navigationItems'
import { DEFAULT_SECTION_ORDER } from '@/constants/sidebarSections'
import { useHomeSidebarStore } from '@/stores/homeSidebar'
import { useSidebarNavStore } from '@/stores/sidebarNav'
import { useSidebarSectionsStore } from '@/stores/sidebarSections'

describe('useSidebarNavStore', () => {
  beforeEach(() => {
    useSidebarNavStore.setState({
      visibility: { ...DEFAULT_NAV_SETTINGS },
      appearance: 'labels',
    })
  })

  it('toggles and sets nav item visibility', () => {
    const id = Object.keys(DEFAULT_NAV_SETTINGS)[0] as keyof typeof DEFAULT_NAV_SETTINGS
    useSidebarNavStore.getState().toggle(id)
    expect(useSidebarNavStore.getState().visibility[id]).toBe(!DEFAULT_NAV_SETTINGS[id])
    useSidebarNavStore.getState().setVisible(id, true)
    expect(useSidebarNavStore.getState().visibility[id]).toBe(true)
  })

  it('updates appearance', () => {
    useSidebarNavStore.getState().setAppearance('icons')
    expect(useSidebarNavStore.getState().appearance).toBe('icons')
  })
})

describe('useHomeSidebarStore', () => {
  beforeEach(() => {
    useHomeSidebarStore.setState({ visibility: { ...DEFAULT_HOME_SETTINGS } })
  })

  it('toggles and sets home shortcut visibility', () => {
    const id = Object.keys(DEFAULT_HOME_SETTINGS)[0] as keyof typeof DEFAULT_HOME_SETTINGS
    useHomeSidebarStore.getState().toggle(id)
    expect(useHomeSidebarStore.getState().visibility[id]).toBe(!DEFAULT_HOME_SETTINGS[id])
    useHomeSidebarStore.getState().setVisible(id, true)
    expect(useHomeSidebarStore.getState().visibility[id]).toBe(true)
  })
})

describe('useSidebarSectionsStore', () => {
  beforeEach(() => {
    useSidebarSectionsStore.setState({
      order: [...DEFAULT_SECTION_ORDER],
      hidden: [],
      custom: [],
    })
  })

  it('reorders, hides, and restores sections', () => {
    const [first, second] = DEFAULT_SECTION_ORDER
    useSidebarSectionsStore.getState().reorder(second, 0)
    expect(useSidebarSectionsStore.getState().order[0]).toBe(second)
    useSidebarSectionsStore.getState().hide(first)
    expect(useSidebarSectionsStore.getState().hidden).toContain(first)
    useSidebarSectionsStore.getState().restore(first)
    expect(useSidebarSectionsStore.getState().hidden).not.toContain(first)
  })

  it('creates and removes custom sections with unique ids', () => {
    useSidebarSectionsStore.getState().createCustom('My Section')
    useSidebarSectionsStore.getState().createCustom('My Section')
    const custom = useSidebarSectionsStore.getState().custom
    expect(custom).toHaveLength(2)
    expect(custom[0].id).not.toBe(custom[1].id)
    const customId = custom[0].id
    useSidebarSectionsStore.getState().removeCustom(customId)
    expect(useSidebarSectionsStore.getState().custom.map((c) => c.id)).not.toContain(customId)
    expect(useSidebarSectionsStore.getState().order).not.toContain(customId)
  })

  it('ignores blank custom section names', () => {
    useSidebarSectionsStore.getState().createCustom('   ')
    expect(useSidebarSectionsStore.getState().custom).toHaveLength(0)
  })
})

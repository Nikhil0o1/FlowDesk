import { describe, expect, it, vi } from 'vitest'

import {
  FAVORITES_UPDATED_EVENT,
  addFavoriteSection,
  favoriteProjectTarget,
  favoriteTaskTarget,
  favoriteViewTarget,
  getFavoriteItems,
  getFavoritePlacement,
  getFavoriteSections,
  getFavoritesState,
  isFavorite,
  moveFavoriteToSection,
  setFavoritePlacement,
  toggleFavorite,
} from '@/lib/favorites'

describe('favorites', () => {
  it('toggles favorites and persists to storage', () => {
    const target = favoriteProjectTarget('p1', 'Alpha')
    expect(toggleFavorite(target)).toBe(true)
    expect(isFavorite(target.key)).toBe(true)
    expect(getFavoriteItems()[0]).toMatchObject({ key: 'project:p1', label: 'Alpha' })
    expect(toggleFavorite(target)).toBe(false)
    expect(isFavorite(target.key)).toBe(false)
  })

  it('supports view and task targets', () => {
    toggleFavorite(favoriteViewTarget('/app/my-tasks', 'My Tasks'))
    toggleFavorite(favoriteTaskTarget('t1', 'Fix bug', 'FD-1'))
    const keys = getFavoriteItems().map((i) => i.key)
    expect(keys).toContain('view:/app/my-tasks')
    expect(keys).toContain('task:t1')
  })

  it('changes placement and creates sections', () => {
    setFavoritePlacement('top')
    expect(getFavoritePlacement()).toBe('top')
    const section = addFavoriteSection('Pinned', '📌')
    expect(section?.name).toBe('Pinned')
    expect(getFavoriteSections().some((s) => s.id === section?.id)).toBe(true)
  })

  it('moves favorite to another section', () => {
    const section = addFavoriteSection('Work', '💼')
    const target = favoriteProjectTarget('p2', 'Beta')
    toggleFavorite(target)
    if (section) moveFavoriteToSection(target.key, section.id)
    expect(getFavoriteItems().find((i) => i.key === target.key)?.sectionId).toBe(section?.id)
  })

  it('rejects empty section names', () => {
    expect(addFavoriteSection('   ')).toBeNull()
  })

  it('ignores move to unknown section', () => {
    const target = favoriteProjectTarget('p9', 'Gamma')
    toggleFavorite(target)
    moveFavoriteToSection(target.key, 'missing-section')
    expect(getFavoriteItems().find((i) => i.key === target.key)?.sectionId).toBe('favorites')
  })

  it('assigns favorites to a custom section', () => {
    const section = addFavoriteSection('Quick', '⚡')
    const target = favoriteViewTarget('/app/inbox', 'Inbox')
    expect(toggleFavorite(target, section!.id)).toBe(true)
    expect(getFavoriteItems().find((i) => i.key === target.key)?.sectionId).toBe(section!.id)
  })

  it('dispatches update event and tolerates corrupt storage', () => {
    const handler = vi.fn()
    window.addEventListener(FAVORITES_UPDATED_EVENT, handler)
    toggleFavorite(favoriteViewTarget('/x', 'X'))
    expect(handler).toHaveBeenCalled()
    window.removeEventListener(FAVORITES_UPDATED_EVENT, handler)

    localStorage.setItem('flowdesk-favorites', '{bad')
    expect(getFavoritesState().items).toEqual([])
  })
})

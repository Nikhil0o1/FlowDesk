/** User favorites — pinned views, projects, and tasks (local per browser). */

export type FavoritePlacement = 'sidebar' | 'top'

export type FavoriteSection = {
  id: string
  name: string
  emoji: string | null
  position: number
}

export type FavoriteItem = {
  key: string
  label: string
  path: string
  sectionId: string
  ts: number
}

export type FavoriteTarget = {
  key: string
  label: string
  path: string
}

type FavoritesStore = {
  placement: FavoritePlacement
  sections: FavoriteSection[]
  items: FavoriteItem[]
}

const KEY = 'flowdesk-favorites'
const DEFAULT_SECTION_ID = 'favorites'

export const FAVORITES_UPDATED_EVENT = 'flowdesk-favorites-updated'

const DEFAULT_STORE: FavoritesStore = {
  placement: 'sidebar',
  sections: [{ id: DEFAULT_SECTION_ID, name: 'Favorites', emoji: '⭐', position: 0 }],
  items: [],
}

function notifyFavoritesUpdated(): void {
  window.dispatchEvent(new Event(FAVORITES_UPDATED_EVENT))
}

function loadStore(): FavoritesStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_STORE, sections: [...DEFAULT_STORE.sections], items: [] }
    const parsed = JSON.parse(raw) as Partial<FavoritesStore>
    const sections =
      parsed.sections && parsed.sections.length > 0
        ? parsed.sections.map((s) => ({ ...s, emoji: s.emoji ?? null }))
        : [{ id: DEFAULT_SECTION_ID, name: 'Favorites', emoji: '⭐', position: 0 }]
    return {
      placement: parsed.placement === 'top' ? 'top' : 'sidebar',
      sections,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    }
  } catch {
    return { ...DEFAULT_STORE, sections: [...DEFAULT_STORE.sections], items: [] }
  }
}

function saveStore(store: FavoritesStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
    notifyFavoritesUpdated()
  } catch {
    /* storage unavailable */
  }
}

export function getFavoritesState(): FavoritesStore {
  return loadStore()
}

export function getFavoriteItems(): FavoriteItem[] {
  return loadStore().items
}

export function getFavoritePlacement(): FavoritePlacement {
  return loadStore().placement
}

export function getFavoriteSections(): FavoriteSection[] {
  return [...loadStore().sections].sort((a, b) => a.position - b.position)
}

export function isFavorite(key: string): boolean {
  return loadStore().items.some((item) => item.key === key)
}

export function setFavoritePlacement(placement: FavoritePlacement): void {
  const store = loadStore()
  saveStore({ ...store, placement })
}

export function toggleFavorite(target: FavoriteTarget, sectionId = DEFAULT_SECTION_ID): boolean {
  const store = loadStore()
  const exists = store.items.some((item) => item.key === target.key)
  if (exists) {
    saveStore({ ...store, items: store.items.filter((item) => item.key !== target.key) })
    return false
  }
  const next: FavoriteItem = {
    key: target.key,
    label: target.label,
    path: target.path,
    sectionId,
    ts: Date.now(),
  }
  saveStore({ ...store, items: [next, ...store.items.filter((item) => item.key !== target.key)] })
  return true
}

export function addFavoriteSection(name: string, emoji: string | null = null): FavoriteSection | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const store = loadStore()
  const id = `section-${Date.now()}`
  const section: FavoriteSection = { id, name: trimmed, emoji, position: store.sections.length }
  saveStore({ ...store, sections: [...store.sections, section] })
  return section
}

export function moveFavoriteToSection(key: string, sectionId: string): void {
  const store = loadStore()
  if (!store.sections.some((s) => s.id === sectionId)) return
  saveStore({
    ...store,
    items: store.items.map((item) => (item.key === key ? { ...item, sectionId } : item)),
  })
}

export const favoriteViewTarget = (path: string, label: string): FavoriteTarget => ({
  key: `view:${path}`,
  label,
  path,
})

export const favoriteProjectTarget = (projectId: string, name: string): FavoriteTarget => ({
  key: `project:${projectId}`,
  label: name,
  path: `/app/projects/${projectId}`,
})

export const favoriteTaskTarget = (taskId: string, title: string, ref?: string): FavoriteTarget => ({
  key: `task:${taskId}`,
  label: ref ? `${ref} ${title}` : title,
  path: `/app/tasks/${taskId}`,
})

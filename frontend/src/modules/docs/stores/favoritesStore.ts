import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { FavoriteEntry, FavoriteType } from '../types/favorites'

interface FavoritesState {
  entries: FavoriteEntry[]
  add: (id: string, type: FavoriteType) => void
  remove: (id: string) => void
  toggle: (id: string, type: FavoriteType) => void
}

/** Persisted favorites for documents and folders (localStorage `flowdesk-favorites`). */
export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      entries: [],
      add: (id, type) =>
        set((s) =>
          s.entries.some((e) => e.id === id)
            ? s
            : { entries: [{ id, type, at: Date.now() }, ...s.entries] },
        ),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      toggle: (id, type) => {
        const exists = get().entries.some((e) => e.id === id)
        if (exists) get().remove(id)
        else get().add(id, type)
      },
    }),
    { name: 'flowdesk-favorites' },
  ),
)

import { useEffect, useState } from 'react'

import {
  FAVORITES_UPDATED_EVENT,
  getFavoritesState,
  type FavoriteItem,
  type FavoritePlacement,
  type FavoriteSection,
} from '../lib/favorites'

export type FavoritesSnapshot = {
  placement: FavoritePlacement
  sections: FavoriteSection[]
  items: FavoriteItem[]
}

export function useFavorites(): FavoritesSnapshot {
  const [snapshot, setSnapshot] = useState<FavoritesSnapshot>(() => {
    const state = getFavoritesState()
    return { placement: state.placement, sections: state.sections, items: state.items }
  })

  useEffect(() => {
    const refresh = () => {
      const state = getFavoritesState()
      setSnapshot({ placement: state.placement, sections: state.sections, items: state.items })
    }
    refresh()
    window.addEventListener(FAVORITES_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, refresh)
  }, [])

  return snapshot
}

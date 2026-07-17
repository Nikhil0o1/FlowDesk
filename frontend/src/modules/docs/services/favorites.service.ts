import type { FavoriteEntry } from '../types/favorites'

/**
 * Favorites domain helpers (pure). State lives in `favoritesStore`.
 *
 * TODO(backend): replace store persistence with API calls here; the pure helpers
 * below stay unchanged.
 */

/** Fast id → favoritedAt lookup. */
export function favoriteMap(entries: FavoriteEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.id, e.at]))
}

/** Ids of favorited entries of a given type, newest first. */
export function favoriteIdsByType(entries: FavoriteEntry[], type: FavoriteEntry['type']): string[] {
  return entries
    .filter((e) => e.type === type)
    .sort((a, b) => b.at - a.at)
    .map((e) => e.id)
}

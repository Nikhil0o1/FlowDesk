import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import { favoriteMap } from '../services/favorites.service'
import { addFavoriteApi, docsKeys, fetchFavorites, removeFavoriteApi } from '../services/docsApi.service'
import type { FavoriteType } from '../types/favorites'

/** Favorites for documents and folders, backed by the Docs API. */
export function useFavorites() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const queryClient = useQueryClient()

  const favoritesQuery = useQuery({
    queryKey: docsKeys.favorites(wsId ?? ''),
    queryFn: () => fetchFavorites(wsId!),
    enabled: !!wsId,
  })

  const entries = useMemo(
    () =>
      (favoritesQuery.data ?? []).map((f) => ({
        id: f.targetId,
        type: f.type,
        at: f.at,
      })),
    [favoritesQuery.data],
  )

  const invalidate = useCallback(() => {
    if (!wsId) return
    void queryClient.invalidateQueries({ queryKey: docsKeys.favorites(wsId) })
  }, [queryClient, wsId])

  const favMap = useMemo(() => favoriteMap(entries), [entries])
  const isFavorite = useCallback((id: string) => favMap.has(id), [favMap])
  const favoritedAt = useCallback((id: string) => favMap.get(id) ?? 0, [favMap])

  const toggleMutation = useMutation({
    mutationFn: async ({ id, type, on }: { id: string; type: FavoriteType; on: boolean }) => {
      if (!wsId) throw new Error('No workspace selected')
      if (on) await addFavoriteApi(wsId, id, type)
      else await removeFavoriteApi(wsId, id)
    },
    onSuccess: invalidate,
  })

  const toggleFavorite = useCallback(
    (id: string, type: FavoriteType) => {
      const on = !isFavorite(id)
      void toggleMutation.mutateAsync({ id, type, on })
    },
    [isFavorite, toggleMutation],
  )

  const removeFavorite = useCallback(
    async (id: string) => {
      if (!wsId) return
      await removeFavoriteApi(wsId, id)
      invalidate()
    },
    [invalidate, wsId],
  )

  return { entries, isFavorite, favoritedAt, toggleFavorite, removeFavorite }
}

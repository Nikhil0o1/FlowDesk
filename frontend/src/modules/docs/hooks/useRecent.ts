import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { clearRecentApi, docsKeys, fetchRecent, removeRecentApi } from '../services/docsApi.service'

/** Recently-opened documents from the API (updated on document open). */
export function useRecent() {
  const queryClient = useQueryClient()

  const recentQuery = useQuery({
    queryKey: docsKeys.recent(),
    queryFn: fetchRecent,
  })

  const entries = useMemo(
    () =>
      (recentQuery.data ?? []).map((r) => ({
        id: r.documentId,
        at: new Date(r.openedAt).getTime(),
      })),
    [recentQuery.data],
  )

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: docsKeys.recent() }),
    [queryClient],
  )

  /** Opening a document records recent server-side via `openDocumentApi`. */
  const track = useCallback((_documentId: string) => {}, [])

  const remove = useCallback(
    async (documentId: string) => {
      await removeRecentApi(documentId)
      invalidate()
    },
    [invalidate],
  )

  const clear = useCallback(async () => {
    await clearRecentApi()
    invalidate()
  }, [invalidate])

  return { entries, track, remove, clear, isLoading: recentQuery.isLoading }
}

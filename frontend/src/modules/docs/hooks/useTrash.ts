import { useCallback, useMemo } from 'react'

import { getTrashed } from '../services/trash.service'
import { deleteDocumentPermanentApi } from '../services/docsApi.service'
import { useDocuments } from './useDocuments'
import { useFavorites } from './useFavorites'
import { useRecent } from './useRecent'

/** Trash view + restore / permanent-delete / empty actions. */
export function useTrash() {
  const { documents, restoreDocument, invalidate } = useDocuments()
  const { removeFavorite } = useFavorites()
  const { remove: removeRecent } = useRecent()

  const trashed = useMemo(() => getTrashed(documents), [documents])

  const restore = useCallback((ids: string[]) => Promise.all(ids.map((id) => restoreDocument(id))), [restoreDocument])

  const deletePermanent = useCallback(
    async (ids: string[]) => {
      await Promise.all(
        ids.map(async (id) => {
          await removeFavorite(id)
          removeRecent(id)
          await deleteDocumentPermanentApi(id)
        }),
      )
      invalidate()
    },
    [invalidate, removeFavorite, removeRecent],
  )

  const emptyTrash = useCallback(() => deletePermanent(trashed.map((d) => d.id)), [deletePermanent, trashed])

  return { trashed, restore, deletePermanent, emptyTrash }
}

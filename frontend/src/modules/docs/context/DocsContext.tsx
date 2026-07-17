import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useCurrentContext } from '../../../lib/queries'
import { useRealtime } from '../../../lib/ws'
import { docsKeys } from '../services/docsApi.service'
import { useDocsUIStore } from '../stores/docsUIStore'
import { useDocuments } from '../hooks/useDocuments'
import { useFolders } from '../hooks/useFolders'
import { searchDocuments } from '../services/docs.service'

/** Prefetch Docs data for the active workspace and subscribe to realtime invalidation. */
export function useDocsBootstrap() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!wsId) return
    void queryClient.prefetchQuery({ queryKey: docsKeys.folders(wsId), queryFn: () => import('../services/docsApi.service').then((m) => m.fetchFolders(wsId)) })
    void queryClient.prefetchQuery({
      queryKey: docsKeys.documents(wsId, 'active'),
      queryFn: () => import('../services/docsApi.service').then((m) => m.fetchDocuments(wsId, { deleted: false })),
    })
  }, [queryClient, wsId])

  useRealtime(
    ['doc.created', 'doc.updated', 'doc.comment.created'],
    () => {
      if (!wsId) return
      void queryClient.invalidateQueries({ queryKey: docsKeys.all })
    },
    [wsId],
  )
}

/**
 * Aggregated Docs API — folders, documents and view state in one place.
 * Collaboration hooks (`useComments`, `useSharing`, etc.) remain per-document.
 */
export function useDocs() {
  useDocsBootstrap()
  const folders = useFolders()
  const documents = useDocuments()
  const ui = useDocsUIStore()

  return {
    ...folders,
    ...documents,
    ...ui,
    searchDocuments: (query: string) => searchDocuments(documents.activeDocuments, folders.folders, query),
  }
}

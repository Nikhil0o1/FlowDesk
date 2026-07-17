import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { displayName, useAuthStore } from '../../../stores/auth'
import { wordCount } from '../services/metadata.service'
import { versionsForDoc } from '../services/history.service'
import {
  createVersionApi,
  docsKeys,
  fetchVersions,
  restoreVersionApi,
} from '../services/docsApi.service'
import type { FlowDoc } from '../types/document'
import { useDocuments } from './useDocuments'

/** Version snapshots for a document — backed by the Docs API. */
export function useVersionHistory(documentId: string) {
  const queryClient = useQueryClient()
  const { updateDocument, invalidate } = useDocuments()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? 'local-user'
  const userName = displayName(user) || 'You'

  const versionsQuery = useQuery({
    queryKey: docsKeys.versions(documentId),
    queryFn: () => fetchVersions(documentId),
    enabled: !!documentId,
  })

  const all = versionsQuery.data ?? []
  const versions = useMemo(() => versionsForDoc(all, documentId), [all, documentId])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.versions(documentId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.activity(documentId) })
  }, [documentId, queryClient])

  const snapshot = useCallback(
    async (doc: Pick<FlowDoc, 'title' | 'content'>, summary = 'Auto-saved') => {
      await createVersionApi(documentId, {
        title: doc.title,
        content: doc.content,
        summary,
        wordCount: wordCount(doc.content),
      })
      refresh()
    },
    [documentId, refresh],
  )

  const restore = useCallback(
    async (versionId: string) => {
      await restoreVersionApi(documentId, versionId)
      invalidate()
      refresh()
    },
    [documentId, invalidate, refresh],
  )

  return { versions, snapshot, restore, isLoading: versionsQuery.isLoading, userId, userName }
}

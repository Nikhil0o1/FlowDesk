import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import { isActive } from '../services/docs.service'
import {
  archiveDocumentApi,
  createDocumentApi,
  docsKeys,
  duplicateDocumentApi,
  fetchDocument,
  fetchDocuments,
  restoreDocumentApi,
  trashDocumentApi,
  unarchiveDocumentApi,
  updateDocumentApi,
} from '../services/docsApi.service'
import type { DocStatus, FlowDoc } from '../types/document'

/** Document data + actions backed by the Docs API. */
export function useDocuments() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const queryClient = useQueryClient()

  const activeQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'active'),
    queryFn: () => fetchDocuments(wsId!, { deleted: false }),
    enabled: !!wsId,
  })

  const archivedQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'archived'),
    queryFn: () => fetchDocuments(wsId!, { deleted: false, archived: true }),
    enabled: !!wsId,
  })

  const trashedQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'trash'),
    queryFn: () => fetchDocuments(wsId!, { deleted: true }),
    enabled: !!wsId,
  })

  const documents = useMemo(() => {
    const map = new Map<string, FlowDoc>()
    for (const d of [...(activeQuery.data ?? []), ...(archivedQuery.data ?? []), ...(trashedQuery.data ?? [])]) {
      map.set(d.id, d)
    }
    return Array.from(map.values())
  }, [activeQuery.data, archivedQuery.data, trashedQuery.data])

  const invalidate = useCallback(() => {
    if (!wsId) return
    void queryClient.invalidateQueries({ queryKey: [...docsKeys.all, 'documents', wsId] })
    void queryClient.invalidateQueries({ queryKey: docsKeys.recent() })
  }, [queryClient, wsId])

  const activeDocuments = useMemo(() => documents.filter(isActive), [documents])

  const getDocument = useCallback(
    (id: string): FlowDoc | undefined => documents.find((d) => d.id === id),
    [documents],
  )

  const byFolder = useCallback(
    (folderId: string | null): FlowDoc[] => documents.filter((d) => d.folderId === folderId && isActive(d)),
    [documents],
  )

  const createMutation = useMutation({
    mutationFn: (opts: Parameters<typeof createDocumentApi>[1]) => createDocumentApi(wsId!, opts),
    onSuccess: invalidate,
  })

  const createDocument = useCallback(
    (
      opts: {
        title?: string
        folderId?: string | null
        status?: DocStatus
        content?: string
        templateId?: string | null
        tags?: string[]
        isWiki?: boolean
        icon?: string | null
      } = {},
    ) => {
      if (!wsId) throw new Error('No workspace selected')
      return createMutation.mutateAsync({
        title: opts.title,
        folderId: opts.folderId,
        status: opts.status,
        content: opts.content,
        templateId: opts.templateId,
        tags: opts.tags,
        isWiki: opts.isWiki,
        icon: opts.icon,
      })
    },
    [createMutation, wsId],
  )

  const updateDocument = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<FlowDoc, 'title' | 'content' | 'status' | 'folderId' | 'tags' | 'icon' | 'isProtected' | 'coverUrl' | 'pageSettings' | 'isWiki'>
      > & {
        createVersion?: boolean
        versionSummary?: string
      },
    ) => {
      const doc = await updateDocumentApi(id, patch)
      invalidate()
      void queryClient.setQueryData(docsKeys.document(id), doc)
      return doc
    },
    [invalidate, queryClient],
  )

  const setProtected = useCallback(
    (id: string, isProtected: boolean) => updateDocument(id, { isProtected }),
    [updateDocument],
  )

  const deleteDocument = useCallback(
    async (id: string) => {
      await trashDocumentApi(id)
      invalidate()
    },
    [invalidate],
  )

  const duplicateDocument = useCallback(
    async (id: string) => {
      const doc = await duplicateDocumentApi(id)
      invalidate()
      return doc
    },
    [invalidate],
  )

  const moveDocument = useCallback(
    (id: string, folderId: string | null) => updateDocument(id, { folderId }),
    [updateDocument],
  )

  return {
    documents,
    activeDocuments,
    getDocument,
    byFolder,
    createDocument,
    updateDocument,
    setProtected,
    deleteDocument,
    duplicateDocument,
    moveDocument,
    isLoading: activeQuery.isLoading,
    invalidate,
    archiveDocument: async (id: string) => {
      await archiveDocumentApi(id)
      invalidate()
    },
    unarchiveDocument: async (id: string) => {
      await unarchiveDocumentApi(id)
      invalidate()
    },
    restoreDocument: async (id: string) => {
      await restoreDocumentApi(id)
      invalidate()
    },
    fetchDocumentById: (id: string) => fetchDocument(id),
  }
}

export function useFolderDocCount(folderId: string) {
  const { activeDocuments } = useDocuments()
  return useMemo(
    () => activeDocuments.reduce((n, d) => (d.folderId === folderId ? n + 1 : n), 0),
    [activeDocuments, folderId],
  )
}

export function useDocumentQuery(documentId: string) {
  return useQuery({
    queryKey: docsKeys.document(documentId),
    queryFn: () => fetchDocument(documentId),
    enabled: !!documentId,
  })
}

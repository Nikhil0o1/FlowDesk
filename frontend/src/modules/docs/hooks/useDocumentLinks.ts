import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addDocumentLinkApi,
  docsKeys,
  fetchDocumentLinks,
  removeDocumentLinkApi,
} from '../services/docsApi.service'
import type { DocLink, DocLinkTargetType } from '../types/docLink'

export function useDocumentLinks(documentId: string) {
  const queryClient = useQueryClient()

  const linksQuery = useQuery({
    queryKey: docsKeys.links(documentId),
    queryFn: () => fetchDocumentLinks(documentId),
    enabled: !!documentId,
  })

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.links(documentId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.activity(documentId) })
  }, [documentId, queryClient])

  const addLink = useMutation({
    mutationFn: ({ targetType, targetId }: { targetType: DocLinkTargetType; targetId: string }) =>
      addDocumentLinkApi(documentId, targetType, targetId),
    onSuccess: invalidate,
  })

  const removeLink = useMutation({
    mutationFn: (linkId: string) => removeDocumentLinkApi(documentId, linkId),
    onSuccess: invalidate,
  })

  return {
    links: linksQuery.data ?? [],
    isLoading: linksQuery.isLoading,
    addLink: addLink.mutateAsync,
    removeLink: removeLink.mutateAsync,
  }
}

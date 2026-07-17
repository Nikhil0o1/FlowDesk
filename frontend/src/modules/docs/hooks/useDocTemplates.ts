import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import {
  applyDocTemplateApi,
  createDocTemplateApi,
  deleteDocTemplateApi,
  docsKeys,
  fetchDocTemplates,
  updateDocTemplateApi,
  type CustomDocTemplate,
} from '../services/docsApi.service'

/** Custom, workspace-scoped Doc templates ("Save as template" / "Apply a template"). */
export function useDocTemplates() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: docsKeys.templates(wsId ?? ''),
    queryFn: () => fetchDocTemplates(wsId!),
    enabled: !!wsId,
  })

  const invalidate = useCallback(() => {
    if (!wsId) return
    void queryClient.invalidateQueries({ queryKey: docsKeys.templates(wsId) })
  }, [queryClient, wsId])

  const templates: CustomDocTemplate[] = query.data ?? []

  const saveAsTemplate = useCallback(
    async (input: { name: string; description?: string; icon?: string | null; documentId?: string; content?: string }) => {
      if (!wsId) throw new Error('No workspace selected')
      const t = await createDocTemplateApi(wsId, input)
      invalidate()
      return t
    },
    [wsId, invalidate],
  )

  const updateTemplate = useCallback(
    async (id: string, patch: { name?: string; description?: string; icon?: string | null; documentId?: string; content?: string }) => {
      const t = await updateDocTemplateApi(id, patch)
      invalidate()
      return t
    },
    [invalidate],
  )

  const deleteTemplate = useCallback(
    async (id: string) => {
      await deleteDocTemplateApi(id)
      invalidate()
    },
    [invalidate],
  )

  const applyMutation = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId?: string | null }) => applyDocTemplateApi(wsId!, id, folderId),
    onSuccess: () => {
      if (!wsId) return
      void queryClient.invalidateQueries({ queryKey: [...docsKeys.all, 'documents', wsId] })
    },
  })

  const applyTemplate = useCallback(
    (id: string, folderId?: string | null) => {
      if (!wsId) throw new Error('No workspace selected')
      return applyMutation.mutateAsync({ id, folderId })
    },
    [applyMutation, wsId],
  )

  return { templates, isLoading: query.isLoading, saveAsTemplate, updateTemplate, deleteTemplate, applyTemplate }
}

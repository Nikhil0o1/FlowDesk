import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import { isActive } from '../services/docs.service'
import {
  buildFolderTree,
  canMoveInto,
  collectFolderAndDescendants,
  folderPath as folderPathOf,
} from '../services/folder.service'
import {
  createFolderApi,
  deleteFolderApi,
  docsKeys,
  fetchFolders,
  moveFolderApi,
  renameFolderApi,
} from '../services/docsApi.service'
import type { FolderNode } from '../types/folder'
import { useDocuments } from './useDocuments'

/** Folder data + actions backed by the Docs API. */
export function useFolders() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const queryClient = useQueryClient()
  const { documents, invalidate: invalidateDocs } = useDocuments()

  const foldersQuery = useQuery({
    queryKey: docsKeys.folders(wsId ?? ''),
    queryFn: () => fetchFolders(wsId!),
    enabled: !!wsId,
  })

  const folders = foldersQuery.data ?? []

  const invalidate = useCallback(() => {
    if (!wsId) return
    void queryClient.invalidateQueries({ queryKey: docsKeys.folders(wsId) })
  }, [queryClient, wsId])

  const tree = useMemo<FolderNode[]>(() => buildFolderTree(folders), [folders])

  const getFolder = useCallback(
    (id: string | null) => (id ? folders.find((f) => f.id === id) : undefined),
    [folders],
  )

  const folderPath = useCallback((id: string | null) => folderPathOf(folders, id), [folders])

  const documentCount = useCallback(
    (id: string) => documents.filter((d) => d.folderId === id && isActive(d)).length,
    [documents],
  )

  const moveTargets = useCallback(
    (sourceId: string) => folders.filter((f) => canMoveInto(folders, sourceId, f.id)),
    [folders],
  )

  const addFolder = useCallback(
    async (name: string, parentId: string | null) => {
      if (!wsId) throw new Error('No workspace selected')
      const folder = await createFolderApi(wsId, name, parentId)
      invalidate()
      return folder
    },
    [invalidate, wsId],
  )

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      await renameFolderApi(id, name)
      invalidate()
    },
    [invalidate],
  )

  const moveFolder = useCallback(
    async (id: string, parentId: string | null) => {
      await moveFolderApi(id, parentId)
      invalidate()
    },
    [invalidate],
  )

  const deleteFolder = useCallback(
    async (id: string) => {
      const ids = collectFolderAndDescendants(folders, id)
      const idSet = new Set(ids)
      const docIds = documents.filter((d) => d.folderId && idSet.has(d.folderId) && isActive(d)).map((d) => d.id)
      await deleteFolderApi(id)
      invalidate()
      invalidateDocs()
      if (docIds.length && wsId) {
        void queryClient.invalidateQueries({ queryKey: docsKeys.favorites(wsId) })
      }
    },
    [documents, folders, invalidate, invalidateDocs, queryClient, wsId],
  )

  return {
    folders,
    tree,
    getFolder,
    folderPath,
    documentCount,
    moveTargets,
    addFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    isLoading: foldersQuery.isLoading,
  }
}

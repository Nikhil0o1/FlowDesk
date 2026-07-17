import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { displayName, useAuthStore } from '../../../stores/auth'
import {
  createCommentApi,
  deleteCommentApi,
  docsKeys,
  fetchComments,
  updateCommentApi,
} from '../services/docsApi.service'
import {
  commentCount,
  inlineComments,
  repliesTo,
  sortThreads,
  topLevelComments,
  unresolvedCount,
} from '../services/comments.service'
import type { DocComment, InlineAnchor } from '../types/comment'

/** Document-scoped comments backed by the Docs API. */
export function useComments(documentId: string, _documentTitle: string) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? 'local-user'
  const userName = displayName(user) || 'You'

  const commentsQuery = useQuery({
    queryKey: docsKeys.comments(documentId),
    queryFn: () => fetchComments(documentId),
    enabled: !!documentId,
  })

  const all = commentsQuery.data ?? []

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.comments(documentId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.activity(documentId) })
  }, [documentId, queryClient])

  const threads = useMemo(() => topLevelComments(all, documentId), [all, documentId])
  const inline = useMemo(() => inlineComments(all, documentId), [all, documentId])
  const count = useMemo(() => commentCount(all, documentId), [all, documentId])
  const openCount = useMemo(() => unresolvedCount(all, documentId), [all, documentId])

  const addComment = useCallback(
    async (body: string, opts: { parentId?: string | null; inlineAnchor?: InlineAnchor | null } = {}) => {
      const comment = await createCommentApi(documentId, body, opts)
      invalidate()
      return comment
    },
    [documentId, invalidate],
  )

  const updateComment = useCallback(
    async (id: string, patch: Partial<Pick<DocComment, 'body' | 'resolved'>>) => {
      const comment = await updateCommentApi(id, patch)
      invalidate()
      return comment
    },
    [invalidate],
  )

  const resolveComment = useCallback(
    (id: string, resolved: boolean) => updateComment(id, { resolved }),
    [updateComment],
  )

  const deleteComment = useCallback(
    async (id: string) => {
      await deleteCommentApi(id)
      invalidate()
    },
    [invalidate],
  )

  const getReplies = useCallback((parentId: string) => repliesTo(all, parentId), [all])

  const sortedThreads = useCallback((order: 'newest' | 'oldest') => sortThreads(threads, order), [threads])

  return {
    threads,
    inline,
    count,
    openCount,
    addComment,
    updateComment,
    resolveComment,
    deleteComment,
    getReplies,
    sortedThreads,
    isLoading: commentsQuery.isLoading,
    userId,
    userName,
  }
}

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { errorMessage } from '../../../lib/api'
import { useCurrentContext } from '../../../lib/queries'
import { displayName, useAuthStore } from '../../../stores/auth'
import { toast } from '../../../stores/toast'
import { collaboratorCount, copyShareLink, privateDocLink } from '../services/sharing.service'
import {
  addShareMemberApi,
  docsKeys,
  fetchShare,
  removeShareMemberApi,
  updateShareApi,
  updateShareMemberApi,
} from '../services/docsApi.service'
import type { DocRole, DocShareMember, ShareTargetType } from '../types/permissions'

/** Per-document sharing backed by the Docs API. */
export function useSharing(
  documentId: string,
  _documentTitle: string,
  documentAuthor?: string,
  documentAuthorId?: string,
) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const user = useAuthStore((s) => s.user)
  const userName = displayName(user) || 'You'

  const shareQuery = useQuery({
    queryKey: docsKeys.share(documentId),
    queryFn: () => fetchShare(documentId),
    enabled: !!documentId,
  })

  const state = useMemo(
    () =>
      shareQuery.data ?? {
        documentId,
        isPrivate: true,
        publicEnabled: false,
        publicToken: null,
        publicUrl: null,
        members: [],
      },
    [documentId, shareQuery.data],
  )

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.share(documentId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.activity(documentId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.document(documentId) })
    if (wsId) {
      void queryClient.invalidateQueries({ queryKey: [...docsKeys.all, 'documents', wsId] })
    }
  }, [documentId, queryClient, wsId])

  const members = useMemo((): DocShareMember[] => {
    const list = state.members as DocShareMember[]
    if (!documentAuthorId) return list
    if (list.some((m) => m.role === 'owner' || m.targetId === documentAuthorId)) return list
    return [
      {
        id: `owner-${documentAuthorId}`,
        type: 'user',
        targetId: documentAuthorId,
        name: documentAuthor || 'Owner',
        role: 'owner',
        addedAt: '',
        addedBy: '',
      },
      ...list,
    ]
  }, [documentAuthor, documentAuthorId, state.members])

  const collaborators = useMemo(() => collaboratorCount({ ...state, members }), [members, state])

  const shareWith = useCallback(
    async (target: {
      type: ShareTargetType
      targetId?: string
      email?: string
      name: string
      avatarUrl?: string | null
      role: DocRole
    }) => {
      if (target.type !== 'user') return
      try {
        if (target.targetId) {
          await addShareMemberApi(documentId, { userId: target.targetId, role: target.role })
        } else if (target.email) {
          await addShareMemberApi(documentId, { email: target.email, role: target.role })
        } else {
          return
        }
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const inviteByEmail = useCallback(
    async (email: string, role: DocRole) => {
      try {
        await addShareMemberApi(documentId, { email, role })
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const removeAccess = useCallback(
    async (memberId: string) => {
      try {
        await removeShareMemberApi(documentId, memberId)
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const updatePermission = useCallback(
    async (memberId: string, role: DocRole) => {
      try {
        await updateShareMemberApi(documentId, memberId, role)
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const togglePublic = useCallback(
    async (enabled: boolean) => {
      try {
        await updateShareApi(documentId, { publicEnabled: enabled })
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const togglePrivate = useCallback(
    async (isPrivate: boolean) => {
      try {
        await updateShareApi(documentId, { isPrivate })
        invalidate()
      } catch (err) {
        toast.error(errorMessage(err))
        throw err
      }
    },
    [documentId, invalidate],
  )

  const link = useMemo(() => copyShareLink(state), [state])
  const privateLink = useMemo(() => (documentId ? privateDocLink(documentId) : ''), [documentId])

  return {
    share: state,
    members,
    collaborators,
    shareWith,
    inviteByEmail,
    removeAccess,
    updatePermission,
    togglePublic,
    togglePrivate,
    publicLink: link,
    privateLink,
    isLoading: shareQuery.isLoading,
    isError: shareQuery.isError,
    userName,
  }
}

import { useMemo } from 'react'

import { displayName, useAuthStore } from '../../../stores/auth'
import { resolveUserRole } from '../services/permissions.service'
import { canCommentDoc, canEditDoc, canManageSharing, type DocRole } from '../types/permissions'
import { useSharing } from './useSharing'
import { useDocuments } from './useDocuments'

/** Current user's effective permission on a document. */
export function usePermissions(documentId: string, authorName?: string, authorId?: string) {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const currentUserName = displayName(user)
  const { getDocument } = useDocuments()
  const doc = getDocument(documentId)
  const { share } = useSharing(
    documentId,
    doc?.title ?? '',
    authorName ?? doc?.author,
    authorId ?? doc?.authorId,
  )

  const role = useMemo(() => {
    if (doc?.userRole) return doc.userRole
    if (doc?.authorId && userId && doc.authorId === userId) return 'owner' as DocRole
    return resolveUserRole(share, userId, authorName ?? doc?.author, currentUserName, authorId ?? doc?.authorId)
  }, [authorName, authorId, currentUserName, doc, share, userId])

  return {
    role,
    canEdit: canEditDoc(role),
    canComment: canCommentDoc(role),
    canShare: canManageSharing(role),
    isOwner: role === 'owner',
  }
}

export function usePermissionBadge(role: DocRole) {
  return role
}

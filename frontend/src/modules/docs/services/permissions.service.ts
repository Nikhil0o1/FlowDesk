import type { DocShareState } from '../types/permissions'
import type { DocRole } from '../types/permissions'

/** Resolve the current user's role on a document from share state. */
export function resolveUserRole(
  share: DocShareState | undefined,
  userId: string | undefined,
  authorName?: string,
  currentUserName?: string,
  authorId?: string,
): DocRole {
  if (!userId) return 'viewer'
  const member = share?.members.find((m) => m.type === 'user' && m.targetId === userId)
  if (member) return member.role
  if (authorId && userId && authorId === userId) return 'owner'
  if (authorName && currentUserName && authorName === currentUserName) return 'owner'
  if (share && !share.isPrivate) return 'viewer'
  return 'viewer'
}

export function publicLink(share: DocShareState | undefined): string {
  if (!share?.publicEnabled || !share.publicUrl) return ''
  return share.publicUrl
}

export const ROLE_LABELS: Record<DocRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
}

/** Document access roles (most → least privilege). */
export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer'

export type ShareTargetType = 'user' | 'team' | 'workspace'

export interface DocShareMember {
  id: string
  type: ShareTargetType
  /** User id, team id, or workspace id depending on `type`. */
  targetId: string
  name: string
  email?: string
  avatarUrl?: string | null
  avatarColor?: string | null
  role: DocRole
  addedAt: string
  addedBy: string
}

export interface DocShareState {
  documentId: string
  isPrivate: boolean
  /** Public link sharing (future backend token). */
  publicEnabled: boolean
  publicToken: string | null
  publicUrl: string | null
  members: DocShareMember[]
}

/** Role capability matrix — pure checks used by hooks and UI. */
export const ROLE_RANK: Record<DocRole, number> = {
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
}

export function roleAtLeast(role: DocRole, min: DocRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function canEditDoc(role: DocRole): boolean {
  return roleAtLeast(role, 'editor')
}

export function canCommentDoc(role: DocRole): boolean {
  return roleAtLeast(role, 'commenter')
}

export function canManageSharing(role: DocRole): boolean {
  return role === 'owner'
}

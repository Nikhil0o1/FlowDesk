import { describe, expect, it } from 'vitest'

import { resolveUserRole } from '@/modules/docs/services/permissions.service'
import { canCommentDoc, canEditDoc, canManageSharing } from '@/modules/docs/types/permissions'
import { extractMentionedUserIds } from '@/modules/docs/services/notification.service'
import { topLevelComments, commentCount } from '@/modules/docs/services/comments.service'
import type { DocComment } from '@/modules/docs/types/comment'
import type { DocShareState } from '@/modules/docs/types/permissions'

const share: DocShareState = {
  documentId: 'd1',
  isPrivate: true,
  publicEnabled: false,
  publicToken: null,
  publicUrl: null,
  members: [
    { id: 'm1', type: 'user', targetId: 'u1', name: 'Owner', role: 'owner', addedAt: '', addedBy: '' },
    { id: 'm2', type: 'user', targetId: 'u2', name: 'Editor', role: 'editor', addedAt: '', addedBy: '' },
  ],
}

describe('resolveUserRole', () => {
  it('returns member role or owner for author', () => {
    expect(resolveUserRole(share, 'u2')).toBe('editor')
    expect(resolveUserRole(undefined, 'u9', 'Alex', 'Alex')).toBe('owner')
    expect(resolveUserRole(share, 'u9')).toBe('viewer')
  })
})

describe('role capabilities', () => {
  it('gates edit, comment and share', () => {
    expect(canEditDoc('editor')).toBe(true)
    expect(canEditDoc('commenter')).toBe(false)
    expect(canCommentDoc('commenter')).toBe(true)
    expect(canCommentDoc('viewer')).toBe(false)
    expect(canManageSharing('owner')).toBe(true)
    expect(canManageSharing('editor')).toBe(false)
  })
})

describe('mentions in notifications service', () => {
  it('extracts user ids from markup', () => {
    const body = 'Hi @[Jane](aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)!'
    expect(extractMentionedUserIds(body)).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'])
  })
})

describe('comments service', () => {
  const comments: DocComment[] = [
    {
      id: '1',
      documentId: 'd1',
      authorId: 'a',
      authorName: 'A',
      body: 'top',
      parentId: null,
      inlineAnchor: null,
      resolved: false,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '2',
      documentId: 'd1',
      authorId: 'a',
      authorName: 'A',
      body: 'reply',
      parentId: '1',
      inlineAnchor: null,
      resolved: false,
      createdAt: '',
      updatedAt: '',
    },
  ]
  it('counts and filters threads', () => {
    expect(commentCount(comments, 'd1')).toBe(2)
    expect(topLevelComments(comments, 'd1')).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'

import { assignableOrgMembers } from '@/lib/assignableOrgMembers'
import type { OrgMember } from '@/lib/types'

function member(role: string, userId = 'u1'): OrgMember {
  return {
    id: 'om-1',
    user_id: userId,
    role,
    created_at: '2026-01-01T00:00:00Z',
    user: { id: userId, email: `${userId}@test.dev`, full_name: 'Test', avatar_url: null, avatar_color: null },
  }
}

describe('assignableOrgMembers', () => {
  it('includes regular org members', () => {
    expect(assignableOrgMembers([member('member')])).toHaveLength(1)
  })

  it('excludes org owner and admin', () => {
    const result = assignableOrgMembers([
      member('owner', 'o1'),
      member('admin', 'a1'),
      member('member', 'm1'),
    ])
    expect(result.map((m) => m.user_id)).toEqual(['m1'])
  })
})

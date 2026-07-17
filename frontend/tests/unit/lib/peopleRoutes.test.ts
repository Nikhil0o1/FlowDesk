import { describe, expect, it } from 'vitest'

import {
  memberAccessApiPath,
  peoplePageUrl,
  resolvePeoplePanelScope,
} from '@/lib/peopleRoutes'

describe('peopleRoutes', () => {
  it('builds scoped All People URLs', () => {
    expect(peoplePageUrl('ws-1')).toBe('/app/teams?tab=people&workspace=ws-1')
    expect(peoplePageUrl({ spaceId: 'sp-1' })).toBe('/app/teams?tab=people&space=sp-1')
    expect(peoplePageUrl({ projectId: 'p-1' })).toBe('/app/teams?tab=people&project=p-1')
  })

  it('resolves panel scope from URL params', () => {
    expect(resolvePeoplePanelScope(new URLSearchParams('project=p-1'))).toEqual({
      level: 'project',
      projectId: 'p-1',
    })
    expect(resolvePeoplePanelScope(new URLSearchParams('space=sp-1'))).toEqual({
      level: 'space',
      spaceId: 'sp-1',
    })
    expect(resolvePeoplePanelScope(new URLSearchParams('workspace=ws-1'))).toEqual({
      level: 'workspace',
      workspaceId: 'ws-1',
    })
    expect(resolvePeoplePanelScope(new URLSearchParams('tab=people'))).toEqual({ level: 'org' })
  })

  it('routes member access API paths by scope', () => {
    expect(memberAccessApiPath('org-1', 'u-1', { level: 'org' })).toBe(
      '/organizations/org-1/members/u-1/access',
    )
    expect(memberAccessApiPath('org-1', 'u-1', { level: 'workspace', workspaceId: 'ws-1' })).toBe(
      '/workspaces/ws-1/members/u-1/access',
    )
    expect(memberAccessApiPath('org-1', 'u-1', { level: 'space', spaceId: 'sp-1' })).toBe(
      '/spaces/sp-1/members/u-1/access',
    )
    expect(memberAccessApiPath('org-1', 'u-1', { level: 'project', projectId: 'p-1' })).toBe(
      '/projects/p-1/members/u-1/access',
    )
  })
})

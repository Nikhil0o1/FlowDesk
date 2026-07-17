import { describe, expect, it } from 'vitest'

import {
  actorCanManageProjectScope,
  actorCanManageSpaceScope,
  actorCanManageWorkspaceScope,
  canAccessAnalytics,
  canGrantScopedRole,
  canManageByHierarchy,
  canManagePersonInList,
  rankForProjectRole,
  rankForSpaceRole,
  rankForWorkspaceRole,
  roleRank,
} from '../../../src/lib/roleHierarchy'

describe('roleHierarchy', () => {
  it('orders roles from org owner down to project viewer', () => {
    expect(roleRank('org_owner')).toBeGreaterThan(roleRank('org_admin'))
    expect(roleRank('org_admin')).toBeGreaterThan(roleRank('workspace_admin'))
    expect(roleRank('workspace_admin')).toBeGreaterThan(roleRank('space_admin'))
    expect(roleRank('space_admin')).toBeGreaterThan(roleRank('project_admin'))
    expect(roleRank('project_admin')).toBeGreaterThan(roleRank('project_member'))
    expect(roleRank('project_member')).toBeGreaterThan(roleRank('project_viewer'))
    expect(roleRank('project_viewer')).toBeGreaterThan(roleRank('org_member'))
  })

  it('gates analytics to project admin and above (not plain members)', () => {
    expect(canAccessAnalytics('project_admin')).toBe(true)
    expect(canAccessAnalytics('space_admin')).toBe(true)
    expect(canAccessAnalytics('org_admin')).toBe(true)
    expect(canAccessAnalytics('org_member')).toBe(false)
    expect(canAccessAnalytics('project_member')).toBe(false)
    expect(canAccessAnalytics(null)).toBe(false)
  })

  it('allows higher roles to manage lower roles', () => {
    expect(canManageByHierarchy('org_admin', 'workspace_admin')).toBe(true)
    expect(canManageByHierarchy('workspace_admin', 'space_admin')).toBe(true)
    expect(canManageByHierarchy('project_admin', 'project_member')).toBe(true)
  })

  it('blocks peers and superiors', () => {
    expect(canManageByHierarchy('workspace_admin', 'workspace_admin')).toBe(false)
    expect(canManageByHierarchy('org_admin', 'org_admin')).toBe(false)
    expect(canManageByHierarchy('project_admin', 'space_admin')).toBe(false)
    expect(canManageByHierarchy('org_admin', 'org_owner')).toBe(false)
  })

  it('blocks granting roles at or above actor level', () => {
    expect(canGrantScopedRole('workspace_admin', rankForWorkspaceRole('admin'))).toBe(false)
    expect(canGrantScopedRole('org_admin', rankForWorkspaceRole('admin'))).toBe(true)
  })

  it('canManagePersonInList respects hierarchy on scoped lists', () => {
    expect(
      canManagePersonInList('project_admin', 'u2', 'u1', 'project', 'member'),
    ).toBe(true)
    expect(
      canManagePersonInList('project_admin', 'u2', 'u1', 'project', 'admin'),
    ).toBe(false)
    expect(canManagePersonInList('org_admin', 'u2', 'u1', 'org', 'admin')).toBe(false)
  })

  it('actorCanManageWorkspaceScope limits non-leaders to administered workspaces', () => {
    const wsRoles = [{ workspace_id: 'ws-1', role: 'admin' as const }]
    expect(actorCanManageWorkspaceScope('owner', wsRoles, 'ws-1')).toBe(true)
    expect(actorCanManageWorkspaceScope('member', wsRoles, 'ws-1')).toBe(true)
    expect(actorCanManageWorkspaceScope('member', wsRoles, 'ws-2')).toBe(false)
  })

  it('actorCanManageSpaceScope allows workspace admins over child spaces', () => {
    const wsRoles = [{ workspace_id: 'ws-1', role: 'admin' as const }]
    expect(actorCanManageSpaceScope('member', wsRoles, [], 'sp-1', 'ws-1')).toBe(true)
    expect(actorCanManageSpaceScope('member', [], [{ space_id: 'sp-2', role: 'admin' }], 'sp-2', 'ws-1')).toBe(
      true,
    )
    expect(actorCanManageSpaceScope('member', [], [], 'sp-3', 'ws-1')).toBe(false)
  })

  it('maps space roles for member access controls', () => {
    expect(rankForSpaceRole('admin')).toBe(roleRank('space_admin'))
    expect(rankForSpaceRole('member')).toBe(roleRank('org_member'))
    expect(rankForProjectRole('admin')).toBe(roleRank('project_admin'))
    expect(rankForProjectRole('member')).toBe(roleRank('project_member'))
    expect(canManagePersonInList('space_admin', 'u2', 'u1', 'space', 'member')).toBe(true)
    expect(canManagePersonInList('space_admin', 'u2', 'u1', 'space', 'admin')).toBe(false)
  })

  it('actorCanManageProjectScope allows space and project admins in their scope', () => {
    expect(
      actorCanManageProjectScope(
        'member',
        [],
        [{ space_id: 'sp-1', role: 'admin' }],
        [],
        'pr-1',
        'ws-1',
        'sp-1',
      ),
    ).toBe(true)
    expect(
      actorCanManageProjectScope(
        'member',
        [],
        [],
        [{ project_id: 'pr-2', role: 'admin' }],
        'pr-2',
        'ws-1',
        null,
      ),
    ).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import {
  canAccessGoals,
  canAccessGoalsSection,
  canCreateGoal,
  canCreateProject,
  canCreateSpace,
  canCreateTeam,
  canDeleteTeam,
  canManageGoal,
  canViewAllGoals,
  canViewGoal,
  creatableSpaces,
  isWorkspaceAdmin,
} from '@/lib/createAccess'

describe('createAccess', () => {
  it('lets space admins create projects in their spaces', () => {
    expect(
      canCreateProject(
        { my_role: 'member' },
        { my_role: 'member' },
        [{ id: 'sp1', my_role: 'admin', workspace_id: 'ws1', name: 'Sample Space' }],
      ),
    ).toBe(true)
  })

  it('limits creatable spaces for space-only admins', () => {
    const spaces = [
      { id: 'sp1', my_role: 'admin', workspace_id: 'ws1', name: 'Mine' },
      { id: 'sp2', my_role: 'member', workspace_id: 'ws1', name: 'Other' },
    ]
    expect(creatableSpaces({ my_role: 'member' }, { my_role: 'member' }, spaces)).toHaveLength(1)
    expect(creatableSpaces({ my_role: 'admin' }, { my_role: 'member' }, spaces)).toHaveLength(2)
  })

  it('blocks space creation for space-only admins', () => {
    expect(canCreateSpace({ my_role: 'member' }, { my_role: 'member' })).toBe(false)
    expect(isWorkspaceAdmin({ my_role: 'member' }, { my_role: 'admin' })).toBe(true)
  })

  it('lets space and project admins create teams in their workspace', () => {
    expect(
      canCreateTeam(
        { my_role: 'member' },
        { my_role: 'member' },
        {
          highest_role: 'space_admin',
          workspace_roles: [],
          space_roles: [
            {
              space_id: 'sp1',
              space_name: 'Mine',
              workspace_id: 'ws1',
              workspace_name: 'WS',
              role: 'admin',
            },
          ],
          project_roles: [],
        },
        'ws1',
      ),
    ).toBe(true)
    expect(
      canCreateTeam(
        { my_role: 'member' },
        { my_role: 'member' },
        {
          highest_role: 'project_admin',
          workspace_roles: [],
          space_roles: [],
          project_roles: [
            {
              project_id: 'p1',
              project_name: 'App',
              space_name: 'Mine',
              workspace_id: 'ws1',
              role: 'admin',
            },
          ],
        },
        'ws1',
      ),
    ).toBe(true)
    expect(
      canCreateTeam(
        { my_role: 'member' },
        { my_role: 'member' },
        {
          highest_role: 'project_admin',
          workspace_roles: [],
          space_roles: [],
          project_roles: [
            {
              project_id: 'p1',
              project_name: 'App',
              space_name: 'Mine',
              workspace_id: 'ws2',
              role: 'admin',
            },
          ],
        },
        'ws1',
      ),
    ).toBe(false)
  })

  it('lets org and workspace admins delete teams without api flag', () => {
    expect(canDeleteTeam({ my_role: 'admin' }, { my_role: 'member' }, false)).toBe(true)
    expect(canDeleteTeam({ my_role: 'owner' }, { my_role: 'member' }, false)).toBe(true)
    expect(canDeleteTeam({ my_role: 'member' }, { my_role: 'admin' }, false)).toBe(true)
    expect(canDeleteTeam({ my_role: 'member' }, { my_role: 'member' }, false)).toBe(false)
    expect(canDeleteTeam({ my_role: 'member' }, { my_role: 'member' }, true)).toBe(true)
  })

  it('gates goals section and create goal like team create', () => {
    const roles = {
      highest_role: 'space_admin' as const,
      workspace_roles: [],
      space_roles: [
        {
          space_id: 'sp1',
          space_name: 'Mine',
          workspace_id: 'ws1',
          workspace_name: 'WS',
          role: 'admin' as const,
        },
      ],
      project_roles: [],
    }
    expect(canAccessGoalsSection({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, roles)).toBe(true)
    expect(canCreateGoal({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, roles)).toBe(true)
    expect(canAccessGoalsSection({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, null)).toBe(false)
    expect(canViewAllGoals({ my_role: 'admin' })).toBe(true)
    expect(canViewAllGoals({ my_role: 'member' })).toBe(false)
  })

  it('does not grant Goals access from Personal List project admin alone', () => {
    const personalOnly = {
      highest_role: 'org_member' as const,
      workspace_roles: [],
      space_roles: [],
      project_roles: [
        {
          project_id: 'pl1',
          project_name: 'Personal List',
          space_name: null,
          workspace_id: 'ws1',
          role: 'admin',
          is_personal: true,
        },
      ],
    }
    expect(
      canAccessGoalsSection({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, personalOnly),
    ).toBe(false)
    expect(canCreateGoal({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, personalOnly)).toBe(
      false,
    )

    const realProjectAdmin = {
      ...personalOnly,
      highest_role: 'project_admin' as const,
      project_roles: [
        ...personalOnly.project_roles,
        {
          project_id: 'p1',
          project_name: 'App',
          space_name: 'Mine',
          workspace_id: 'ws1',
          role: 'admin',
          is_personal: false,
        },
      ],
    }
    expect(
      canAccessGoalsSection({ my_role: 'member' }, { my_role: 'member', id: 'ws1' }, realProjectAdmin),
    ).toBe(true)
  })

  it('lets owners and co-owners view and manage goals', () => {
    const goal = {
      owner_id: 'u1',
      created_by: 'u2',
      owners: [{ id: 'u3', full_name: 'Co', email: 'co@example.com' }],
    }
    expect(canViewGoal(goal, 'u3', { my_role: 'member' })).toBe(true)
    expect(canViewGoal(goal, 'u9', { my_role: 'member' })).toBe(false)
    expect(canViewGoal(goal, undefined, { my_role: 'member' })).toBe(false)
    expect(canViewGoal(goal, 'u9', { my_role: 'admin' })).toBe(true)
    expect(canManageGoal(goal, 'u1', { my_role: 'member' }, { my_role: 'member', id: 'ws1' }, null)).toBe(true)
    expect(canManageGoal(goal, 'u3', { my_role: 'member' }, { my_role: 'member', id: 'ws1' }, null)).toBe(true)
    expect(canManageGoal(goal, 'u9', { my_role: 'member' }, { my_role: 'admin', id: 'ws1' }, null)).toBe(true)
    expect(canManageGoal(goal, 'u9', { my_role: 'member' }, { my_role: 'member', id: 'ws1' }, null)).toBe(false)
  })

  it('combines section access with shared goal access from API', () => {
    expect(canAccessGoals(true, { can_access: false })).toBe(true)
    expect(canAccessGoals(false, { can_access: true })).toBe(true)
    expect(canAccessGoals(false, { can_access: false })).toBe(false)
    expect(canAccessGoals(false, null)).toBe(false)
    expect(canAccessGoals(false, undefined)).toBe(false)
  })
})

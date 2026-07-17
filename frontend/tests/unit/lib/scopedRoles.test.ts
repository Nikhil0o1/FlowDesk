import { describe, expect, it } from 'vitest'

import {
  adminProjectRoles,
  adminSpaceRoles,
  adminWorkspaceRoles,
  dashboardViewsForWorkspace,
  formatScopeList,
  isImplicitOrgWorkspaceMember,
  isOrgLeader,
  isOrgWorkspaceDrillDownPath,
  isProjectMemberDashboardRole,
  memberProjectRoles,
  orgLeaderHidesWorkspaceSwitcher,
  pickProjectAdminScope,
  pickProjectMemberScope,
  pickSpaceAdminScope,
  pickWorkspaceAdminScope,
  profileRoleDisplay,
} from '@/lib/scopedRoles'
import type { UserRoleSummary } from '@/lib/types'

const baseRoles: UserRoleSummary = {
  highest_role: 'workspace_admin',
  org_role: 'member',
  org_name: 'Acme',
  workspace_roles: [
    { workspace_id: 'ws-1', workspace_name: 'Alpha', role: 'admin' },
    { workspace_id: 'ws-2', workspace_name: 'Beta', role: 'admin' },
  ],
  space_roles: [{ space_id: 'sp-1', space_name: 'Ops', workspace_id: 'ws-1', workspace_name: 'Alpha', role: 'admin' }],
  project_roles: [{ project_id: 'p-1', project_name: 'Phoenix', workspace_id: 'ws-1', role: 'admin' }],
}

describe('scopedRoles', () => {
  it('detects org leaders and workspace switcher paths', () => {
    expect(isOrgLeader({ my_role: 'owner' })).toBe(true)
    expect(isOrgLeader({ my_role: 'member' })).toBe(false)
    expect(isImplicitOrgWorkspaceMember('owner')).toBe(true)
    expect(isImplicitOrgWorkspaceMember('org_admin')).toBe(true)
    expect(isImplicitOrgWorkspaceMember('admin')).toBe(false)
    expect(orgLeaderHidesWorkspaceSwitcher('/app/dashboard')).toBe(true)
    expect(orgLeaderHidesWorkspaceSwitcher('/app/workspaces/ws-1')).toBe(false)
    expect(isOrgWorkspaceDrillDownPath('/app/workspaces/ws-1')).toBe(true)
  })

  it('filters admin scopes and formats lists', () => {
    expect(adminWorkspaceRoles(baseRoles)).toHaveLength(2)
    expect(adminSpaceRoles(baseRoles)).toHaveLength(1)
    expect(adminProjectRoles(baseRoles)).toHaveLength(1)
    expect(formatScopeList(['A', 'B', 'C', 'D'])).toBe('A, B, C +1 more')
  })

  it('excludes Personal List from admin project roles', () => {
    const roles: UserRoleSummary = {
      ...baseRoles,
      highest_role: 'org_member',
      workspace_roles: [],
      space_roles: [],
      project_roles: [
        {
          project_id: 'pl-1',
          project_name: 'Personal List',
          workspace_id: 'ws-1',
          role: 'admin',
          is_personal: true,
        },
        {
          project_id: 'p-1',
          project_name: 'Phoenix',
          workspace_id: 'ws-1',
          role: 'admin',
          is_personal: false,
        },
      ],
    }
    expect(adminProjectRoles(roles)).toHaveLength(1)
    expect(adminProjectRoles(roles)[0]?.project_id).toBe('p-1')
  })

  it('builds profile role display for multi-scope admins', () => {
    expect(profileRoleDisplay({ ...baseRoles, org_role: 'owner' }).title).toBe('Organization Owner')
    expect(profileRoleDisplay({ ...baseRoles, org_role: 'admin' }).title).toBe('Organization Admin')
    expect(profileRoleDisplay({ ...baseRoles, org_role: 'member', workspace_roles: [], space_roles: [], project_roles: [], highest_role: 'org_member' }).title).toBe('Organization Member')
    expect(profileRoleDisplay(baseRoles).title).toBe('Workspace Admin · 2 workspaces')
    expect(profileRoleDisplay({ ...baseRoles, highest_role: 'space_admin' }).title).toBe('Space Admin')
    expect(profileRoleDisplay({ ...baseRoles, highest_role: 'project_admin' }).title).toBe('Project Admin')
    expect(
      profileRoleDisplay({
        ...baseRoles,
        highest_role: 'project_member',
        workspace_roles: [],
        space_roles: [],
        project_roles: [
          { project_id: 'p-2', project_name: 'Atlas', workspace_id: 'ws-1', role: 'member' },
        ],
      }).title,
    ).toBe('Project Member')
    expect(profileRoleDisplay(undefined).title).toBe('Member')
  })

  it('profile role line shows member projects alongside project admin', () => {
    const roles: UserRoleSummary = {
      highest_role: 'project_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [],
      space_roles: [],
      project_roles: [
        { project_id: 'p-x', project_name: 'X', space_id: 's1', space_name: 'S', workspace_id: 'ws-a', role: 'admin' },
        { project_id: 'p-y', project_name: 'Y', space_id: 's1', space_name: 'S', workspace_id: 'ws-a', role: 'member' },
      ],
    }
    const display = profileRoleDisplay(roles)
    expect(display.title).toBe('Project Admin + Member')
    expect(display.detail).toBe('Admin: X · Member: Y')
  })

  it('member roles subsumed by an admin space are not repeated in the profile line', () => {
    const roles: UserRoleSummary = {
      highest_role: 'space_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [],
      space_roles: [{ space_id: 's1', space_name: 'S1', workspace_id: 'ws-a', workspace_name: 'A', role: 'admin' }],
      project_roles: [
        { project_id: 'p-in', project_name: 'In', space_id: 's1', space_name: 'S1', workspace_id: 'ws-a', role: 'member' },
        { project_id: 'p-out', project_name: 'Out', space_id: 's2', space_name: 'S2', workspace_id: 'ws-a', role: 'member' },
      ],
    }
    const display = profileRoleDisplay(roles)
    expect(display.title).toBe('Space Admin')
    expect(display.detail).toBe('S1 (A) · Member: Out')
  })

  it('picks preferred admin and member scope ids', () => {
    expect(pickWorkspaceAdminScope(baseRoles.workspace_roles, 'ws-2', null)).toBe('ws-2')
    expect(pickSpaceAdminScope(baseRoles.space_roles, null)).toBe('sp-1')
    expect(pickProjectAdminScope(baseRoles.project_roles, 'p-1')).toBe('p-1')
    const memberRoles = [
      { project_id: 'p-2', project_name: 'Atlas', workspace_id: 'ws-2', role: 'member' as const },
      { project_id: 'p-3', project_name: 'Beta', workspace_id: 'ws-1', role: 'viewer' as const },
    ]
    expect(memberProjectRoles({ ...baseRoles, project_roles: memberRoles })).toHaveLength(2)
    expect(pickProjectMemberScope(memberRoles, 'ws-1', null)).toBe('p-3')
    expect(pickProjectMemberScope(memberRoles, 'ws-2', 'p-2')).toBe('p-2')
  })

  it('org leader always gets the single org dashboard regardless of workspace', () => {
    const owner: UserRoleSummary = { ...baseRoles, org_role: 'owner', highest_role: 'org_owner' }
    const views = dashboardViewsForWorkspace(owner, 'ws-1')
    expect(views).toHaveLength(1)
    expect(views[0].kind).toBe('org_owner')
    expect(dashboardViewsForWorkspace({ ...baseRoles, org_role: 'admin' }, 'ws-2')[0].kind).toBe('org_admin')
  })

  it('project member sees only their project dashboard, scoped to the current workspace', () => {
    const roles: UserRoleSummary = {
      highest_role: 'project_member',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [],
      space_roles: [],
      project_roles: [{ project_id: 'p-x', project_name: 'X', space_name: 'S', workspace_id: 'ws-a', role: 'member' }],
    }
    const inA = dashboardViewsForWorkspace(roles, 'ws-a')
    expect(inA).toHaveLength(1)
    expect(inA[0].kind).toBe('project_member')
    expect(inA[0].scopeId).toBe('p-x')
    // No dashboard in a workspace they don't belong to.
    expect(dashboardViewsForWorkspace(roles, 'ws-other')).toHaveLength(0)
  })

  it('project admin of X + member of Y in one workspace yields both views, admin first', () => {
    const roles: UserRoleSummary = {
      highest_role: 'project_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [],
      space_roles: [],
      project_roles: [
        { project_id: 'p-x', project_name: 'X', space_name: 'S', workspace_id: 'ws-a', role: 'admin' },
        { project_id: 'p-y', project_name: 'Y', space_name: 'S', workspace_id: 'ws-a', role: 'member' },
      ],
    }
    const views = dashboardViewsForWorkspace(roles, 'ws-a')
    expect(views.map((v) => v.kind)).toEqual(['project_admin', 'project_member'])
    expect(views[0].scopeId).toBe('p-x')
    expect(views[1].scopeId).toBe('p-y')
  })

  it('workspace admin in A + project member in B switches dashboard by workspace', () => {
    const roles: UserRoleSummary = {
      highest_role: 'workspace_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [{ workspace_id: 'ws-a', workspace_name: 'A', role: 'admin' }],
      space_roles: [],
      project_roles: [{ project_id: 'p-y', project_name: 'Y', space_name: 'S', workspace_id: 'ws-b', role: 'member' }],
    }
    const inA = dashboardViewsForWorkspace(roles, 'ws-a')
    expect(inA).toHaveLength(1)
    expect(inA[0].kind).toBe('workspace_admin')
    const inB = dashboardViewsForWorkspace(roles, 'ws-b')
    expect(inB).toHaveLength(1)
    expect(inB[0].kind).toBe('project_member')
    expect(inB[0].scopeId).toBe('p-y')
  })

  it('workspace admin subsumes lower roles in that workspace — single view, no switcher', () => {
    const roles: UserRoleSummary = {
      highest_role: 'workspace_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [{ workspace_id: 'ws-a', workspace_name: 'A', role: 'admin' }],
      space_roles: [],
      project_roles: [
        { project_id: 'p-x', project_name: 'X', space_id: 's1', space_name: 'S1', workspace_id: 'ws-a', role: 'admin' },
        { project_id: 'p-y', project_name: 'Y', space_id: 's2', space_name: 'S2', workspace_id: 'ws-a', role: 'member' },
      ],
    }
    const views = dashboardViewsForWorkspace(roles, 'ws-a')
    expect(views).toHaveLength(1)
    expect(views[0].kind).toBe('workspace_admin')
  })

  it('space admin subsumes projects in its own space but keeps projects in other spaces', () => {
    const roles: UserRoleSummary = {
      highest_role: 'space_admin',
      org_role: 'member',
      org_name: 'Acme',
      workspace_roles: [],
      space_roles: [{ space_id: 's1', space_name: 'S1', workspace_id: 'ws-a', workspace_name: 'A', role: 'admin' }],
      project_roles: [
        { project_id: 'p-in', project_name: 'In', space_id: 's1', space_name: 'S1', workspace_id: 'ws-a', role: 'admin' },
        { project_id: 'p-out', project_name: 'Out', space_id: 's2', space_name: 'S2', workspace_id: 'ws-a', role: 'member' },
      ],
    }
    const views = dashboardViewsForWorkspace(roles, 'ws-a')
    expect(views.map((v) => v.kind)).toEqual(['space_admin', 'project_member'])
    expect(views.find((v) => v.scopeId === 'p-in')).toBeUndefined()
    expect(views.find((v) => v.scopeId === 'p-out')).toBeTruthy()
  })

  it('detects project member dashboard roles and viewer profile label', () => {
    expect(isProjectMemberDashboardRole('project_member')).toBe(true)
    expect(isProjectMemberDashboardRole('project_viewer')).toBe(true)
    expect(isProjectMemberDashboardRole('project_admin')).toBe(false)
    expect(
      profileRoleDisplay({
        ...baseRoles,
        highest_role: 'project_viewer',
        workspace_roles: [],
        space_roles: [],
        project_roles: [
          { project_id: 'p-2', project_name: 'Atlas', workspace_id: 'ws-1', role: 'viewer' },
        ],
      }).title,
    ).toBe('Project Viewer')
  })
})

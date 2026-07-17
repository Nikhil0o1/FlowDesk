import { describe, expect, it } from 'vitest'

import {
  INVITE_ROLES,
  SPACE_INVITE_ROLES,
  canInviteAnyone,
  canInviteToProject,
  canInviteToWorkspace,
  defaultRoleForScope,
  buildOrgBulkGrants,
  formatSpaceInviteRoleLabel,
  formatWorkspaceAdminTopRoleLabel,
  inviteableProjects,
  inviteableWorkspaces,
  inviteableWorkspacesForScope,
  isSpaceInviteProjectRole,
  normalizeRoleForScope,
  projectLabel,
  resolveInviteScope,
  usesWorkspaceAdminInviteFlow,
  WORKSPACE_ADMIN_TOP_ROLES,
  workspaceLabel,
} from '@/components/invites/inviteScopes'
import type { Project, Workspace } from '@/lib/types'

function workspace(partial: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    organization_id: 'org-1',
    name: 'Main',
    description: null,
    color: '#000',
    icon: null,
    is_archived: false,
    my_role: 'member',
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function project(partial: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    space_id: 'space-1',
    workspace_id: 'ws-1',
    name: 'Alpha',
    description: null,
    color: '#000',
    icon: null,
    position: 0,
    is_archived: false,
    my_role: 'member',
    created_at: '2026-01-01T00:00:00Z',
    task_count: null,
    done_task_count: null,
    ...partial,
  }
}

describe('INVITE_ROLES / defaultRoleForScope', () => {
  it('returns the first allowed role per scope', () => {
    expect(defaultRoleForScope('organization')).toBe(INVITE_ROLES.organization[0])
    expect(defaultRoleForScope('workspace')).toBe('admin')
    expect(defaultRoleForScope('space')).toBe('space_admin')
    expect(defaultRoleForScope('project')).toBe('member')
  })

  it('exposes space invite roles', () => {
    expect(SPACE_INVITE_ROLES).toEqual([
      'space_admin',
      'project_admin',
      'project_member',
      'project_viewer',
    ])
    expect(formatSpaceInviteRoleLabel('project_admin')).toBe('Project Admin')
    expect(formatSpaceInviteRoleLabel('project_viewer')).toBe('Project Viewer')
    expect(isSpaceInviteProjectRole('project_member')).toBe(true)
    expect(isSpaceInviteProjectRole('project_viewer')).toBe(true)
    expect(isSpaceInviteProjectRole('space_admin')).toBe(false)
  })
})

describe('normalizeRoleForScope', () => {
  it('keeps allowed roles', () => {
    expect(normalizeRoleForScope('project', 'viewer')).toBe('viewer')
  })

  it('falls back to default when role is invalid', () => {
    expect(normalizeRoleForScope('workspace', 'owner')).toBe('admin')
    expect(normalizeRoleForScope('workspace', 'member')).toBe('admin')
  })
})

describe('inviteableWorkspaces', () => {
  it('returns all workspaces for org owners', () => {
    const workspaces = [workspace({ id: 'a' }), workspace({ id: 'b', my_role: 'member' })]
    expect(inviteableWorkspaces(workspaces, true)).toEqual(workspaces)
  })

  it('filters to admin workspaces for non-owners', () => {
    const workspaces = [
      workspace({ id: 'a', my_role: 'admin' }),
      workspace({ id: 'b', my_role: 'member' }),
      workspace({ id: 'c', my_role: 'owner' }),
    ]
    expect(inviteableWorkspaces(workspaces, false).map((w) => w.id)).toEqual(['a', 'c'])
  })
})

describe('inviteableWorkspacesForScope', () => {
  it('includes workspaces where user is project admin for project scope', () => {
    const workspaces = [
      workspace({ id: 'ws-1', my_role: 'member' }),
      workspace({ id: 'ws-2', my_role: 'member' }),
    ]
    const projects = [
      project({ id: 'p1', workspace_id: 'ws-2', my_explicit_role: 'admin' }),
      project({ id: 'p2', workspace_id: 'ws-1', my_explicit_role: 'member' }),
    ]
    expect(inviteableWorkspacesForScope('project', workspaces, projects, false).map((w) => w.id)).toEqual(
      ['ws-2'],
    )
  })

  it('does not include member-only workspaces for workspace scope', () => {
    const workspaces = [workspace({ id: 'ws-1', my_role: 'member' })]
    const projects = [project({ workspace_id: 'ws-1', my_explicit_role: 'admin' })]
    expect(inviteableWorkspacesForScope('workspace', workspaces, projects, false)).toEqual([])
  })
})

describe('canInviteAnyone / resolveInviteScope', () => {
  it('allows project-only admins to invite', () => {
    const workspaces = [workspace({ my_role: 'member' })]
    const projects = [project({ my_explicit_role: 'admin' })]
    expect(canInviteAnyone(null, workspaces, [], projects)).toBe(true)
    expect(canInviteToWorkspace(workspaces, false)).toBe(false)
    expect(canInviteToProject(projects)).toBe(true)
    expect(resolveInviteScope('workspace', false, workspaces, [], projects)).toBe('project')
  })

  it('prefers space scope when user is workspace admin without org leadership', () => {
    const workspaces = [workspace({ my_role: 'admin' })]
    expect(resolveInviteScope('workspace', false, workspaces, [], [])).toBe('space')
  })

  it('detects workspace-admin guided invite flow', () => {
    expect(usesWorkspaceAdminInviteFlow(false, [workspace({ my_role: 'admin' })])).toBe(true)
    expect(usesWorkspaceAdminInviteFlow(true, [workspace({ my_role: 'admin' })])).toBe(false)
    expect(usesWorkspaceAdminInviteFlow(false, [workspace({ my_role: 'member' })])).toBe(false)
  })
})

describe('inviteableProjects', () => {
  const projects = [
    project({ id: 'p1', my_explicit_role: 'admin' }),
    project({ id: 'p2', my_explicit_role: 'member' }),
  ]

  it('returns all projects for org owners', () => {
    expect(inviteableProjects(projects, workspace(), true)).toEqual(projects)
  })

  it('returns all projects for workspace admins', () => {
    expect(inviteableProjects(projects, workspace({ my_role: 'admin' }), false)).toEqual(projects)
  })

  it('filters to project admins otherwise', () => {
    expect(inviteableProjects(projects, workspace(), false).map((p) => p.id)).toEqual(['p1'])
  })

  it('includes all projects in a space for space admins', () => {
    const spaces = [
      { id: 'space-1', workspace_id: 'ws-1', name: 'General', color: '#000', my_role: 'admin' },
    ] as import('@/lib/types').Space[]
    const spaceProjects = [
      project({ id: 'p1', space_id: 'space-1', my_explicit_role: 'member' }),
      project({ id: 'p2', space_id: 'space-1', my_explicit_role: 'member' }),
      project({ id: 'p3', space_id: 'space-2', my_explicit_role: 'admin' }),
    ]
    const result = inviteableProjects(spaceProjects, workspace(), false, {
      spaceId: 'space-1',
      spaces,
    })
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('buildOrgBulkGrants', () => {
  it('maps workspace, space, and project selections to API grants', () => {
    expect(
      buildOrgBulkGrants('workspace', 'member', ['ws-1', 'ws-2'], [], []),
    ).toEqual([
      { scope: 'workspace', role: 'member', workspace_id: 'ws-1' },
      { scope: 'workspace', role: 'member', workspace_id: 'ws-2' },
    ])
    expect(buildOrgBulkGrants('space', 'space_admin', [], ['sp-1'], [])).toEqual([
      { scope: 'space', role: 'admin', space_id: 'sp-1' },
    ])
    expect(buildOrgBulkGrants('space', 'project_viewer', [], [], ['p-1', 'p-2'])).toEqual([
      { scope: 'project', role: 'viewer', project_id: 'p-1' },
      { scope: 'project', role: 'viewer', project_id: 'p-2' },
    ])
    expect(buildOrgBulkGrants('project', 'admin', [], [], ['p-9'])).toEqual([
      { scope: 'project', role: 'admin', project_id: 'p-9' },
    ])
  })
})

describe('workspace admin invite roles', () => {
  it('includes viewer beside admin and member', () => {
    expect(WORKSPACE_ADMIN_TOP_ROLES).toEqual(['admin', 'member', 'viewer'])
    expect(formatWorkspaceAdminTopRoleLabel('viewer')).toBe('Viewer')
    expect(formatWorkspaceAdminTopRoleLabel('member')).toBe('Member')
  })
})

describe('workspaceLabel / projectLabel', () => {
  it('appends archived suffix', () => {
    expect(workspaceLabel(workspace({ name: 'Old', is_archived: true }))).toBe('Old (archived)')
    expect(projectLabel(project({ name: 'Beta', is_archived: true }))).toBe('Beta (archived)')
  })

  it('returns plain names when not archived', () => {
    expect(workspaceLabel(workspace({ name: 'Main' }))).toBe('Main')
    expect(projectLabel(project({ name: 'Alpha' }))).toBe('Alpha')
  })
})

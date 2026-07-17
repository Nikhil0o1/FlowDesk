import { describe, expect, it } from 'vitest'

import { canEditProjectTasks, canManageProjectSettings, canManageSpaceSettings, hasInheritedProjectAdmin, projectRoleLabel } from '@/lib/projectAccess'

describe('projectAccess', () => {
  it('returns empty label when role is missing', () => {
    expect(projectRoleLabel({ my_role: null, my_explicit_role: null })).toBe('')
  })

  it('labels inherited org admin access', () => {
    expect(
      projectRoleLabel(
        { my_role: 'admin', my_explicit_role: null },
        { orgRole: 'owner' },
      ),
    ).toBe('Admin · org')
  })

  it('labels inherited workspace admin access', () => {
    expect(
      projectRoleLabel(
        { my_role: 'admin', my_explicit_role: null },
        { workspace: { my_role: 'owner' } },
      ),
    ).toBe('Admin · workspace')
  })

  it('labels inherited space admin access', () => {
    expect(
      projectRoleLabel(
        { my_role: 'admin', my_explicit_role: null },
        { space: { my_role: 'admin' }, workspace: { my_role: 'member' } },
      ),
    ).toBe('Admin · space')
  })

  it('falls back to inherited admin when no scope matches', () => {
    expect(
      projectRoleLabel({ my_role: 'admin', my_explicit_role: null }, {}),
    ).toBe('Admin · inherited')
  })

  it('keeps explicit member role label', () => {
    expect(
      projectRoleLabel(
        { my_role: 'admin', my_explicit_role: 'admin' },
        { space: { my_role: 'admin' } },
      ),
    ).toBe('admin')
  })

  it('returns plain role for non-admin members', () => {
    expect(projectRoleLabel({ my_role: 'member', my_explicit_role: 'member' })).toBe('member')
  })

  it('detects inherited project admin', () => {
    expect(hasInheritedProjectAdmin({ my_role: 'admin', my_explicit_role: null })).toBe(true)
    expect(hasInheritedProjectAdmin({ my_role: 'admin', my_explicit_role: 'admin' })).toBe(false)
  })

  it('canEditProjectTasks allows editors and blocks viewers', () => {
    expect(canEditProjectTasks('member')).toBe(true)
    expect(canEditProjectTasks('admin')).toBe(true)
    expect(canEditProjectTasks('viewer')).toBe(false)
    expect(canEditProjectTasks(null)).toBe(false)
  })

  it('canManageProjectSettings allows project admins but not members or viewers', () => {
    const project = { id: 'p1', space_id: 's1', my_role: 'admin' as const }
    expect(canManageProjectSettings(project)).toBe(true)
    expect(canManageProjectSettings({ ...project, my_role: 'member' })).toBe(false)
    expect(canManageProjectSettings({ ...project, my_role: 'viewer' })).toBe(false)
    expect(
      canManageProjectSettings(
        { id: 'p2', space_id: 's1', my_role: 'member' },
        { adminProjectIds: ['p2'] },
      ),
    ).toBe(true)
  })

  it('canManageSpaceSettings allows space admins but not plain members', () => {
    expect(canManageSpaceSettings({ id: 's1', my_role: 'admin' })).toBe(true)
    expect(canManageSpaceSettings({ id: 's1', my_role: 'member' })).toBe(false)
    expect(canManageSpaceSettings({ id: 's2', my_role: null }, { adminSpaceIds: ['s2'] })).toBe(true)
  })
})

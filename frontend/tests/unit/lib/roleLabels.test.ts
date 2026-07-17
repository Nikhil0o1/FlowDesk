import { describe, expect, it } from 'vitest'

import { formatRoleLabel, formatScopedRole } from '@/lib/roleLabels'

describe('roleLabels', () => {
  it('formatRoleLabel returns known labels and fallbacks', () => {
    expect(formatRoleLabel('project_admin')).toBe('Project Admin')
    expect(formatRoleLabel('custom_role')).toBe('Custom Role')
    expect(formatRoleLabel(null)).toBe('No access')
    expect(formatRoleLabel(undefined)).toBe('No access')
  })

  it('formatScopedRole maps workspace, space, and project roles', () => {
    expect(formatScopedRole('workspace', 'owner')).toBe('Organization Owner')
    expect(formatScopedRole('workspace', 'org_admin')).toBe('Organization Admin')
    expect(formatScopedRole('workspace', 'admin')).toBe('Workspace Admin')
    expect(formatScopedRole('workspace', 'member')).toBe('Workspace Member')
    expect(formatScopedRole('space', 'admin')).toBe('Space Admin')
    expect(formatScopedRole('space', 'member')).toBe('Space Member')
    expect(formatScopedRole('project', 'admin')).toBe('Project Admin')
    expect(formatScopedRole('project', 'viewer')).toBe('Project Viewer')
    expect(formatScopedRole('project', 'member')).toBe('Project Member')
  })
})

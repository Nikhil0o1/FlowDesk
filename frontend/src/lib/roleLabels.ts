export const ROLE_LABELS: Record<string, string> = {
  owner: 'Organization Owner',
  admin: 'Organization Admin',
  member: 'Organization Member',
  org_owner: 'Organization Owner',
  org_admin: 'Organization Admin',
  org_member: 'Organization Member',
  workspace_admin: 'Workspace Admin',
  workspace_member: 'Workspace Member',
  space_admin: 'Space Admin',
  space_member: 'Space Member',
  project_admin: 'Project Admin',
  project_member: 'Project Member',
  project_viewer: 'Project Viewer',
  viewer: 'Project Viewer',
}

export function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return 'No access'
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatScopedRole(scope: 'workspace' | 'space' | 'project', role: string): string {
  if (scope === 'workspace') {
    if (role === 'owner') return 'Organization Owner'
    if (role === 'org_admin') return 'Organization Admin'
    if (role === 'admin') return 'Workspace Admin'
    return 'Workspace Member'
  }
  if (scope === 'space') {
    if (role === 'admin') return 'Space Admin'
    return 'Space Member'
  }
  if (role === 'admin') return 'Project Admin'
  if (role === 'viewer') return 'Project Viewer'
  return 'Project Member'
}

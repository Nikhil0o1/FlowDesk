import type { Project, Space, Workspace } from './types'

/** Human-readable project role when effective access differs from explicit membership. */
export function projectRoleLabel(
  project: Pick<Project, 'my_role' | 'my_explicit_role'>,
  ctx?: {
    space?: Pick<Space, 'my_role'> | null
    workspace?: Pick<Workspace, 'my_role'> | null
    orgRole?: string | null
  },
): string {
  const role = project.my_role
  if (!role) return ''
  if (role !== 'admin' || project.my_explicit_role) {
    return role
  }
  if (ctx?.orgRole === 'owner' || ctx?.orgRole === 'admin') return 'Admin · org'
  if (ctx?.workspace?.my_role === 'admin' || ctx?.workspace?.my_role === 'owner') {
    return 'Admin · workspace'
  }
  if (ctx?.space?.my_role === 'admin' || ctx?.space?.my_role === 'owner') {
    return 'Admin · space'
  }
  return 'Admin · inherited'
}

/** True when the user has project admin powers via space/workspace/org, not a ProjectMember row. */
export function hasInheritedProjectAdmin(
  project: Pick<Project, 'my_role' | 'my_explicit_role'>,
): boolean {
  return project.my_role === 'admin' && !project.my_explicit_role
}

/** Project viewers and unknown roles cannot create or edit tasks. */
export function canEditProjectTasks(role: string | null | undefined): boolean {
  return role != null && role !== 'viewer'
}

type ScopeAdminOptions = {
  orgLeader?: boolean
  workspaceAdmin?: boolean
  adminProjectIds?: Iterable<string>
  adminSpaceIds?: Iterable<string>
}

/** Sidebar / settings menus: project admin and above; not member or viewer. */
export function canManageProjectSettings(
  project: Pick<Project, 'id' | 'space_id' | 'my_role'>,
  options: ScopeAdminOptions = {},
): boolean {
  if (options.orgLeader || options.workspaceAdmin) return true
  if (project.my_role === 'admin') return true
  const adminProjects = new Set(options.adminProjectIds ?? [])
  const adminSpaces = new Set(options.adminSpaceIds ?? [])
  if (adminProjects.has(project.id)) return true
  if (project.space_id && adminSpaces.has(project.space_id)) return true
  return false
}

/** Sidebar / settings menus: space admin and above. */
export function canManageSpaceSettings(
  space: Pick<Space, 'id' | 'my_role'>,
  options: ScopeAdminOptions = {},
): boolean {
  if (options.orgLeader || options.workspaceAdmin) return true
  if (space.my_role === 'admin' || space.my_role === 'owner') return true
  return new Set(options.adminSpaceIds ?? []).has(space.id)
}

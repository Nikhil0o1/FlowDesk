import type { Project, Space, Workspace } from '../../lib/types'

export type InviteScope = 'organization' | 'workspace' | 'space' | 'project'

/** Composite roles for the Space invite tab. */
export type SpaceInviteRole = 'space_admin' | 'project_admin' | 'project_member' | 'project_viewer'

export const SPACE_INVITE_ROLES: readonly SpaceInviteRole[] = [
  'space_admin',
  'project_admin',
  'project_member',
  'project_viewer',
]

export const INVITE_ROLES: Record<Exclude<InviteScope, 'space'>, readonly string[]> = {
  organization: ['admin', 'member'],
  workspace: ['admin'],
  project: ['member', 'admin', 'viewer'],
}

/** Roles shown in the invite form for the active scope. */
export function inviteRolesForScope(scope: InviteScope): readonly string[] {
  if (scope === 'space') return SPACE_INVITE_ROLES
  return INVITE_ROLES[scope]
}

export function defaultRoleForScope(scope: InviteScope): string {
  if (scope === 'space') return 'space_admin'
  return INVITE_ROLES[scope][0]
}

export function normalizeRoleForScope(scope: InviteScope, role: string): string {
  const allowed = inviteRolesForScope(scope)
  return allowed.includes(role) ? role : allowed[0]
}

export function isSpaceInviteProjectRole(
  role: string,
): role is 'project_admin' | 'project_member' | 'project_viewer' {
  return role === 'project_admin' || role === 'project_member' || role === 'project_viewer'
}

export function spaceInviteRoleToApiRole(role: SpaceInviteRole): 'admin' | 'member' | 'viewer' {
  if (role === 'space_admin' || role === 'project_admin') return 'admin'
  if (role === 'project_viewer') return 'viewer'
  return 'member'
}

export function formatSpaceInviteRoleLabel(role: string): string {
  if (role === 'space_admin') return 'Space Admin'
  if (role === 'project_admin') return 'Project Admin'
  if (role === 'project_member') return 'Project Member'
  if (role === 'project_viewer') return 'Project Viewer'
  return role
}

export type OrgBulkGrant = {
  scope: 'workspace' | 'space' | 'project'
  role: string
  workspace_id?: string
  space_id?: string
  project_id?: string
}

/** Build API grants for organization bulk invites from form state. */
export function buildOrgBulkGrants(
  scope: InviteScope,
  role: string,
  selectedWorkspaceIds: string[],
  selectedSpaceIds: string[],
  selectedProjectIds: string[],
): OrgBulkGrant[] {
  if (scope === 'workspace') {
    return selectedWorkspaceIds.map((workspace_id) => ({ scope: 'workspace', role, workspace_id }))
  }
  if (scope === 'space') {
    if (role === 'space_admin') {
      return selectedSpaceIds.map((space_id) => ({ scope: 'space', role: 'admin', space_id }))
    }
    const apiRole = spaceInviteRoleToApiRole(role as SpaceInviteRole)
    return selectedProjectIds.map((project_id) => ({ scope: 'project', role: apiRole, project_id }))
  }
  if (scope === 'project') {
    return selectedProjectIds.map((project_id) => ({ scope: 'project', role, project_id }))
  }
  return []
}

/** Workspaces the current user may send workspace-scoped invites to. */
export function inviteableWorkspaces(workspaces: Workspace[], isOrgAdminOrOwner: boolean): Workspace[] {
  if (isOrgAdminOrOwner) return workspaces
  return workspaces.filter((w) => w.my_role === 'admin' || w.my_role === 'owner')
}

/** Whether the user may send workspace-scoped invites to any workspace. */
export function canInviteToWorkspace(workspaces: Workspace[], isOrgAdminOrOwner: boolean): boolean {
  return inviteableWorkspaces(workspaces, isOrgAdminOrOwner).length > 0
}

/** Workspace admins (not org leaders) use the guided invite flow — no workspace-admin invites. */
export function usesWorkspaceAdminInviteFlow(
  isOrgAdminOrOwner: boolean,
  workspaces: Workspace[],
): boolean {
  return !isOrgAdminOrOwner && canInviteToWorkspace(workspaces, false)
}

export type WorkspaceAdminTopRole = 'admin' | 'member' | 'viewer'
export type WorkspaceAdminAdminKind = 'space_admin' | 'project_admin'

export const WORKSPACE_ADMIN_TOP_ROLES: readonly WorkspaceAdminTopRole[] = ['admin', 'member', 'viewer']
export const WORKSPACE_ADMIN_ADMIN_KINDS: readonly WorkspaceAdminAdminKind[] = [
  'space_admin',
  'project_admin',
]

export function formatWorkspaceAdminTopRoleLabel(role: WorkspaceAdminTopRole): string {
  if (role === 'admin') return 'Admin'
  if (role === 'viewer') return 'Viewer'
  return 'Member'
}

/** Whether the user may send space-scoped invites (org admin/owner bypass, or space admin). */
export function canInviteToSpace(spaces: Space[], isOrgAdminOrOwner: boolean): boolean {
  if (isOrgAdminOrOwner) return true
  return spaces.some((s) => s.my_role === 'admin' || s.my_role === 'owner')
}

/** Spaces the current user may invite to within a workspace. */
export function inviteableSpaces(spaces: Space[], isOrgAdminOrOwner: boolean): Space[] {
  if (isOrgAdminOrOwner) return spaces
  return spaces.filter((s) => s.my_role === 'admin' || s.my_role === 'owner')
}

/** Whether the user may send project-scoped invites (explicit project admin on at least one project). */
export function canInviteToProject(projects: Project[]): boolean {
  return projects.some((p) => p.my_explicit_role === 'admin')
}

/** Whether the user may open the invite flow at all (any invite scope). */
export function canInviteAnyone(
  org: { my_role?: string | null } | null | undefined,
  workspaces: Workspace[],
  spaces: Space[],
  projects: Project[],
): boolean {
  const isOrgAdminOrOwner = org?.my_role === 'owner' || org?.my_role === 'admin'
  return (
    isOrgAdminOrOwner ||
    canInviteToWorkspace(workspaces, false) ||
    canInviteToSpace(spaces, false) ||
    canInviteToProject(projects)
  )
}

/**
 * Workspaces selectable in the invite form for the given scope.
 * Project scope includes workspaces where the user is project admin (even as ws member).
 */
export function inviteableWorkspacesForScope(
  scope: InviteScope,
  workspaces: Workspace[],
  projects: Project[],
  isOrgAdminOrOwner: boolean,
  spaces: Space[] = [],
): Workspace[] {
  if (scope === 'organization') return []
  if (isOrgAdminOrOwner) return workspaces
  if (scope === 'workspace') {
    return inviteableWorkspaces(workspaces, false)
  }
  const adminProjectWorkspaceIds = new Set(
    projects.filter((p) => p.my_explicit_role === 'admin').map((p) => p.workspace_id),
  )
  const spaceAdminWorkspaceIds = new Set(
    spaces
      .filter((s) => s.my_role === 'admin' || s.my_role === 'owner')
      .map((s) => s.workspace_id),
  )
  return workspaces.filter(
    (w) =>
      w.my_role === 'admin' ||
      w.my_role === 'owner' ||
      adminProjectWorkspaceIds.has(w.id) ||
      (scope === 'space' && spaceAdminWorkspaceIds.has(w.id)),
  )
}

/** Pick the best default invite scope for the user's permissions. */
export function resolveInviteScope(
  preferred: InviteScope,
  isOrgAdminOrOwner: boolean,
  workspaces: Workspace[],
  spaces: Space[],
  projects: Project[],
): InviteScope {
  const canWorkspace = canInviteToWorkspace(workspaces, isOrgAdminOrOwner)
  const canSpace = canInviteToSpace(spaces, isOrgAdminOrOwner)
  const canProject = canInviteToProject(projects)
  if (preferred === 'organization' && isOrgAdminOrOwner) return 'organization'
  if (preferred === 'workspace' && canWorkspace) {
    if (!isOrgAdminOrOwner) {
      if (canSpace) return 'space'
      if (canProject) return 'project'
      return 'space'
    }
    return 'workspace'
  }
  if (preferred === 'space' && canSpace) return 'space'
  if (preferred === 'project' && canProject) return 'project'
  if (!isOrgAdminOrOwner && canWorkspace) {
    if (canSpace) return 'space'
    if (canProject) return 'project'
    return 'space'
  }
  if (canWorkspace) return 'workspace'
  if (canSpace) return 'space'
  if (canProject) return 'project'
  if (isOrgAdminOrOwner) return 'organization'
  return preferred
}

/** Projects the current user may send project-scoped invites to within a workspace. */
export function inviteableProjects(
  projects: Project[],
  workspace: Workspace | undefined,
  isOrgAdminOrOwner: boolean,
  options?: { spaceId?: string; spaces?: Space[] },
): Project[] {
  const spaceId = options?.spaceId
  const spaces = options?.spaces ?? []
  let list = projects.filter((p) => !p.is_archived)
  if (spaceId) list = list.filter((p) => p.space_id === spaceId)

  if (isOrgAdminOrOwner || workspace?.my_role === 'admin' || workspace?.my_role === 'owner') {
    return list
  }

  const spaceAdminIds = new Set(
    spaces.filter((s) => s.my_role === 'admin' || s.my_role === 'owner').map((s) => s.id),
  )

  return list.filter(
    (p) => p.my_explicit_role === 'admin' || (p.space_id != null && spaceAdminIds.has(p.space_id)),
  )
}

export function workspaceLabel(ws: Workspace): string {
  return ws.is_archived ? `${ws.name} (archived)` : ws.name
}

export function projectLabel(p: Project): string {
  return p.is_archived ? `${p.name} (archived)` : p.name
}

import type { Project, Workspace } from '../../lib/types'

export type InviteScope = 'organization' | 'workspace' | 'project'

export const INVITE_ROLES: Record<InviteScope, readonly string[]> = {
  organization: ['member', 'owner'],
  workspace: ['member', 'admin'],
  project: ['member', 'admin', 'viewer'],
}

export function defaultRoleForScope(scope: InviteScope): string {
  return INVITE_ROLES[scope][0]
}

export function normalizeRoleForScope(scope: InviteScope, role: string): string {
  const allowed = INVITE_ROLES[scope]
  return allowed.includes(role) ? role : allowed[0]
}

/** Workspaces the current user may send workspace-scoped invites to. */
export function inviteableWorkspaces(workspaces: Workspace[], isOrgOwner: boolean): Workspace[] {
  if (isOrgOwner) return workspaces
  return workspaces.filter((w) => w.my_role === 'admin')
}

/** Projects the current user may send project-scoped invites to within a workspace. */
export function inviteableProjects(
  projects: Project[],
  workspace: Workspace | undefined,
  isOrgOwner: boolean,
): Project[] {
  if (isOrgOwner || workspace?.my_role === 'admin') return projects
  return projects.filter((p) => p.my_role === 'admin')
}

export function workspaceLabel(ws: Workspace): string {
  return ws.is_archived ? `${ws.name} (archived)` : ws.name
}

export function projectLabel(p: Project): string {
  return p.is_archived ? `${p.name} (archived)` : p.name
}

import { canInviteAnyone } from '../components/invites/inviteScopes'
import { canCreateChannel } from './chatAccess'
import { isOrgLeader } from './scopedRoles'
import type { Organization, Project, Space, UserRoleSummary, Workspace, Goal, GoalAccess } from './types'

export function isWorkspaceAdmin(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
): boolean {
  return isOrgLeader(org) || workspace?.my_role === 'admin' || workspace?.my_role === 'owner'
}

/** Matches backend: space admin or workspace/org admin. */
export function canCreateProject(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
  spaces: Space[],
): boolean {
  if (isWorkspaceAdmin(org, workspace)) return true
  return spaces.some((s) => s.my_role === 'admin' || s.my_role === 'owner')
}

/** Spaces the user may create a project in (all ws spaces for ws admin; admin spaces only otherwise). */
export function creatableSpaces(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
  spaces: Space[],
): Space[] {
  if (isWorkspaceAdmin(org, workspace)) return spaces
  return spaces.filter((s) => s.my_role === 'admin' || s.my_role === 'owner')
}

/** Matches backend: org/workspace admin or scoped space/project admin in the workspace. */
export function canCreateTeam(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role' | 'id'> | null | undefined,
  roles: UserRoleSummary | null | undefined,
  workspaceId?: string | null,
): boolean {
  if (isWorkspaceAdmin(org, workspace)) return true
  const wsId = workspaceId ?? workspace?.id
  if (!wsId || !roles) return false
  const spaceAdmin = roles.space_roles.some((s) => s.workspace_id === wsId && s.role === 'admin')
  const projectAdmin = roles.project_roles.some((p) => p.workspace_id === wsId && p.role === 'admin')
  return spaceAdmin || projectAdmin
}

/**
 * Matches backend delete rules for org/workspace admins.
 * Scoped space/project admins still rely on `apiCanDelete` from the team payload
 * (linked-project checks live on the server).
 */
export function canDeleteTeam(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
  apiCanDelete?: boolean,
): boolean {
  return apiCanDelete === true || isWorkspaceAdmin(org, workspace)
}

export function canCreateSpace(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
): boolean {
  return isWorkspaceAdmin(org, workspace)
}

export function canCreateSprint(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
): boolean {
  return isWorkspaceAdmin(org, workspace)
}

/**
 * Matches backend require_goal_initiator.
 * Personal List project-admin does not grant Goals section access.
 */
export function canAccessGoalsSection(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role' | 'id'> | null | undefined,
  roles: UserRoleSummary | null | undefined,
  workspaceId?: string | null,
): boolean {
  if (isWorkspaceAdmin(org, workspace)) return true
  const wsId = workspaceId ?? workspace?.id
  if (!wsId || !roles) return false
  const spaceAdmin = roles.space_roles.some((s) => s.workspace_id === wsId && s.role === 'admin')
  const projectAdmin = roles.project_roles.some(
    (p) => p.workspace_id === wsId && p.role === 'admin' && !p.is_personal,
  )
  return spaceAdmin || projectAdmin
}

/** Goals nav/list: section admin or explicit share/ownership (from /goals/access). */
export function canAccessGoals(
  sectionAccess: boolean,
  access: Pick<GoalAccess, 'can_access'> | null | undefined,
): boolean {
  return sectionAccess || access?.can_access === true
}

export function canCreateGoal(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role' | 'id'> | null | undefined,
  roles: UserRoleSummary | null | undefined,
  workspaceId?: string | null,
): boolean {
  return canAccessGoalsSection(org, workspace, roles, workspaceId)
}

/** Org owner/admin — backend lists every goal in the workspace. */
export function canViewAllGoals(org: Pick<Organization, 'my_role'> | null | undefined): boolean {
  return isOrgLeader(org)
}

export function canViewGoal(
  goal: Pick<Goal, 'owner_id' | 'created_by' | 'owners'>,
  userId: string | undefined,
  org: Pick<Organization, 'my_role'> | null | undefined,
): boolean {
  if (canViewAllGoals(org)) return true
  if (!userId) return false
  if (goal.owner_id === userId || goal.created_by === userId) return true
  return (goal.owners ?? []).some((o) => o.id === userId)
}

export function canManageGoal(
  goal: Pick<Goal, 'owner_id' | 'created_by' | 'owners'>,
  userId: string | undefined,
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role' | 'id'> | null | undefined,
  roles: UserRoleSummary | null | undefined,
): boolean {
  if (userId && (goal.owner_id === userId || goal.created_by === userId)) return true
  if (userId && (goal.owners ?? []).some((o) => o.id === userId)) return true
  return canAccessGoalsSection(org, workspace, roles, workspace?.id)
}

export function canCreateWorkspace(org: Pick<Organization, 'my_role'> | null | undefined): boolean {
  return isOrgLeader(org)
}

export function canOpenCreateInvite(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspaces: Workspace[],
  spaces: Space[],
  projects: Project[],
): boolean {
  return canInviteAnyone(org, workspaces, spaces, projects)
}

export { canCreateChannel }

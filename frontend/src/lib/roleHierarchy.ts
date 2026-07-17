/** Org-wide role hierarchy for people management (mirrors backend). */
export type HighestRole =
  | 'org_owner'
  | 'org_admin'
  | 'workspace_admin'
  | 'space_admin'
  | 'project_admin'
  | 'org_member'
  | 'project_member'
  | 'project_viewer'
  | 'member'

const ROLE_RANK: Record<string, number> = {
  org_owner: 8,
  org_admin: 7,
  workspace_admin: 6,
  space_admin: 5,
  project_admin: 4,
  project_member: 3,
  project_viewer: 2,
  org_member: 1,
  member: 0,
}

export function roleRank(role: string | null | undefined): number {
  if (!role) return 0
  return ROLE_RANK[role] ?? 0
}

export function rankForWorkspaceRole(role: string): number {
  return role === 'admin' || role === 'owner' ? ROLE_RANK.workspace_admin : ROLE_RANK.org_member
}

export function rankForSpaceRole(role: string): number {
  return role === 'admin' ? ROLE_RANK.space_admin : ROLE_RANK.org_member
}

export function rankForProjectRole(role: string): number {
  if (role === 'admin') return ROLE_RANK.project_admin
  if (role === 'member') return ROLE_RANK.project_member
  if (role === 'viewer') return ROLE_RANK.project_viewer
  return ROLE_RANK.org_member
}

/** True when actor outranks target and may change their access. */
export function canManageByHierarchy(
  actorHighest: string | null | undefined,
  targetHighest: string | null | undefined,
): boolean {
  if (targetHighest === 'org_owner') return false
  return roleRank(actorHighest) > roleRank(targetHighest)
}

/** True when actor may assign a scoped role at this level. */
export function canGrantScopedRole(
  actorHighest: string | null | undefined,
  grantRank: number,
): boolean {
  return roleRank(actorHighest) > grantRank
}

function isOrgLeaderRole(orgRole: string | null | undefined): boolean {
  return orgRole === 'owner' || orgRole === 'admin'
}

/** Actor may change workspace membership only within workspaces they administer (or org leaders). */
export function actorCanManageWorkspaceScope(
  actorOrgRole: string | null | undefined,
  actorWorkspaceRoles: { workspace_id: string; role: string }[] | undefined,
  workspaceId: string,
): boolean {
  if (isOrgLeaderRole(actorOrgRole)) return true
  return (
    actorWorkspaceRoles?.some((w) => w.workspace_id === workspaceId && w.role === 'admin') ?? false
  )
}

/** Actor may change space membership within spaces they administer (or higher bypass). */
export function actorCanManageSpaceScope(
  actorOrgRole: string | null | undefined,
  actorWorkspaceRoles: { workspace_id: string; role: string }[] | undefined,
  actorSpaceRoles: { space_id: string; role: string }[] | undefined,
  spaceId: string,
  workspaceId: string,
): boolean {
  if (isOrgLeaderRole(actorOrgRole)) return true
  if (actorWorkspaceRoles?.some((w) => w.workspace_id === workspaceId && w.role === 'admin')) {
    return true
  }
  return actorSpaceRoles?.some((s) => s.space_id === spaceId && s.role === 'admin') ?? false
}

/** Actor may change project membership within projects they administer (or higher bypass). */
export function actorCanManageProjectScope(
  actorOrgRole: string | null | undefined,
  actorWorkspaceRoles: { workspace_id: string; role: string }[] | undefined,
  actorSpaceRoles: { space_id: string; role: string }[] | undefined,
  actorProjectRoles: { project_id: string; role: string }[] | undefined,
  projectId: string,
  workspaceId: string,
  spaceId: string | null | undefined,
): boolean {
  if (isOrgLeaderRole(actorOrgRole)) return true
  if (actorWorkspaceRoles?.some((w) => w.workspace_id === workspaceId && w.role === 'admin')) {
    return true
  }
  if (spaceId && actorSpaceRoles?.some((s) => s.space_id === spaceId && s.role === 'admin')) {
    return true
  }
  return actorProjectRoles?.some((p) => p.project_id === projectId && p.role === 'admin') ?? false
}

export type PeopleListKind = 'org' | 'workspace' | 'space' | 'project'

/** Best-effort rank from list row role when full highest_role is not loaded. */
export function estimateTargetRankFromPeopleList(kind: PeopleListKind, role: string): number {
  if (kind === 'org') {
    if (role === 'owner') return ROLE_RANK.org_owner
    if (role === 'admin') return ROLE_RANK.org_admin
    return ROLE_RANK.org_member
  }
  if (kind === 'workspace') {
    if (role === 'admin' || role === 'owner') return ROLE_RANK.workspace_admin
    return ROLE_RANK.org_member
  }
  if (kind === 'space') {
    if (role === 'admin') return ROLE_RANK.space_admin
    return ROLE_RANK.org_member
  }
  return rankForProjectRole(role)
}

/** Whether the actor may open role management for this row in All People. */
export function canManagePersonInList(
  actorHighest: string | null | undefined,
  targetUserId: string,
  actorUserId: string | undefined,
  kind: PeopleListKind,
  targetRole: string,
): boolean {
  if (!actorHighest || !actorUserId || targetUserId === actorUserId) return false
  return roleRank(actorHighest) > estimateTargetRankFromPeopleList(kind, targetRole)
}

/** True when the user may open the org Analytics (presence) section.
 * Org owner / org admin / workspace admin / space admin / project admin only —
 * plain members, viewers, and Personal List-only admins are excluded
 * (highest_role already ignores is_personal project admin).
 */
export function canAccessAnalytics(actorHighest: string | null | undefined): boolean {
  return roleRank(actorHighest) >= ROLE_RANK.project_admin
}

/** True when the user has a people-management admin role anywhere in the org. */
export function canAccessPeopleDirectory(actorHighest: string | null | undefined): boolean {
  return canAccessAnalytics(actorHighest)
}

/**
 * Mirror of backend `can_viewer_see_member_in_analytics`.
 * Org leaders see everyone. Scoped admins see surrounding members except org leaders.
 */
export function canViewerSeeMemberInAnalytics(
  viewerHighest: string | null | undefined,
  targetHighest: string | null | undefined,
): boolean {
  if (!viewerHighest || !targetHighest) return false
  if (viewerHighest === 'org_owner' || viewerHighest === 'org_admin') return true
  if (targetHighest === 'org_owner' || targetHighest === 'org_admin') return false
  return true
}

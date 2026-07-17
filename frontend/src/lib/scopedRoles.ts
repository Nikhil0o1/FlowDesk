import { formatRoleLabel } from './roleLabels'
import type {
  HighestRole,
  Organization,
  ProjectRoleItem,
  SpaceRoleItem,
  UserRoleSummary,
  WorkspaceRoleItem,
} from './types'

/** Org owner or org admin (organization-level leadership). */
export function isOrgLeader(org: Pick<Organization, 'my_role'> | null | undefined): boolean {
  return org?.my_role === 'owner' || org?.my_role === 'admin'
}

/** Workspace roster roles for users with implicit org-wide access (not removable). */
export function isImplicitOrgWorkspaceMember(role: string): boolean {
  return role === 'owner' || role === 'org_admin'
}

/** Org leaders hide the top-bar workspace switcher on org home and workspace list. */
export function orgLeaderHidesWorkspaceSwitcher(pathname: string): boolean {
  return pathname === '/app/dashboard' || pathname === '/app/workspaces'
}

export function isOrgWorkspaceDrillDownPath(pathname: string): boolean {
  return /^\/app\/workspaces\/[^/]+$/.test(pathname)
}

export function adminWorkspaceRoles(roles: UserRoleSummary): WorkspaceRoleItem[] {
  return roles.workspace_roles.filter((wr) => wr.role === 'admin')
}

export function adminSpaceRoles(roles: UserRoleSummary): SpaceRoleItem[] {
  return roles.space_roles.filter((sr) => sr.role === 'admin')
}

export function adminProjectRoles(roles: UserRoleSummary): ProjectRoleItem[] {
  // Personal List admin must not count as a scoped project admin (Analytics / People).
  return roles.project_roles.filter((pr) => pr.role === 'admin' && !pr.is_personal)
}

export function memberProjectRoles(roles: UserRoleSummary): ProjectRoleItem[] {
  return roles.project_roles.filter((pr) => pr.role === 'member' || pr.role === 'viewer')
}

/** Dashboard routing for explicit project member or viewer (not admins). */
export function isProjectMemberDashboardRole(role: string | null | undefined): boolean {
  return role === 'project_member' || role === 'project_viewer'
}

export function formatScopeList(names: string[], max = 3): string {
  if (names.length === 0) return ''
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`
}

export interface ProfileRoleDisplay {
  title: string
  detail: string | null
}

/** Human-readable role line for profile menu / drawer header. */
export function profileRoleDisplay(roles: UserRoleSummary | undefined): ProfileRoleDisplay {
  if (!roles) return { title: 'Member', detail: null }

  if (roles.org_role === 'owner') {
    return { title: 'Organization Owner', detail: roles.org_name }
  }
  if (roles.org_role === 'admin') {
    return { title: 'Organization Admin', detail: roles.org_name }
  }

  const ws = adminWorkspaceRoles(roles)
  const sp = adminSpaceRoles(roles)
  const pr = adminProjectRoles(roles)

  // Lower project roles held alongside an admin role — shown so a "Project Admin"
  // who is also a member elsewhere isn't displayed as admin-only. Roles already
  // covered by an admin workspace/space are subsumed and omitted.
  const adminWsIds = new Set(ws.map((w) => w.workspace_id))
  const adminSpIds = new Set(sp.map((s) => s.space_id))
  const notSubsumed = (p: ProjectRoleItem) =>
    !adminWsIds.has(p.workspace_id) && !(p.space_id != null && adminSpIds.has(p.space_id))
  const memberPr = roles.project_roles.filter((p) => p.role === 'member' && notSubsumed(p))
  const viewerPr = roles.project_roles.filter((p) => p.role === 'viewer' && notSubsumed(p))
  const extraSegments: string[] = []
  if (memberPr.length > 0) {
    extraSegments.push(`Member: ${formatScopeList(memberPr.map((p) => p.project_name), 2)}`)
  }
  if (viewerPr.length > 0) {
    extraSegments.push(`Viewer: ${formatScopeList(viewerPr.map((p) => p.project_name), 2)}`)
  }
  const withExtras = (detail: string) => [detail, ...extraSegments].join(' · ')

  if (roles.highest_role === 'workspace_admin' && ws.length > 0) {
    return {
      title: ws.length > 1 ? `Workspace Admin · ${ws.length} workspaces` : 'Workspace Admin',
      detail: withExtras(formatScopeList(ws.map((w) => w.workspace_name))),
    }
  }
  if (roles.highest_role === 'space_admin' && sp.length > 0) {
    return {
      title: sp.length > 1 ? `Space Admin · ${sp.length} spaces` : 'Space Admin',
      detail: withExtras(formatScopeList(sp.map((s) => `${s.space_name} (${s.workspace_name})`))),
    }
  }
  if (roles.highest_role === 'project_admin' && pr.length > 0) {
    if (extraSegments.length > 0) {
      return {
        title: `Project Admin + ${memberPr.length > 0 ? 'Member' : 'Viewer'}`,
        detail: withExtras(`Admin: ${formatScopeList(pr.map((p) => p.project_name), 2)}`),
      }
    }
    return {
      title: pr.length > 1 ? `Project Admin · ${pr.length} projects` : 'Project Admin',
      detail: formatScopeList(pr.map((p) => p.project_name)),
    }
  }
  if (isProjectMemberDashboardRole(roles.highest_role)) {
    const memberProjects = memberProjectRoles(roles)
    if (memberProjects.length > 0) {
      const allViewers = memberProjects.every((p) => p.role === 'viewer')
      const label = allViewers ? 'Project Viewer' : 'Project Member'
      return {
        title:
          memberProjects.length > 1 ? `${label} · ${memberProjects.length} projects` : label,
        detail: formatScopeList(memberProjects.map((p) => p.project_name)),
      }
    }
  }

  if (roles.org_role === 'member') {
    return { title: 'Organization Member', detail: roles.org_name }
  }

  return { title: formatRoleLabel(roles.highest_role as HighestRole), detail: null }
}

/* ---------------- Per-workspace dashboard views ---------------- */

export type DashboardViewKind =
  | 'org_owner'
  | 'org_admin'
  | 'workspace_admin'
  | 'space_admin'
  | 'project_admin'
  | 'project_member'
  | 'project_viewer'

export interface DashboardView {
  /** Stable key for switcher selection + state, e.g. "project_admin:<id>". */
  key: string
  kind: DashboardViewKind
  /** Role label, e.g. "Project Admin". */
  label: string
  /** Scope name (space/project/org name) shown as the switcher's secondary line. */
  scopeName: string | null
  /** Workspace this view belongs to (null for org-level views). */
  workspaceId: string | null
  /** The id passed to the dashboard component (workspace/space/project id). */
  scopeId: string | null
  rank: number
}

const VIEW_RANK: Record<DashboardViewKind, number> = {
  org_owner: 8,
  org_admin: 7,
  workspace_admin: 6,
  space_admin: 5,
  project_admin: 4,
  project_member: 3,
  project_viewer: 2,
}

const VIEW_LABEL: Record<DashboardViewKind, string> = {
  org_owner: 'Organization Owner',
  org_admin: 'Organization Admin',
  workspace_admin: 'Workspace Admin',
  space_admin: 'Space Admin',
  project_admin: 'Project Admin',
  project_member: 'Project Member',
  project_viewer: 'Project Viewer',
}

/**
 * The dashboards a user can view given the CURRENTLY selected workspace.
 *
 * Org owners/admins always get the single org-wide dashboard. Everyone else gets a
 * view per role they hold *inside this workspace* — workspace admin, each space they
 * admin, each project they admin, and each project they're a member/viewer of. The
 * dashboard defaults to the highest-ranked view; a switcher lets them move between the
 * rest. Switching to a different workspace (via the top bar) recomputes this list, so a
 * workspace admin in A who is only a project member in B sees the project-member
 * dashboard while in B. Results are sorted highest-role first.
 */
export function dashboardViewsForWorkspace(
  roles: UserRoleSummary | undefined,
  workspaceId: string | null | undefined,
): DashboardView[] {
  if (!roles) return []

  if (roles.org_role === 'owner') {
    return [
      {
        key: 'org_owner',
        kind: 'org_owner',
        label: VIEW_LABEL.org_owner,
        scopeName: roles.org_name,
        workspaceId: null,
        scopeId: null,
        rank: VIEW_RANK.org_owner,
      },
    ]
  }
  if (roles.org_role === 'admin') {
    return [
      {
        key: 'org_admin',
        kind: 'org_admin',
        label: VIEW_LABEL.org_admin,
        scopeName: roles.org_name,
        workspaceId: null,
        scopeId: null,
        rank: VIEW_RANK.org_admin,
      },
    ]
  }

  if (!workspaceId) return []

  // A higher-scope role subsumes the ones beneath it in the same scope, so we don't
  // offer redundant "downgrade" views. Workspace admin covers the whole workspace →
  // a single view, no switcher. Space admin covers every project in its space → those
  // project views are folded away (projects in OTHER spaces still count).
  const wsAdmin = roles.workspace_roles.find(
    (w) => w.workspace_id === workspaceId && w.role === 'admin',
  )
  if (wsAdmin) {
    return [
      {
        key: `workspace_admin:${workspaceId}`,
        kind: 'workspace_admin',
        label: VIEW_LABEL.workspace_admin,
        scopeName: wsAdmin.workspace_name,
        workspaceId,
        scopeId: workspaceId,
        rank: VIEW_RANK.workspace_admin,
      },
    ]
  }

  const adminSpaceIds = new Set(
    roles.space_roles
      .filter((s) => s.workspace_id === workspaceId && s.role === 'admin')
      .map((s) => s.space_id),
  )
  const subsumedBySpaceAdmin = (p: ProjectRoleItem) =>
    p.space_id != null && adminSpaceIds.has(p.space_id)

  const views: DashboardView[] = []
  for (const s of roles.space_roles.filter(
    (s) => s.workspace_id === workspaceId && s.role === 'admin',
  )) {
    views.push({
      key: `space_admin:${s.space_id}`,
      kind: 'space_admin',
      label: VIEW_LABEL.space_admin,
      scopeName: s.space_name,
      workspaceId,
      scopeId: s.space_id,
      rank: VIEW_RANK.space_admin,
    })
  }
  for (const p of roles.project_roles.filter(
    (p) => p.workspace_id === workspaceId && p.role === 'admin' && !subsumedBySpaceAdmin(p),
  )) {
    views.push({
      key: `project_admin:${p.project_id}`,
      kind: 'project_admin',
      label: VIEW_LABEL.project_admin,
      scopeName: p.project_name,
      workspaceId,
      scopeId: p.project_id,
      rank: VIEW_RANK.project_admin,
    })
  }
  for (const p of roles.project_roles.filter(
    (p) =>
      p.workspace_id === workspaceId &&
      (p.role === 'member' || p.role === 'viewer') &&
      !subsumedBySpaceAdmin(p),
  )) {
    const kind: DashboardViewKind = p.role === 'viewer' ? 'project_viewer' : 'project_member'
    views.push({
      key: `${kind}:${p.project_id}`,
      kind,
      label: VIEW_LABEL[kind],
      scopeName: p.project_name,
      workspaceId,
      scopeId: p.project_id,
      rank: VIEW_RANK[kind],
    })
  }

  views.sort((a, b) => b.rank - a.rank || (a.scopeName ?? '').localeCompare(b.scopeName ?? ''))
  return views
}

export function pickWorkspaceAdminScope(
  adminRoles: WorkspaceRoleItem[],
  currentWorkspaceId: string | null | undefined,
  savedScope: string | null,
): string | null {
  if (adminRoles.length === 0) return null
  if (savedScope && adminRoles.some((r) => r.workspace_id === savedScope)) return savedScope
  const inContext = adminRoles.find((r) => r.workspace_id === currentWorkspaceId)
  return inContext?.workspace_id ?? adminRoles[0].workspace_id
}

export function pickSpaceAdminScope(
  adminRoles: SpaceRoleItem[],
  savedScope: string | null,
): string | null {
  if (adminRoles.length === 0) return null
  if (savedScope && adminRoles.some((r) => r.space_id === savedScope)) return savedScope
  return adminRoles[0].space_id
}

export function pickProjectAdminScope(
  adminRoles: ProjectRoleItem[],
  savedScope: string | null,
): string | null {
  if (adminRoles.length === 0) return null
  if (savedScope && adminRoles.some((r) => r.project_id === savedScope)) return savedScope
  return adminRoles[0].project_id
}

export function pickProjectMemberScope(
  memberRoles: ProjectRoleItem[],
  currentWorkspaceId: string | null | undefined,
  savedScope: string | null,
): string | null {
  if (memberRoles.length === 0) return null
  if (savedScope && memberRoles.some((r) => r.project_id === savedScope)) return savedScope
  const inContext = memberRoles.find((r) => r.workspace_id === currentWorkspaceId)
  return inContext?.project_id ?? memberRoles[0].project_id
}

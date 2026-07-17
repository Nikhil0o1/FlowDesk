import { PEOPLE_TAB } from './peopleRoutes'
import {
  adminProjectRoles,
  adminSpaceRoles,
  adminWorkspaceRoles,
  isOrgLeader,
} from './scopedRoles'
import type { Organization, UserRoleSummary, Workspace } from './types'

export type PeopleInviteFlowKind = 'workspace' | 'space' | 'project'

export type InviteScopePins = {
  workspaceId: string | null
  spaceId: string | null
  projectId: string | null
}

/** Workspace / space / project admins — choice modal from Invite anywhere in the app. */
export function resolveScopedInviteFlow(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'id' | 'my_role'> | null | undefined,
  roles: UserRoleSummary | undefined,
): PeopleInviteFlowKind | null {
  if (isOrgLeader(org) || !roles) return null

  if (
    workspace?.my_role === 'admin' ||
    workspace?.my_role === 'owner' ||
    roles.workspace_roles.some((r) => r.role === 'admin')
  ) {
    return 'workspace'
  }
  if (adminSpaceRoles(roles).length > 0) return 'space'
  if (adminProjectRoles(roles).length > 0) return 'project'
  return null
}

/** Scoped admin on All People — same flow kind as global invite. */
export function resolvePeopleInviteFlow(
  pathname: string,
  search: string,
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'id' | 'my_role'> | null | undefined,
  roles: UserRoleSummary | undefined,
): PeopleInviteFlowKind | null {
  if (!pathname.startsWith('/app/teams')) return null
  const params = new URLSearchParams(search)
  if (params.get('tab') !== PEOPLE_TAB) return null
  return resolveScopedInviteFlow(org, workspace, roles)
}

export function defaultInvitePins(
  flow: PeopleInviteFlowKind,
  workspace: Pick<Workspace, 'id' | 'my_role'> | null | undefined,
  roles: UserRoleSummary,
  overrides?: Partial<InviteScopePins>,
): InviteScopePins {
  const overrideWorkspaceId = overrides?.workspaceId ?? null
  const overrideSpaceId = overrides?.spaceId ?? null
  const overrideProjectId = overrides?.projectId ?? null

  if (flow === 'workspace') {
    const workspaceId =
      overrideWorkspaceId ??
      (workspace?.my_role === 'admin' || workspace?.my_role === 'owner' ? workspace.id : null) ??
      adminWorkspaceRoles(roles)[0]?.workspace_id ??
      null
    return { workspaceId, spaceId: null, projectId: null }
  }

  if (flow === 'space') {
    const spaces = adminSpaceRoles(roles)
    const inCurrent = workspace?.id
      ? spaces.filter((s) => s.workspace_id === workspace.id)
      : spaces
    const picked = overrideSpaceId
      ? spaces.find((s) => s.space_id === overrideSpaceId)
      : (inCurrent[0] ?? spaces[0])
    return {
      workspaceId: overrideWorkspaceId ?? picked?.workspace_id ?? workspace?.id ?? null,
      spaceId: overrideSpaceId ?? picked?.space_id ?? null,
      projectId: null,
    }
  }

  const projects = adminProjectRoles(roles)
  const inCurrent = workspace?.id
    ? projects.filter((p) => p.workspace_id === workspace.id)
    : projects
  const picked = overrideProjectId
    ? projects.find((p) => p.project_id === overrideProjectId)
    : (inCurrent[0] ?? projects[0])
  return {
    workspaceId: overrideWorkspaceId ?? picked?.workspace_id ?? workspace?.id ?? null,
    spaceId: null,
    projectId: overrideProjectId ?? picked?.project_id ?? null,
  }
}

export function inviteOpensPeopleChoice(
  pathname: string,
  search: string,
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'id' | 'my_role'> | null | undefined,
  roles: UserRoleSummary | undefined,
): boolean {
  return (
    resolvePeopleInviteFlow(pathname, search, org, workspace, roles) !== null ||
    resolveScopedInviteFlow(org, workspace, roles) !== null
  )
}

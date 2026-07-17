import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  PEOPLE_TAB,
  PROJECT_FILTER_PARAM,
  SPACE_FILTER_PARAM,
  WORKSPACE_FILTER_PARAM,
  resolvePeoplePanelScope,
  type PeoplePanelScope,
} from '../lib/peopleRoutes'
import { formatRoleLabel, formatScopedRole } from '../lib/roleLabels'
import {
  useCurrentContext,
  useOrganizationMembers,
  useProjectMembers,
  useSpaceMembers,
  useUserRoles,
  useWorkspaceMembers,
} from '../lib/queries'
import {
  adminProjectRoles,
  adminSpaceRoles,
  adminWorkspaceRoles,
  isOrgLeader,
  pickProjectAdminScope,
  pickSpaceAdminScope,
} from '../lib/scopedRoles'
import { canAccessPeopleDirectory, type PeopleListKind } from '../lib/roleHierarchy'

export function usePeopleScope() {
  const { org, workspace, workspaces, isLoading: contextLoading } = useCurrentContext()
  const { data: roles, isLoading: rolesLoading } = useUserRoles()
  const [params] = useSearchParams()

  const tabIsPeople = params.get('tab') === PEOPLE_TAB
  const workspaceFilterId = params.get(WORKSPACE_FILTER_PARAM)
  const spaceFilterId = params.get(SPACE_FILTER_PARAM)
  const projectFilterId = params.get(PROJECT_FILTER_PARAM)

  const isOrgLeaderUser = isOrgLeader(org)
  const adminWorkspaces = useMemo(
    () => (roles ? adminWorkspaceRoles(roles) : []),
    [roles],
  )
  const adminWorkspaceIds = useMemo(
    () => new Set(adminWorkspaces.map((wr) => wr.workspace_id)),
    [adminWorkspaces],
  )

  const isWorkspaceAdmin =
    !isOrgLeaderUser &&
    (roles?.highest_role === 'workspace_admin' ||
      adminWorkspaces.length > 0 ||
      workspace?.my_role === 'admin')

  const isSpaceAdminOnly =
    !isOrgLeaderUser && !isWorkspaceAdmin && roles?.highest_role === 'space_admin'
  const isProjectAdminOnly =
    !isOrgLeaderUser && !isWorkspaceAdmin && roles?.highest_role === 'project_admin'

  const scopedWorkspaceId = useMemo(() => {
    if (isOrgLeaderUser) return workspaceFilterId ?? null
    if (isWorkspaceAdmin) {
      if (workspaceFilterId && adminWorkspaceIds.has(workspaceFilterId)) return workspaceFilterId
      if (workspace?.id && adminWorkspaceIds.has(workspace.id)) return workspace.id
      if (workspace?.my_role === 'admin' && workspace.id) return workspace.id
      return adminWorkspaces[0]?.workspace_id ?? null
    }
    return null
  }, [
    adminWorkspaceIds,
    adminWorkspaces,
    isOrgLeaderUser,
    isWorkspaceAdmin,
    workspace?.id,
    workspace?.my_role,
    workspaceFilterId,
  ])

  const adminSpaces = useMemo(() => (roles ? adminSpaceRoles(roles) : []), [roles])
  const adminProjects = useMemo(() => (roles ? adminProjectRoles(roles) : []), [roles])
  /** Every project the user belongs to (admin, member or viewer). */
  const allProjects = useMemo(() => roles?.project_roles ?? [], [roles])

  const scopedSpaceId = useMemo(() => {
    if (!isSpaceAdminOnly || !roles) return null
    if (spaceFilterId && adminSpaces.some((s) => s.space_id === spaceFilterId)) return spaceFilterId
    const inWorkspace = workspace?.id
      ? adminSpaces.filter((s) => s.workspace_id === workspace.id)
      : adminSpaces
    return pickSpaceAdminScope(inWorkspace.length ? inWorkspace : adminSpaces, spaceFilterId)
  }, [adminSpaces, isSpaceAdminOnly, roles, spaceFilterId, workspace?.id])

  const scopedProjectId = useMemo(() => {
    if (!isProjectAdminOnly || !roles) return null
    // Any project the user belongs to can be VIEWED here — management is gated
    // separately on their role in that specific project (scopedProjectRole).
    if (projectFilterId && allProjects.some((p) => p.project_id === projectFilterId)) {
      return projectFilterId
    }
    const inWorkspace = workspace?.id
      ? adminProjects.filter((p) => p.workspace_id === workspace.id)
      : adminProjects
    return pickProjectAdminScope(inWorkspace.length ? inWorkspace : adminProjects, projectFilterId)
  }, [adminProjects, allProjects, isProjectAdminOnly, projectFilterId, roles, workspace?.id])

  /** The viewer's explicit role in the scoped project ('admin' | 'member' | 'viewer' | null). */
  const scopedProjectRole = useMemo(
    () => allProjects.find((p) => p.project_id === scopedProjectId)?.role ?? null,
    [allProjects, scopedProjectId],
  )

  const needsOrgMembers = isOrgLeaderUser || (!isWorkspaceAdmin && !isSpaceAdminOnly && !isProjectAdminOnly)
  const orgMembers = useOrganizationMembers(needsOrgMembers ? org?.id : undefined)
  const workspaceMembers = useWorkspaceMembers(
    isOrgLeaderUser
      ? (workspaceFilterId ?? undefined)
      : isWorkspaceAdmin
        ? (scopedWorkspaceId ?? undefined)
        : undefined,
  )
  const spaceMembers = useSpaceMembers(isSpaceAdminOnly ? scopedSpaceId ?? undefined : undefined)
  const projectMembers = useProjectMembers(isProjectAdminOnly ? scopedProjectId ?? undefined : undefined)

  const useWorkspaceMemberList = isWorkspaceAdmin && !!scopedWorkspaceId
  const useSpaceMemberList = isSpaceAdminOnly && !!scopedSpaceId
  const useProjectMemberList = isProjectAdminOnly && !!scopedProjectId

  /** Wait for role/context before choosing org-wide vs workspace-scoped lists. */
  const scopeResolving =
    !isOrgLeaderUser &&
    (contextLoading || rolesLoading) &&
    !isSpaceAdminOnly &&
    !isProjectAdminOnly

  const panelScope = useMemo((): PeoplePanelScope => {
    const fromUrl = resolvePeoplePanelScope(params)
    if (fromUrl.level === 'project') return fromUrl
    if (fromUrl.level === 'space') return fromUrl
    if (fromUrl.level === 'workspace') return fromUrl

    if (useProjectMemberList && scopedProjectId) {
      return { level: 'project', projectId: scopedProjectId }
    }
    if (useSpaceMemberList && scopedSpaceId) {
      return { level: 'space', spaceId: scopedSpaceId }
    }
    const workspaceScopeId = scopedWorkspaceId ?? workspaceFilterId
    if ((useWorkspaceMemberList || (isOrgLeaderUser && workspaceFilterId)) && workspaceScopeId) {
      return { level: 'workspace', workspaceId: workspaceScopeId }
    }
    return { level: 'org' }
  }, [
    params,
    isOrgLeaderUser,
    scopedProjectId,
    scopedSpaceId,
    scopedWorkspaceId,
    useProjectMemberList,
    useSpaceMemberList,
    useWorkspaceMemberList,
    workspaceFilterId,
  ])

  const members = useMemo(() => {
    if (scopeResolving) return []
    if (useWorkspaceMemberList) return workspaceMembers.data ?? []
    if (useProjectMemberList) return projectMembers.data ?? []
    if (useSpaceMemberList) return spaceMembers.data ?? []
    if (isOrgLeaderUser) {
      const all = orgMembers.data ?? []
      if (!workspaceFilterId) return all
      const wsUserIds = new Set((workspaceMembers.data ?? []).map((m) => m.user_id))
      return all.filter((m) => wsUserIds.has(m.user_id))
    }
    return orgMembers.data ?? []
  }, [
    scopeResolving,
    isOrgLeaderUser,
    orgMembers.data,
    projectMembers.data,
    spaceMembers.data,
    useProjectMemberList,
    useSpaceMemberList,
    useWorkspaceMemberList,
    workspaceFilterId,
    workspaceMembers.data,
  ])

  const isLoading =
    scopeResolving ||
    (needsOrgMembers ? orgMembers.isLoading : false) ||
    (useProjectMemberList ? projectMembers.isLoading : false) ||
    (useSpaceMemberList ? spaceMembers.isLoading : false) ||
    (useWorkspaceMemberList || (isOrgLeaderUser && workspaceFilterId)
      ? workspaceMembers.isLoading
      : false)

  const scopeLabel = useMemo(() => {
    if (useProjectMemberList && scopedProjectId) {
      return roles?.project_roles.find((p) => p.project_id === scopedProjectId)?.project_name ?? 'this project'
    }
    if (useSpaceMemberList && scopedSpaceId) {
      return roles?.space_roles.find((s) => s.space_id === scopedSpaceId)?.space_name ?? 'this space'
    }
    if ((useWorkspaceMemberList || (isOrgLeaderUser && workspaceFilterId)) && scopedWorkspaceId) {
      return (
        workspaces.find((w) => w.id === scopedWorkspaceId)?.name ??
        workspace?.name ??
        'this workspace'
      )
    }
    return org?.name ?? 'this organization'
  }, [
    isOrgLeaderUser,
    org?.name,
    roles?.project_roles,
    roles?.space_roles,
    scopedProjectId,
    scopedSpaceId,
    scopedWorkspaceId,
    useProjectMemberList,
    useSpaceMemberList,
    useWorkspaceMemberList,
    workspace?.name,
    workspaceFilterId,
    workspaces,
  ])

  const formatMemberRole = (role: string) => {
    if (useWorkspaceMemberList) return formatScopedRole('workspace', role)
    if (useProjectMemberList) return formatScopedRole('project', role)
    if (useSpaceMemberList) return formatScopedRole('space', role)
    return formatRoleLabel(role)
  }

  const peopleListKind = useMemo((): PeopleListKind => {
    if (useProjectMemberList) return 'project'
    if (useSpaceMemberList) return 'space'
    if (useWorkspaceMemberList || (isOrgLeaderUser && workspaceFilterId)) return 'workspace'
    return 'org'
  }, [
    isOrgLeaderUser,
    useProjectMemberList,
    useSpaceMemberList,
    useWorkspaceMemberList,
    workspaceFilterId,
  ])

  const hasPeopleAdminAccess = !rolesLoading && canAccessPeopleDirectory(roles?.highest_role)

  const canAccessPeopleTab = tabIsPeople && hasPeopleAdminAccess

  const canOpenMemberPanel = canAccessPeopleTab

  return {
    members,
    isLoading,
    panelScope,
    scopeLabel,
    formatMemberRole,
    canOpenMemberPanel,
    canAccessPeopleTab,
    hasPeopleAdminAccess,
    peopleListKind,
    isOrgLeaderUser,
    isWorkspaceAdmin,
    /** @deprecated use isWorkspaceAdmin */
    isWorkspaceAdminOnly: isWorkspaceAdmin,
    isSpaceAdminOnly,
    isProjectAdminOnly,
    scopedWorkspaceId,
    scopedSpaceId,
    scopedProjectId,
    scopedProjectRole,
    adminWorkspaces,
    adminSpaces,
    adminProjects,
    allProjects,
  }
}

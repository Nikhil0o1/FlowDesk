import { useMemo } from 'react'

import { useCurrentContext, useUserRoles } from '../lib/queries'
import { profileRoleDisplay } from '../lib/scopedRoles'
import {
  adminProjectRoles,
  adminSpaceRoles,
  adminWorkspaceRoles,
  isOrgLeader,
  pickProjectAdminScope,
  pickSpaceAdminScope,
  pickWorkspaceAdminScope,
} from '../lib/scopedRoles'

export interface AnalyticsScopeDefaults {
  workspaceId: string
  spaceId: string
  projectId: string
}

export interface AnalyticsScopeOption {
  id: string
  name: string
  workspace_id?: string
}

/**
 * Role-aware analytics filter scope — mirrors People directory scoping.
 * Org leaders see the whole org; scoped admins only see (and pick) their
 * administered workspaces, spaces, or projects.
 */
export function useAnalyticsScope() {
  const { org, workspace, workspaces, isLoading: contextLoading } = useCurrentContext()
  const { data: roles, isLoading: rolesLoading } = useUserRoles()

  const ready = !contextLoading && !rolesLoading && !!org && !!roles

  const orgLeader = isOrgLeader(org)

  const adminWorkspaces = useMemo(
    () => (roles ? adminWorkspaceRoles(roles) : []),
    [roles],
  )
  const adminSpaces = useMemo(() => (roles ? adminSpaceRoles(roles) : []), [roles])
  const adminProjects = useMemo(() => (roles ? adminProjectRoles(roles) : []), [roles])

  const highest = roles?.highest_role ?? null
  const isWorkspaceAdmin =
    !orgLeader &&
    (highest === 'workspace_admin' || adminWorkspaces.length > 0)
  const isSpaceAdminOnly =
    !orgLeader && !isWorkspaceAdmin && highest === 'space_admin'
  const isProjectAdminOnly =
    !orgLeader && !isWorkspaceAdmin && highest === 'project_admin'

  const defaults = useMemo((): AnalyticsScopeDefaults => {
    if (!ready) {
      return { workspaceId: '', spaceId: '', projectId: '' }
    }
    if (orgLeader) {
      return { workspaceId: '', spaceId: '', projectId: '' }
    }
    if (isWorkspaceAdmin) {
      const wsId =
        pickWorkspaceAdminScope(adminWorkspaces, workspace?.id, null) ?? ''
      return { workspaceId: wsId, spaceId: '', projectId: '' }
    }
    if (isSpaceAdminOnly) {
      const spId = pickSpaceAdminScope(adminSpaces, null) ?? ''
      const space = adminSpaces.find((s) => s.space_id === spId)
      return {
        workspaceId: space?.workspace_id ?? '',
        spaceId: spId,
        projectId: '',
      }
    }
    if (isProjectAdminOnly) {
      const prId = pickProjectAdminScope(adminProjects, null) ?? ''
      const project = adminProjects.find((p) => p.project_id === prId)
      return {
        workspaceId: project?.workspace_id ?? '',
        spaceId: '',
        projectId: prId,
      }
    }
    return { workspaceId: '', spaceId: '', projectId: '' }
  }, [
    adminProjects,
    adminSpaces,
    adminWorkspaces,
    isProjectAdminOnly,
    isSpaceAdminOnly,
    isWorkspaceAdmin,
    orgLeader,
    ready,
    workspace?.id,
  ])

  const workspaceOptions = useMemo((): AnalyticsScopeOption[] => {
    if (!ready) return []
    if (orgLeader) {
      return workspaces.map((w) => ({ id: w.id, name: w.name }))
    }
    if (isWorkspaceAdmin) {
      return adminWorkspaces.map((w) => ({
        id: w.workspace_id,
        name: w.workspace_name,
      }))
    }
    if (isSpaceAdminOnly) {
      const seen = new Map<string, string>()
      for (const s of adminSpaces) {
        seen.set(s.workspace_id, s.workspace_name)
      }
      return [...seen.entries()].map(([id, name]) => ({ id, name }))
    }
    if (isProjectAdminOnly) {
      const wsNameById = new Map(workspaces.map((w) => [w.id, w.name]))
      const seen = new Map<string, string>()
      for (const p of adminProjects) {
        seen.set(p.workspace_id, wsNameById.get(p.workspace_id) ?? 'Workspace')
      }
      return [...seen.entries()].map(([id, name]) => ({ id, name }))
    }
    return []
  }, [
    adminProjects,
    adminSpaces,
    adminWorkspaces,
    isProjectAdminOnly,
    isSpaceAdminOnly,
    isWorkspaceAdmin,
    orgLeader,
    ready,
    workspaces,
  ])

  const spaceOptions = useMemo((): AnalyticsScopeOption[] => {
    if (!ready || orgLeader) return []
    if (isSpaceAdminOnly) {
      return adminSpaces.map((s) => ({
        id: s.space_id,
        name: s.space_name,
        workspace_id: s.workspace_id,
      }))
    }
    return []
  }, [adminSpaces, isSpaceAdminOnly, orgLeader, ready])

  const projectOptions = useMemo((): AnalyticsScopeOption[] => {
    if (!ready || orgLeader) return []
    if (isProjectAdminOnly) {
      return adminProjects.map((p) => ({
        id: p.project_id,
        name: p.project_name,
        workspace_id: p.workspace_id,
      }))
    }
    return []
  }, [adminProjects, isProjectAdminOnly, orgLeader, ready])

  const scopeLabel = useMemo(() => {
    if (!ready || !roles) return ''
    const { title, detail } = profileRoleDisplay(roles)
    return detail ? `${title} · ${detail}` : title
  }, [ready, roles])

  return {
    ready,
    orgLeader,
    isWorkspaceAdmin,
    isSpaceAdminOnly,
    isProjectAdminOnly,
    defaults,
    workspaceOptions,
    spaceOptions,
    projectOptions,
    scopeLabel,
    canPickOrgRole: orgLeader,
    canPickWorkspace: orgLeader || isWorkspaceAdmin,
    canPickSpace: orgLeader || isSpaceAdminOnly,
    canPickProject: orgLeader || isProjectAdminOnly,
    workspaceAllLabel: orgLeader
      ? 'All workspaces'
      : isWorkspaceAdmin
        ? 'All my workspaces'
        : 'Workspace',
    showWorkspaceAll: orgLeader || (isWorkspaceAdmin && workspaceOptions.length > 1),
    showSpaceFilter: orgLeader || isSpaceAdminOnly || isWorkspaceAdmin,
    showProjectFilter: orgLeader || isProjectAdminOnly || isWorkspaceAdmin,
    lockWorkspace: isSpaceAdminOnly || isProjectAdminOnly,
    lockSpace: isProjectAdminOnly,
    lockProject: isProjectAdminOnly && adminProjects.length === 1,
  }
}

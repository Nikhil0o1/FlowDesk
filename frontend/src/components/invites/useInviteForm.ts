import { useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { INVITE_EMAIL_ERROR, isValidInviteEmail } from '../../lib/emailValidation'
import { useCurrentContext, useProjects, useSpaces, useUserRoles } from '../../lib/queries'
import { adminSpaceRoles } from '../../lib/scopedRoles'
import type { Organization } from '../../lib/types'
import { useUIStore } from '../../stores/ui'
import { toast } from '../../stores/toast'
import {
  buildOrgBulkGrants,
  canInviteToProject,
  canInviteToSpace,
  canInviteToWorkspace,
  defaultRoleForScope,
  inviteableProjects,
  inviteableSpaces,
  inviteableWorkspaces,
  inviteableWorkspacesForScope,
  isSpaceInviteProjectRole,
  normalizeRoleForScope,
  resolveInviteScope,
  usesWorkspaceAdminInviteFlow,
  type InviteScope,
  type WorkspaceAdminAdminKind,
  type WorkspaceAdminTopRole,
} from './inviteScopes'

export function useInviteForm({
  open,
  onClose,
  defaultScope = 'workspace',
  defaultWorkspaceId = '',
  defaultProjectId = '',
}: {
  open: boolean
  onClose: () => void
  defaultScope?: InviteScope
  defaultWorkspaceId?: string
  defaultProjectId?: string
}) {
  const { org, workspace, workspaces, isLoading: contextLoading } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const inviteWorkspaceId = useUIStore((s) => s.inviteWorkspaceId)
  const setInviteWorkspaceId = useUIStore((s) => s.setInviteWorkspaceId)
  const inviteFlowKind = useUIStore((s) => s.inviteFlowKind)
  const setInviteFlowKind = useUIStore((s) => s.setInviteFlowKind)
  const inviteSpaceId = useUIStore((s) => s.inviteSpaceId)
  const setInviteSpaceId = useUIStore((s) => s.setInviteSpaceId)
  const inviteProjectId = useUIStore((s) => s.inviteProjectId)
  const setInviteProjectId = useUIStore((s) => s.setInviteProjectId)
  const isOrgAdminOrOwner = org?.my_role === 'owner' || org?.my_role === 'admin'
  const isSpaceAdminFlow = inviteFlowKind === 'space'
  const isProjectAdminFlow = inviteFlowKind === 'project'
  const isWorkspaceAdminFlow =
    inviteFlowKind === 'workspace' ||
    (!inviteFlowKind && usesWorkspaceAdminInviteFlow(isOrgAdminOrOwner, workspaces))
  const isGuidedInviteFlow = isWorkspaceAdminFlow || isSpaceAdminFlow || isProjectAdminFlow

  const [email, setEmail] = useState('')
  const [emailBlurred, setEmailBlurred] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [scope, setScope] = useState<InviteScope>(defaultScope)
  const [role, setRole] = useState(() => defaultRoleForScope(defaultScope))
  const [topRole, setTopRole] = useState<WorkspaceAdminTopRole>('member')
  const [adminKind, setAdminKind] = useState<WorkspaceAdminAdminKind | ''>('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([])
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [activeProjectId, setActiveProjectId] = useState('')
  const [sending, setSending] = useState(false)

  const wsAdminWorkspaces = useMemo(
    () => inviteableWorkspaces(workspaces, false),
    [workspaces],
  )

  const pinnedSpace = userRoles?.space_roles.find(
    (s) => s.space_id === inviteSpaceId || s.space_id === activeSpaceId,
  )
  const pinnedProject = userRoles?.project_roles.find((p) => p.project_id === inviteProjectId)

  const spaceAdminScopeId =
    activeSpaceId ||
    inviteSpaceId ||
    pinnedSpace?.space_id ||
    (userRoles ? adminSpaceRoles(userRoles)[0]?.space_id : '') ||
    ''

  const guidedWorkspaceId = useMemo(() => {
    if (isSpaceAdminFlow) {
      const fromRole = userRoles?.space_roles.find((s) => s.space_id === spaceAdminScopeId)
      return (
        workspaceId ||
        inviteWorkspaceId ||
        fromRole?.workspace_id ||
        pinnedSpace?.workspace_id ||
        workspace?.id ||
        ''
      )
    }
    if (isProjectAdminFlow) {
      return (
        workspaceId ||
        inviteWorkspaceId ||
        pinnedProject?.workspace_id ||
        workspace?.id ||
        ''
      )
    }
    if (isWorkspaceAdminFlow) {
      return workspaceId || inviteWorkspaceId || defaultWorkspaceId || workspace?.id || ''
    }
    return workspaceId || workspace?.id || ''
  }, [
    isSpaceAdminFlow,
    isProjectAdminFlow,
    isWorkspaceAdminFlow,
    workspaceId,
    inviteWorkspaceId,
    defaultWorkspaceId,
    workspace?.id,
    spaceAdminScopeId,
    userRoles?.space_roles,
    pinnedSpace?.workspace_id,
    pinnedProject?.workspace_id,
  ])

  // Load projects/spaces for the current workspace to evaluate permissions and targets.
  const contextProjectsQuery = useProjects(workspace?.id)
  const contextProjects = contextProjectsQuery.data ?? []
  const contextSpacesQuery = useSpaces(workspace?.id)
  const contextSpaces = contextSpacesQuery.data ?? []

  const canWorkspaceInvite = canInviteToWorkspace(workspaces, isOrgAdminOrOwner) && !isWorkspaceAdminFlow

  // Load spaces/projects for the guided invite workspace (store pins apply before form state syncs).
  const spacesQuery = useSpaces(
    (isGuidedInviteFlow || scope === 'space' || scope === 'project') && guidedWorkspaceId
      ? guidedWorkspaceId
      : undefined,
  )
  const projectsQuery = useProjects(
    (isGuidedInviteFlow || scope === 'space' || scope === 'project') && guidedWorkspaceId
      ? guidedWorkspaceId
      : undefined,
  )

  const canSpaceInvite = canInviteToSpace(contextSpaces, isOrgAdminOrOwner)
  const canProjectInvite = canInviteToProject(contextProjects)

  const inviteWorkspaces = useMemo(
    () =>
      isWorkspaceAdminFlow
        ? wsAdminWorkspaces
        : inviteableWorkspacesForScope(
            scope,
            workspaces,
            contextProjects,
            isOrgAdminOrOwner,
            contextSpaces,
          ),
    [
      isWorkspaceAdminFlow,
      wsAdminWorkspaces,
      scope,
      workspaces,
      contextProjects,
      isOrgAdminOrOwner,
      contextSpaces,
    ],
  )

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId)
  const inviteSpacesForWs = useMemo(
    () => inviteableSpaces(spacesQuery.data ?? [], isOrgAdminOrOwner),
    [spacesQuery.data, isOrgAdminOrOwner],
  )
  const inviteProjectsAll = useMemo(() => {
    const raw = (projectsQuery.data ?? []).filter((p) => !p.is_archived)
    // Space admins: API already limits projects to their spaces — no client-side permission filter.
    if (isSpaceAdminFlow && spaceAdminScopeId) {
      return raw.filter((p) => p.space_id === spaceAdminScopeId)
    }
    return inviteableProjects(raw, selectedWorkspace, isOrgAdminOrOwner, {
      spaces: spacesQuery.data ?? [],
      spaceId: isSpaceAdminFlow && spaceAdminScopeId ? spaceAdminScopeId : undefined,
    })
  }, [
    projectsQuery.data,
    selectedWorkspace,
    isOrgAdminOrOwner,
    spacesQuery.data,
    isSpaceAdminFlow,
    spaceAdminScopeId,
  ])
  const inviteProjects = useMemo(() => {
    if (isSpaceAdminFlow && spaceAdminScopeId) {
      return inviteProjectsAll
    }
    if (isProjectAdminFlow) {
      return inviteProjectsAll.filter((p) => p.my_explicit_role === 'admin')
    }
    if (isWorkspaceAdminFlow) return inviteProjectsAll
    if (scope === 'project') return inviteProjectsAll
    if (scope === 'space' && isSpaceInviteProjectRole(role)) return inviteProjectsAll
    return []
  }, [
    isSpaceAdminFlow,
    isProjectAdminFlow,
    spaceAdminScopeId,
    isWorkspaceAdminFlow,
    scope,
    role,
    inviteProjectsAll,
  ])

  const resolvedWorkspaceId = isWorkspaceAdminFlow
    ? workspaceId
    : inviteWorkspaces.some((w) => w.id === workspaceId)
      ? workspaceId
      : inviteWorkspaces[0]?.id ?? ''
  const resolvedSpaceId = isWorkspaceAdminFlow
    ? spaceId
    : inviteSpacesForWs.some((s) => s.id === spaceId)
      ? spaceId
      : inviteSpacesForWs[0]?.id ?? ''
  const resolvedProjectId = isWorkspaceAdminFlow
    ? projectId
    : inviteProjects.some((p) => p.id === projectId)
      ? projectId
      : inviteProjects[0]?.id ?? ''

  useEffect(() => {
    if (!open) return
    if (isSpaceAdminFlow) {
      const nextSpaceId =
        inviteSpaceId ||
        activeSpaceId ||
        (userRoles ? adminSpaceRoles(userRoles)[0]?.space_id : '') ||
        ''
      setActiveSpaceId(nextSpaceId)
      setTopRole('member')
      setAdminKind('')
      setEmail('')
      setEmailBlurred(false)
      setSubmitAttempted(false)
      setSelectedSpaceIds([])
      setSelectedProjectIds([])
      const spaceMeta = userRoles?.space_roles.find((s) => s.space_id === nextSpaceId)
      const wsId =
        inviteWorkspaceId || spaceMeta?.workspace_id || pinnedSpace?.workspace_id || workspace?.id || ''
      setWorkspaceId(wsId)
      setInviteSpaceId(null)
      setInviteWorkspaceId(null)
      return
    }
    if (isProjectAdminFlow) {
      const projectId = inviteProjectId || pinnedProject?.project_id || ''
      setActiveProjectId(projectId)
      setTopRole('member')
      setAdminKind('')
      setEmail('')
      setEmailBlurred(false)
      setSubmitAttempted(false)
      setSelectedSpaceIds([])
      setSelectedProjectIds(projectId ? [projectId] : [])
      const wsId = pinnedProject?.workspace_id || workspace?.id || ''
      setWorkspaceId(wsId)
      setInviteProjectId(null)
      return
    }
    if (isWorkspaceAdminFlow) {
      setTopRole('member')
      setAdminKind('')
      setEmail('')
      setEmailBlurred(false)
      setSubmitAttempted(false)
      setSpaceId('')
      setProjectId('')
      setSelectedSpaceIds([])
      setSelectedProjectIds([])
      const pinned = inviteWorkspaceId || defaultWorkspaceId || workspace?.id || ''
      const list = wsAdminWorkspaces
      if (pinned && list.some((w) => w.id === pinned)) {
        setWorkspaceId(pinned)
      } else if (list.length === 1) {
        setWorkspaceId(list[0]!.id)
      } else {
        setWorkspaceId('')
      }
      setInviteWorkspaceId(null)
      return
    }
    const resolvedScope = resolveInviteScope(
      defaultScope,
      isOrgAdminOrOwner,
      workspaces,
      contextSpaces,
      contextProjects,
    )
    setScope(resolvedScope)
    setRole(defaultRoleForScope(resolvedScope))
    setEmail('')
    setEmailBlurred(false)
    setSubmitAttempted(false)
    setProjectId(defaultProjectId)
    setSpaceId('')
    setSelectedWorkspaceIds([])
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
    setWorkspaceId(defaultWorkspaceId || workspace?.id || '')
  }, [
    open,
    isWorkspaceAdminFlow,
    isSpaceAdminFlow,
    isProjectAdminFlow,
    inviteWorkspaceId,
    inviteSpaceId,
    inviteProjectId,
    pinnedSpace?.space_id,
    pinnedSpace?.workspace_id,
    pinnedProject?.workspace_id,
    userRoles,
    setInviteWorkspaceId,
    setInviteSpaceId,
    setInviteProjectId,
    defaultScope,
    defaultWorkspaceId,
    defaultProjectId,
    workspace?.id,
    isOrgAdminOrOwner,
    workspaces,
    wsAdminWorkspaces,
    contextSpaces,
    contextProjects,
  ])

  useEffect(() => {
    if (!open || isWorkspaceAdminFlow || workspaceId) return
    const fallback = inviteWorkspaces[0]?.id
    if (fallback) setWorkspaceId(fallback)
  }, [open, isWorkspaceAdminFlow, workspaceId, inviteWorkspaces])

  useEffect(() => {
    setRole((current) => normalizeRoleForScope(scope, current))
    if (!isWorkspaceAdminFlow) {
      setSelectedWorkspaceIds([])
      setSelectedSpaceIds([])
      setSelectedProjectIds([])
    }
  }, [scope, isWorkspaceAdminFlow])

  useEffect(() => {
    if (isWorkspaceAdminFlow || scope !== 'space') return
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
  }, [role, scope, isWorkspaceAdminFlow])

  useEffect(() => {
    if (scope === 'space' && role === 'space_admin') {
      setProjectId('')
      setSelectedProjectIds([])
    }
  }, [scope, role])

  useEffect(() => {
    if (!open || isWorkspaceAdminFlow || scope !== 'workspace') return
    if (inviteWorkspaces.length === 1 && selectedWorkspaceIds.length === 0) {
      setSelectedWorkspaceIds([inviteWorkspaces[0]!.id])
    }
  }, [open, isWorkspaceAdminFlow, scope, inviteWorkspaces, selectedWorkspaceIds.length])

  const trimmedEmail = email.trim()
  const emailInvalid = trimmedEmail.length > 0 && !isValidInviteEmail(trimmedEmail)
  const domainPart = trimmedEmail.split('@')[1] ?? ''
  const domainLooksComplete = domainPart.includes('.')
  const emailError =
    emailInvalid && (emailBlurred || submitAttempted || domainLooksComplete)
      ? INVITE_EMAIL_ERROR
      : null

  const workspaceReady =
    inviteWorkspaces.length <= 1 || !!resolvedWorkspaceId

  const workspaceAdminTargetsReady =
    topRole === 'member' || topRole === 'viewer'
      ? selectedProjectIds.length > 0
      : adminKind === 'space_admin'
        ? selectedSpaceIds.length > 0
        : adminKind === 'project_admin'
          ? selectedProjectIds.length > 0
          : false

  const scopedTargetsReady =
    scope === 'workspace'
      ? selectedWorkspaceIds.length > 0
      : scope === 'space'
        ? !!resolvedWorkspaceId &&
          (role === 'space_admin'
            ? selectedSpaceIds.length > 0
            : isSpaceInviteProjectRole(role)
              ? selectedProjectIds.length > 0
              : false)
        : scope === 'project'
          ? !!resolvedWorkspaceId && selectedProjectIds.length > 0
          : false

  const scopedAdminTargetsReady = selectedProjectIds.length > 0

  const canSubmit =
    !!trimmedEmail &&
    isValidInviteEmail(trimmedEmail) &&
    !sending &&
    (isSpaceAdminFlow || isProjectAdminFlow
      ? scopedAdminTargetsReady
      : isWorkspaceAdminFlow
        ? workspaceReady && workspaceAdminTargetsReady
        : scope === 'organization'
          ? !!org
          : scopedTargetsReady)

  const send = async () => {
    if (!trimmedEmail || !isValidInviteEmail(trimmedEmail)) {
      setSubmitAttempted(true)
      return
    }
    if (!canSubmit) return
    setSending(true)
    try {
      if (isSpaceAdminFlow) {
        const result = await sendSpaceAdminInvite({
          spaceId: activeSpaceId,
          topRole,
          email: trimmedEmail,
          selectedProjectIds,
        })
        showInviteResultToast(trimmedEmail, result)
      } else if (isProjectAdminFlow) {
        // The anchor project only drives the bulk endpoint's workspace/permission
        // context; the actual targets are selectedProjectIds. When the invite is
        // opened without a pinned project, fall back to the first selected project
        // (all selected projects are ones the admin manages in this workspace).
        const anchorProjectId = selectedProjectIds.includes(activeProjectId)
          ? activeProjectId
          : selectedProjectIds[0] ?? activeProjectId
        const result = await sendProjectAdminInvite({
          anchorProjectId,
          topRole,
          email: trimmedEmail,
          selectedProjectIds,
        })
        showInviteResultToast(trimmedEmail, result)
      } else if (isWorkspaceAdminFlow) {
        const result = await sendWorkspaceAdminInvite({
          topRole,
          adminKind,
          email: trimmedEmail,
          workspaceId: resolvedWorkspaceId,
          selectedSpaceIds,
          selectedProjectIds,
        })
        showInviteResultToast(trimmedEmail, result)
      } else {
        const result = await sendScopedBulkInvite({
          scope,
          role,
          email: trimmedEmail,
          org,
          selectedWorkspaceIds,
          selectedSpaceIds,
          selectedProjectIds,
        })
        showInviteResultToast(trimmedEmail, result)
      }
      setEmail('')
      setInviteFlowKind(null)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const handleWorkspaceChange = (id: string) => {
    setWorkspaceId(id)
    setSpaceId('')
    setProjectId('')
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
  }

  const handleScopeChange = (next: InviteScope) => {
    setScope(next)
    setSelectedWorkspaceIds([])
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
  }

  const handleSpaceChange = (id: string) => {
    setSpaceId(id)
    setProjectId('')
  }

  const handleTopRoleChange = (next: WorkspaceAdminTopRole) => {
    setTopRole(next)
    setAdminKind('')
    setSpaceId('')
    setProjectId('')
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
  }

  const handleAdminKindChange = (next: WorkspaceAdminAdminKind) => {
    setAdminKind(next)
    setSpaceId('')
    setProjectId('')
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
  }

  return {
    email,
    setEmail,
    emailError,
    onEmailBlur: () => setEmailBlurred(true),
    scope,
    setScope: handleScopeChange,
    role,
    setRole,
    topRole,
    setTopRole: handleTopRoleChange,
    adminKind,
    setAdminKind: handleAdminKindChange,
    workspaceId: resolvedWorkspaceId,
    setWorkspaceId: handleWorkspaceChange,
    selectedWorkspaceIds,
    setSelectedWorkspaceIds,
    spaceId: resolvedSpaceId,
    setSpaceId: handleSpaceChange,
    selectedSpaceIds,
    setSelectedSpaceIds,
    projectId: resolvedProjectId,
    setProjectId,
    selectedProjectIds,
    setSelectedProjectIds,
    sending,
    send,
    canSubmit,
    isWorkspaceAdminFlow,
    isSpaceAdminFlow,
    isProjectAdminFlow,
    isGuidedInviteFlow,
    isOrgAdminOrOwner,
    canWorkspaceInvite,
    canSpaceInvite,
    canProjectInvite,
    inviteWorkspaces,
    inviteSpaces: inviteSpacesForWs,
    inviteProjects,
    workspacesLoading: contextLoading,
    spacesLoading: spacesQuery.isPending,
    projectsLoading: projectsQuery.isPending,
    spaceName:
      userRoles?.space_roles.find((s) => s.space_id === spaceAdminScopeId)?.space_name ??
      'this space',
    projectName:
      userRoles?.project_roles.find((p) => p.project_id === activeProjectId)?.project_name ??
      'this project',
    activeSpaceId,
    activeProjectId,
  }
}

async function sendWorkspaceAdminInvite({
  topRole,
  adminKind,
  email,
  workspaceId,
  selectedSpaceIds,
  selectedProjectIds,
}: {
  topRole: WorkspaceAdminTopRole
  adminKind: WorkspaceAdminAdminKind | ''
  email: string
  workspaceId: string
  selectedSpaceIds: string[]
  selectedProjectIds: string[]
}) {
  if (!workspaceId) throw new Error('Select a workspace first')

  type Grant = { scope: 'space' | 'project'; role: string; space_id?: string; project_id?: string }
  const grants: Grant[] = []

  if (topRole === 'admin' && adminKind === 'space_admin') {
    if (selectedSpaceIds.length === 0) throw new Error('Select at least one space')
    for (const spaceId of selectedSpaceIds) {
      grants.push({ scope: 'space', role: 'admin', space_id: spaceId })
    }
  } else if (topRole === 'admin' && adminKind === 'project_admin') {
    if (selectedProjectIds.length === 0) throw new Error('Select at least one project')
    for (const projectId of selectedProjectIds) {
      grants.push({ scope: 'project', role: 'admin', project_id: projectId })
    }
  } else if (topRole === 'member' || topRole === 'viewer') {
    if (selectedProjectIds.length === 0) throw new Error('Select at least one project')
    const role = topRole === 'viewer' ? 'viewer' : 'member'
    for (const projectId of selectedProjectIds) {
      grants.push({ scope: 'project', role, project_id: projectId })
    }
  } else {
    throw new Error('Select a role and at least one target')
  }

  const response = await api.post<{ invites: unknown[]; skipped: string[] }>(
    `/workspaces/${workspaceId}/invites/bulk`,
    { email, grants },
  )
  return { created: response.invites.length, skipped: response.skipped ?? [] }
}

async function sendSpaceAdminInvite({
  spaceId,
  topRole,
  email,
  selectedProjectIds,
}: {
  spaceId: string
  topRole: WorkspaceAdminTopRole
  email: string
  selectedProjectIds: string[]
}) {
  if (!spaceId) throw new Error('Select a space first')
  if (selectedProjectIds.length === 0) throw new Error('Select at least one project')
  const role =
    topRole === 'admin' ? 'admin' : topRole === 'viewer' ? 'viewer' : 'member'
  const grants = selectedProjectIds.map((projectId) => ({
    scope: 'project' as const,
    role,
    project_id: projectId,
  }))
  const response = await api.post<{ invites: unknown[]; skipped: string[] }>(
    `/spaces/${spaceId}/invites/bulk`,
    { email, grants },
  )
  return { created: response.invites.length, skipped: response.skipped ?? [] }
}

async function sendProjectAdminInvite({
  anchorProjectId,
  topRole,
  email,
  selectedProjectIds,
}: {
  anchorProjectId: string
  topRole: WorkspaceAdminTopRole
  email: string
  selectedProjectIds: string[]
}) {
  if (!anchorProjectId) throw new Error('Select a project first')
  if (selectedProjectIds.length === 0) throw new Error('Select at least one project')
  const role =
    topRole === 'admin' ? 'admin' : topRole === 'viewer' ? 'viewer' : 'member'
  const grants = selectedProjectIds.map((projectId) => ({
    scope: 'project' as const,
    role,
    project_id: projectId,
  }))
  const response = await api.post<{ invites: unknown[]; skipped: string[] }>(
    `/projects/${anchorProjectId}/invites/bulk`,
    { email, grants },
  )
  return { created: response.invites.length, skipped: response.skipped ?? [] }
}

function showInviteResultToast(
  email: string,
  result: { created: number; skipped: string[] },
) {
  if (result.skipped.length > 0) {
    toast.success(
      `Sent ${result.created} invitation${result.created === 1 ? '' : 's'} to ${email} (${result.skipped.length} skipped)`,
    )
    return
  }
  if (result.created === 1) {
    toast.success(`Invitation sent to ${email}`)
    return
  }
  toast.success(`Sent ${result.created} invitations to ${email}`)
}

async function sendScopedBulkInvite({
  scope,
  role,
  email,
  org,
  selectedWorkspaceIds,
  selectedSpaceIds,
  selectedProjectIds,
}: {
  scope: InviteScope
  role: string
  email: string
  org: Organization | null
  selectedWorkspaceIds: string[]
  selectedSpaceIds: string[]
  selectedProjectIds: string[]
}) {
  if (scope === 'organization') {
    if (!org) throw new Error('Select an organization first')
    await api.post(`/organizations/${org.id}/invites`, { email, role })
    return { created: 1, skipped: [] as string[] }
  }

  if (!org) throw new Error('Select an organization first')
  const grants = buildOrgBulkGrants(
    scope,
    role,
    selectedWorkspaceIds,
    selectedSpaceIds,
    selectedProjectIds,
  )
  if (grants.length === 0) throw new Error('Select at least one target')

  const response = await api.post<{ invites: unknown[]; skipped: string[] }>(
    `/organizations/${org.id}/invites/bulk`,
    { email, grants },
  )
  return { created: response.invites.length, skipped: response.skipped ?? [] }
}

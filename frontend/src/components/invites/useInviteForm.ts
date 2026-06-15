import { useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { Organization } from '../../lib/types'
import { toast } from '../../stores/toast'
import {
  defaultRoleForScope,
  inviteableProjects,
  inviteableWorkspaces,
  normalizeRoleForScope,
  type InviteScope,
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
  const isOrgOwner = org?.my_role === 'owner'

  const [email, setEmail] = useState('')
  const [scope, setScope] = useState<InviteScope>(defaultScope)
  const [role, setRole] = useState(() => defaultRoleForScope(defaultScope))
  const [workspaceId, setWorkspaceId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [sending, setSending] = useState(false)

  const inviteWorkspaces = useMemo(
    () => inviteableWorkspaces(workspaces, isOrgOwner),
    [workspaces, isOrgOwner],
  )

  const projectsQuery = useProjects(
    scope === 'project' && workspaceId ? workspaceId : undefined,
  )
  const selectedWorkspace = inviteWorkspaces.find((w) => w.id === workspaceId)
  const inviteProjects = useMemo(
    () => inviteableProjects(projectsQuery.data ?? [], selectedWorkspace, isOrgOwner),
    [projectsQuery.data, selectedWorkspace, isOrgOwner],
  )

  const resolvedWorkspaceId = workspaceId || inviteWorkspaces[0]?.id || ''
  const resolvedProjectId = projectId || inviteProjects[0]?.id || ''

  useEffect(() => {
    if (!open) return
    setScope(defaultScope)
    setRole(defaultRoleForScope(defaultScope))
    setEmail('')
    setProjectId(defaultProjectId)
    setWorkspaceId(defaultWorkspaceId || workspace?.id || '')
  }, [open, defaultScope, defaultWorkspaceId, defaultProjectId, workspace?.id])

  // Once workspaces load, pick a default if we still have no selection
  useEffect(() => {
    if (!open || workspaceId) return
    const fallback = inviteWorkspaces[0]?.id
    if (fallback) setWorkspaceId(fallback)
  }, [open, workspaceId, inviteWorkspaces])

  useEffect(() => {
    setRole((current) => normalizeRoleForScope(scope, current))
  }, [scope])

  useEffect(() => {
    if (scope !== 'project' || !workspaceId) return
    if (inviteProjects.length === 0) {
      setProjectId('')
      return
    }
    if (!inviteProjects.some((p) => p.id === projectId)) {
      const preferred =
        defaultProjectId && inviteProjects.some((p) => p.id === defaultProjectId)
          ? defaultProjectId
          : inviteProjects[0].id
      setProjectId(preferred)
    }
  }, [scope, workspaceId, inviteProjects, projectId, defaultProjectId])

  const canSubmit =
    !!email.trim() &&
    !sending &&
    (scope === 'organization'
      ? !!org
      : scope === 'workspace'
        ? inviteWorkspaces.length > 0 && !!resolvedWorkspaceId
        : inviteWorkspaces.length > 0 &&
          !!resolvedWorkspaceId &&
          inviteProjects.length > 0 &&
          !!resolvedProjectId)

  const send = async () => {
    if (!canSubmit) return
    setSending(true)
    try {
      await sendInvite({
        scope,
        role,
        email: email.trim(),
        org,
        workspaceId: resolvedWorkspaceId,
        projectId: resolvedProjectId,
      })
      toast.success(`Invitation sent to ${email.trim()}`)
      setEmail('')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return {
    email,
    setEmail,
    scope,
    setScope,
    role,
    setRole,
    workspaceId: resolvedWorkspaceId,
    setWorkspaceId,
    projectId: resolvedProjectId,
    setProjectId,
    sending,
    send,
    canSubmit,
    isOrgOwner,
    inviteWorkspaces,
    inviteProjects,
    workspacesLoading: contextLoading,
    projectsLoading: projectsQuery.isPending,
  }
}

async function sendInvite({
  scope,
  role,
  email,
  org,
  workspaceId,
  projectId,
}: {
  scope: InviteScope
  role: string
  email: string
  org: Organization | null
  workspaceId: string
  projectId: string
}) {
  if (scope === 'organization') {
    if (!org) throw new Error('Select an organization first')
    await api.post(`/organizations/${org.id}/invites`, { email, role })
    return
  }

  if (scope === 'workspace') {
    if (!workspaceId) {
      throw new Error('Select a workspace first, or invite to the organization instead')
    }
    await api.post(`/workspaces/${workspaceId}/invites`, {
      email,
      role: role === 'owner' ? 'admin' : role,
    })
    return
  }

  if (!projectId) throw new Error('Select a project first')
  await api.post(`/projects/${projectId}/invites`, { email, role })
}

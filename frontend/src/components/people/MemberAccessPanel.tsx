import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Shield, X } from 'lucide-react'
import { useMemo } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useMemberAccess, useUserRoles } from '../../lib/queries'
import type { PeoplePanelScope } from '../../lib/peopleRoutes'
import type { MemberAccessDetail } from '../../lib/types'
import { formatRoleLabel, formatScopedRole } from '../../lib/roleLabels'
import {
  actorCanManageProjectScope,
  actorCanManageSpaceScope,
  actorCanManageWorkspaceScope,
  canGrantScopedRole,
  canManageByHierarchy,
  rankForProjectRole,
  rankForSpaceRole,
  rankForWorkspaceRole,
} from '../../lib/roleHierarchy'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'

type OrgRole = 'admin' | 'member'
type WsRole = 'admin' | 'member'
type SpaceRole = 'admin' | 'member'
type ProjectRole = 'admin' | 'member' | 'viewer'

function invalidateRoleCaches(queryClient: ReturnType<typeof useQueryClient>, orgId: string, userId: string) {
  void queryClient.invalidateQueries({ queryKey: ['member-access', orgId, userId] })
  void queryClient.invalidateQueries({ queryKey: ['organization-members', orgId] })
  void queryClient.invalidateQueries({ queryKey: ['user-roles'] })
  void queryClient.invalidateQueries({ queryKey: ['workspaces', orgId] })
  void queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
  void queryClient.invalidateQueries({ queryKey: ['space-members'] })
  void queryClient.invalidateQueries({ queryKey: ['project-members'] })
  void queryClient.invalidateQueries({ queryKey: ['spaces'] })
  void queryClient.invalidateQueries({ queryKey: ['projects'] })
  void queryClient.invalidateQueries({ queryKey: ['org-dashboard', orgId] })
}

export function MemberAccessPanel({
  orgId,
  userId,
  actorOrgRole,
  scope = { level: 'org' },
  onClose,
}: {
  orgId: string
  userId: string
  actorOrgRole: string | null | undefined
  scope?: PeoplePanelScope
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: access, isLoading, isError, error, refetch } = useMemberAccess(orgId, userId, scope)
  const { data: actorRoles } = useUserRoles()

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => {
      await fn()
      invalidateRoleCaches(queryClient, orgId, userId)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const actorIsOrgOwner = actorOrgRole === 'owner'
  const actorIsOrgAdmin = actorOrgRole === 'admin' || actorIsOrgOwner

  const visibleWorkspaces = useMemo(() => {
    if (!access) return []
    if (scope.level === 'workspace') {
      return access.workspace_access.filter((w) => w.workspace_id === scope.workspaceId)
    }
    if (scope.level === 'space' || scope.level === 'project') return []
    return access.workspace_access
  }, [access, scope])

  const visibleSpaces = useMemo(() => {
    if (!access) return []
    if (scope.level === 'project') return []
    if (scope.level === 'space') {
      return access.space_access.filter((s) => s.space_id === scope.spaceId)
    }
    if (scope.level === 'workspace') {
      return access.space_access.filter((s) => s.workspace_id === scope.workspaceId)
    }
    return access.space_access
  }, [access, scope])

  const visibleProjects = useMemo(() => {
    if (!access) return []
    if (scope.level === 'project') {
      return access.project_access.filter((p) => p.project_id === scope.projectId)
    }
    if (scope.level === 'space') {
      return access.project_access.filter((p) => p.space_id === scope.spaceId)
    }
    if (scope.level === 'workspace') {
      return access.project_access.filter((p) => p.workspace_id === scope.workspaceId)
    }
    return access.project_access
  }, [access, scope])

  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="Member access" width="max-w-2xl">
        <CenteredSpinner />
      </Modal>
    )
  }

  if (isError || !access) {
    const apiDetail =
      isError && error instanceof Error && 'status' in error
        ? errorMessage(error)
        : null
    return (
      <Modal open onClose={onClose} title="Member access" width="max-w-md">
        <p className="text-sm text-fg-secondary">
          {apiDetail ??
            (isError
              ? 'You do not have permission to manage this member, or they are outside your scope.'
              : 'Member details could not be loaded.')}
        </p>
        {isError && (
          <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
            Retry
          </button>
        )}
      </Modal>
    )
  }

  const name = access.user?.full_name || access.user?.email || 'Member'
  const showOrgSection = actorIsOrgAdmin && access.can_manage_org_role

  const changeOrgRole = (role: OrgRole) =>
    mutate.mutate(async () => {
      await api.patch(`/organizations/${orgId}/members/${userId}`, { role })
      toast.success(`Organization role updated to ${formatRoleLabel(role)}`)
    })

  const setWorkspace = async (workspaceId: string, role: WsRole | null) => {
    if (role === null) {
      await api.delete(`/workspaces/${workspaceId}/members/${userId}`)
      toast.success('Removed from workspace')
      return
    }
    const existing = access.workspace_access.find((w) => w.workspace_id === workspaceId)?.role
    if (existing) {
      await api.patch(`/workspaces/${workspaceId}/members/${userId}`, { role })
    } else {
      await api.post(`/workspaces/${workspaceId}/members`, { user_id: userId, role })
    }
    toast.success('Workspace role updated')
  }

  const setSpace = async (spaceId: string, role: SpaceRole | null) => {
    if (role === null) {
      await api.delete(`/spaces/${spaceId}/members/${userId}`)
      toast.success('Removed from space')
      return
    }
    const existing = access.space_access.find((s) => s.space_id === spaceId)?.role
    if (existing) {
      await api.patch(`/spaces/${spaceId}/members/${userId}`, { role })
    } else {
      await api.post(`/spaces/${spaceId}/members`, { user_id: userId, role })
    }
    toast.success('Space role updated')
  }

  const setProject = async (projectId: string, role: ProjectRole | null) => {
    if (role === null) {
      await api.delete(`/projects/${projectId}/members/${userId}`)
      toast.success('Removed from project')
      return
    }
    const existing = access.project_access.find((p) => p.project_id === projectId)?.role
    if (existing) {
      await api.patch(`/projects/${projectId}/members/${userId}`, { role })
    } else {
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role })
    }
    toast.success('Project role updated')
  }

  const actorHighest = actorRoles?.highest_role
  const targetHighest = access.highest_role
  const actorOutranksTarget = canManageByHierarchy(actorHighest, targetHighest)

  const canManageWorkspace = (wsId: string, _targetRole: string | null) =>
    actorOutranksTarget &&
    actorCanManageWorkspaceScope(actorOrgRole, actorRoles?.workspace_roles, wsId)

  const canGrantWsAdmin = canGrantScopedRole(actorHighest, rankForWorkspaceRole('admin'))

  const canManageSpace = (spaceId: string, workspaceId: string, _targetRole: string | null) =>
    actorOutranksTarget &&
    actorCanManageSpaceScope(
      actorOrgRole,
      actorRoles?.workspace_roles,
      actorRoles?.space_roles,
      spaceId,
      workspaceId,
    )

  const canGrantSpaceAdmin = canGrantScopedRole(actorHighest, rankForSpaceRole('admin'))

  const canManageProject = (project: MemberAccessDetail['project_access'][0]) =>
    actorOutranksTarget &&
    actorCanManageProjectScope(
      actorOrgRole,
      actorRoles?.workspace_roles,
      actorRoles?.space_roles,
      actorRoles?.project_roles,
      project.project_id,
      project.workspace_id,
      project.space_id,
    )

  const canGrantProjectAdmin = canGrantScopedRole(actorHighest, rankForProjectRole('admin'))

  const hasManageableRows =
    (showOrgSection && access.can_manage_org_role) ||
    visibleWorkspaces.some((ws) => canManageWorkspace(ws.workspace_id, ws.role)) ||
    visibleSpaces.some((sp) => canManageSpace(sp.space_id, sp.workspace_id, sp.role)) ||
    visibleProjects.some((pr) => canManageProject(pr))

  return (
    <Modal open onClose={onClose} title="Manage roles" width="max-w-xl">
      <div className="mb-3 flex items-start gap-2.5">
        <Avatar
          name={name}
          src={access.user?.avatar_url}
          color={access.user?.avatar_color}
          size={36}
          userId={userId}
          showPresence
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-fg">{name}</h2>
          <p className="truncate text-xs text-fg-muted">{access.user?.email}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-violet-600 dark:text-violet-300">
            <Shield size={10} />
            {formatRoleLabel(access.highest_role)}
          </p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg">
          <X size={14} />
        </button>
      </div>

      <div className="max-h-[min(42vh,360px)] space-y-3 overflow-y-auto pr-0.5">
        {showOrgSection && (
          <AccessSection title="Organization">
            <div className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-900/50 px-2.5 py-1.5">
              <span className="text-sm text-fg">{formatRoleLabel(access.org_role)}</span>
              {access.can_manage_org_role && (
                <RolePicker
                  value={access.org_role as OrgRole}
                  options={actorIsOrgOwner ? ['admin', 'member'] : ['member']}
                  labels={{ admin: 'Organization Admin', member: 'Organization Member' }}
                  onChange={(r) => changeOrgRole(r as OrgRole)}
                  disabled={mutate.isPending}
                />
              )}
            </div>
          </AccessSection>
        )}

        {visibleWorkspaces.length > 0 && (
          <AccessSection title="Workspaces" count={visibleWorkspaces.filter((w) => w.role).length}>
            {visibleWorkspaces.map((ws) => (
              <AccessRow
                key={ws.workspace_id}
                primary={ws.workspace_name}
                roleLabel={ws.role ? formatScopedRole('workspace', ws.role) : 'No access'}
                hasAccess={Boolean(ws.role)}
                canManage={canManageWorkspace(ws.workspace_id, ws.role)}
                disabled={mutate.isPending}
                onSetRole={(role) =>
                  mutate.mutate(async () => {
                    await setWorkspace(ws.workspace_id, role === 'none' ? null : (role as WsRole))
                  })
                }
                options={
                  ws.role
                    ? [
                        ...(canGrantWsAdmin ? [{ value: 'admin', label: 'Workspace Admin' }] : []),
                        { value: 'none', label: 'Remove access' },
                      ]
                    : canGrantWsAdmin
                      ? [{ value: 'admin', label: 'Add as Admin' }]
                      : []
                }
                optionLabels={{ admin: 'Workspace Admin', member: 'Member', none: 'Remove access' }}
                currentValue={ws.role ?? 'none'}
              />
            ))}
          </AccessSection>
        )}

        {visibleSpaces.length > 0 && (
          <AccessSection title="Spaces" count={visibleSpaces.filter((s) => s.role).length}>
            {visibleSpaces.map((sp) => (
              <AccessRow
                key={sp.space_id}
                primary={sp.space_name}
                secondary={sp.workspace_name}
                roleLabel={sp.role ? formatScopedRole('space', sp.role) : 'No access'}
                hasAccess={Boolean(sp.role)}
                canManage={canManageSpace(sp.space_id, sp.workspace_id, sp.role)}
                disabled={mutate.isPending}
                onSetRole={(role) =>
                  mutate.mutate(async () => {
                    await setSpace(sp.space_id, role === 'none' ? null : (role as SpaceRole))
                  })
                }
                options={
                  sp.role
                    ? [
                        ...(canGrantSpaceAdmin ? [{ value: 'admin', label: 'Space Admin' }] : []),
                        { value: 'none', label: 'Remove access' },
                      ]
                    : [...(canGrantSpaceAdmin ? [{ value: 'admin', label: 'Add as Admin' }] : [])]
                }
                optionLabels={{
                  admin: 'Space Admin',
                  member: 'Member',
                  none: 'Remove access',
                }}
                currentValue={sp.role ?? 'none'}
              />
            ))}
          </AccessSection>
        )}

        {visibleProjects.length > 0 && (
          <AccessSection title="Projects" count={visibleProjects.filter((p) => p.role).length}>
            {visibleProjects.map((pr) => (
              <AccessRow
                key={pr.project_id}
                primary={pr.project_name}
                secondary={[pr.workspace_name, pr.space_name].filter(Boolean).join(' · ')}
                roleLabel={pr.role ? formatScopedRole('project', pr.role) : 'No access'}
                hasAccess={Boolean(pr.role)}
                canManage={canManageProject(pr)}
                disabled={mutate.isPending}
                onSetRole={(role) =>
                  mutate.mutate(async () => {
                    await setProject(pr.project_id, role === 'none' ? null : (role as ProjectRole))
                  })
                }
                options={
                  pr.role
                    ? [
                        ...(canGrantProjectAdmin ? [{ value: 'admin', label: 'Project Admin' }] : []),
                        { value: 'member', label: 'Project Member' },
                        { value: 'viewer', label: 'Project Viewer' },
                        { value: 'none', label: 'Remove access' },
                      ]
                    : [
                        { value: 'member', label: 'Add as Member' },
                        ...(canGrantProjectAdmin ? [{ value: 'admin', label: 'Add as Admin' }] : []),
                        { value: 'viewer', label: 'Add as Viewer' },
                      ]
                }
                currentValue={pr.role ?? 'none'}
              />
            ))}
          </AccessSection>
        )}
      </div>

      {!hasManageableRows && (
        <p className="mt-3 text-xs text-fg-muted">
          You can view this member&apos;s access, but their role is equal to or higher than yours in the
          hierarchy.
        </p>
      )}
    </Modal>
  )
}

function AccessSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
        {count != null && (
          <span className="rounded-full bg-ink-750 px-1.5 py-px text-[10px] font-medium text-fg-secondary">
            {count}
          </span>
        )}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function AccessRow({
  primary,
  secondary,
  roleLabel,
  hasAccess,
  canManage,
  disabled,
  onSetRole,
  options,
  optionLabels,
  currentValue,
}: {
  primary: string
  secondary?: string
  roleLabel: string
  hasAccess: boolean
  canManage: boolean
  disabled?: boolean
  onSetRole: (role: string) => void
  options: { value: string; label: string }[]
  optionLabels?: Record<string, string>
  currentValue: string
}) {
  const labels = optionLabels ?? Object.fromEntries(options.map((o) => [o.value, o.label]))
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-white/60 px-2.5 py-1.5 dark:border-ink-700 dark:bg-ink-900/50">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{primary}</p>
        {secondary && <p className="truncate text-[10px] leading-tight text-fg-muted">{secondary}</p>}
      </div>
      {canManage ? (
        <RolePicker
          value={currentValue}
          options={options.map((o) => o.value)}
          labels={labels}
          onChange={onSetRole}
          disabled={disabled}
        />
      ) : (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            hasAccess
              ? 'bg-brand/10 text-brand dark:bg-brand/15'
              : 'bg-gray-100 text-gray-500 dark:bg-ink-750 dark:text-fg-muted',
          )}
        >
          {roleLabel}
        </span>
      )}
    </div>
  )
}

function RolePicker({
  value,
  options,
  labels,
  onChange,
  disabled,
}: {
  value: string
  options: string[]
  labels: Record<string, string>
  onChange: (role: string) => void
  disabled?: boolean
}) {
  const display = labels[value] ?? labels[options[0]] ?? value
  return (
    <Dropdown
      align="right"
      width="w-52"
      trigger={
        <button
          disabled={disabled}
          className="inline-flex items-center gap-0.5 rounded-md border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold text-fg-secondary transition-colors hover:border-brand/40 hover:text-fg disabled:opacity-50"
        >
          <span className="max-w-[120px] truncate">{display}</span>
          <ChevronDown size={11} />
        </button>
      }
    >
      {(close) => (
        <>
          {options.map((opt) => (
            <button
              key={opt}
              className="menu-item"
              onClick={() => {
                if (opt !== value) onChange(opt)
                close()
              }}
            >
              <span className="flex-1 text-left">{labels[opt] ?? opt}</span>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  )
}

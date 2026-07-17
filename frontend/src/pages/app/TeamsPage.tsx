import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Plus, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { usePeopleScope } from '../../hooks/usePeopleScope'
import {
  PEOPLE_TAB,
  PROJECT_FILTER_PARAM,
  SPACE_FILTER_PARAM,
  WORKSPACE_FILTER_PARAM,
} from '../../lib/peopleRoutes'
import { api, errorMessage } from '../../lib/api'
import { canCreateTeam, canDeleteTeam, isWorkspaceAdmin } from '../../lib/createAccess'
import { resolvePeopleInviteFlow } from '../../lib/inviteFlow'
import { useCurrentContext, useTeams, useUserRoles, useWorkspaceMembers } from '../../lib/queries'
import { canManagePersonInList } from '../../lib/roleHierarchy'
import { isOrgLeader } from '../../lib/scopedRoles'
import type { Team } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { MemberAccessPanel } from '../../components/people/MemberAccessPanel'
import {
  PeopleScopeFilter,
  projectScopeOptions,
  spaceScopeOptions,
  workspaceScopeOptions,
} from '../../components/people/PeopleScopeFilter'
import { useOpenInvite } from '../../hooks/useOpenInvite'
import { Avatar, AvatarStack } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const TEAM_COLORS = ['#2B88EE', '#4CB782', '#5B9FF0', '#F2994A', '#E667A8', '#07BEA3', '#E5484D']
type EditableRole = 'admin' | 'member'

function roleBadgeClass(role: string, interactive = false) {
  return cn(
    'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
    role === 'owner'
      ? 'bg-brand-soft text-brand'
      : role === 'admin'
        ? 'bg-teal-500/15 text-teal-400'
        : 'bg-ink-750 text-fg-secondary',
    interactive && 'transition-colors hover:ring-1 hover:ring-brand/60',
  )
}

export default function TeamsPage() {
  const { org, workspace, workspaces } = useCurrentContext()
  const teams = useTeams(workspace?.id)
  const { data: userRoles } = useUserRoles()
  const [params, setParams] = useSearchParams()
  const peopleInviteFlow = resolvePeopleInviteFlow(
    '/app/teams',
    params.toString(),
    org,
    workspace,
    userRoles,
  )
  const canCreateTeams =
    teams.data?.some((t) => t.can_create_teams) ||
    canCreateTeam(org, workspace, userRoles, workspace?.id)

  const tab = params.get('tab') === PEOPLE_TAB ? PEOPLE_TAB : 'teams'
  const workspaceFilterId = params.get(WORKSPACE_FILTER_PARAM)
  const filterWorkspace = workspaceFilterId
    ? workspaces.find((w) => w.id === workspaceFilterId) ?? null
    : null

  const peopleScope = usePeopleScope()
  const openInvite = useOpenInvite()

  const peopleSubtitle = useMemo(() => {
    if (peopleScope.isWorkspaceAdmin && peopleScope.scopedWorkspaceId) {
      return `People in ${peopleScope.scopeLabel}`
    }
    if (peopleScope.isOrgLeaderUser && !params.get(WORKSPACE_FILTER_PARAM)) {
      return `Everyone in ${org?.name ?? 'this organization'}`
    }
    if (peopleScope.panelScope.level === 'org') {
      return `Everyone in ${org?.name ?? 'this organization'}`
    }
    return `People in ${peopleScope.scopeLabel}`
  }, [
    org?.name,
    params,
    peopleScope.isOrgLeaderUser,
    peopleScope.isWorkspaceAdmin,
    peopleScope.panelScope.level,
    peopleScope.scopeLabel,
    peopleScope.scopedWorkspaceId,
  ])

  const selectedTeam = teams.data?.find((t) => t.id === params.get('team')) ?? null
  const createOpen = params.get('new') === '1'

  const clearWorkspaceFilter = () => {
    const next = new URLSearchParams(params)
    next.delete(WORKSPACE_FILTER_PARAM)
    setParams(next, { replace: true })
  }

  const closeOverlays = () => {
    params.delete('new')
    params.delete('team')
    setParams(params, { replace: true })
  }

  if (teams.isLoading) return <CenteredSpinner />

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">{tab === PEOPLE_TAB ? 'All People' : 'All Teams'}</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {tab === PEOPLE_TAB
              ? peopleSubtitle
              : 'Group people to assign and mention them as a unit.'}
          </p>
        </div>
        {canCreateTeams && tab !== PEOPLE_TAB && (
          <button
            className="btn-primary"
            onClick={() => {
              params.set('new', '1')
              setParams(params, { replace: true })
            }}
          >
            <Plus size={15} /> Create Team
          </button>
        )}
        {tab === PEOPLE_TAB &&
          peopleScope.hasPeopleAdminAccess &&
          (peopleInviteFlow !== 'project' || peopleScope.scopedProjectRole === 'admin') && (
          <button
            className="btn-primary"
            onClick={() => {
              if (peopleInviteFlow === 'workspace' && peopleScope.scopedWorkspaceId) {
                openInvite({
                  existingOnly: true,
                  flowKind: 'workspace',
                  workspaceId: peopleScope.scopedWorkspaceId,
                })
              } else if (peopleInviteFlow === 'space' && peopleScope.scopedSpaceId) {
                const space = peopleScope.adminSpaces.find((s) => s.space_id === peopleScope.scopedSpaceId)
                openInvite({
                  existingOnly: true,
                  flowKind: 'space',
                  spaceId: peopleScope.scopedSpaceId,
                  workspaceId: space?.workspace_id ?? workspace?.id ?? null,
                })
              } else if (peopleInviteFlow === 'project' && peopleScope.scopedProjectId) {
                const project = peopleScope.adminProjects.find(
                  (p) => p.project_id === peopleScope.scopedProjectId,
                )
                openInvite({
                  existingOnly: true,
                  flowKind: 'project',
                  projectId: peopleScope.scopedProjectId,
                  workspaceId: project?.workspace_id ?? workspace?.id ?? null,
                })
              } else {
                openInvite()
              }
            }}
          >
            <UserPlus size={15} /> Add people
          </button>
        )}
      </div>

      {tab === PEOPLE_TAB && peopleScope.isWorkspaceAdmin && peopleScope.adminWorkspaces.length > 1 && (
        <PeopleScopeFilter
          kind="workspace"
          paramKey={WORKSPACE_FILTER_PARAM}
          activeId={peopleScope.scopedWorkspaceId}
          options={workspaceScopeOptions(peopleScope.adminWorkspaces)}
        />
      )}

      {tab === PEOPLE_TAB && peopleScope.isSpaceAdminOnly && (
        <PeopleScopeFilter
          kind="space"
          paramKey={SPACE_FILTER_PARAM}
          activeId={peopleScope.scopedSpaceId}
          options={spaceScopeOptions(peopleScope.adminSpaces)}
        />
      )}

      {tab === PEOPLE_TAB && peopleScope.isProjectAdminOnly && (
        <PeopleScopeFilter
          kind="project"
          paramKey={PROJECT_FILTER_PARAM}
          activeId={peopleScope.scopedProjectId}
          options={projectScopeOptions(peopleScope.allProjects)}
        />
      )}

      {tab === PEOPLE_TAB && isOrgLeader(org) && workspaceFilterId && filterWorkspace && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/80 px-2.5 py-1 text-xs text-fg-secondary">
            <Users size={12} className="text-fg-muted" />
            <span>
              Workspace: <span className="font-medium text-fg">{filterWorkspace.name}</span>
            </span>
            <button
              type="button"
              onClick={clearWorkspaceFilter}
              className="ml-0.5 rounded p-0.5 text-fg-muted transition-colors hover:bg-ink-700 hover:text-fg"
              title="Show everyone in the organization"
              aria-label="Clear workspace filter"
            >
              <X size={12} />
            </button>
          </span>
          <button
            type="button"
            onClick={clearWorkspaceFilter}
            className="text-xs font-medium text-brand hover:underline"
          >
            Show all people
          </button>
        </div>
      )}

      <div className="mt-6">{tab === PEOPLE_TAB ? <PeopleList /> : <TeamsGrid teams={teams.data ?? []} />}</div>

      <CreateTeamModal open={createOpen && canCreateTeams} onClose={closeOverlays} />
      {selectedTeam && (
        <ManageTeamModal key={selectedTeam.id} team={selectedTeam} onClose={closeOverlays} />
      )}
    </div>
  )
}

function TeamsGrid({ teams }: { teams: Team[] }) {
  const [, setParams] = useSearchParams()
  if (teams.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams yet"
        description="Use Teams to easily create groups of people you can assign to tasks and mention in comments."
      />
    )
  }
  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
      {teams.map((team) => (
        <button
          key={team.id}
          onClick={() => setParams({ team: team.id }, { replace: true })}
          className="rounded-2xl border border-ink-700 bg-ink-850/60 p-5 text-left transition-colors hover:border-ink-600"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ backgroundColor: team.color }}
            >
              {team.name[0]?.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{team.name}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
                {team.description || 'No description'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <AvatarStack users={team.members} size={24} max={5} />
            <span className="text-[11px] text-fg-muted">
              {team.members.length} member{team.members.length === 1 ? '' : 's'}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function PeopleList() {
  const { org } = useCurrentContext()
  const user = useAuthStore((s) => s.user)
  const { data: actorRoles } = useUserRoles()
  const {
    members,
    isLoading,
    panelScope,
    scopeLabel,
    formatMemberRole,
    hasPeopleAdminAccess,
    peopleListKind,
    scopedProjectRole,
  } = usePeopleScope()

  // On a project-scoped list, management requires being an admin of THAT project —
  // being a project admin elsewhere in the org grants nothing here.
  const canManageThisScope = peopleListKind !== 'project' || scopedProjectRole === 'admin'

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  if (!hasPeopleAdminAccess && !isLoading) {
    return (
      <EmptyState
        icon={Users}
        title="No access"
        description="Only organization and scoped admins can view and manage people here."
      />
    )
  }

  if (isLoading) return <CenteredSpinner />

  if (members.length === 0) {
    const emptyLabel =
      panelScope.level === 'org'
        ? 'No people found.'
        : `No people in ${scopeLabel}.`
    return <EmptyState icon={Users} title="No people" description={emptyLabel} />
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-gray-200/70 dark:border-ink-700">
        {members.map((member) => {
          const name = member.user?.full_name || member.user?.email || 'Unknown'
          const isSelf = member.user_id === user?.id
          const canManage =
            canManageThisScope &&
            canManagePersonInList(
              actorRoles?.highest_role,
              member.user_id,
              user?.id,
              peopleListKind,
              member.role,
            )
          return (
            <button
              key={member.user_id}
              type="button"
              onClick={() => canManage && setSelectedUserId(member.user_id)}
              className={cn(
                'flex w-full items-center gap-3 border-b border-gray-200/60 bg-white/80 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-ink-700/60 dark:bg-ink-900',
                canManage && 'hover:bg-gray-50 dark:hover:bg-ink-800',
                !canManage && 'cursor-default',
              )}
            >
              <Avatar
                name={name}
                src={member.user?.avatar_url}
                color={member.user?.avatar_color}
                size={36}
                userId={member.user_id}
                showPresence
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">
                  {name}
                  {isSelf && <span className="text-fg-muted"> (you)</span>}
                </p>
                <p className="truncate text-xs text-fg-muted">{member.user?.email}</p>
              </div>
              <span className={roleBadgeClass(member.role)}>{formatMemberRole(member.role)}</span>
              <span className="hidden text-[11px] text-fg-muted sm:inline">
                joined {formatDate(member.created_at)}
              </span>
              {canManage && (
                <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-label="Manage roles" />
              )}
            </button>
          )
        })}
      </div>

      {selectedUserId && org?.id && (
        <MemberAccessPanel
          orgId={org.id}
          userId={selectedUserId}
          actorOrgRole={org.my_role}
          scope={panelScope}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </>
  )
}

function RoleDropdown({
  value,
  onChange,
  title = 'Change role',
}: {
  value: EditableRole
  onChange: (role: EditableRole) => void
  title?: string
}) {
  const options: EditableRole[] = ['admin', 'member']
  return (
    <Dropdown
      align="right"
      width="w-44"
      trigger={
        <button className={roleBadgeClass(value, true)} title={title}>
          {value}
          <ChevronDown size={12} />
        </button>
      }
    >
      {(close) => (
        <>
          {options.map((role) => (
            <button
              key={role}
              className="menu-item"
              onClick={() => {
                if (role !== value) onChange(role)
                close()
              }}
            >
              <span className="flex-1 capitalize">{role}</span>
              {role === value && <Check size={14} className="text-brand" />}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  )
}

function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(TEAM_COLORS[0])

  const create = useMutation({
    mutationFn: () =>
      api.post<Team>(`/workspaces/${workspace!.id}/teams`, {
        name: name.trim(),
        description: description.trim() || null,
        color,
      }),
    onSuccess: () => {
      toast.success('Team created')
      void queryClient.invalidateQueries({ queryKey: ['teams', workspace?.id] })
      setName('')
      setDescription('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title="Create Team" width="max-w-md">
      <p className="mb-4 text-sm text-fg-secondary">
        Use Teams to easily create groups of people you can assign to tasks, mention in comments, or
        add as watchers.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && !create.isPending) create.mutate()
        }}
      >
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Icon & name</label>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {(name[0] || 'T').toUpperCase()}
            </span>
            <input
              className="input-dark"
              placeholder="Team name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="flex gap-2">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn('h-6 w-6 rounded-lg transition-transform', color === c && 'scale-110 ring-2 ring-white/60')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Description (optional)</label>
          <textarea
            rows={3}
            className="input-dark resize-none"
            placeholder="Add Team description, information, and wiki"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={!name.trim() || create.isPending}>
            Create Team
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ManageTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const { org, workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const workspaceMembers = useWorkspaceMembers(workspace?.id)
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['teams', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspaces', org?.id] })
  }

  const canManageTeamMembers = team.can_manage_members
  const showDeleteTeam = canDeleteTeam(org, workspace, team.can_delete)

  // Only this team's members — never the full workspace roster.
  const teamMembers = useMemo(() => {
    if (team.member_details?.length) return team.member_details
    return team.members.map((u) => ({
      id: u.id,
      user_id: u.id,
      role: 'member' as const,
      created_at: '',
      user: u,
    }))
  }, [team.member_details, team.members])

  const memberIds = useMemo(() => new Set(teamMembers.map((m) => m.user_id)), [teamMembers])

  // Workspace people who are not yet on this team (add candidates only).
  const addCandidates = useMemo(
    () => (workspaceMembers.data ?? []).filter((m) => !memberIds.has(m.user_id)),
    [workspaceMembers.data, memberIds],
  )

  const save = async () => {
    try {
      await api.patch(`/teams/${team.id}`, { name: name.trim(), description: description.trim() || null })
      toast.success('Team updated')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const addMember = async (userId: string) => {
    try {
      await api.post(`/teams/${team.id}/members`, { user_ids: [userId] })
      toast.success('Member added')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const removeMember = async (userId: string) => {
    try {
      await api.delete(`/teams/${team.id}/members/${userId}`)
      toast.success('Member removed')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const changeTeamRole = async (userId: string, role: EditableRole) => {
    try {
      await api.patch(`/teams/${team.id}/members/${userId}`, { role })
      toast.success(`Team role updated to ${role}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async () => {
    try {
      await api.delete(`/teams/${team.id}`)
      toast.success('Team deleted')
      refresh()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Modal open onClose={onClose} title={team.name} width="max-w-lg">
      <div className="space-y-4">
        {canManageTeamMembers && (
          <div className="space-y-2.5">
            <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              rows={2}
              className="input-dark resize-none"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex justify-end">
              <button className="btn-secondary !py-1.5 text-xs" onClick={save} disabled={!name.trim()}>
                Save changes
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Members ({teamMembers.length})
            </p>
            {canManageTeamMembers && (
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2 py-1 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-brand hover:text-brand"
              >
                <UserPlus size={12} />
                Add people
              </button>
            )}
          </div>

          {canManageTeamMembers && addOpen && (
            <div className="mb-3 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/60 p-1.5">
              {addCandidates.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-fg-muted">
                  Everyone in this workspace is already on the team.
                </p>
              ) : (
                addCandidates.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-ink-800"
                  >
                    <Avatar
                      name={member.user?.full_name || member.user?.email || '?'}
                      src={member.user?.avatar_url}
                      size={26}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {member.user?.full_name || member.user?.email}
                    </span>
                    <button
                      type="button"
                      onClick={() => void addMember(member.user_id)}
                      className="rounded-lg border border-ink-700 px-2 py-1 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-brand hover:text-brand"
                    >
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {teamMembers.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-fg-muted">No members on this team yet.</p>
            ) : (
              teamMembers.map((member) => {
                const displayName = member.user?.full_name || member.user?.email || '?'
                const isYou = member.user_id === user?.id
                const isProtected = isYou
                const teamRole = member.role === 'admin' || member.role === 'member' ? member.role : 'member'
                const canChangeTeamRole = canManageTeamMembers && !isProtected
                const canRemoveMember = canManageTeamMembers && !isProtected
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-ink-800"
                  >
                    <Avatar name={displayName} src={member.user?.avatar_url} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {displayName}
                      {isYou && <span className="text-fg-muted"> (you)</span>}
                    </span>
                    {canChangeTeamRole ? (
                      <RoleDropdown
                        value={teamRole}
                        title="Change team role"
                        onChange={(role) => void changeTeamRole(member.user_id, role)}
                      />
                    ) : (
                      <span className={roleBadgeClass(teamRole)}>{teamRole}</span>
                    )}
                    {canRemoveMember ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(member.user_id)}
                        className="rounded-lg border border-red-500/30 px-2 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:border-red-400 hover:text-red-200"
                      >
                        Remove
                      </button>
                    ) : (
                      <Check size={14} className="text-brand" />
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {showDeleteTeam && (
          <div className="border-t border-ink-700 pt-3">
            {confirmDelete ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-secondary">Delete this team?</span>
                <span className="flex gap-3">
                  <button className="font-semibold text-red-400 hover:text-red-300" onClick={remove}>
                    Delete
                  </button>
                  <button className="text-fg-muted hover:text-fg" onClick={() => setConfirmDelete(false)}>
                    <X size={14} />
                  </button>
                </span>
              </div>
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-red-400"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Delete team
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

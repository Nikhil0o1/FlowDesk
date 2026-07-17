import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, FolderKanban, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import WorkspaceAdminDashboard from '../../components/dashboard/WorkspaceAdminDashboard'
import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSpaces, useOrganizationMembers } from '../../lib/queries'
import { projectRoleLabel } from '../../lib/projectAccess'
import { isImplicitOrgWorkspaceMember, isOrgLeader } from '../../lib/scopedRoles'
import { canInviteToSpace } from '../../components/invites/inviteScopes'
import type { OrgMember, Workspace } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { useAuthStore } from '../../stores/auth'
import { useWorkspaceStore } from '../../stores/workspace'
import { InviteModal } from '../../components/invites/InviteModal'
import { Avatar } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { RenameModal } from '../../components/ui/RenameModal'
import { RenameButton } from '../../components/ui/RenameButton'
import { CenteredSpinner } from '../../components/ui/Spinner'

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

export default function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { org, workspaces } = useCurrentContext()
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace)

  useEffect(() => {
    if (workspaceId) setWorkspace(workspaceId)
  }, [workspaceId, setWorkspace])

  if (!workspaceId) {
    return <p className="p-8 text-sm text-fg-secondary">Workspace not found.</p>
  }

  if (isOrgLeader(org)) {
    return (
      <div className="h-full min-h-0">
        <WorkspaceAdminDashboard
          workspaceId={workspaceId}
          adminWorkspaceCount={workspaces.length}
          orgDrillDown
        />
      </div>
    )
  }

  return <WorkspaceManageDetail workspaceId={workspaceId} />
}

function WorkspaceManageDetail({ workspaceId }: { workspaceId: string }) {
  const { org } = useCurrentContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameSpace, setRenameSpace] = useState<{ id: string; name: string } | null>(null)
  const [renameProject, setRenameProject] = useState<{ id: string; name: string } | null>(null)

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<Workspace>(`/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  })

  const members = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => api.get<OrgMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: !!workspaceId,
  })
  const orgMembers = useOrganizationMembers(org?.id)

  const spaces = useSpaces(workspaceId)
  const projects = useProjects(workspaceId)

  const orgLeaderUserIds = useMemo(
    () =>
      new Set(
        (orgMembers.data ?? [])
          .filter((member) => member.role === 'owner' || member.role === 'admin')
          .map((member) => member.user_id),
      ),
    [orgMembers.data],
  )

  if (workspace.isLoading) return <CenteredSpinner />
  if (!workspace.data) return <p className="p-8 text-sm text-fg-secondary">Workspace not found.</p>

  const ws = workspace.data
  const currentMemberRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const actorIsOwner = (org?.my_role === 'owner' || org?.my_role === 'admin') || ws.my_role === 'owner' || currentMemberRole === 'owner'
  const actorIsAdmin = !actorIsOwner && (ws.my_role === 'admin' || currentMemberRole === 'admin')
  const isAdmin = actorIsOwner || actorIsAdmin
  const isOrgAdminOrOwner = org?.my_role === 'owner' || org?.my_role === 'admin'
  const canInviteSpace = canInviteToSpace(spaces.data ?? [], isOrgAdminOrOwner)
  const canInvite = isAdmin || canInviteSpace
  const inviteDefaultScope = isAdmin ? 'workspace' : 'space'
  const canRenameOrgResources = org?.my_role === 'owner' || org?.my_role === 'admin'

  const refreshMembers = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', ws.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspace', ws.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspaces', org?.id] })
  }

  const changeRole = async (userId: string, role: 'admin' | 'member') => {
    try {
      await api.patch(`/workspaces/${ws.id}/members/${userId}`, { role })
      refreshMembers()
      toast.success(`Workspace role saved: user ${role === 'admin' ? 'promoted' : 'demoted'}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const removeMember = async (userId: string) => {
    try {
      await api.delete(`/workspaces/${ws.id}/members/${userId}`)
      refreshMembers()
      toast.success('Member removed')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const saveWorkspaceName = async (name: string) => {
    setRenaming(true)
    try {
      await api.patch(`/workspaces/${ws.id}`, { name })
      void queryClient.invalidateQueries({ queryKey: ['workspace', ws.id] })
      void queryClient.invalidateQueries({ queryKey: ['workspaces', org?.id] })
      toast.success('Workspace renamed')
      setRenameOpen(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRenaming(false)
    }
  }

  const saveSpaceName = async (name: string) => {
    if (!renameSpace) return
    setRenaming(true)
    try {
      await api.patch(`/spaces/${renameSpace.id}`, { name })
      void queryClient.invalidateQueries({ queryKey: ['spaces', ws.id] })
      toast.success('Space renamed')
      setRenameSpace(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRenaming(false)
    }
  }

  const saveProjectName = async (name: string) => {
    if (!renameProject) return
    setRenaming(true)
    try {
      await api.patch(`/projects/${renameProject.id}`, { name })
      void queryClient.invalidateQueries({ queryKey: ['projects', ws.id] })
      toast.success('Project renamed')
      setRenameProject(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="flex items-start gap-4">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
          style={{ backgroundColor: ws.color }}
        >
          {ws.name[0].toUpperCase()}
        </span>
        <div className="flex-1">
          <div className="group/name flex min-w-0 items-center gap-1">
            <h1 className="truncate text-xl font-bold text-fg">{ws.name}</h1>
            {canRenameOrgResources && <RenameButton onClick={() => setRenameOpen(true)} />}
          </div>
          <p className="mt-0.5 text-sm text-fg-secondary">{ws.description || 'No description'}</p>
        </div>
        {canInvite && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={15} /> Invite
          </button>
        )}
      </div>

      <div className="mt-7 grid grid-cols-[1fr_360px] gap-6 max-lg:grid-cols-1">
        {/* Spaces */}
        {canRenameOrgResources && (spaces.data?.length ?? 0) > 0 && (
          <section className="max-lg:col-span-1 lg:col-span-2">
            <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-fg">
              Spaces
              <span className="text-xs font-normal text-fg-muted">{spaces.data?.length ?? 0}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {(spaces.data ?? []).map((space) => (
                <div
                  key={space.id}
                  className="group/name flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{ backgroundColor: space.color }}
                  >
                    {space.name[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate text-sm text-fg">{space.name}</span>
                  <RenameButton onClick={() => setRenameSpace({ id: space.id, name: space.name })} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Projects */}
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-fg">
            <FolderKanban size={15} /> Projects
            <span className="text-xs font-normal text-fg-muted">{projects.data?.length ?? 0}</span>
          </h2>
          <div className="space-y-2">
            {(projects.data ?? []).map((project) => {
              const space = spaces.data?.find((s) => s.id === project.space_id)
              return (
                <div
                  key={project.id}
                  className="group/name flex w-full items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-left transition-colors hover:border-ink-600"
                >
                  <button
                    onClick={() => navigate(`/app/projects/${project.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <FolderKanban size={17} style={{ color: project.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{project.name}</p>
                      <p className="text-[11px] text-fg-muted">
                        {space?.name ?? 'Space'} · {project.task_count ?? 0} tasks
                      </p>
                    </div>
                  </button>
                  {canRenameOrgResources && (
                    <RenameButton onClick={() => setRenameProject({ id: project.id, name: project.name })} />
                  )}
                  <span className="shrink-0 text-[11px] uppercase text-fg-muted">
                    {projectRoleLabel(project, { space, workspace: ws, orgRole: org?.my_role })}
                  </span>
                </div>
              )
            })}
            {(projects.data ?? []).length === 0 && (
              <p className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-6 text-center text-sm text-fg-muted">
                No projects visible to you in this workspace.
              </p>
            )}
          </div>
        </section>

        {/* Members */}
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-fg">
            <Users size={15} /> Members
            <span className="text-xs font-normal text-fg-muted">{members.data?.length ?? 0}</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-ink-700">
            {(members.data ?? []).map((member) => {
              const canOwnerEdit = actorIsOwner && member.role !== 'owner' && member.user_id !== user?.id
              const canAdminEdit = actorIsAdmin && member.role !== 'owner' && member.user_id !== user?.id
              const canChangeRole = canOwnerEdit || canAdminEdit
              const isOrgLeaderMember =
                isImplicitOrgWorkspaceMember(member.role) || orgLeaderUserIds.has(member.user_id)
              const canRemove =
                !isOrgLeaderMember &&
                (canOwnerEdit || (actorIsAdmin && member.role !== 'owner' && member.user_id !== user?.id))
              return (
                <div
                  key={member.id}
                  className="group flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-3.5 py-2.5 last:border-b-0"
                >
                  <Avatar
                    name={member.user?.full_name || member.user?.email || '?'}
                    src={member.user?.avatar_url}
                    size={30}
                    userId={member.user_id}
                    showPresence
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {member.user?.full_name || member.user?.email}
                    </p>
                    <p className="truncate text-[11px] text-fg-muted">
                      {member.user?.email} · joined {formatDate(member.created_at)}
                    </p>
                  </div>
                  {canChangeRole && (member.role === 'admin' || member.role === 'member') && (
                    <RoleDropdown
                      value={member.role}
                      onChange={(role) => void changeRole(member.user_id, role)}
                    />
                  )}
                  {(!canChangeRole || (member.role !== 'admin' && member.role !== 'member')) && (
                    <span className={roleBadgeClass(member.role)}>{member.role}</span>
                  )}
                  {canRemove && (
                    <button
                      className="rounded-lg border border-red-500/25 px-2.5 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:border-red-400 hover:text-red-200"
                      onClick={() => void removeMember(member.user_id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        defaultScope={inviteDefaultScope}
        defaultWorkspaceId={ws.id}
      />

      <RenameModal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename workspace"
        label="Workspace name"
        initialName={ws.name}
        onSave={saveWorkspaceName}
        saving={renaming}
      />
      <RenameModal
        open={!!renameSpace}
        onClose={() => setRenameSpace(null)}
        title="Rename space"
        label="Space name"
        initialName={renameSpace?.name ?? ''}
        onSave={saveSpaceName}
        saving={renaming}
      />
      <RenameModal
        open={!!renameProject}
        onClose={() => setRenameProject(null)}
        title="Rename project"
        label="Project name"
        initialName={renameProject?.name ?? ''}
        onSave={saveProjectName}
        saving={renaming}
      />
    </div>
  )
}

function RoleDropdown({
  value,
  onChange,
}: {
  value: EditableRole
  onChange: (role: EditableRole) => void
}) {
  const options: EditableRole[] = ['admin', 'member']
  return (
    <Dropdown
      align="right"
      width="w-44"
      trigger={
        <button className={roleBadgeClass(value, true)} title="Change workspace role">
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

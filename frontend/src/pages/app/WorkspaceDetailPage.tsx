import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Shield, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSpaces } from '../../lib/queries'
import type { OrgMember, Workspace } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { useAuthStore } from '../../stores/auth'
import { InviteModal } from '../../components/invites/InviteModal'
import { Avatar } from '../../components/ui/Avatar'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { org } = useCurrentContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [inviteOpen, setInviteOpen] = useState(false)

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

  const spaces = useSpaces(workspaceId)
  const projects = useProjects(workspaceId)

  if (workspace.isLoading) return <CenteredSpinner />
  if (!workspace.data) return <p className="p-8 text-sm text-fg-secondary">Workspace not found.</p>

  const ws = workspace.data
  const currentMemberRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const actorIsOwner = org?.my_role === 'owner' || ws.my_role === 'owner' || currentMemberRole === 'owner'
  const actorIsAdmin = !actorIsOwner && (ws.my_role === 'admin' || currentMemberRole === 'admin')
  const isAdmin = actorIsOwner || actorIsAdmin

  const refreshMembers = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', ws.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspace', ws.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspaces', org?.id] })
  }

  const changeRole = async (userId: string, role: 'admin' | 'member') => {
    try {
      await api.patch(`/workspaces/${ws.id}/members/${userId}`, { role })
      refreshMembers()
      toast.success(`Saved changes: user ${role === 'admin' ? 'promoted' : 'demoted'}`)
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
          <h1 className="text-xl font-bold text-fg">{ws.name}</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">{ws.description || 'No description'}</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={15} /> Invite
          </button>
        )}
      </div>

      <div className="mt-7 grid grid-cols-[1fr_360px] gap-6 max-lg:grid-cols-1">
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
                <button
                  key={project.id}
                  onClick={() => navigate(`/app/projects/${project.id}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-left transition-colors hover:border-ink-600"
                >
                  <FolderKanban size={17} style={{ color: project.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{project.name}</p>
                    <p className="text-[11px] text-fg-muted">
                      {space?.name ?? 'Space'} · {project.key} · {project.task_count ?? 0} tasks
                    </p>
                  </div>
                  <span className="text-[11px] uppercase text-fg-muted">{project.my_role ?? ''}</span>
                </button>
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
              const canRemove = canOwnerEdit || (actorIsAdmin && member.role === 'member' && member.user_id !== user?.id)
              const nextRole = member.role === 'admin' ? 'member' : 'admin'
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
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
                      member.role === 'owner'
                        ? 'bg-brand-soft text-brand'
                        : member.role === 'admin'
                          ? 'bg-purple-500/15 text-purple-300'
                          : 'bg-ink-750 text-fg-secondary',
                    )}
                  >
                    {member.role === 'admin' && <Shield size={11} />}
                    {member.role}
                  </span>
                  {canChangeRole && (
                    <button
                      className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-brand hover:text-brand"
                      onClick={() => void changeRole(member.user_id, nextRole)}
                    >
                      {nextRole === 'admin' ? 'Promote to admin' : 'Demote to member'}
                    </button>
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

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

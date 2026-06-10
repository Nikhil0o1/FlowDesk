import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSpaces } from '../../lib/queries'
import type { OrgMember, Workspace } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { InviteModal } from '../../components/invites/InviteModal'
import { Avatar } from '../../components/ui/Avatar'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { org } = useCurrentContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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
  const isAdmin = ws.my_role === 'admin' || ws.my_role === 'owner' || org?.my_role === 'owner'

  const changeRole = async (userId: string, role: string) => {
    try {
      await api.patch(`/workspaces/${ws.id}/members/${userId}`, { role })
      void queryClient.invalidateQueries({ queryKey: ['workspace-members', ws.id] })
      toast.success('Role updated')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const removeMember = async (userId: string) => {
    try {
      await api.delete(`/workspaces/${ws.id}/members/${userId}`)
      void queryClient.invalidateQueries({ queryKey: ['workspace-members', ws.id] })
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
            {(members.data ?? []).map((member) => (
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
                {isAdmin ? (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => changeRole(member.user_id, e.target.value)}
                      className={cn(
                        'rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-fg-secondary outline-none',
                        member.role === 'admin' && 'text-brand',
                      )}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className="hidden text-fg-muted hover:text-red-400 group-hover:block"
                      onClick={() => removeMember(member.user_id)}
                      title="Remove from workspace"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] uppercase text-fg-muted">
                    {member.role === 'admin' && <Shield size={11} className="text-brand" />}
                    {member.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

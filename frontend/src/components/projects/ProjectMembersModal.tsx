import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useTeams } from '../../lib/queries'
import type { OrgMember, ProjectTeam, ProjectTeamAssignResult } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'

const PROJECT_ROLES = ['admin', 'member', 'viewer'] as const
type ProjectRole = (typeof PROJECT_ROLES)[number]

/** Manage who's in a project: add workspace members, assign teams, remove, or invite by email. */
export function ProjectMembersModal({
  open,
  onClose,
  projectId,
  workspaceId,
  onInviteByEmail,
  inheritedAccessLabel,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  workspaceId: string | undefined
  onInviteByEmail: () => void
  /** When set, the viewer has admin access via space/workspace/org, not a project member row. */
  inheritedAccessLabel?: string
}) {
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const teams = useTeams(open ? workspaceId : undefined)
  const members = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: open && !!projectId,
  })
  /** Only explicit project admins (listed with admin role) may change or remove others. */
  const canManageMembers = (members.data ?? []).some(
    (m) => m.user_id === userId && m.role === 'admin',
  )
  const candidates = useQuery({
    queryKey: ['project-member-candidates', projectId],
    queryFn: () =>
      api.get<Array<{ user_id: string; in_workspace: boolean; user: OrgMember['user'] }>>(
        `/projects/${projectId}/member-candidates`,
      ),
    enabled: open && !!projectId && canManageMembers,
  })
  const assignedTeams = useQuery({
    queryKey: ['project-teams', projectId],
    queryFn: () => api.get<ProjectTeam[]>(`/projects/${projectId}/teams`),
    enabled: open && !!projectId,
  })
  const [addRole, setAddRole] = useState('member')
  const [teamRole, setTeamRole] = useState('member')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [assigningTeam, setAssigningTeam] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['project-member-candidates', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['project-teams', projectId] })
  }

  const add = async (userId: string) => {
    setBusyId(userId)
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role: addRole })
      toast.success('Member added to project')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const assignedTeamIds = new Set((assignedTeams.data ?? []).map((t) => t.team_id))
  const availableTeams = (teams.data ?? []).filter((t) => !assignedTeamIds.has(t.id))
  const candidateList = candidates.data ?? []

  const assignTeam = async () => {
    if (!selectedTeamId) return
    setAssigningTeam(true)
    try {
      const result = await api.post<ProjectTeamAssignResult>(`/projects/${projectId}/teams`, {
        team_id: selectedTeamId,
        role: teamRole,
      })
      const { team_name, members_added, members_skipped } = result
      const extra = members_skipped > 0 ? ` (${members_skipped} already on the project)` : ''
      toast.success(`Added ${members_added} member${members_added === 1 ? '' : 's'} from ${team_name}${extra}`)
      setSelectedTeamId('')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAssigningTeam(false)
    }
  }

  const remove = async (targetUserId: string) => {
    setBusyId(targetUserId)
    try {
      await api.delete(`/projects/${projectId}/members/${targetUserId}`)
      toast.success('Member removed from project')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const changeRole = async (targetUserId: string, role: ProjectRole) => {
    setBusyId(targetUserId)
    try {
      await api.patch(`/projects/${projectId}/members/${targetUserId}`, { role })
      toast.success('Project role updated')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Project members" width="max-w-lg">
      <div className="space-y-4">
        {inheritedAccessLabel && (
          <p className="rounded-lg border border-teal-500/25 bg-teal-500/10 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
            You have admin access to this project as <span className="font-medium text-fg">{inheritedAccessLabel}</span>.
            Inherited admins are not listed below — only people explicitly added to the project appear here.
            Use <span className="font-medium text-fg">Invite</span> (space or project scope) to add others.
          </p>
        )}
        {(assignedTeams.data ?? []).length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Assigned teams
            </p>
            <div className="flex flex-wrap gap-2">
              {(assignedTeams.data ?? []).map((link) => (
                <span
                  key={link.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-fg"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{ backgroundColor: link.team_color }}
                  >
                    {link.team_name[0]?.toUpperCase()}
                  </span>
                  {link.team_name}
                  <span className="text-fg-muted">· {link.member_count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Members ({members.data?.length ?? 0})
          </p>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {(members.data ?? []).map((member) => {
              const isSelf = member.user_id === userId
              const canEditMember = canManageMembers && !isSelf
              return (
              <div key={member.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                <Avatar
                  name={member.user?.full_name || member.user?.email || '?'}
                  src={member.user?.avatar_url}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {member.user?.full_name || member.user?.email}
                    {isSelf && <span className="ml-1 text-[11px] text-fg-muted">(you)</span>}
                  </span>
                  <span className="block truncate text-[11px] text-fg-muted">{member.user?.email}</span>
                </span>
                {canEditMember ? (
                  <select
                    className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] uppercase text-fg outline-none focus:border-brand"
                    value={member.role}
                    disabled={busyId === member.user_id}
                    title="Change project role"
                    onChange={(e) => changeRole(member.user_id, e.target.value as ProjectRole)}
                  >
                    {PROJECT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] uppercase text-fg-muted">{member.role}</span>
                )}
                {canEditMember && (
                  <button
                    className="rounded p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-red-400"
                    title="Remove from project"
                    disabled={busyId === member.user_id}
                    onClick={() => remove(member.user_id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )})}
            {members.data?.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-muted">No members on this project yet.</p>
            )}
          </div>
        </div>

        {canManageMembers && (
          <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Users size={14} className="text-brand" />
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Add entire team</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className="input-dark min-w-0 flex-1"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
              >
                <option value="">Select team…</option>
                {availableTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.members.length} members)
                  </option>
                ))}
              </select>
              <select
                className="input-dark w-full sm:w-28"
                value={teamRole}
                onChange={(e) => setTeamRole(e.target.value)}
                title="Project role for team members"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                className="btn-primary shrink-0"
                disabled={!selectedTeamId || assigningTeam}
                onClick={assignTeam}
              >
                {assigningTeam ? 'Adding…' : 'Add team'}
              </button>
            </div>
            {availableTeams.length === 0 && (
              <p className="mt-2 text-xs text-fg-muted">
                {teams.data?.length
                  ? 'All workspace teams are already assigned to this project.'
                  : 'Create teams under Teams in the sidebar first.'}
              </p>
            )}
            <p className="mt-2 text-[11px] text-fg-muted">
              Adds every member of the team to this project — no individual invites needed.
            </p>
          </div>
        )}

        {canManageMembers && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Add one person
              </p>
              <select
                className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-fg outline-none"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                title="Role for newly added members"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="max-h-44 space-y-0.5 overflow-y-auto">
              {candidateList.map((member) => (
                <div key={member.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                  <Avatar
                    name={member.user?.full_name || member.user?.email || '?'}
                    src={member.user?.avatar_url ?? null}
                    size={26}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {member.user?.full_name || member.user?.email}
                    </span>
                    {!member.in_workspace && (
                      <span className="block text-[11px] text-fg-muted">Will be added to this workspace</span>
                    )}
                  </span>
                  <button
                    className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
                    disabled={busyId === member.user_id}
                    onClick={() => add(member.user_id)}
                  >
                    Add
                  </button>
                </div>
              ))}
              {candidates.isLoading && (
                <p className="px-2 py-2 text-xs text-fg-muted">Loading organization members…</p>
              )}
              {!candidates.isLoading && candidateList.length === 0 && (
                <p className="px-2 py-2 text-xs text-fg-muted">
                  No more members to add. Organization, workspace, and space admins already have access
                  automatically. Use invite by email for someone not in your organization yet.
                </p>
              )}
            </div>
          </div>
        )}

        {canManageMembers && (
          <button className="btn-secondary w-full" onClick={onInviteByEmail}>
            <UserPlus size={15} /> Invite someone new by email
          </button>
        )}
      </div>
    </Modal>
  )
}

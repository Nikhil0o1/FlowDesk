import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useWorkspaceMembers } from '../../lib/queries'
import type { OrgMember } from '../../lib/types'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'

/** Manage who's in a project: add existing workspace members, remove, or invite by email. */
export function ProjectMembersModal({
  open,
  onClose,
  projectId,
  workspaceId,
  canManage,
  onInviteByEmail,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  workspaceId: string | undefined
  canManage: boolean
  onInviteByEmail: () => void
}) {
  const queryClient = useQueryClient()
  const workspaceMembers = useWorkspaceMembers(open ? workspaceId : undefined)
  const members = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: open && !!projectId,
  })
  const [addRole, setAddRole] = useState('member')
  const [busyId, setBusyId] = useState<string | null>(null)

  const memberIds = new Set((members.data ?? []).map((m) => m.user_id))
  const candidates = (workspaceMembers.data ?? []).filter((m) => !memberIds.has(m.user_id))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
  }

  const add = async (userId: string) => {
    setBusyId(userId)
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role: addRole })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (userId: string) => {
    setBusyId(userId)
    try {
      await api.delete(`/projects/${projectId}/members/${userId}`)
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
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Members ({members.data?.length ?? 0})
          </p>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {(members.data ?? []).map((member) => (
              <div key={member.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                <Avatar
                  name={member.user?.full_name || member.user?.email || '?'}
                  src={member.user?.avatar_url}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {member.user?.full_name || member.user?.email}
                  </span>
                  <span className="block truncate text-[11px] text-fg-muted">{member.user?.email}</span>
                </span>
                <span className="text-[11px] uppercase text-fg-muted">{member.role}</span>
                {canManage && (
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
            ))}
            {members.data?.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-muted">
                No explicit members yet — workspace admins and the organization owner always have access.
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Add from workspace
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
              {candidates.map((member) => (
                <div key={member.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                  <Avatar
                    name={member.user?.full_name || member.user?.email || '?'}
                    src={member.user?.avatar_url ?? null}
                    size={26}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {member.user?.full_name || member.user?.email}
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
              {candidates.length === 0 && (
                <p className="px-2 py-2 text-xs text-fg-muted">
                  Everyone in this workspace is already a project member.
                </p>
              )}
            </div>
          </div>
        )}

        {canManage && (
          <button className="btn-secondary w-full" onClick={onInviteByEmail}>
            <UserPlus size={15} /> Invite someone new by email
          </button>
        )}
      </div>
    </Modal>
  )
}

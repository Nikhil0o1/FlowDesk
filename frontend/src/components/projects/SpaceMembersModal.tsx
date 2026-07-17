import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { OrgMember } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'

/** Manage who's in a Space: add workspace members, change role, remove. */
export function SpaceMembersModal({
  open,
  onClose,
  spaceId,
  workspaceId,
  canManage,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  workspaceId: string | undefined
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const members = useQuery({
    queryKey: ['space-members', spaceId],
    queryFn: () => api.get<OrgMember[]>(`/spaces/${spaceId}/members`),
    enabled: open && !!spaceId,
  })
  const wsMembers = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => api.get<OrgMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: open && !!workspaceId && canManage,
  })
  const isSpaceAdmin = (members.data ?? []).some((m) => m.user_id === userId && m.role === 'admin')
  const canManageMembers = canManage || isSpaceAdmin
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['space-members', spaceId] })

  const existingIds = new Set((members.data ?? []).map((m) => m.user_id))
  const candidates = (wsMembers.data ?? []).filter((m) => !existingIds.has(m.user_id))

  const add = async (uid: string) => {
    setBusyId(uid)
    try {
      await api.post(`/spaces/${spaceId}/members`, { user_id: uid, role: 'admin' })
      toast.success('Member added to space')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const changeRole = async (uid: string, role: string) => {
    setBusyId(uid)
    try {
      await api.patch(`/spaces/${spaceId}/members/${uid}`, { role })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (uid: string) => {
    setBusyId(uid)
    try {
      await api.delete(`/spaces/${spaceId}/members/${uid}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Space members" width="max-w-lg">
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
                {canManageMembers && member.user_id !== userId ? (
                  member.role === 'admin' ? (
                    <span className="text-[11px] font-semibold uppercase text-fg-muted">Admin</span>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
                      disabled={busyId === member.user_id}
                      onClick={() => changeRole(member.user_id, 'admin')}
                    >
                      Make admin
                    </button>
                  )
                ) : (
                  <span className="text-[11px] uppercase text-fg-muted">{member.role}</span>
                )}
                {canManageMembers && member.user_id !== userId && (
                  <button
                    className="rounded p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-red-400"
                    title="Remove from space"
                    disabled={busyId === member.user_id}
                    onClick={() => remove(member.user_id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {members.data?.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-muted">No members on this space yet.</p>
            )}
          </div>
        </div>

        {canManageMembers && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Add a member</p>
              <span className="text-[10px] text-fg-muted">Adds as space admin</span>
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
              {wsMembers.isLoading && <p className="px-2 py-2 text-xs text-fg-muted">Loading workspace members…</p>}
              {!wsMembers.isLoading && candidates.length === 0 && (
                <p className="px-2 py-2 text-xs text-fg-muted">
                  Everyone in the workspace is already a member, or has access automatically as an admin.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

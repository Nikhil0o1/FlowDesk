import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Lock, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { GoalShareState, OrgMember } from '../../lib/types'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'

type GoalShareRole = 'editor' | 'viewer'

const GOAL_SHARE_ROLE_LABELS: Record<GoalShareRole, string> = {
  editor: 'Editor',
  viewer: 'Viewer',
}

interface ShareGoalModalProps {
  open: boolean
  onClose: () => void
  goalId: string
  goalName: string
  workspaceName: string
  members: OrgMember[]
}

export function ShareGoalModal({
  open,
  onClose,
  goalId,
  goalName,
  members,
}: ShareGoalModalProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<GoalShareRole>('viewer')
  const [copied, setCopied] = useState(false)

  const share = useQuery({
    queryKey: ['goal-share', goalId],
    queryFn: () => api.get<GoalShareState>(`/goals/${goalId}/share`),
    enabled: open && !!goalId,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goal-share', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goal', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goals'] })
  }

  const updateShare = useMutation({
    mutationFn: (is_private: boolean) => api.patch<GoalShareState>(`/goals/${goalId}/share`, { is_private }),
    onSuccess: () => {
      invalidate()
      toast.success('Sharing updated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const addMember = useMutation({
    mutationFn: ({ user_id, role }: { user_id: string; role: GoalShareRole }) =>
      api.post<GoalShareState>(`/goals/${goalId}/share/members`, { user_id, role }),
    onSuccess: () => {
      setQuery('')
      invalidate()
      toast.success('Person invited')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const removeMember = useMutation({
    mutationFn: (user_id: string) => api.delete(`/goals/${goalId}/share/members/${user_id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Access removed')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const sharedIds = new Set((share.data?.members ?? []).map((m) => m.user_id))
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return members.filter((m) => {
      if (sharedIds.has(m.user_id)) return false
      const name = m.user?.full_name?.toLowerCase() ?? ''
      const email = m.user?.email?.toLowerCase() ?? ''
      return name.includes(q) || email.includes(q)
    })
  }, [members, query, sharedIds])

  const copyLink = async () => {
    const url = share.data?.share_url
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy link')
    }
  }

  const isPrivate = share.data?.is_private ?? false
  const isBusy = addMember.isPending || removeMember.isPending || updateShare.isPending

  const inviteMember = (user_id: string) => {
    addMember.mutate({ user_id, role: inviteRole })
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this Goal" width="max-w-md">
      <div className="-m-1 space-y-3">
        <p className="text-xs text-fg-secondary">
          Sharing goal <span className="font-semibold text-fg">{goalName}</span>
        </p>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              className="input w-full py-2.5 pl-9 pr-9 text-sm"
              placeholder="Invite by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length === 1) {
                  inviteMember(filtered[0]!.user_id)
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-muted hover:bg-ink-750"
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            aria-label="Invite role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as GoalShareRole)}
            className="input h-[42px] w-[7.5rem] shrink-0 px-2 text-xs"
          >
            {Object.entries(GOAL_SHARE_ROLE_LABELS).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary h-[42px] shrink-0 !px-4 text-xs"
            disabled={filtered.length !== 1 || isBusy}
            onClick={() => {
              const member = filtered[0]
              if (member) inviteMember(member.user_id)
            }}
          >
            Invite
          </button>
        </div>

        {filtered.length > 0 && (
          <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 p-1.5">
            {filtered.map((member) => (
              <button
                key={member.user_id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-800"
                disabled={isBusy}
                onClick={() => inviteMember(member.user_id)}
              >
                <Avatar
                  name={member.user?.full_name || member.user?.email || '?'}
                  src={member.user?.avatar_url}
                  color={member.user?.avatar_color}
                  size={24}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">
                    {member.user?.full_name || member.user?.email}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{member.user?.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-fg">
            <Link2 size={14} className="text-fg-muted" />
            Private link
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void copyLink()}>
            {copied ? (
              <>
                <Check size={13} className="mr-1 inline text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy size={13} className="mr-1 inline" />
                Copy link
              </>
            )}
          </button>
        </div>

        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Share with</h4>
          <div className="space-y-1.5">
            {(share.data?.members ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-700 px-3 py-2 text-xs text-fg-muted">
                No one has access yet.
              </p>
            ) : (
              (share.data?.members ?? []).map((member) => (
                <div key={member.user_id} className="flex items-center gap-2 rounded-lg border border-ink-700 px-2.5 py-2">
                  <Avatar
                    name={member.user?.full_name || member.user?.email || '?'}
                    src={member.user?.avatar_url}
                    color={member.user?.avatar_color}
                    size={24}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {member.user?.full_name || member.user?.email}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {GOAL_SHARE_ROLE_LABELS[member.role as GoalShareRole] ?? member.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
                    disabled={isBusy}
                    onClick={() => removeMember.mutate(member.user_id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-ink-700 py-2 text-xs font-medium text-fg hover:bg-ink-850"
          disabled={updateShare.isPending || isPrivate}
          onClick={() => updateShare.mutate(true)}
        >
          <Lock size={14} />
          Make Private
        </button>
      </div>
    </Modal>
  )
}

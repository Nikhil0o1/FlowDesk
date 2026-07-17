import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, errorMessage } from '../../../../lib/api'
import type { OrgMember } from '../../../../lib/types'
import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { Avatar } from '../../../../components/ui/Avatar'
import { Modal } from '../../../../components/ui/Modal'
import { docsKeys, type DocFolderShareState } from '../../services/docsApi.service'

type FolderShareRole = 'editor' | 'viewer'

const FOLDER_SHARE_ROLE_LABELS: Record<FolderShareRole, string> = {
  editor: 'Editor',
  viewer: 'Viewer',
}

interface ShareDocFolderModalProps {
  open: boolean
  onClose: () => void
  folderId: string
  folderName: string
  workspaceName: string
  members: OrgMember[]
}

export function ShareDocFolderModal({
  open,
  onClose,
  folderId,
  folderName,
  workspaceName,
  members,
}: ShareDocFolderModalProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<FolderShareRole>('viewer')

  const share = useQuery({
    queryKey: docsKeys.folderShare(folderId),
    queryFn: () => api.get<DocFolderShareState>(`/doc-folders/${folderId}/share`),
    enabled: open && !!folderId,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.folderShare(folderId) })
    void queryClient.invalidateQueries({ queryKey: docsKeys.all })
  }

  const updateShare = useMutation({
    mutationFn: (is_private: boolean) =>
      api.patch<DocFolderShareState>(`/doc-folders/${folderId}/share`, { is_private }),
    onSuccess: () => {
      invalidate()
      toast.success('Sharing updated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const addMember = useMutation({
    mutationFn: ({ user_id, role }: { user_id: string; role: FolderShareRole }) =>
      api.post<DocFolderShareState>(`/doc-folders/${folderId}/share/members`, {
        user_id,
        role,
      }),
    onSuccess: () => {
      setQuery('')
      invalidate()
      toast.success('Person invited')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const removeMember = useMutation({
    mutationFn: (user_id: string) => api.delete(`/doc-folders/${folderId}/share/members/${user_id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Access removed')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const updateMemberRole = useMutation({
    mutationFn: ({ user_id, role }: { user_id: string; role: FolderShareRole }) =>
      api.patch<DocFolderShareState>(`/doc-folders/${folderId}/share/members/${user_id}`, { role }),
    onSuccess: () => {
      invalidate()
      toast.success('Role updated')
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

  const isPrivate = share.data?.is_private ?? false
  const isBusy =
    addMember.isPending || removeMember.isPending || updateMemberRole.isPending || updateShare.isPending

  const inviteMember = (user_id: string) => {
    addMember.mutate({ user_id, role: inviteRole })
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this Folder" width="max-w-md">
      <div className="-m-1 space-y-3">
        <p className="text-xs text-fg-secondary">
          Sharing folder <span className="font-semibold text-fg">{folderName}</span>
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
            onChange={(e) => setInviteRole(e.target.value as FolderShareRole)}
            className="input h-[42px] w-[7.5rem] shrink-0 px-2 text-xs"
          >
            {Object.entries(FOLDER_SHARE_ROLE_LABELS).map(([role, label]) => (
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
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-ink-800"
                disabled={isBusy}
                onClick={() => inviteMember(member.user_id)}
              >
                <Avatar
                  name={member.user?.full_name || member.user?.email || '?'}
                  src={member.user?.avatar_url}
                  color={member.user?.avatar_color}
                  size={28}
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

        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Share with</h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-ink-700 px-2.5 py-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                {workspaceName[0]?.toUpperCase() || 'W'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{workspaceName}</p>
                <span className="rounded-full bg-ink-750 px-2 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">
                  Workspace members
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!isPrivate}
                disabled={updateShare.isPending}
                onClick={() => updateShare.mutate(isPrivate ? false : true)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  !isPrivate ? 'bg-brand' : 'bg-ink-700',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    !isPrivate ? 'left-5' : 'left-0.5',
                  )}
                />
              </button>
            </div>

            {(share.data?.members ?? []).map((member) => (
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
                  <p className="text-xs text-fg-muted">{FOLDER_SHARE_ROLE_LABELS[member.role as FolderShareRole] ?? member.role}</p>
                </div>
                <select
                  aria-label={`Role for ${member.user?.full_name || member.user?.email || 'member'}`}
                  className="input h-9 w-24 shrink-0 px-2 text-xs"
                  value={member.role}
                  disabled={isBusy}
                  onChange={(e) =>
                    updateMemberRole.mutate({
                      user_id: member.user_id,
                      role: e.target.value as FolderShareRole,
                    })
                  }
                >
                  {Object.entries(FOLDER_SHARE_ROLE_LABELS).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
                  disabled={isBusy}
                  onClick={() => removeMember.mutate(member.user_id)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
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

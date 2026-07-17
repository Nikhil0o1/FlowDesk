import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Code2, Globe, Link2, Lock, Search, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { INVITE_EMAIL_ERROR, isValidInviteEmail } from '../../lib/emailValidation'
import { escapeHtmlAttr } from '../../lib/htmlEscape'
import { safeExternalUrl } from '../../lib/safeUrl'
import type { TaskShareState } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Never expire', days: null },
  { label: '24 hours', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
]

const PERMISSION_OPTIONS: { value: 'editor' | 'viewer'; label: string }[] = [
  { value: 'editor', label: 'Can edit' },
  { value: 'viewer', label: 'Can view' },
]

function publicShareUrl(state: TaskShareState | undefined): string {
  if (!state?.public_enabled) return ''
  if (state.public_token) return `${window.location.origin}/t/${state.public_token}`
  return state.public_url ?? ''
}

/** ClickUp-style "Share this task" dialog. */
export function ShareModal({
  open,
  onClose,
  taskId,
  taskTitle,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  taskTitle: string
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [emailBlurred, setEmailBlurred] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer')
  const [showAdvanced, setShowAdvanced] = useState(true)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setEmailBlurred(false)
    setSubmitAttempted(false)
  }, [open])

  const trimmedEmail = email.trim()
  const emailInvalid = trimmedEmail.length > 0 && !isValidInviteEmail(trimmedEmail)
  const domainPart = trimmedEmail.split('@')[1] ?? ''
  const domainLooksComplete = domainPart.includes('.')
  const emailError =
    emailInvalid && (emailBlurred || submitAttempted || domainLooksComplete)
      ? INVITE_EMAIL_ERROR
      : null

  const share = useQuery({
    queryKey: ['task-share', taskId],
    queryFn: () => api.get<TaskShareState>(`/tasks/${taskId}/share`),
    enabled: open,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['task-share', taskId] })
    void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
  }

  const patchShare = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<TaskShareState>(`/tasks/${taskId}/share`, body),
    onSuccess: (data) => queryClient.setQueryData(['task-share', taskId], data),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const invite = useMutation({
    mutationFn: () =>
      api.post<TaskShareState>(`/tasks/${taskId}/share/members`, {
        email: trimmedEmail,
        role: inviteRole,
      }),
    onSuccess: (data) => {
      toast.success(`Invitation sent to ${trimmedEmail}`)
      setEmail('')
      setEmailBlurred(false)
      setSubmitAttempted(false)
      queryClient.setQueryData(['task-share', taskId], data)
      invalidate()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const inviteDisabled = !trimmedEmail || invite.isPending

  const submitInvite = () => {
    if (!trimmedEmail || !isValidInviteEmail(trimmedEmail)) {
      setSubmitAttempted(true)
      return
    }
    invite.mutate()
  }

  const updateMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'editor' | 'viewer' }) =>
      api.patch<TaskShareState>(`/tasks/${taskId}/share/members/${userId}`, { role }),
    onSuccess: (data) => queryClient.setQueryData(['task-share', taskId], data),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete<TaskShareState>(`/tasks/${taskId}/share/members/${userId}`),
    onSuccess: (data) => queryClient.setQueryData(['task-share', taskId], data),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const state = share.data
  const privateLink = `${window.location.origin}/app/tasks/${taskId}`
  const publicUrl = publicShareUrl(state)
  const embedSrc = safeExternalUrl(publicUrl) ?? ''
  const embedCode = embedSrc
    ? `<iframe src="${escapeHtmlAttr(embedSrc)}" width="700" height="480" style="border:1px solid #2a2a35;border-radius:10px" title="${escapeHtmlAttr(taskTitle)}"></iframe>`
    : ''
  const expiryLabel = state?.public_expires_at
    ? `Expires ${new Date(state.public_expires_at).toLocaleDateString()}`
    : 'Never expire'

  const copy = async (text: string, label: string) => {
    if (!text) {
      toast.error(`${label} is not available yet`)
      return
    }
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  }

  const setExpiry = (days: number | null) => {
    if (days === null) patchShare.mutate({ clear_public_expiry: true })
    else patchShare.mutate({ public_expires_at: new Date(Date.now() + days * 86_400_000).toISOString() })
  }

  const busy = patchShare.isPending || share.isLoading
  const members = state?.members ?? []

  if (share.isLoading) {
    return (
      <Modal open={open} onClose={onClose} title="Share this task" width="max-w-md">
        <CenteredSpinner />
      </Modal>
    )
  }

  if (share.isError || !state) {
    return (
      <Modal open={open} onClose={onClose} title="Share this task" width="max-w-md">
        <p className="text-sm text-fg-secondary">Unable to load sharing settings for this task.</p>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this task" width="max-w-md">
      <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-fg-muted">
        Sharing task <span className="font-medium text-fg-secondary">{taskTitle}</span>
        {state.is_private && <Lock size={12} className="text-amber-400" />}
      </p>

      {/* Private sharing — invite specific people */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Private sharing</p>
      <div className="flex gap-2">
        <input
          type="email"
          className={cn('input-dark flex-1', emailError && 'border-red-500/50')}
          placeholder="Invite by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailBlurred(true)}
          onKeyDown={(e) => e.key === 'Enter' && submitInvite()}
          aria-invalid={emailError ? true : undefined}
        />
        <Dropdown
          align="right"
          width="w-32"
          trigger={
            <button className="btn-secondary !px-2 text-xs whitespace-nowrap">
              {PERMISSION_OPTIONS.find((o) => o.value === inviteRole)?.label}
            </button>
          }
        >
          {(close) =>
            PERMISSION_OPTIONS.map((o) => (
              <button
                key={o.value}
                className="menu-item"
                onClick={() => {
                  setInviteRole(o.value)
                  close()
                }}
              >
                {o.label}
              </button>
            ))
          }
        </Dropdown>
        <button
          className="btn-primary !px-4 text-xs"
          disabled={inviteDisabled}
          onClick={submitInvite}
        >
          Invite
        </button>
      </div>
      {emailError && <p className="mt-1.5 text-xs text-red-400">{emailError}</p>}
      <p className="mt-1.5 text-[11px] text-fg-muted">
        Only invited people can access this task. Assign view or edit permissions per person.
      </p>

      {/* Public link */}
      <div className="mt-5 flex items-center gap-3">
        <Globe size={16} className="shrink-0 text-fg-secondary" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-fg">Public link</p>
          <p className="text-[11px] text-fg-muted">Anyone with the link can view — no account required</p>
        </div>
        <Toggle
          checked={!!state.public_enabled}
          onChange={(v) => patchShare.mutate({ public_enabled: v })}
          disabled={busy}
        />
      </div>

      {state.public_enabled && (
        <>
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-ink-750 py-2 text-sm font-medium text-fg transition-colors hover:bg-ink-700"
            onClick={() => void copy(publicUrl, 'Public link')}
          >
            <Link2 size={14} /> Copy public link
          </button>

          {showAdvanced ? (
            <div className="mt-3 space-y-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-medium text-fg">Expire link</p>
                <Dropdown
                  align="right"
                  width="w-40"
                  trigger={
                    <button className="flex items-center gap-1 text-xs text-fg-secondary hover:text-fg">
                      {expiryLabel} <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                  }
                >
                  {(close) =>
                    EXPIRY_OPTIONS.map((o) => (
                      <button
                        key={o.label}
                        className="menu-item"
                        onClick={() => {
                          setExpiry(o.days)
                          close()
                        }}
                      >
                        {o.label}
                      </button>
                    ))
                  }
                </Dropdown>
              </div>

              <div className="flex items-center gap-2">
                <Search size={14} className="shrink-0 text-fg-muted" />
                <p className="flex-1 text-sm font-medium text-fg">Share link with search engines</p>
                <Toggle
                  checked={!!state.public_searchable}
                  onChange={(v) => patchShare.mutate({ public_searchable: v })}
                  disabled={busy}
                />
              </div>

              <div className="flex items-center gap-2">
                <Code2 size={14} className="shrink-0 text-fg-muted" />
                <p className="flex-1 text-sm font-medium text-fg">Embed code</p>
                <button className="btn-secondary !py-1 text-xs" onClick={() => void copy(embedCode, 'Embed code')}>
                  Copy code
                </button>
              </div>

              <button
                className="w-full rounded-lg border border-ink-700 py-1.5 text-xs font-medium text-fg-secondary hover:border-ink-600 hover:text-fg"
                onClick={() => setShowAdvanced(false)}
              >
                Hide advanced settings
              </button>

              <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                <Globe size={11} /> Public sharing is view-only — recipients cannot edit or comment.
              </p>
            </div>
          ) : (
            <button
              className="mt-2 w-full rounded-lg border border-ink-700 py-1.5 text-xs font-medium text-fg-secondary hover:border-ink-600 hover:text-fg"
              onClick={() => setShowAdvanced(true)}
            >
              Show advanced settings
            </button>
          )}
        </>
      )}

      {/* Private link for team members */}
      <div className="mt-4 flex items-center gap-3">
        <Link2 size={16} className="shrink-0 text-fg-secondary" />
        <div className="flex-1">
          <p className="text-sm font-medium text-fg">Private link</p>
          <p className="text-[11px] text-fg-muted">Requires a FlowDesk account and project access</p>
        </div>
        <button className="btn-secondary !py-1 text-xs" onClick={() => void copy(privateLink, 'Private link')}>
          Copy link
        </button>
      </div>

      {/* Project visibility */}
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Project access</p>
      <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5">
        <Users size={15} className="text-fg-secondary" />
        <span className="flex-1 text-sm text-fg">Everyone in the project</span>
        <Toggle
          checked={!state.is_private}
          onChange={(v) => patchShare.mutate({ is_private: !v })}
          disabled={busy}
        />
      </div>

      {members.length > 0 && (
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fg-secondary">
            <Users size={13} /> People with access
          </p>
          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                <Avatar name={m.user?.full_name || m.user?.email || '?'} src={m.user?.avatar_url} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{m.user?.full_name || m.user?.email}</span>
                <Dropdown
                  align="right"
                  width="w-28"
                  trigger={
                    <button className="text-[11px] uppercase text-fg-muted hover:text-fg">
                      {m.role === 'editor' ? 'Can edit' : 'Can view'}
                    </button>
                  }
                >
                  {(close) =>
                    PERMISSION_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className="menu-item"
                        onClick={() => {
                          updateMemberRole.mutate({ userId: m.user_id, role: o.value })
                          close()
                        }}
                      >
                        {o.label}
                      </button>
                    ))
                  }
                </Dropdown>
                <button className="text-fg-muted hover:text-red-400" onClick={() => removeMember.mutate(m.user_id)} title="Remove">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-ink-700'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

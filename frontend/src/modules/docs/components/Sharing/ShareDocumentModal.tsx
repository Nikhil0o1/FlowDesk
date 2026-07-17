import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  FileText,
  Globe,
  Info,
  Link2,
  Lock,
  Search,
  Shield,
  Upload,
  Users,
  X,
} from 'lucide-react'

import { useCurrentContext, useWorkspaceMembers } from '../../../../lib/queries'
import { INVITE_EMAIL_ERROR, isValidInviteEmail } from '../../../../lib/emailValidation'
import { toast } from '../../../../stores/toast'
import { useAuthStore, displayName } from '../../../../stores/auth'
import { Avatar } from '../../../../components/ui/Avatar'
import { Dropdown } from '../../../../components/ui/Dropdown'
import { Modal } from '../../../../components/ui/Modal'
import { CenteredSpinner } from '../../../../components/ui/Spinner'
import { cn } from '../../../../lib/utils'
import { useDocuments } from '../../hooks/useDocuments'
import { useSharing } from '../../hooks/useSharing'
import { exportDocument, DOC_EXPORT_FORMATS, DOC_EXPORT_EXTRA_FORMATS, type ExportFormat } from '../../services/docExport.service'
import { ROLE_LABELS } from '../../services/permissions.service'
import type { DocRole } from '../../types/permissions'
import type { FlowDoc } from '../../types/document'

const INVITE_ROLES: DocRole[] = ['editor', 'commenter', 'viewer']

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-ink-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

function InfoTip({ label }: { label: string }) {
  return (
    <span title={label} className="inline-flex text-fg-muted" aria-label={label}>
      <Info size={13} />
    </span>
  )
}

/** ClickUp-style "Share this Doc" / "Share this page" dialog. */
export type ShareScope = 'doc' | 'page'

export function ShareDocumentModal({
  doc,
  open,
  onClose,
  scope = 'doc',
  onScopeChange,
}: {
  doc: FlowDoc
  open: boolean
  onClose: () => void
  scope?: ShareScope
  onScopeChange?: (scope: ShareScope) => void
}) {
  const user = useAuthStore((s) => s.user)
  const { workspace } = useCurrentContext()
  const { data: workspaceMembers } = useWorkspaceMembers(workspace?.id)
  const { getDocument, setProtected } = useDocuments()
  const liveDoc = getDocument(doc.id) ?? doc

  const canManage =
    liveDoc.userRole === 'owner' || (!!user?.id && liveDoc.authorId === user.id)

  const {
    share,
    members,
    shareWith,
    inviteByEmail,
    removeAccess,
    updatePermission,
    togglePublic,
    togglePrivate,
    publicLink,
    privateLink,
    isLoading,
    isError,
  } = useSharing(liveDoc.id, liveDoc.title, liveDoc.author, liveDoc.authorId)

  const [query, setQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<DocRole>('viewer')
  const [showPeople, setShowPeople] = useState(true)
  const [busy, setBusy] = useState(false)
  const [queryBlurred, setQueryBlurred] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setInviteRole('viewer')
    setShowPeople(true)
    setQueryBlurred(false)
    setSubmitAttempted(false)
  }, [open, liveDoc.id])

  const trimmedQuery = query.trim()
  const queryIsEmail = isValidInviteEmail(trimmedQuery)
  const queryLooksLikeEmail = trimmedQuery.includes('@')
  const domainPart = trimmedQuery.split('@')[1] ?? ''
  const domainLooksComplete = domainPart.includes('.')
  const emailError =
    queryLooksLikeEmail && !queryIsEmail && (queryBlurred || submitAttempted || domainLooksComplete)
      ? INVITE_EMAIL_ERROR
      : null

  const LeadIcon = liveDoc.isWiki ? BookOpen : FileText

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const sharedIds = new Set(members.filter((m) => m.type === 'user').map((m) => m.targetId))
    return (workspaceMembers ?? []).filter((m) => {
      if (sharedIds.has(m.user_id)) return false
      const name = (m.user?.full_name || '').toLowerCase()
      const email = (m.user?.email || '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [members, query, workspaceMembers])

  const invitedMembers = members.filter((m) => m.role !== 'owner')

  const copy = async (text: string, label: string) => {
    if (!text) {
      toast.error(`${label} is not available`)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const addUser = async (userId: string, name: string, email?: string, avatarUrl?: string | null) => {
    if (!canManage) return
    await run(async () => {
      await shareWith({ type: 'user', targetId: userId, name, email, avatarUrl, role: inviteRole })
      setQuery('')
      setQueryBlurred(false)
      setSubmitAttempted(false)
      toast.success(`Shared with ${name}`)
    })
  }

  const submitEmailInvite = async () => {
    if (!canManage || !queryIsEmail) {
      setSubmitAttempted(true)
      return
    }
    await run(async () => {
      await inviteByEmail(trimmedQuery, inviteRole)
      setQuery('')
      setQueryBlurred(false)
      setSubmitAttempted(false)
      toast.success(`Invitation sent to ${trimmedQuery}`)
    })
  }

  const onExport = async (format: ExportFormat) => {
    try {
      await exportDocument(liveDoc, format)
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch {
      toast.error('Export failed')
    }
  }

  const onToggleProtect = async (next: boolean) => {
    if (!canManage) return
    setBusy(true)
    try {
      await setProtected(liveDoc.id, next)
      toast.success(next ? 'Document protected' : 'Protection removed')
    } catch {
      toast.error('Could not update protection')
    } finally {
      setBusy(false)
    }
  }

  const isPageScope = scope === 'page'
  const modalTitle = isPageScope ? 'Share this page' : 'Share this Doc'
  const scopeLabel = isPageScope ? 'Sharing page' : 'Sharing as a single view'

  if (isLoading) {
    return (
      <Modal open={open} onClose={onClose} title={modalTitle} width="max-w-md">
        <CenteredSpinner />
      </Modal>
    )
  }

  if (isError) {
    return (
      <Modal open={open} onClose={onClose} title={modalTitle} width="max-w-md">
        <p className="text-sm text-fg-secondary">Unable to load sharing settings for this document.</p>
      </Modal>
    )
  }

  return (
    <div>
      <Modal open={open} onClose={onClose} title={modalTitle} width="max-w-md">
        <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-fg-muted">
          {scopeLabel}
          <LeadIcon size={13} className="shrink-0 text-brand" />
          <span className="truncate font-medium text-fg-secondary underline decoration-ink-600 underline-offset-2">
            {liveDoc.title || 'Untitled'}
          </span>
        </p>

        {!isPageScope && canManage ? (
          <div className="relative mb-4">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input
                  type="email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => setQueryBlurred(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (candidates.length === 1) {
                        const m = candidates[0]
                        void addUser(
                          m.user_id,
                          m.user?.full_name || m.user?.email || 'User',
                          m.user?.email,
                          m.user?.avatar_url,
                        )
                      } else if (queryIsEmail) {
                        void submitEmailInvite()
                      } else {
                        setSubmitAttempted(true)
                      }
                    }
                  }}
                  placeholder="Invite by name or email"
                  className={cn('input-dark w-full py-2.5 pl-9 pr-9 text-sm', emailError && 'border-red-500/50')}
                  aria-label="Invite by name or email"
                  aria-invalid={emailError ? true : undefined}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('')
                      setQueryBlurred(false)
                      setSubmitAttempted(false)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-muted hover:text-fg"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                aria-label="Invite role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as DocRole)}
                className="input h-[42px] w-[7.5rem] shrink-0 px-2 text-xs"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary h-[42px] shrink-0 !px-4 text-xs"
                disabled={!trimmedQuery || busy}
                onClick={() => {
                  if (queryIsEmail) void submitEmailInvite()
                  else if (candidates.length === 1) {
                    const m = candidates[0]
                    void addUser(
                      m.user_id,
                      m.user?.full_name || m.user?.email || 'User',
                      m.user?.email,
                      m.user?.avatar_url,
                    )
                  } else {
                    setSubmitAttempted(true)
                  }
                }}
              >
                Invite
              </button>
            </div>
            {emailError && <p className="mt-1.5 text-xs text-red-400">{emailError}</p>}
            {query && candidates.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 shadow-popover">
                {candidates.slice(0, 8).map((m) => (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-750"
                      onClick={() =>
                        void addUser(
                          m.user_id,
                          m.user?.full_name || m.user?.email || 'User',
                          m.user?.email,
                          m.user?.avatar_url,
                        )
                      }
                    >
                      <Avatar name={m.user?.full_name || m.user?.email || '?'} src={m.user?.avatar_url} size={24} />
                      <span className="min-w-0 flex-1 truncate">{m.user?.full_name || m.user?.email}</span>
                      <span className="text-[11px] text-fg-muted">{ROLE_LABELS[inviteRole]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query && candidates.length === 0 && queryIsEmail && !emailError && (
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-between rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-left text-sm text-fg-secondary hover:bg-ink-800 hover:text-fg"
                onClick={() => void submitEmailInvite()}
              >
                <span>
                  Invite <span className="font-medium text-fg">{trimmedQuery}</span> to workspace &amp; share doc
                </span>
                <span className="text-[11px] text-fg-muted">{ROLE_LABELS[inviteRole]}</span>
              </button>
            )}
            {query && candidates.length === 0 && !queryIsEmail && !emailError && (
              <p className="mt-1.5 text-xs text-fg-muted">
                No workspace members match. Enter a valid email to invite someone new.
              </p>
            )}
          </div>
        ) : !isPageScope ? (
          <p className="mb-4 rounded-lg border border-ink-700 bg-ink-900/50 px-3 py-2 text-xs text-fg-muted">
            You can view sharing settings. Only the document owner can change access.
          </p>
        ) : null}

        <div className="space-y-0 divide-y divide-ink-700 rounded-xl border border-ink-700">
          <ShareRow
            icon={Globe}
            label="Share link with anyone"
            tip="Anyone with the link can view — no account required"
            action={
              <Toggle
                checked={share.publicEnabled}
                onChange={(v) => void run(() => togglePublic(v))}
                disabled={!canManage || busy}
              />
            }
          />
          <ShareRow
            icon={Link2}
            label="Private link"
            tip="Requires a FlowDesk account and document access"
            action={
              <button
                type="button"
                className="btn-secondary !py-1 text-xs"
                onClick={() => void copy(privateLink, 'Private link')}
              >
                Copy link
              </button>
            }
          />
          <ShareRow
            icon={Upload}
            label={isPageScope ? 'Export page' : 'Export Doc'}
            tip="Download a copy of this document"
            action={
              <Dropdown
                align="right"
                width="w-40"
                trigger={
                  <button type="button" className="btn-secondary !py-1 text-xs">
                    Export
                  </button>
                }
              >
                {(close) => (
                  <>
                    {DOC_EXPORT_FORMATS.map(({ format, label }) => (
                      <button key={format} type="button" className="menu-item" onClick={() => { void onExport(format); close() }}>
                        {label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-ink-700" />
                    {DOC_EXPORT_EXTRA_FORMATS.map(({ format, label }) => (
                      <button key={format} type="button" className="menu-item" onClick={() => { void onExport(format); close() }}>
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
            }
          />
          <ShareRow
            icon={Lock}
            label={isPageScope ? 'Protect page' : 'Protect Doc'}
            tip="Only the owner can edit when protection is on"
            action={
              <Toggle
                checked={!!liveDoc.isProtected}
                onChange={(v) => void onToggleProtect(v)}
                disabled={!canManage || busy}
              />
            }
          />
        </div>

        {share.publicEnabled && publicLink && (
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-ink-750 py-2 text-sm font-medium text-fg transition-colors hover:bg-ink-700"
            onClick={() => void copy(publicLink, 'Public link')}
          >
            <Globe size={14} /> Copy public link
          </button>
        )}

        {!isPageScope && (
          <>
            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Share with</p>

            <div className="rounded-xl border border-ink-700">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-label={showPeople ? 'Collapse people list' : 'Expand people list'}
                  onClick={() => setShowPeople((v) => !v)}
                  className="rounded p-0.5 text-fg-muted hover:text-fg"
                >
                  <ChevronRight size={14} className={cn('transition-transform', showPeople && 'rotate-90')} />
                </button>
                <Avatar name={workspace?.name ?? 'Workspace'} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{workspace?.name ?? 'Workspace'}</p>
                  <span className="mt-0.5 inline-flex rounded-full bg-ink-750 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                    Workspace members
                  </span>
                </div>
                {user && <Avatar name={displayName(user)} src={user.profile?.avatar_url} size={24} />}
                <Toggle
                  checked={!share.isPrivate}
                  onChange={(v) => void run(() => togglePrivate(!v))}
                  disabled={!canManage || busy}
                />
              </div>

              {showPeople && (
                <div className="border-t border-ink-700 px-3 py-2">
                  {members.length === 0 ? (
                    <p className="py-2 text-xs text-fg-muted">No one has access yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-ink-800/80">
                          <Avatar name={m.name} src={m.avatarUrl} color={m.avatarColor} size={26} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-fg">{m.name}</p>
                            {m.email && <p className="truncate text-[11px] text-fg-muted">{m.email}</p>}
                          </div>
                          {m.role === 'owner' ? (
                            <span className="text-[11px] text-fg-muted">{ROLE_LABELS.owner}</span>
                          ) : canManage ? (
                            <>
                              <select
                                aria-label={`Role for ${m.name}`}
                                value={m.role}
                                onChange={(e) => void run(() => updatePermission(m.id, e.target.value as DocRole))}
                                disabled={busy}
                                className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[11px]"
                              >
                                {INVITE_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                aria-label={`Remove ${m.name}`}
                                onClick={() => void run(() => removeAccess(m.id))}
                                disabled={busy}
                                className="rounded p-1 text-fg-muted hover:text-rose-400"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] text-fg-muted">{ROLE_LABELS[m.role]}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {invitedMembers.length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
                      <Users size={11} />
                      {invitedMembers.length} invited {invitedMembers.length === 1 ? 'member' : 'members'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="mt-3 flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg"
              onClick={() => onScopeChange?.('page')}
            >
              Share this page
              <ChevronRight size={14} className="ml-auto" />
            </button>
          </>
        )}

        {isPageScope && onScopeChange && (
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg"
            onClick={() => onScopeChange('doc')}
          >
            Share this Doc (All pages)
            <ChevronRight size={14} className="ml-auto" />
          </button>
        )}
      </Modal>
    </div>
  )
}

function ShareRow({
  icon: Icon,
  label,
  tip,
  action,
}: {
  icon: typeof Globe
  label: string
  tip: string
  action: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon size={15} className="shrink-0 text-fg-secondary" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <p className="text-sm text-fg">{label}</p>
        <InfoTip label={tip} />
      </div>
      {action}
    </div>
  )
}

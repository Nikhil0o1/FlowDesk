import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Power, Search } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { INVITE_EMAIL_ERROR, isValidInviteEmail } from '../../lib/emailValidation'
import type { OrgMetadata, Page } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function OrganizationsAdminPage() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orgs', q, page],
    queryFn: () =>
      api.get<Page<OrgMetadata>>(`/admin/organizations?page=${page}&page_size=25${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  })

  const toggle = useMutation({
    mutationFn: ({ id, disable }: { id: string; disable: boolean }) =>
      api.post(`/admin/organizations/${id}/${disable ? 'disable' : 'enable'}`),
    onSuccess: (_, vars) => {
      toast.success(vars.disable ? 'Organization disabled' : 'Organization enabled')
      void queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Organizations</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">Metadata only — workspace content is isolated.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> New organization
        </button>
      </div>

      <div className="relative mt-5 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="Search organizations"
          className="input-dark !pl-9"
        />
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={Building2} title="No organizations" description="Create one and invite its owner." />
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl border border-ink-700">
          <div className="grid grid-cols-[1fr_90px_90px_90px_90px_90px] gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            <span>Organization</span>
            <span>Members</span>
            <span>Workspaces</span>
            <span>Projects</span>
            <span>Tasks</span>
            <span>Status</span>
          </div>
          {data!.items.map((org) => (
            <div key={org.id} className="grid grid-cols-[1fr_90px_90px_90px_90px_90px] items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0">
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-medium', org.is_disabled ? 'text-fg-muted line-through' : 'text-fg')}>
                  {org.name}
                </p>
                <p className="text-[11px] text-fg-muted">
                  created {formatDate(org.created_at)}
                </p>
              </div>
              <span className="text-sm text-fg-secondary">{org.member_count}</span>
              <span className="text-sm text-fg-secondary">{org.workspace_count}</span>
              <span className="text-sm text-fg-secondary">{org.project_count}</span>
              <span className="text-sm text-fg-secondary">{org.task_count}</span>
              <button
                onClick={() => toggle.mutate({ id: org.id, disable: !org.is_disabled })}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors',
                  org.is_disabled
                    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                    : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25',
                )}
              >
                <Power size={11} />
                {org.is_disabled ? 'Disabled' : 'Active'}
              </button>
            </div>
          ))}
        </div>
      )}

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [emailBlurred, setEmailBlurred] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [creating, setCreating] = useState(false)

  const trimmedEmail = ownerEmail.trim()
  const emailInvalid = trimmedEmail.length > 0 && !isValidInviteEmail(trimmedEmail)
  const domainPart = trimmedEmail.split('@')[1] ?? ''
  const domainLooksComplete = domainPart.includes('.')
  const emailError =
    emailInvalid && (emailBlurred || submitAttempted || domainLooksComplete)
      ? INVITE_EMAIL_ERROR
      : null
  const canSubmit =
    name.trim().length >= 2 && !!trimmedEmail && isValidInviteEmail(trimmedEmail) && !creating

  const handleClose = () => {
    setName('')
    setOwnerEmail('')
    setEmailBlurred(false)
    setSubmitAttempted(false)
    onClose()
  }

  const create = async () => {
    if (!trimmedEmail || !isValidInviteEmail(trimmedEmail)) {
      setSubmitAttempted(true)
      return
    }
    setCreating(true)
    try {
      await api.post('/admin/organizations', {
        name: name.trim(),
        owner_email: trimmedEmail,
      })
      toast.success(`Organization created — onboarding email sent to ${trimmedEmail}`)
      void queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
      handleClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create organization" width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">
            Organization name <span className="text-red-400">*</span>
          </label>
          <input
            className="input-dark"
            placeholder="e.g. Acme Corp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">
            Owner email <span className="text-red-400">*</span>
          </label>
          <input
            className={cn('input-dark', emailError && 'border-red-500/50')}
            type="email"
            placeholder="owner@example.com"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            onBlur={() => setEmailBlurred(true)}
            aria-invalid={emailError ? true : undefined}
          />
          {emailError && <p className="mt-1.5 text-xs text-red-400">{emailError}</p>}
        </div>
        <p className="text-xs text-fg-muted">
          The owner receives an onboarding email with a secure activation link (expires in 48h).
        </p>
        <button
          className="btn-primary w-full"
          disabled={!canSubmit}
          onClick={create}
        >
          {creating ? 'Creating…' : 'Create & send invite'}
        </button>
      </div>
    </Modal>
  )
}

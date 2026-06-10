import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

type Scope = 'organization' | 'workspace' | 'project'

export function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const [email, setEmail] = useState('')
  const [scope, setScope] = useState<Scope>('workspace')
  const [role, setRole] = useState('member')
  const [projectId, setProjectId] = useState('')
  const [sending, setSending] = useState(false)

  const isOrgOwner = org?.my_role === 'owner'

  const send = async () => {
    if (!email.trim()) return
    setSending(true)
    try {
      if (scope === 'organization' && org) {
        await api.post(`/organizations/${org.id}/invites`, { email: email.trim(), role })
      } else if (scope === 'workspace' && workspace) {
        await api.post(`/workspaces/${workspace.id}/invites`, {
          email: email.trim(),
          role: role === 'owner' ? 'admin' : role,
        })
      } else if (scope === 'project') {
        const pid = projectId || projects.data?.[0]?.id
        if (!pid) throw new Error('No project selected')
        await api.post(`/projects/${pid}/invites`, {
          email: email.trim(),
          role: role === 'owner' || role === 'admin' ? 'member' : role,
        })
      }
      toast.success(`Invitation sent to ${email.trim()}`)
      setEmail('')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const roleOptions =
    scope === 'organization'
      ? ['member', 'owner']
      : scope === 'workspace'
        ? ['member', 'admin']
        : ['member', 'admin', 'viewer']

  return (
    <Modal open={open} onClose={onClose} title="Invite people" width="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Email address</label>
          <input
            type="email"
            className="input-dark"
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Invite to</label>
          <div className="flex gap-2">
            {isOrgOwner && (
              <ScopeButton current={scope} value="organization" onSelect={setScope}>
                Organization
              </ScopeButton>
            )}
            <ScopeButton current={scope} value="workspace" onSelect={setScope}>
              Workspace
            </ScopeButton>
            <ScopeButton current={scope} value="project" onSelect={setScope}>
              Project
            </ScopeButton>
          </div>
        </div>

        {scope === 'project' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Project</label>
            <select className="input-dark" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Role</label>
          <select className="input-dark" value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-fg-muted">
          New users get an onboarding email to activate their account and set a password. Existing
          users get an accept link — no password reset needed.
        </p>

        <button className="btn-primary w-full" disabled={sending || !email.trim()} onClick={send}>
          {sending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </Modal>
  )
}

function ScopeButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: Scope
  value: Scope
  onSelect: (s: Scope) => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        current === value
          ? 'border-brand bg-brand-soft text-fg'
          : 'border-ink-700 bg-ink-800 text-fg-secondary hover:bg-ink-750'
      }`}
    >
      {children}
    </button>
  )
}

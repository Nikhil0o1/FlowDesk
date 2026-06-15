import { INVITE_ROLES, type InviteScope } from './inviteScopes'
import { InviteTargetSelect } from './InviteTargetSelect'
import { useInviteForm } from './useInviteForm'
import { Modal } from '../ui/Modal'

export function InviteModal({
  open,
  onClose,
  defaultScope = 'workspace',
  defaultWorkspaceId = '',
  defaultProjectId = '',
}: {
  open: boolean
  onClose: () => void
  defaultScope?: InviteScope
  defaultWorkspaceId?: string
  defaultProjectId?: string
}) {
  const form = useInviteForm({
    open,
    onClose,
    defaultScope,
    defaultWorkspaceId,
    defaultProjectId,
  })

  const roleOptions = INVITE_ROLES[form.scope]

  return (
    <Modal open={open} onClose={onClose} title="Invite people" width="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Email address</label>
          <input
            type="email"
            className="input-dark"
            placeholder="teammate@company.com"
            value={form.email}
            onChange={(e) => form.setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Invite to</label>
          <div className="flex gap-2">
            {form.isOrgOwner && (
              <ScopeButton current={form.scope} value="organization" onSelect={form.setScope}>
                Organization
              </ScopeButton>
            )}
            <ScopeButton current={form.scope} value="workspace" onSelect={form.setScope}>
              Workspace
            </ScopeButton>
            <ScopeButton current={form.scope} value="project" onSelect={form.setScope}>
              Project
            </ScopeButton>
          </div>
        </div>

        <InviteTargetSelect
          scope={form.scope}
          workspaces={form.inviteWorkspaces}
          workspacesLoading={form.workspacesLoading}
          workspaceId={form.workspaceId}
          onWorkspaceChange={form.setWorkspaceId}
          projects={form.inviteProjects}
          projectsLoading={form.projectsLoading}
          projectId={form.projectId}
          onProjectChange={form.setProjectId}
        />

        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Role</label>
          <select className="input-dark" value={form.role} onChange={(e) => form.setRole(e.target.value)}>
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

        <button className="btn-primary w-full" disabled={!form.canSubmit} onClick={form.send}>
          {form.sending ? 'Sending…' : 'Send invitation'}
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
  current: InviteScope
  value: InviteScope
  onSelect: (s: InviteScope) => void
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

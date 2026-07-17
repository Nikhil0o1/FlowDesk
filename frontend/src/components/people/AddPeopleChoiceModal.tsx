import { Mail, Users } from 'lucide-react'

import { Modal } from '../ui/Modal'

export function AddPeopleChoiceModal({
  open,
  onClose,
  onNewPeople,
  onExistingPeople,
  scope = 'workspace',
}: {
  open: boolean
  onClose: () => void
  onNewPeople: () => void
  onExistingPeople: () => void
  scope?: 'workspace' | 'space' | 'project'
}) {
  const existingHint =
    scope === 'space'
      ? 'Add organization members to projects in your space.'
      : scope === 'project'
        ? 'Add organization members to projects you administer.'
        : 'Add organization members who are not in this workspace yet.'
  const newHint =
    scope === 'space'
      ? 'Invite by email — they will join your organization and selected projects in your space.'
      : scope === 'project'
        ? 'Invite by email — they will join your organization and selected projects.'
        : 'Invite by email — they will join your organization and workspace.'

  return (
    <Modal open={open} onClose={onClose} title="Add people" width="max-w-sm">
      <p className="mb-4 text-sm text-fg-secondary">
        Invite someone new to your organization, or add someone who is already a member.
      </p>
      <div className="grid gap-2">
        <button
          type="button"
          onClick={onNewPeople}
          className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-800/60 px-4 py-3.5 text-left transition-colors hover:border-brand/40 hover:bg-ink-800"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Mail size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-fg">New people</span>
            <span className="mt-0.5 block text-xs text-fg-muted">{newHint}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onExistingPeople}
          className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-800/60 px-4 py-3.5 text-left transition-colors hover:border-brand/40 hover:bg-ink-800"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-400">
            <Users size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-fg">Existing people</span>
            <span className="mt-0.5 block text-xs text-fg-muted">{existingHint}</span>
          </span>
        </button>
      </div>
    </Modal>
  )
}

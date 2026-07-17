import { Check, Trophy, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { api, errorMessage } from '../../lib/api'
import type { OrgMember } from '../../lib/types'
import { cn, minSelectableDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { DateInput } from '../ui/DateInput'

type Step = 'name' | 'owner' | 'due_date' | 'description'

interface CreateGoalModalProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  members: OrgMember[]
  folderId?: string | null
  onCreated: (goalId: string) => void
}

function TrophyBadge({ active }: { active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
        active ? 'border-amber-500/50 bg-amber-500/15 text-amber-400' : 'border-ink-700 bg-ink-850 text-fg-muted',
      )}
    >
      <Trophy size={14} />
    </span>
  )
}

function OkButton({
  onClick,
  disabled,
  label = 'OK',
}: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-ink-700 px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-ink-600 disabled:opacity-50"
    >
      {label}
      <Check size={12} strokeWidth={2.5} />
    </button>
  )
}

export function CreateGoalModal({
  open,
  onClose,
  workspaceId,
  members,
  folderId,
  onCreated,
}: CreateGoalModalProps) {
  const [activeStep, setActiveStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [ownerIds, setOwnerIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const selectedOwners = members.filter((m) => ownerIds.includes(m.user_id))

  const reset = () => {
    setActiveStep('name')
    setName('')
    setOwnerIds([])
    setDueDate('')
    setDescription('')
    setOwnerPickerOpen(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const confirmName = () => {
    if (!name.trim()) {
      toast.error('Enter a goal name')
      return
    }
    setActiveStep('owner')
  }

  const toggleOwner = (userId: string) => {
    setOwnerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const confirmOwner = () => {
    if (ownerIds.length === 0) {
      toast.error('Choose at least one goal owner')
      return
    }
    setOwnerPickerOpen(false)
    setActiveStep('due_date')
  }

  const confirmDueDate = () => setActiveStep('description')

  const submit = async () => {
    if (!name.trim() || ownerIds.length === 0) {
      toast.error('Name and at least one owner are required')
      return
    }
    setSaving(true)
    try {
      const goal = await api.post<{ id: string }>(
        folderId ? `/goal-folders/${folderId}/goals` : `/workspaces/${workspaceId}/goals`,
        {
          name: name.trim(),
          owner_ids: ownerIds,
          description: description.trim() || null,
          due_date: dueDate || null,
          status: 'active',
        },
      )
      toast.success('Goal created')
      reset()
      onCreated(goal.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const goToOwner = () => {
    if (!name.trim()) {
      toast.error('Enter a goal name')
      setActiveStep('name')
      return
    }
    setActiveStep('owner')
  }

  const goToDueDate = () => {
    if (!name.trim()) {
      toast.error('Enter a goal name')
      setActiveStep('name')
      return
    }
    if (ownerIds.length === 0) {
      toast.error('Choose at least one goal owner')
      setActiveStep('owner')
      return
    }
    setActiveStep('due_date')
  }

  const goToDescription = () => {
    if (!name.trim()) {
      toast.error('Enter a goal name')
      setActiveStep('name')
      return
    }
    if (ownerIds.length === 0) {
      toast.error('Choose at least one goal owner')
      setActiveStep('owner')
      return
    }
    setActiveStep('description')
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="relative w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 px-4 py-4 shadow-popover">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3 top-3 rounded-lg p-1 text-fg-muted hover:bg-ink-800 hover:text-fg"
        >
          <X size={16} />
        </button>

        <div className="space-y-3">
          {/* Goal name */}
          <section>
            <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={() => setActiveStep('name')}>
              <TrophyBadge active={activeStep === 'name' || !!name} />
              <div className="min-w-0 flex-1">
                <h3 className={cn('text-sm font-semibold', activeStep === 'name' ? 'text-fg' : 'text-fg-secondary')}>
                  Goal name <span className="text-red-400">*</span>
                </h3>
                {activeStep !== 'name' && name.trim() && (
                  <p className="truncate text-xs text-fg-muted">{name.trim()}</p>
                )}
              </div>
            </button>
            {activeStep === 'name' && (
              <div className="mt-2 pl-9">
                <input
                  autoFocus
                  className="w-full border-0 border-b border-fg bg-transparent px-0 py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-brand"
                  placeholder="What do you want to achieve?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmName()}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <OkButton onClick={confirmName} disabled={!name.trim()} />
                  <span className="text-[10px] text-fg-muted">ENTER</span>
                </div>
              </div>
            )}
          </section>

          <div className="border-t border-ink-800" />

          {/* Owners */}
          <section>
            <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={goToOwner}>
              <TrophyBadge active={activeStep === 'owner' || ownerIds.length > 0} />
              <div className="min-w-0 flex-1">
                <h3 className={cn('text-sm font-semibold', activeStep === 'owner' ? 'text-fg' : 'text-fg-secondary')}>
                  Owners <span className="text-red-400">*</span>
                </h3>
                {activeStep !== 'owner' && selectedOwners.length > 0 && (
                  <p className="truncate text-xs text-fg-muted">
                    {selectedOwners.map((m) => m.user?.full_name || m.user?.email).join(', ')}
                  </p>
                )}
              </div>
            </button>
            {activeStep === 'owner' && (
              <div className="mt-2 pl-9">
                <button
                  type="button"
                  onClick={() => setOwnerPickerOpen((v) => !v)}
                  className="flex w-full items-center gap-2 border-0 border-b border-fg py-1.5 text-left"
                >
                  {selectedOwners.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {selectedOwners.map((m) => (
                        <span
                          key={m.user_id}
                          className="inline-flex items-center gap-1 rounded-full bg-ink-850 py-0.5 pl-0.5 pr-2 text-xs text-fg"
                        >
                          <Avatar
                            name={m.user?.full_name || m.user?.email || '?'}
                            src={m.user?.avatar_url}
                            color={m.user?.avatar_color}
                            size={18}
                          />
                          {m.user?.full_name || m.user?.email}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-fg-muted text-fg-muted">
                        <UserPlus size={12} />
                      </span>
                      <span className="text-sm text-fg-muted">Choose owners</span>
                    </>
                  )}
                </button>

                {ownerPickerOpen && (
                  <div className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 p-1">
                    {members.map((member) => {
                      const selected = ownerIds.includes(member.user_id)
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => toggleOwner(member.user_id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                            selected ? 'bg-brand-soft' : 'hover:bg-ink-800',
                          )}
                        >
                          <Avatar
                            name={member.user?.full_name || member.user?.email || '?'}
                            src={member.user?.avatar_url}
                            color={member.user?.avatar_color}
                            size={22}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-fg">
                              {member.user?.full_name || member.user?.email}
                            </p>
                          </div>
                          {selected && <Check size={13} className="text-brand" />}
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end gap-2">
                  <OkButton onClick={confirmOwner} disabled={ownerIds.length === 0} />
                  <span className="text-[10px] text-fg-muted">ENTER</span>
                </div>
              </div>
            )}
          </section>

          <div className="border-t border-ink-800" />

          {/* Due date */}
          <section>
            <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={goToDueDate}>
              <TrophyBadge active={activeStep === 'due_date' || !!dueDate} />
              <div className="min-w-0 flex-1">
                <h3 className={cn('text-sm font-semibold', activeStep === 'due_date' ? 'text-fg' : 'text-fg-secondary')}>
                  Target date
                </h3>
                {activeStep !== 'due_date' && dueDate && (
                  <p className="text-xs text-fg-muted">{dueDate}</p>
                )}
              </div>
            </button>
            {activeStep === 'due_date' && (
              <div className="mt-2 pl-9">
                <DateInput
                  className="!rounded-none !border-0 !border-b !border-fg !bg-transparent !px-0 !py-1.5 !text-sm"
                  value={dueDate}
                  min={minSelectableDateKey()}
                  onChange={setDueDate}
                  placeholder="End date (optional)"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <OkButton onClick={confirmDueDate} />
                </div>
              </div>
            )}
          </section>

          <div className="border-t border-ink-800" />

          {/* Description */}
          <section>
            <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={goToDescription}>
              <TrophyBadge active={activeStep === 'description' || !!description} />
              <div className="min-w-0 flex-1">
                <h3
                  className={cn(
                    'text-sm font-semibold',
                    activeStep === 'description' ? 'text-fg' : 'text-fg-secondary',
                  )}
                >
                  Description
                </h3>
                {activeStep !== 'description' && description.trim() && (
                  <p className="line-clamp-1 text-xs text-fg-muted">{description.trim()}</p>
                )}
              </div>
            </button>
            {activeStep === 'description' && (
              <div className="mt-2 pl-9">
                <textarea
                  className="min-h-[48px] w-full resize-none border-0 border-b border-fg bg-transparent px-0 py-1 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-brand"
                  placeholder="Optional short description…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
                <div className="mt-2 flex items-center justify-end">
                  <OkButton
                    onClick={() => void submit()}
                    disabled={saving || !name.trim() || ownerIds.length === 0}
                    label={saving ? 'Creating…' : 'Create'}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

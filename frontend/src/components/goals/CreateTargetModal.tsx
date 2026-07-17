import { Check, Hash, ListChecks, ToggleLeft, Trophy, UserPlus, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { api, errorMessage } from '../../lib/api'
import type { GoalTargetType, OrgMember } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'

interface CreateTargetModalProps {
  open: boolean
  onClose: () => void
  goalId: string
  members: OrgMember[]
  onCreated: () => void
}

const TARGET_TYPES: {
  id: GoalTargetType
  label: string
  description: string
  icon: typeof Hash
}[] = [
  { id: 'number', label: 'Number', description: 'Any number like 7 or 70', icon: Hash },
  { id: 'true_false', label: 'True/False', description: 'Done or not done', icon: ToggleLeft },
  { id: 'currency', label: 'Currency', description: 'Measure like money', icon: Wallet },
  { id: 'tasks', label: 'Tasks', description: 'Track completion of tasks', icon: ListChecks },
]

function TrophyBadge({ active }: { active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
        active ? 'border-amber-500/50 bg-amber-500/15 text-amber-400' : 'border-ink-700 bg-ink-850 text-fg-muted',
      )}
    >
      <Trophy size={16} />
    </span>
  )
}

function OkButton({ onClick, disabled, label = 'OK' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md bg-ink-700 px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-ink-600 disabled:opacity-50"
    >
      {label}
      <Check size={14} strokeWidth={2.5} />
    </button>
  )
}

function NumberStepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex items-center rounded-lg border border-ink-700 bg-ink-850">
        <input
          type="number"
          className="w-24 bg-transparent px-3 py-2 text-sm text-fg outline-none"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="flex flex-col border-l border-ink-700">
          <button type="button" className="px-2 py-0.5 text-xs text-fg-muted hover:bg-ink-800" onClick={() => onChange(value + 1)}>
            ▲
          </button>
          <button type="button" className="px-2 py-0.5 text-xs text-fg-muted hover:bg-ink-800" onClick={() => onChange(value - 1)}>
            ▼
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreateTargetModal({
  open,
  onClose,
  goalId,
  members,
  onCreated,
}: CreateTargetModalProps) {
  const [title, setTitle] = useState('')
  const [ownerIds, setOwnerIds] = useState<string[]>([])
  const [targetType, setTargetType] = useState<GoalTargetType>('tasks')
  const [startValue, setStartValue] = useState(0)
  const [targetValue, setTargetValue] = useState(1)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

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
    setTitle('')
    setOwnerIds([])
    setTargetType('tasks')
    setStartValue(0)
    setTargetValue(1)
    setOwnerPickerOpen(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const toggleOwner = (userId: string) => {
    setOwnerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Enter a target name')
      return
    }
    if (ownerIds.length === 0) {
      toast.error('Choose at least one target owner')
      return
    }
    if ((targetType === 'number' || targetType === 'currency') && startValue === targetValue) {
      toast.error('Start and target values must differ')
      return
    }
    setSaving(true)
    try {
      await api.post(`/goals/${goalId}/targets`, {
        title: title.trim(),
        owner_ids: ownerIds,
        target_type: targetType,
        start_value: targetType === 'number' || targetType === 'currency' ? startValue : null,
        target_value: targetType === 'number' || targetType === 'currency' ? targetValue : null,
        current_value: targetType === 'number' || targetType === 'currency' ? startValue : null,
        is_completed: false,
      })
      toast.success('Target created')
      reset()
      onCreated()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[5vh]"
      onMouseDown={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-ink-700 bg-ink-900 px-6 py-6 shadow-popover">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted hover:bg-ink-800 hover:text-fg"
        >
          <X size={18} />
        </button>

        <div className="space-y-5">
          <section>
            <div className="flex items-start gap-3">
              <TrophyBadge active={!!title} />
              <div>
                <h3 className="text-sm font-semibold text-fg">
                  Target name <span className="text-red-400">*</span>
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Required. Break your Goal down into measurable targets.
                </p>
              </div>
            </div>
            <div className="mt-3 pl-10">
              <input
                autoFocus
                className="w-full border-0 border-b border-fg bg-transparent px-0 py-2 text-base text-fg outline-none focus:border-brand"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              <div className="mt-3 flex items-center justify-end gap-3">
                <OkButton onClick={() => void submit()} disabled={saving || !title.trim() || ownerIds.length === 0} />
                <span className="text-xs text-fg-muted">press ENTER</span>
              </div>
            </div>
          </section>

          <div className="border-t border-ink-800" />

          <section>
            <div className="flex items-start gap-3">
              <TrophyBadge active={ownerIds.length > 0} />
              <div>
                <h3 className="text-sm font-semibold text-fg">
                  Owners <span className="text-red-400">*</span>
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Required. Select one or more admins responsible for this Target.
                </p>
              </div>
            </div>
            <div className="mt-3 pl-10">
              <button
                type="button"
                onClick={() => setOwnerPickerOpen((v) => !v)}
                className="flex w-full items-center gap-3 border-0 border-b border-fg py-2 text-left"
              >
                {selectedOwners.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {selectedOwners.map((m) => (
                      <span
                        key={m.user_id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-ink-850 py-0.5 pl-0.5 pr-2 text-sm text-fg"
                      >
                        <Avatar
                          name={m.user?.full_name || m.user?.email || '?'}
                          src={m.user?.avatar_url}
                          color={m.user?.avatar_color}
                          size={22}
                        />
                        {m.user?.full_name || m.user?.email}
                      </span>
                    ))}
                  </div>
                ) : (
                  <>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-fg-muted text-fg-muted">
                      <UserPlus size={14} />
                    </span>
                    <span className="text-base text-fg-muted">Choose owners</span>
                  </>
                )}
              </button>
              {ownerPickerOpen && (
                <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 p-1.5">
                  {members.map((member) => {
                    const selected = ownerIds.includes(member.user_id)
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        onClick={() => toggleOwner(member.user_id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
                          selected ? 'bg-brand-soft' : 'hover:bg-ink-800',
                        )}
                      >
                        <Avatar
                          name={member.user?.full_name || member.user?.email || '?'}
                          src={member.user?.avatar_url}
                          color={member.user?.avatar_color}
                          size={26}
                        />
                        <span className="truncate text-sm text-fg">
                          {member.user?.full_name || member.user?.email}
                        </span>
                        {selected && <Check size={15} className="ml-auto text-brand" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-ink-800" />

          <section>
            <div className="flex items-start gap-3">
              <TrophyBadge active />
              <div>
                <h3 className="text-sm font-semibold text-fg">Type of Target</h3>
                <p className="mt-0.5 text-xs text-fg-muted">How do you want to measure this result?</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 pl-10 sm:grid-cols-4">
              {TARGET_TYPES.map((type) => {
                const Icon = type.icon
                const selected = targetType === type.id
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setTargetType(type.id)}
                    className={cn(
                      'relative rounded-xl border p-2.5 text-left transition-colors',
                      selected ? 'border-brand bg-brand-soft' : 'border-ink-700 bg-ink-850 hover:border-ink-600',
                    )}
                  >
                    {selected && <Check size={14} className="absolute right-2 top-2 text-brand" />}
                    <Icon size={18} className="mb-2 text-fg-secondary" />
                    <p className="text-sm font-semibold text-fg">{type.label}</p>
                    <p className="mt-1 text-[11px] leading-snug text-fg-muted">{type.description}</p>
                  </button>
                )
              })}
            </div>

            {(targetType === 'number' || targetType === 'currency') && (
              <div className="mt-3 flex items-end gap-3 pl-10">
                <NumberStepper label="Start" value={startValue} onChange={setStartValue} />
                <span className="pb-3 text-fg-muted">→</span>
                <NumberStepper label="Target" value={targetValue} onChange={setTargetValue} />
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-3 pl-10">
              <OkButton
                onClick={() => void submit()}
                disabled={saving || !title.trim() || ownerIds.length === 0}
                label={saving ? 'Creating…' : 'OK'}
              />
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { Bug, CheckCircle2, CircleDashed, CircleX, Flag, Layers, Lightbulb, SquareCheck } from 'lucide-react'

import type { CustomStatus, Priority, TaskType } from '../../lib/types'
import { cn, PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/utils'

/** Category-based status icon used everywhere a status is shown (ClickUp-style). */
export function StatusIcon({
  category,
  color = '#87909E',
  size = 14,
}: {
  category?: string | null
  color?: string
  size?: number
}) {
  if (category === 'done') return <CheckCircle2 size={size} style={{ color }} className="shrink-0" />
  if (category === 'cancelled') return <CircleX size={size} style={{ color }} className="shrink-0" />
  if (category === 'in_progress') {
    // ring with a half-filled pie — the "in progress" mark
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" style={{ color }} aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
      </svg>
    )
  }
  return <CircleDashed size={size} style={{ color }} className="shrink-0" />
}

export function StatusPill({ status, size = 'sm' }: { status: CustomStatus | null; size?: 'sm' | 'md' }) {
  if (!status) return <span className="text-xs text-fg-muted">No status</span>
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      )}
      style={{
        color: status.color,
        borderColor: `${status.color}55`,
        backgroundColor: `${status.color}14`,
      }}
    >
      <StatusIcon category={status.category} color={status.color} size={size === 'sm' ? 12 : 14} />
      {status.name}
    </span>
  )
}

export function PriorityFlag({ priority, withLabel = false }: { priority: Priority | null; withLabel?: boolean }) {
  if (!priority) return <Flag size={14} className="text-ink-600" />
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag size={14} style={{ color: PRIORITY_COLORS[priority] }} fill={PRIORITY_COLORS[priority]} />
      {withLabel && (
        <span className="text-xs" style={{ color: PRIORITY_COLORS[priority] }}>
          {PRIORITY_LABELS[priority]}
        </span>
      )}
    </span>
  )
}

const TYPE_META: Record<TaskType, { icon: React.ReactNode; color: string; label: string }> = {
  task: { icon: <SquareCheck size={13} />, color: '#5B9FF0', label: 'Task' },
  bug: { icon: <Bug size={13} />, color: '#E5484D', label: 'Bug' },
  story: { icon: <Lightbulb size={13} />, color: '#4CB782', label: 'Story' },
  epic: { icon: <Layers size={13} />, color: '#B07BE0', label: 'Epic' },
}

export function TaskTypeBadge({ type, withLabel = false }: { type: TaskType; withLabel?: boolean }) {
  const meta = TYPE_META[type] ?? TYPE_META.task
  return (
    <span className="inline-flex items-center gap-1" style={{ color: meta.color }} title={meta.label}>
      {meta.icon}
      {withLabel && <span className="text-xs">{meta.label}</span>}
    </span>
  )
}

export function LabelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-ink-750 px-1.5 py-0.5 text-[11px] text-fg-secondary">
      {label}
    </span>
  )
}

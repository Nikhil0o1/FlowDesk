import { Pencil } from 'lucide-react'

import { cn } from '../../lib/utils'

/** Minimal rename control — shows on parent `group/name` hover only. */
export function RenameButton({
  onClick,
  className,
  title = 'Rename',
}: {
  onClick: () => void
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/name:opacity-100',
        className,
      )}
    >
      <Pencil size={11} strokeWidth={2} />
    </button>
  )
}

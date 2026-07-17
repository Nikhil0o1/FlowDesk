import { toast } from '../../stores/toast'
import { cn } from '../../lib/utils'

/** Amber marker for tasks missing a due date. */
export function NoDueDateDot({
  title,
  className,
  size = 'md',
  interactive = true,
}: {
  title?: string
  className?: string
  size?: 'sm' | 'md'
  /** When false, renders a dot only (parent handles clicks, e.g. DatePicker). */
  interactive?: boolean
}) {
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  const dotClass = cn('shrink-0 rounded-full bg-amber-400', dim, className)

  if (!interactive) {
    return (
      <span
        className={dotClass}
        title={title ? `${title} — no due date` : 'No due date'}
        aria-label={title ? `${title} has no due date` : 'No due date'}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        toast.info('This task has no due date')
      }}
      className={cn(dotClass, 'transition-transform hover:scale-125')}
      title={title ? `${title} — no due date` : 'No due date'}
      aria-label={title ? `${title} has no due date` : 'No due date'}
    />
  )
}

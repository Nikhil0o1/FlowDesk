import { cn } from '../../../lib/utils'
import type { DocStatus } from '../types/document'

const STYLES: Record<DocStatus, string> = {
  draft: 'bg-ink-750 text-fg-secondary',
  published: 'bg-emerald-500/15 text-emerald-400',
}

export function StatusBadge({ status, className }: { status: DocStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        STYLES[status],
        className,
      )}
    >
      {status}
    </span>
  )
}

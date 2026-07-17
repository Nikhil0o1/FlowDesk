import { cn } from '../../../../lib/utils'
import { ROLE_LABELS } from '../../services/permissions.service'
import type { DocRole } from '../../types/permissions'

const ROLE_STYLE: Record<DocRole, string> = {
  owner: 'bg-violet-500/15 text-violet-300',
  editor: 'bg-brand/15 text-brand',
  commenter: 'bg-sky-500/15 text-sky-300',
  viewer: 'bg-ink-750 text-fg-muted',
}

/** Small badge showing the user's document permission role. */
export function PermissionBadge({ role, className }: { role: DocRole; className?: string }) {
  return (
    <span
      className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', ROLE_STYLE[role], className)}
    >
      {ROLE_LABELS[role]}
    </span>
  )
}

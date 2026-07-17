import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

/**
 * Standard section sidebar panel. Width is controlled by AppLayout via
 * `secondarySidebarWidth` and `SecondarySidebarResizeHandle` — child sidebars
 * must use `w-full min-w-0` (not a fixed width) so drag-resize works.
 */
export function SecondarySidebar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <aside
      className={cn(
        'flex h-full w-full min-w-0 flex-col border-r border-ink-700 bg-ink-850',
        className,
      )}
    >
      {children}
    </aside>
  )
}

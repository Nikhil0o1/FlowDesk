import { ChevronsLeft } from 'lucide-react'

import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'

/**
 * ClickUp-style secondary-sidebar collapse control (`<<`).
 * Collapses the panel; IconRail shows `>>` to expand again. Keyboard: Ctrl/Cmd+\.
 */
export function SidebarCollapseButton({
  className,
  alwaysVisible = true,
}: {
  className?: string
  /** When false, only reveals on `group-hover/sidebar` (Home legacy hover pattern). */
  alwaysVisible?: boolean
}) {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      title="Collapse sidebar (Ctrl+\\)"
      aria-label="Collapse sidebar"
      className={cn(
        'rounded-lg border border-ink-600 p-1.5 text-fg-muted transition-all hover:border-ink-500 hover:bg-ink-750 hover:text-fg',
        alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/sidebar:opacity-100',
        className,
      )}
    >
      <ChevronsLeft size={15} strokeWidth={2} />
    </button>
  )
}

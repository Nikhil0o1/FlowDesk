import { Download, Link2, MessageSquare, Share2, Type } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import { DocExportDropdown } from '../DocExportDropdown'
import type { FlowDoc } from '../../types/document'
import type { RightSidebarTab } from '../../types/collaboration'

interface DocPageRailProps {
  activeTab: RightSidebarTab | null
  showSidebar: boolean
  commentCount: number
  canShare: boolean
  exportDoc: Pick<FlowDoc, 'id' | 'title' | 'content'>
  onExported?: () => void
  onTab: (tab: RightSidebarTab) => void
  onShare: () => void
}

/** Thin vertical toolbar on the document page (ClickUp-style). */
export function DocPageRail({
  activeTab,
  showSidebar,
  commentCount,
  canShare,
  exportDoc,
  onExported,
  onTab,
  onShare,
}: DocPageRailProps) {
  const items: {
    id: RightSidebarTab | 'share' | 'export'
    icon: typeof MessageSquare
    label: string
    onClick: () => void
    badge?: number
  }[] = [
    { id: 'comments', icon: MessageSquare, label: 'Comments', onClick: () => onTab('comments'), badge: commentCount },
    { id: 'styles', icon: Type, label: 'Page styles', onClick: () => onTab('styles') },
    { id: 'links', icon: Link2, label: 'Links', onClick: () => onTab('links') },
    ...(canShare ? [{ id: 'share' as const, icon: Share2, label: 'Share', onClick: onShare }] : []),
  ]

  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-ink-700 bg-ink-850 py-3">
      {items.map(({ id, icon: Icon, label, onClick, badge }) => {
        const active = id !== 'share' && id !== 'export' && showSidebar && activeTab === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              active ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:bg-ink-800 hover:text-fg',
            )}
          >
            <Icon size={17} />
            {badge != null && badge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        )
      })}
      <DocExportDropdown
        doc={exportDoc}
        onExported={onExported}
        trigger={
          <button
            type="button"
            title="Export"
            aria-label="Export"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
          >
            <Download size={17} />
          </button>
        }
      />
    </div>
  )
}

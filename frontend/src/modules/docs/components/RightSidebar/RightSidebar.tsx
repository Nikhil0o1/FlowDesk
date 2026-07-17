import { Activity, GitBranch, Info, Link2, MessageSquare, Sparkles, Type, X } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import type { RightSidebarTab } from '../../types/collaboration'
import type { FlowDoc } from '../../types/document'
import type { DocInsertBlock, DocPageSettings } from '../../types/pageSettings'
import { ActivityPanel } from '../Activity/ActivityPanel'
import { CommentsPanel } from '../Comments/CommentsPanel'
import { DocLinksPanel } from '../DocPage/DocLinksPanel'
import { PageStylesPanel } from '../DocPage/PageStylesPanel'
import { MetadataPanel } from '../Metadata/MetadataPanel'
import { VersionHistoryPanel } from '../VersionHistory/VersionHistoryPanel'

const TABS: { id: RightSidebarTab; label: string; icon: typeof MessageSquare; disabled?: boolean }[] = [
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'styles', label: 'Styles', icon: Type },
  { id: 'links', label: 'Links', icon: Link2 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'history', label: 'History', icon: GitBranch },
  { id: 'details', label: 'Details', icon: Info },
  { id: 'ai', label: 'AI', icon: Sparkles, disabled: true },
]

interface RightSidebarProps {
  doc: FlowDoc
  tab: RightSidebarTab
  onTabChange: (tab: RightSidebarTab) => void
  onClose: () => void
  canComment: boolean
  commentCount?: number
  pendingInline?: { markerId: string; quote: string } | null
  onClearInline?: () => void
  pageSettings?: DocPageSettings
  onPageSettingsChange?: (patch: Partial<DocPageSettings>) => void
  readOnly?: boolean
  docIcon?: string | null
  onIconChange?: (icon: string | null) => void
  onInsertBlock?: (type: DocInsertBlock) => void
  onApplyTypographyPage?: () => void
  onApplyTypographyAll?: () => void
  stats?: { words: number; chars: number; readingTimeSec: number }
  onOpenLinks?: () => void
}

/** Reusable document right panel with Comments / Activity / History / Details tabs. */
export function RightSidebar({
  doc,
  tab,
  onTabChange,
  onClose,
  canComment,
  commentCount = 0,
  pendingInline,
  onClearInline,
  pageSettings,
  onPageSettingsChange,
  readOnly,
  docIcon,
  onIconChange,
  onInsertBlock,
  onApplyTypographyPage,
  onApplyTypographyAll,
  stats,
  onOpenLinks,
}: RightSidebarProps) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-ink-700 bg-ink-850">
      <div className="flex items-center justify-between border-b border-ink-700 px-2 py-2">
        <div className="flex flex-1 gap-0.5 overflow-x-auto" role="tablist" aria-label="Document panel">
          {TABS.map(({ id, label, icon: Icon, disabled }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              disabled={disabled}
              onClick={() => !disabled && onTabChange(id)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                tab === id ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:bg-ink-750 hover:text-fg',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <Icon size={13} />
              {label}
              {id === 'comments' && commentCount > 0 && (
                <span className="rounded-full bg-ink-750 px-1 text-[10px]">{commentCount}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="ml-1 shrink-0 rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === 'comments' && (
          <CommentsPanel doc={doc} canComment={canComment} pendingInline={pendingInline} onClearInline={onClearInline} />
        )}
        {tab === 'styles' && pageSettings && onPageSettingsChange && (
          <PageStylesPanel
            settings={pageSettings}
            onChange={onPageSettingsChange}
            readOnly={readOnly}
            docIcon={docIcon}
            onIconChange={onIconChange}
            onInsertBlock={onInsertBlock}
            onApplyTypographyPage={onApplyTypographyPage}
            onApplyTypographyAll={onApplyTypographyAll}
            stats={stats}
            onOpenLinks={onOpenLinks}
          />
        )}
        {tab === 'links' && <DocLinksPanel documentId={doc.id} readOnly={readOnly} />}
        {tab === 'activity' && <ActivityPanel documentId={doc.id} />}
        {tab === 'history' && <VersionHistoryPanel documentId={doc.id} />}
        {tab === 'details' && <MetadataPanel doc={doc} embedded />}
      </div>
    </aside>
  )
}

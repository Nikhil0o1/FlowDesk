import { Archive, Folder, Lock, Pencil, Plus } from 'lucide-react'

import type { GoalFolder } from '../../lib/types'
import { cn } from '../../lib/utils'

const FOLDER_COLORS = [
  '#64748b',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

export { FOLDER_COLORS }

const tileClass =
  'flex h-[128px] w-[128px] shrink-0 flex-col rounded-lg border border-ink-700 bg-ink-800 shadow-sm transition-colors hover:border-ink-600 hover:bg-ink-850'

/** Create-folder tile matching ClickUp: solid card, outline folder + teal plus badge */
export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Create folder" className={cn(tileClass, 'group items-center justify-center')}>
      <span className="relative inline-flex">
        <Folder size={44} strokeWidth={1.15} className="text-fg-muted group-hover:text-fg-secondary" />
        <span className="absolute -bottom-0.5 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white shadow-sm">
          <Plus size={12} strokeWidth={3} />
        </span>
      </span>
    </button>
  )
}

export function FolderCard({
  folder,
  onOpen,
  onEdit,
  dropTarget,
  onDragEnter,
  onDragOver,
  onDrop,
}: {
  folder: GoalFolder
  onOpen: () => void
  onEdit?: () => void
  /** Highlight when a goal is dragged over this folder */
  dropTarget?: boolean
  onDragEnter?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  const accent = folder.color ?? undefined
  return (
    <div
      className={cn(
        tileClass,
        'group relative',
        folder.is_archived && 'opacity-55',
        dropTarget && 'border-brand bg-brand-soft ring-2 ring-brand/35',
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
        {folder.is_private && (
          <span title="Private" className="rounded p-1 text-fg-muted">
            <Lock size={12} />
          </span>
        )}
        {folder.is_archived && (
          <span title="Archived" className="rounded p-1 text-fg-muted">
            <Archive size={12} />
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            title="Edit folder"
            className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-ink-800 hover:text-fg group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col items-center justify-center gap-2 px-2.5 pb-2.5 pt-3 text-center"
      >
        <Folder
          size={44}
          strokeWidth={1.15}
          style={accent ? { color: accent } : undefined}
          className={cn('text-fg-muted', dropTarget && 'text-brand')}
        />
        <span className="line-clamp-2 w-full text-[12px] font-medium leading-snug text-fg">
          {folder.name}{' '}
          <span className="font-normal text-fg-muted">({folder.goal_count})</span>
        </span>
        {dropTarget && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-brand">Drop to move</span>
        )}
      </button>
    </div>
  )
}

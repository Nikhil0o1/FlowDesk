import { Folder as FolderIcon, Lock, MoreHorizontal, Pencil, Plus, Share2, Star, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useRowMenu, type MenuItem } from '../../../components/ui/ContextMenu'
import { cn, timeAgo } from '../../../lib/utils'
import { useFolderDocCount } from '../hooks/useDocuments'
import { useFavorites } from '../hooks/useFavorites'
import type { Folder } from '../types/folder'

const tileClass =
  'flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-800 p-4 pr-10 text-left transition-colors hover:border-ink-600 hover:bg-ink-750'

/** Create-folder tile shown on the All Docs / folder shelf. */
export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Create folder"
      className={cn(tileClass, 'group justify-center border-dashed hover:border-brand/50')}
    >
      <span className="relative inline-flex text-fg-muted group-hover:text-fg">
        <FolderIcon size={28} strokeWidth={1.25} />
        <span className="absolute -bottom-0.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white">
          <Plus size={10} strokeWidth={3} />
        </span>
      </span>
      <span className="text-sm font-medium text-fg-secondary group-hover:text-fg">New folder</span>
    </button>
  )
}

interface FolderCardProps {
  folder: Folder
  onRename?: () => void
  onShare?: () => void
  onDelete?: () => void
  dropTarget?: boolean
  onDragEnter?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragLeave?: () => void
}

/** Compact folder tile with edit / share / delete and drop-to-move support. */
export function FolderCard({
  folder,
  onRename,
  onShare,
  onDelete,
  dropTarget,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragLeave,
}: FolderCardProps) {
  const navigate = useNavigate()
  const count = useFolderDocCount(folder.id)
  const { isFavorite, toggleFavorite } = useFavorites()
  const favorite = isFavorite(folder.id)

  const menuItems = (): MenuItem[] => [
    ...(onRename
      ? [{ type: 'action' as const, label: 'Rename', icon: <Pencil size={14} />, onClick: onRename }]
      : []),
    ...(onShare
      ? [{ type: 'action' as const, label: 'Share', icon: <Share2 size={14} />, onClick: onShare }]
      : []),
    ...(onRename || onShare ? [{ type: 'separator' as const }] : []),
    ...(onDelete
      ? [
          {
            type: 'action' as const,
            label: 'Delete',
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: onDelete,
          },
        ]
      : []),
  ]

  const menu = useRowMenu(menuItems)

  return (
    <div
      className="group relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <button
        type="button"
        onClick={() => navigate(`/app/docs/folder/${folder.id}`)}
        className={cn(
          tileClass,
          dropTarget && 'border-brand bg-brand-soft ring-2 ring-brand/35',
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-400',
            dropTarget && 'bg-brand/20 text-brand',
          )}
        >
          <FolderIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
            <span className="truncate">{folder.name}</span>
            {folder.isPrivate && (
              <Lock size={12} className="shrink-0 text-fg-muted" aria-label="Private" />
            )}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {dropTarget
              ? 'Drop to move'
              : `${count} ${count === 1 ? 'doc' : 'docs'} · ${timeAgo(folder.updatedAt)}`}
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        <button
          type="button"
          aria-label={favorite ? 'Unfavorite folder' : 'Favorite folder'}
          aria-pressed={favorite}
          onClick={() => toggleFavorite(folder.id, 'folder')}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-ink-700',
            favorite
              ? 'text-amber-400'
              : 'text-fg-muted opacity-0 hover:text-fg focus:opacity-100 group-hover:opacity-100',
          )}
        >
          <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        {(onRename || onShare || onDelete) && (
          <button
            type="button"
            aria-label="Folder actions"
            onClick={menu.onTriggerClick}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted opacity-0 transition-opacity hover:bg-ink-700 hover:text-fg focus:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      {menu.node}
    </div>
  )
}

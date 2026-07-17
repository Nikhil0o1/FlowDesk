import { memo } from 'react'
import {
  BookOpen,
  Check,
  FileText,
  Globe,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Star,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { cn, timeAgo } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { useRowMenu } from '../../../../components/ui/ContextMenu'
import { useFavorites } from '../../hooks/useFavorites'
import { useFolders } from '../../hooks/useFolders'
import type { FlowDoc } from '../../types/document'
import type { DocCardContext, DocView } from '../../types/editor'
import { useDocumentRowMenuItems } from '../DocumentRowMenuItems'
import { HighlightText } from '../Search/HighlightText'
import { StatusBadge } from '../StatusBadge'

interface DocumentCardProps {
  doc: FlowDoc
  view: DocView
  context?: DocCardContext
  query?: string
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** Parent owns the rename modal. */
  onRename?: (doc: FlowDoc) => void
  /** Parent confirms permanent deletion (Trash only). */
  onPurge?: (doc: FlowDoc) => void
}

function DocumentCardBase({
  doc,
  view,
  context = 'active',
  query,
  selectable,
  selected,
  onToggleSelect,
  onRename,
  onPurge,
}: DocumentCardProps) {
  const navigate = useNavigate()
  const { getFolder } = useFolders()
  const { isFavorite, toggleFavorite } = useFavorites()

  const favorite = isFavorite(doc.id)
  const canOpen = context !== 'trash'
  const open = () => canOpen && navigate(`/app/docs/${doc.id}`)
  const LeadIcon = doc.isWiki ? BookOpen : FileText

  const indicators = (
    <>
      {doc.isProtected && <Lock size={12} className="shrink-0 text-amber-400" aria-label="Protected" />}
      {doc.publicEnabled && <Globe size={12} className="shrink-0 text-emerald-400" aria-label="Public link" />}
    </>
  )

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/docs/${doc.id}`)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const menuItems = useDocumentRowMenuItems(doc, context, {
    onRename,
    onPurge,
    copyLink,
    open,
  })
  const menu = useRowMenu(menuItems)

  const folderName = doc.folderId ? getFolder(doc.folderId)?.name : undefined
  const meta =
    context === 'trash' ? (
      <>
        <span className="truncate">
          Original: {doc.originalFolderId ? getFolder(doc.originalFolderId)?.name ?? 'Deleted folder' : 'Root'}
        </span>
        <span aria-hidden>·</span>
        <span className="shrink-0">Deleted {timeAgo(doc.deletedAt ?? doc.updatedAt)}</span>
        {doc.deletedBy && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{doc.deletedBy}</span>
          </>
        )}
      </>
    ) : context === 'archive' ? (
      <>
        {folderName && (
          <>
            <span className="truncate">{folderName}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="shrink-0">Archived {timeAgo(doc.archivedAt ?? doc.updatedAt)}</span>
      </>
    ) : (
      <>
        {folderName && (
          <>
            <span className="truncate">{folderName}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="shrink-0">{timeAgo(doc.updatedAt)}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{doc.author}</span>
      </>
    )

  const checkbox = selectable ? (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!selected}
      aria-label={selected ? 'Deselect document' : 'Select document'}
      onClick={(e) => {
        e.stopPropagation()
        onToggleSelect?.(doc.id)
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all',
        selected
          ? 'border-brand bg-brand text-white opacity-100'
          : 'border-ink-600 text-transparent opacity-0 group-hover:opacity-100 hover:border-fg-muted',
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  ) : null

  const hoverActions =
    context === 'active' ? (
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100',
          favorite && 'opacity-100',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <HoverActionButton icon={Link2} label="Copy link" onClick={copyLink} />
        <HoverActionButton
          icon={Star}
          label={favorite ? 'Unfavorite' : 'Favorite'}
          onClick={() => toggleFavorite(doc.id, 'doc')}
          active={favorite}
          filled={favorite}
        />
        <HoverActionButton icon={Pencil} label="Rename" onClick={() => onRename?.(doc)} />
      </div>
    ) : null

  const star =
    context !== 'trash' && view !== 'list' ? (
      <button
        type="button"
        aria-label={favorite ? 'Unfavorite' : 'Favorite'}
        aria-pressed={favorite}
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(doc.id, 'doc')
        }}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-ink-700',
          favorite ? 'text-amber-400' : 'text-fg-muted hover:text-fg',
        )}
      >
        <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
      </button>
    ) : null

  if (view === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => e.key === 'Enter' && open()}
        onContextMenu={menu.onContextMenu}
        className={cn(
          'group flex items-center gap-3 border-b border-ink-700/60 px-3 py-2.5 transition-colors last:border-b-0',
          canOpen && 'cursor-pointer',
          selected ? 'bg-brand-soft' : 'hover:bg-ink-800',
        )}
      >
        {checkbox}
        <LeadIcon size={16} className="shrink-0 text-brand" />
        {doc.icon && <span className="shrink-0 text-base leading-none">{doc.icon}</span>}
        <span className="min-w-0 truncate text-sm font-medium text-fg">
          <HighlightText text={doc.title} query={query} />
        </span>
        {hoverActions}
        {indicators}
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted sm:flex">{meta}</div>
        <StatusBadge status={doc.status} />
        <MoreButton onClick={menu.onTriggerClick} />
        {menu.node}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      onContextMenu={menu.onContextMenu}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        canOpen && 'cursor-pointer',
        selected ? 'border-brand bg-brand-soft' : 'border-ink-700 bg-ink-800 hover:border-ink-600 hover:bg-ink-750',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {checkbox}
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
            {doc.icon ? <span className="text-lg leading-none">{doc.icon}</span> : <LeadIcon size={18} />}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {star}
          <MoreButton onClick={menu.onTriggerClick} />
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
          <HighlightText text={doc.title} query={query} />
          {indicators}
        </h3>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">{meta}</div>
      </div>
      <StatusBadge status={doc.status} className="self-start" />
      {menu.node}
    </div>
  )
}

function HoverActionButton({
  icon: Icon,
  label,
  onClick,
  active,
  filled,
}: {
  icon: typeof Link2
  label: string
  onClick: () => void
  active?: boolean
  filled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-fg-muted transition-colors',
        'hover:border-ink-500 hover:bg-ink-750 hover:text-fg',
        active && 'border-amber-500/40 text-amber-400',
      )}
    >
      <Icon size={13} fill={filled ? 'currentColor' : 'none'} />
    </button>
  )
}

function MoreButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="Document actions"
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors',
        'hover:bg-ink-700 hover:text-fg focus:opacity-100 group-hover:opacity-100 sm:opacity-0',
      )}
    >
      <MoreHorizontal size={16} />
    </button>
  )
}

export const DocumentCard = memo(DocumentCardBase)

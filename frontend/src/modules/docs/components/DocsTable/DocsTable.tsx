import { memo, useMemo } from 'react'
import {
  ArrowDown,
  BadgeCheck,
  BookOpen,
  Building2,
  Check,
  FileText,
  Folder,
  Globe,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Star,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Avatar } from '../../../../components/ui/Avatar'
import { useRowMenu } from '../../../../components/ui/ContextMenu'
import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { useFavorites } from '../../hooks/useFavorites'
import { useFolders } from '../../hooks/useFolders'
import { formatDocListTime } from '../../services/docs.service'
import { useDocsUIStore } from '../../stores/docsUIStore'
import type { FlowDoc } from '../../types/document'
import type { DocCardContext, DocSort, DocTableColumnId } from '../../types/editor'
import { DOC_TABLE_COLUMNS } from '../../types/editor'
import { DOC_FOLDER_DRAG_MIME } from '../../constants/dnd'
import { HighlightText } from '../Search/HighlightText'
import { useDocumentRowMenuItems } from '../DocumentRowMenuItems'
import { ColumnsMenu } from './ColumnsMenu'

interface DocsTableProps {
  docs: FlowDoc[]
  context?: DocCardContext
  query?: string
  selectable?: boolean
  workspaceName?: string
  onRename?: (doc: FlowDoc) => void
  onPurge?: (doc: FlowDoc) => void
  onShare?: (doc: FlowDoc) => void
  draggableDocs?: boolean
  onDocDragStart?: (docId: string) => void
  onDocDragEnd?: () => void
}

const COL = 'px-3 py-2.5 text-left text-xs font-medium text-fg-muted'

const SORT_FIELD: Partial<Record<DocTableColumnId, DocSort>> = {
  dateUpdated: 'updated',
  dateViewed: 'viewed',
  dateCreated: 'created',
}

/** ClickUp-style document table with a "+" Columns picker. */
export function DocsTable({
  docs,
  context = 'active',
  query,
  selectable = true,
  workspaceName = 'Everything',
  onRename,
  onPurge,
  onShare,
  draggableDocs = false,
  onDocDragStart,
  onDocDragEnd,
}: DocsTableProps) {
  const selectedIds = useDocsUIStore((s) => s.selectedIds)
  const setSelected = useDocsUIStore((s) => s.setSelected)
  const clearSelected = useDocsUIStore((s) => s.clearSelected)
  const sort = useDocsUIStore((s) => s.sort)
  const sortDir = useDocsUIStore((s) => s.sortDir)
  const setSort = useDocsUIStore((s) => s.setSort)
  const setSortDir = useDocsUIStore((s) => s.setSortDir)
  const visibleColumns = useDocsUIStore((s) => s.visibleColumns)

  const columns = useMemo(
    () => DOC_TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.id)),
    [visibleColumns],
  )

  const visibleIds = useMemo(() => docs.map((d) => d.id), [docs])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))

  const toggleSort = (field: DocSort) => {
    if (sort === field) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else {
      setSort(field)
      setSortDir('desc')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-900/40">
              {selectable && (
                <th className={cn(COL, 'w-10')}>
                  <SelectCheckbox
                    checked={allSelected}
                    onChange={() => (allSelected ? clearSelected() : setSelected(visibleIds))}
                    label={allSelected ? 'Deselect all' : 'Select all'}
                  />
                </th>
              )}
              {columns.map((col) => {
                const sortKey = SORT_FIELD[col.id]
                return (
                  <th
                    key={col.id}
                    className={cn(
                      COL,
                      col.id === 'name' && 'min-w-[220px]',
                      col.id === 'location' && 'w-36',
                      col.id === 'tags' && 'w-32',
                      (col.id === 'dateUpdated' ||
                        col.id === 'dateViewed' ||
                        col.id === 'dateCreated') &&
                        'w-28',
                      col.id === 'sharing' && 'w-24',
                      (col.id === 'owner' || col.id === 'contributors') && 'w-36',
                    )}
                  >
                    {sortKey ? (
                      <SortHeader
                        label={col.label}
                        active={sort === sortKey}
                        dir={sortDir}
                        onClick={() => toggleSort(sortKey)}
                      />
                    ) : (
                      col.label
                    )}
                  </th>
                )
              })}
              <th className={cn(COL, 'w-10')} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-center">
                  <ColumnsMenu />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <DocsTableRow
                key={doc.id}
                doc={doc}
                columns={columns.map((c) => c.id)}
                context={context}
                query={query}
                selectable={selectable}
                selected={selectedIds.includes(doc.id)}
                workspaceName={workspaceName}
                onRename={onRename}
                onPurge={onPurge}
                onShare={onShare}
                draggable={draggableDocs && context === 'active'}
                onDocDragStart={onDocDragStart}
                onDocDragEnd={onDocDragEnd}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-fg">
      {label}
      {active && <ArrowDown size={12} className={cn(dir === 'asc' && 'rotate-180')} />}
    </button>
  )
}

const DocsTableRow = memo(function DocsTableRow({
  doc,
  columns,
  context,
  query,
  selectable,
  selected,
  workspaceName,
  onRename,
  onPurge,
  onShare,
  draggable,
  onDocDragStart,
  onDocDragEnd,
}: {
  doc: FlowDoc
  columns: DocTableColumnId[]
  context: DocCardContext
  query?: string
  selectable?: boolean
  selected: boolean
  workspaceName: string
  onRename?: (doc: FlowDoc) => void
  onPurge?: (doc: FlowDoc) => void
  onShare?: (doc: FlowDoc) => void
  draggable?: boolean
  onDocDragStart?: (docId: string) => void
  onDocDragEnd?: () => void
}) {
  const navigate = useNavigate()
  const { getFolder } = useFolders()
  const { isFavorite, toggleFavorite } = useFavorites()
  const toggleSelected = useDocsUIStore((s) => s.toggleSelected)
  const favorite = isFavorite(doc.id)
  const canOpen = context !== 'trash'
  const open = () => canOpen && navigate(`/app/docs/${doc.id}`)
  const LeadIcon = doc.isWiki ? BookOpen : FileText

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/docs/${doc.id}`)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const menuItems = useDocumentRowMenuItems(doc, context, {
    onRename,
    onPurge,
    onShare,
    copyLink,
    open,
  })
  const menu = useRowMenu(menuItems)

  const folderName = doc.folderName ?? (doc.folderId ? getFolder(doc.folderId)?.name : null)
  const locationLabel = folderName ?? workspaceName
  const LocationIcon = folderName ? Folder : Building2

  const tags = doc.tags ?? []
  const commentCount = doc.commentCount ?? 0
  const contributor = doc.updatedBy || doc.author

  return (
    <tr
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return
        e.dataTransfer.setData(DOC_FOLDER_DRAG_MIME, doc.id)
        e.dataTransfer.setData('text/plain', doc.id)
        e.dataTransfer.effectAllowed = 'move'
        onDocDragStart?.(doc.id)
      }}
      onDragEnd={() => onDocDragEnd?.()}
      onClick={open}
      onContextMenu={menu.onContextMenu}
      className={cn(
        'group cursor-pointer border-b border-ink-700/60 transition-colors last:border-b-0',
        selected ? 'bg-brand-soft/40' : 'hover:bg-ink-800/80',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {selectable && (
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <SelectCheckbox
            checked={selected}
            onChange={() => toggleSelected(doc.id)}
            label={selected ? 'Deselect' : 'Select'}
            hoverOnly={!selected}
          />
        </td>
      )}
      {columns.map((colId) => {
        switch (colId) {
          case 'name':
            return (
              <td key={colId} className="px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <LeadIcon size={15} className="shrink-0 text-brand" />
                  <span className="min-w-0 truncate text-sm font-medium text-fg">
                    <HighlightText text={doc.title} query={query} />
                  </span>
                  {doc.isWiki && (
                    <BadgeCheck size={14} className="shrink-0 text-fg-muted" aria-label="Wiki" />
                  )}
                  {commentCount > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-fg-muted">
                      <MessageSquare size={12} />
                      {commentCount}
                    </span>
                  )}
                  <div
                    className={cn(
                      'ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100',
                      favorite && 'opacity-100',
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <HoverBtn icon={Link2} label="Copy link" onClick={copyLink} />
                    <HoverBtn
                      icon={Star}
                      label={favorite ? 'Unfavorite' : 'Favorite'}
                      onClick={() => toggleFavorite(doc.id, 'doc')}
                      active={favorite}
                      filled={favorite}
                    />
                    {context === 'active' && (
                      <HoverBtn icon={Pencil} label="Rename" onClick={() => onRename?.(doc)} />
                    )}
                  </div>
                </div>
              </td>
            )
          case 'location':
            return (
              <td key={colId} className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
                  <LocationIcon size={13} className="shrink-0 text-fg-muted" />
                  <span className="truncate">{locationLabel}</span>
                </span>
              </td>
            )
          case 'tags':
            return (
              <td key={colId} className="px-3 py-2 text-sm text-fg-muted">
                {tags.length > 0 ? (
                  <span className="truncate">
                    {tags.slice(0, 2).join(', ')}
                    {tags.length > 2 ? '…' : ''}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            )
          case 'owner':
            return (
              <td key={colId} className="px-3 py-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
                  <Avatar name={doc.author} size={22} />
                  <span className="truncate">{doc.author || '—'}</span>
                </span>
              </td>
            )
          case 'dateViewed':
            return (
              <td key={colId} className="px-3 py-2 text-sm text-fg-secondary">
                {formatDocListTime(doc.lastViewedAt)}
              </td>
            )
          case 'dateCreated':
            return (
              <td key={colId} className="px-3 py-2 text-sm text-fg-secondary">
                {formatDocListTime(doc.createdAt)}
              </td>
            )
          case 'dateUpdated':
            return (
              <td key={colId} className="px-3 py-2 text-sm text-fg-secondary">
                {formatDocListTime(doc.updatedAt)}
              </td>
            )
          case 'contributors':
            return (
              <td key={colId} className="px-3 py-2">
                {contributor ? (
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
                    <Avatar name={contributor} size={22} />
                    <span className="truncate">{contributor}</span>
                  </span>
                ) : (
                  <span className="text-sm text-fg-muted">—</span>
                )}
              </td>
            )
          case 'sharing':
            return (
              <td key={colId} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <SharingCell doc={doc} onShare={() => onShare?.(doc)} />
              </td>
            )
          default:
            return null
        }
      })}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center">
          <button
            type="button"
            aria-label="Document actions"
            onClick={menu.onTriggerClick}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted opacity-0 transition-all hover:bg-ink-700 hover:text-fg group-hover:opacity-100"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu.node}
        </div>
      </td>
    </tr>
  )
})

function SharingCell({ doc, onShare }: { doc: FlowDoc; onShare?: () => void }) {
  const content = doc.publicEnabled ? (
    <Globe size={14} />
  ) : doc.isShared || (doc.shareMemberCount ?? 0) > 0 ? (
    <Users size={14} />
  ) : (
    <Avatar name={doc.author} size={24} />
  )

  const shellClass = doc.publicEnabled
    ? 'bg-emerald-500/15 text-emerald-400'
    : doc.isShared || (doc.shareMemberCount ?? 0) > 0
      ? 'bg-ink-750 text-fg-muted'
      : ''

  return (
    <button
      type="button"
      aria-label={`Share ${doc.title}`}
      onClick={onShare}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:ring-2 hover:ring-brand/30',
        shellClass,
        !shellClass && 'hover:bg-ink-750',
      )}
    >
      {content}
    </button>
  )
}

function SelectCheckbox({
  checked,
  onChange,
  label,
  hoverOnly,
}: {
  checked: boolean
  onChange: () => void
  label: string
  hoverOnly?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded border transition-all',
        checked
          ? 'border-brand bg-brand text-white opacity-100'
          : cn('border-ink-600 text-transparent hover:border-fg-muted', hoverOnly && 'opacity-0 group-hover:opacity-100'),
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  )
}

function HoverBtn({
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
        'flex h-6 w-6 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-fg-muted hover:border-ink-500 hover:text-fg',
        active && 'border-amber-500/40 text-amber-400',
      )}
    >
      <Icon size={13} fill={filled ? 'currentColor' : 'none'} />
    </button>
  )
}

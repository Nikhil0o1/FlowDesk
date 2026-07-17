import { Archive, ArchiveRestore, Star, X } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import { useArchive } from '../../hooks/useArchive'
import { useActivity } from '../../hooks/useActivity'
import { useComments } from '../../hooks/useComments'
import { useFavorites } from '../../hooks/useFavorites'
import { useFolders } from '../../hooks/useFolders'
import { usePermissions } from '../../hooks/usePermissions'
import { useSharing } from '../../hooks/useSharing'
import { useVersionHistory } from '../../hooks/useVersionHistory'
import { computeMetadata } from '../../services/metadata.service'
import type { FlowDoc } from '../../types/document'
import { PermissionBadge } from '../Permissions/PermissionBadge'
import { StatusBadge } from '../StatusBadge'

function fmt(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * Reusable document metadata panel. Used standalone or embedded in RightSidebar
 * Details tab (Phase 3).
 */
export function MetadataPanel({
  doc,
  onClose,
  embedded = false,
}: {
  doc: FlowDoc
  onClose?: () => void
  /** When true, renders without outer aside chrome (inside RightSidebar). */
  embedded?: boolean
}) {
  const { getFolder } = useFolders()
  const { isFavorite, toggleFavorite } = useFavorites()
  const { isArchived, archive, unarchive } = useArchive()
  const { role } = usePermissions(doc.id, doc.author)
  const { collaborators } = useSharing(doc.id, doc.title, doc.author)
  const { count: commentCount } = useComments(doc.id, doc.title)
  const { count: activityCount } = useActivity(doc.id)
  const { versions } = useVersionHistory(doc.id)

  const meta = computeMetadata(doc)
  const favorite = isFavorite(doc.id)
  const archived = isArchived(doc.id)
  const folderName = doc.folderId ? getFolder(doc.folderId)?.name ?? 'Unknown' : 'Root'

  const inner = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-sm font-bold text-fg">Details</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="rounded-lg p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={() => toggleFavorite(doc.id, 'doc')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
            favorite ? 'border-amber-400/40 bg-amber-400/10 text-amber-400' : 'border-ink-700 bg-ink-800 text-fg-secondary hover:text-fg',
          )}
        >
          <Star size={13} fill={favorite ? 'currentColor' : 'none'} /> {favorite ? 'Favorited' : 'Favorite'}
        </button>
        <button
          type="button"
          onClick={() => (archived ? unarchive([doc.id]) : archive([doc.id]))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:text-fg"
        >
          {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />} {archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>

      <div className="space-y-0.5 overflow-y-auto px-2 pb-4">
        <Row label="Your permission">
          <PermissionBadge role={role} />
        </Row>
        <Row label="Collaborators">{collaborators}</Row>
        <Row label="Status">
          <StatusBadge status={doc.status} />
        </Row>
        <Row label="Folder">{folderName}</Row>
        <Row label="Created by">{doc.author}</Row>
        <Row label="Created">{fmt(doc.createdAt)}</Row>
        <Row label="Last updated">{fmt(doc.updatedAt)}</Row>
        <Row label="Updated by">{doc.updatedBy ?? doc.author}</Row>
        <Row label="Last viewed">{fmt(doc.updatedAt)}</Row>
        <Row label="Version">{versions[0]?.versionNumber ?? '—'}</Row>
        <Row label="Comments">{commentCount}</Row>
        <Row label="Activity">{activityCount}</Row>
        <Row label="Words">{meta.wordCount.toLocaleString()}</Row>
        <Row label="Characters">{meta.charCount.toLocaleString()}</Row>
        <Row label="Reading time">{meta.readingLabel}</Row>
        <Row label="Archived">{archived ? 'Yes' : 'No'}</Row>
        <Row label="Favorite">{favorite ? 'Yes' : 'No'}</Row>
        <Row label="Tags">
          <span className="text-fg-muted">None · coming soon</span>
        </Row>
        <Row label="Document ID">
          <span className="font-mono text-[11px] text-fg-muted">{doc.id}</span>
        </Row>
      </div>
    </>
  )

  if (embedded) {
    return <div className="flex h-full flex-col overflow-y-auto">{inner}</div>
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-ink-700 bg-ink-850">
      {inner}
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5">
      <span className="shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 text-right text-xs text-fg">{children}</span>
    </div>
  )
}

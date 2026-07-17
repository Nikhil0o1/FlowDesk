import { useEffect, useMemo, useState } from 'react'

import { RenameModal } from '../../../components/ui/RenameModal'
import { useDocuments } from '../hooks/useDocuments'
import { useTrash } from '../hooks/useTrash'
import { useDocsUIStore } from '../stores/docsUIStore'
import type { FlowDoc } from '../types/document'
import type { DocCardContext, DocView } from '../types/editor'
import { BulkToolbar } from './BulkToolbar/BulkToolbar'
import { ConfirmDialog } from './ConfirmDialog'
import { DocumentCard } from './DocumentCard/DocumentCard'
import { DocsTable } from './DocsTable/DocsTable'
import { ShareDocumentModal } from './Sharing/ShareDocumentModal'

interface DocCollectionProps {
  docs: FlowDoc[]
  view: DocView
  context?: DocCardContext
  query?: string
  selectable?: boolean
  emptyState?: React.ReactNode
  workspaceName?: string
  /** Enable HTML5 drag so docs can be dropped onto folder cards. */
  draggableDocs?: boolean
  onDocDragStart?: (docId: string) => void
  onDocDragEnd?: () => void
}

/**
 * Reusable document collection: renders the grid/list, owns the rename +
 * permanent-delete dialogs, and wires bulk selection to the floating toolbar.
 * Shared by the Docs home, Favorites, Trash and Archive views.
 */
export function DocCollection({
  docs,
  view,
  context = 'active',
  query,
  selectable,
  emptyState,
  workspaceName = 'Everything',
  draggableDocs = false,
  onDocDragStart,
  onDocDragEnd,
}: DocCollectionProps) {
  const { updateDocument, getDocument } = useDocuments()
  const { deletePermanent } = useTrash()
  const selectedIds = useDocsUIStore((s) => s.selectedIds)
  const toggleSelected = useDocsUIStore((s) => s.toggleSelected)
  const setSelected = useDocsUIStore((s) => s.setSelected)
  const clearSelected = useDocsUIStore((s) => s.clearSelected)

  const [renaming, setRenaming] = useState<FlowDoc | null>(null)
  const [purging, setPurging] = useState<FlowDoc | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const sharingDoc = sharingId ? getDocument(sharingId) ?? docs.find((d) => d.id === sharingId) : null

  // Selection is transient — never leak it across views.
  useEffect(() => () => clearSelected(), [clearSelected])

  const visibleIds = useMemo(() => docs.map((d) => d.id), [docs])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedVisible = useMemo(() => visibleIds.filter((id) => selectedSet.has(id)), [visibleIds, selectedSet])

  if (docs.length === 0) return <>{emptyState ?? null}</>

  const cards = docs.map((doc) => (
    <DocumentCard
      key={doc.id}
      doc={doc}
      view={view}
      context={context}
      query={query}
      selectable={selectable}
      selected={selectedSet.has(doc.id)}
      onToggleSelect={toggleSelected}
      onRename={setRenaming}
      onPurge={setPurging}
    />
  ))

  return (
    <>
      {view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
      ) : (
        <DocsTable
          docs={docs}
          context={context}
          query={query}
          selectable={selectable}
          workspaceName={workspaceName}
          onRename={setRenaming}
          onPurge={setPurging}
          onShare={(doc) => setSharingId(doc.id)}
          draggableDocs={draggableDocs}
          onDocDragStart={onDocDragStart}
          onDocDragEnd={onDocDragEnd}
        />
      )}

      {selectable && selectedVisible.length > 0 && (
        <BulkToolbar
          context={context}
          selectedIds={selectedVisible}
          visibleIds={visibleIds}
          onSelectAll={() => setSelected(visibleIds)}
          onClear={clearSelected}
        />
      )}

      <RenameModal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename document"
        label="Document title"
        initialName={renaming?.title ?? ''}
        onSave={async (title) => {
          if (renaming) updateDocument(renaming.id, { title })
          setRenaming(null)
        }}
      />
      <ConfirmDialog
        open={!!purging}
        onClose={() => setPurging(null)}
        title="Delete permanently"
        message={`Permanently delete "${purging?.title}"? This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={() => {
          if (purging) deletePermanent([purging.id])
        }}
      />
      {sharingDoc && (
        <ShareDocumentModal
          doc={sharingDoc}
          open={!!sharingId}
          onClose={() => setSharingId(null)}
        />
      )}
    </>
  )
}

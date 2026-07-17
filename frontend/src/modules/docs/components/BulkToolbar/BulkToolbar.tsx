import { useState } from 'react'
import { Archive, ArchiveRestore, CheckSquare, FolderInput, RotateCcw, Star, Trash2, X, Folder as FolderIcon, CornerUpLeft } from 'lucide-react'

import { useRowMenu, type MenuItem } from '../../../../components/ui/ContextMenu'
import { useArchive } from '../../hooks/useArchive'
import { useDocuments } from '../../hooks/useDocuments'
import { useFolders } from '../../hooks/useFolders'
import { useTrash } from '../../hooks/useTrash'
import { useFavorites } from '../../hooks/useFavorites'
import type { DocCardContext } from '../../types/editor'
import { ConfirmDialog } from '../ConfirmDialog'

interface BulkToolbarProps {
  context: DocCardContext
  selectedIds: string[]
  visibleIds: string[]
  onSelectAll: () => void
  onClear: () => void
}

/** Floating bulk-action bar shown when one or more documents are selected. */
export function BulkToolbar({ context, selectedIds, visibleIds, onSelectAll, onClear }: BulkToolbarProps) {
  const { folders } = useFolders()
  const { moveDocument, deleteDocument } = useDocuments()
  const { archive, unarchive } = useArchive()
  const { restore, deletePermanent } = useTrash()
  const { toggleFavorite, isFavorite } = useFavorites()
  const [confirmPurge, setConfirmPurge] = useState(false)

  const count = selectedIds.length
  const allSelected = count > 0 && count === visibleIds.length

  const after = (fn: () => void) => {
    fn()
    onClear()
  }

  const moveMenu = (): MenuItem[] => [
    { type: 'action', label: 'Move to root', icon: <CornerUpLeft size={14} />, onClick: () => after(() => selectedIds.forEach((id) => moveDocument(id, null))) },
    { type: 'separator' },
    ...folders.map(
      (f): MenuItem => ({
        type: 'action',
        label: f.name,
        icon: <FolderIcon size={14} />,
        onClick: () => after(() => selectedIds.forEach((id) => moveDocument(id, f.id))),
      }),
    ),
  ]
  const move = useRowMenu(moveMenu)

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-popover">
          <span className="px-2 text-sm font-medium text-fg">{count} selected</span>
          <span className="mx-0.5 h-5 w-px bg-ink-700" aria-hidden />

          <BulkButton icon={CheckSquare} label={allSelected ? 'Clear all' : 'Select all'} onClick={allSelected ? onClear : onSelectAll} />

          {context === 'active' && (
            <>
              <BulkButton icon={Star} label="Favorite" onClick={() => after(() => selectedIds.forEach((id) => { if (!isFavorite(id)) toggleFavorite(id, 'doc') }))} />
              <BulkButton icon={FolderInput} label="Move" onClick={move.onTriggerClick} />
              <BulkButton icon={Archive} label="Archive" onClick={() => after(() => archive(selectedIds))} />
              <BulkButton icon={Trash2} label="Delete" danger onClick={() => after(() => selectedIds.forEach((id) => deleteDocument(id)))} />
            </>
          )}

          {context === 'archive' && (
            <>
              <BulkButton icon={ArchiveRestore} label="Unarchive" onClick={() => after(() => unarchive(selectedIds))} />
              <BulkButton icon={Trash2} label="Delete" danger onClick={() => after(() => selectedIds.forEach((id) => deleteDocument(id)))} />
            </>
          )}

          {context === 'trash' && (
            <>
              <BulkButton icon={RotateCcw} label="Restore" onClick={() => after(() => restore(selectedIds))} />
              <BulkButton icon={Trash2} label="Delete forever" danger onClick={() => setConfirmPurge(true)} />
            </>
          )}

          <span className="mx-0.5 h-5 w-px bg-ink-700" aria-hidden />
          <BulkButton icon={X} label="Clear selection" onClick={onClear} />
        </div>
      </div>

      {move.node}

      <ConfirmDialog
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        title="Delete permanently"
        message={`Permanently delete ${count} document${count === 1 ? '' : 's'}? This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={() => after(() => deletePermanent(selectedIds))}
      />
    </>
  )
}

function BulkButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Star
  label: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        danger
          ? 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10'
          : 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg'
      }
    >
      <Icon size={15} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

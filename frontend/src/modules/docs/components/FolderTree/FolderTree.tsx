import { memo, useState } from 'react'
import { FolderPlus } from 'lucide-react'

import { RenameModal } from '../../../../components/ui/RenameModal'
import { useFolders } from '../../hooks/useFolders'
import type { Folder } from '../../types/folder'
import { ConfirmDialog } from '../ConfirmDialog'
import { FolderNode } from './FolderNode'

/**
 * Recursive folder tree. Owns the rename/delete dialogs once for the whole tree
 * (nodes just request them) to avoid a modal per folder. Memoized so unrelated
 * document edits don't re-render it.
 */
function FolderTreeBase({ activeFolderId }: { activeFolderId: string | null }) {
  const { tree, renameFolder, deleteFolder } = useFolders()
  const [renaming, setRenaming] = useState<Folder | null>(null)
  const [deleting, setDeleting] = useState<Folder | null>(null)

  if (tree.length === 0) {
    return (
      <div className="mx-3 mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center">
        <FolderPlus size={20} className="text-fg-muted" />
        <p className="text-xs text-fg-secondary">Create your first folder.</p>
      </div>
    )
  }

  return (
    <div role="tree" aria-label="Folders" className="py-1">
      {tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={0}
          activeFolderId={activeFolderId}
          onRename={setRenaming}
          onDelete={setDeleting}
        />
      ))}

      <RenameModal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename folder"
        label="Folder name"
        initialName={renaming?.name ?? ''}
        onSave={async (name) => {
          if (renaming) renameFolder(renaming.id, name)
          setRenaming(null)
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete folder"
        message={`Delete "${deleting?.name}" and everything inside it? This can't be undone.`}
        onConfirm={() => {
          if (deleting) deleteFolder(deleting.id)
        }}
      />
    </div>
  )
}

export const FolderTree = memo(FolderTreeBase)

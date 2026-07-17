import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { DocsListView } from '../components/DocsListView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useTrash } from '../hooks/useTrash'

/** Soft-deleted documents: restore, permanently delete or empty the trash. */
export default function TrashPage() {
  const { trashed, emptyTrash } = useTrash()
  const [confirm, setConfirm] = useState(false)

  return (
    <>
      <DocsListView
        title="Trash"
        crumbLabel="Trash"
        docs={trashed}
        context="trash"
        emptyIcon={Trash2}
        emptyTitle="Trash is empty."
        emptyDescription="Deleted documents show up here and can be restored."
        searchPlaceholder="Search trash"
        headerActions={
          trashed.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={() => setConfirm(true)}>
              <Trash2 size={16} /> Empty trash
            </button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Empty trash"
        message={`Permanently delete all ${trashed.length} item${trashed.length === 1 ? '' : 's'}? This can't be undone.`}
        confirmLabel="Empty trash"
        onConfirm={emptyTrash}
      />
    </>
  )
}

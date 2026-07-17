import { DEFAULT_FOLDERS } from '../constants/defaultFolders'
import { MOCK_DOCUMENTS } from '../constants/mockDocuments'
import { useDocumentsStore } from '../stores/documentsStore'
import { useFoldersStore } from '../stores/foldersStore'

/**
 * Seed realistic folders + documents on first ever use. Idempotent: guarded by a
 * persisted `seeded` flag, so it never overwrites user edits or re-seeds after
 * the user clears everything.
 *
 * TODO(backend): once a Docs API exists, replace this seed with a real fetch in
 * `docs.service` / `folder.service` and drop the mock constants.
 */
export function seedIfNeeded() {
  const folders = useFoldersStore.getState()
  if (folders.seeded) return
  folders.setFolders(DEFAULT_FOLDERS)
  useDocumentsStore.getState().setDocuments(MOCK_DOCUMENTS)
  folders.setSeeded(true)
}

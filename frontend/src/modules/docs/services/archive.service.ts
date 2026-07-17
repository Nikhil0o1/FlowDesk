import type { FlowDoc } from '../types/document'
import { isArchived } from './docs.service'

/**
 * Archive helpers (pure). Archiving is modelled as an `archivedAt` field on the
 * document; mutations live in `documentsStore` and are surfaced through
 * `useArchive`. Archived docs are read-only in the editor.
 *
 * TODO(backend): move archive state to the API; this stays a pure view.
 */

/** Archived documents, most-recently-archived first. */
export function getArchived(docs: FlowDoc[]): FlowDoc[] {
  return docs
    .filter(isArchived)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
}

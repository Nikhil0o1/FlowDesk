import type { FlowDoc } from '../types/document'
import { isTrashed } from './docs.service'

/**
 * Trash helpers (pure). Soft-delete is modelled as a `deletedAt` field on the
 * document (single source of truth); mutations live in `documentsStore` and are
 * surfaced through `useTrash`.
 *
 * TODO(backend): move soft-delete + purge to the API; this stays a pure view.
 */

/** Trashed documents, most-recently-deleted first. */
export function getTrashed(docs: FlowDoc[]): FlowDoc[] {
  return docs
    .filter(isTrashed)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
}

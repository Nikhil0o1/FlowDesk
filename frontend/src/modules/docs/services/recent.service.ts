import type { FlowDoc } from '../types/document'
import type { RecentEntry } from '../stores/recentStore'
import { isTrashed } from './docs.service'

/**
 * Recent-documents helpers (pure). State + the 50-item cap live in `recentStore`.
 *
 * TODO(backend): sync recents server-side; the resolution helper stays the same.
 */

export interface ResolvedRecent {
  doc: FlowDoc
  openedAt: number
}

/**
 * Resolve recent entries to live documents, preserving recency order and
 * dropping anything that has since been trashed or deleted.
 */
export function resolveRecent(entries: RecentEntry[], docs: FlowDoc[]): ResolvedRecent[] {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const out: ResolvedRecent[] = []
  for (const entry of entries) {
    const doc = byId.get(entry.id)
    if (doc && !isTrashed(doc)) out.push({ doc, openedAt: entry.at })
  }
  return out
}

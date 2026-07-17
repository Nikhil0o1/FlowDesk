import { useMemo } from 'react'

import { useDocsUIStore } from '../stores/docsUIStore'
import { applyFilterRules, filterByTags, sortDocuments } from '../services/docs.service'
import type { FlowDoc } from '../types/document'
import { useFolders } from './useFolders'

/** Applies ClickUp-style filter rules, tag chips, and date sort from `docsUIStore`. */
export function useDocFiltering(docs: FlowDoc[]) {
  const { folders } = useFolders()
  const sort = useDocsUIStore((s) => s.sort)
  const sortDir = useDocsUIStore((s) => s.sortDir)
  const filterRules = useDocsUIStore((s) => s.filterRules)
  const tagFilter = useDocsUIStore((s) => s.tagFilter)

  const result = useMemo(() => {
    let rows = filterByTags(docs, tagFilter)
    rows = applyFilterRules(rows, filterRules, folders)
    return sortDocuments(rows, sort, sortDir)
  }, [docs, tagFilter, filterRules, folders, sort, sortDir])

  return { result }
}

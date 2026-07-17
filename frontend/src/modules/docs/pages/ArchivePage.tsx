import { Archive } from 'lucide-react'

import { DocsListView } from '../components/DocsListView'
import { useArchive } from '../hooks/useArchive'

/** Archived (read-only) documents: search, sort and restore. */
export default function ArchivePage() {
  const { archived } = useArchive()

  return (
    <DocsListView
      title="Archived"
      crumbLabel="Archived"
      docs={archived}
      context="archive"
      emptyIcon={Archive}
      emptyTitle="No archived documents."
      emptyDescription="Archived documents are read-only and kept out of your way."
      searchPlaceholder="Search archive"
    />
  )
}

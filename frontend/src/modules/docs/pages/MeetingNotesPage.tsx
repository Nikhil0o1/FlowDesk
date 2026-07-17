import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import { DocsListView } from '../components/DocsListView'
import { docsKeys, fetchDocuments } from '../services/docsApi.service'
import { useDocsUIStore } from '../stores/docsUIStore'

/** Docs tagged or titled for meeting notes (ClickUp-style sidebar view). */
export default function MeetingNotesPage() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const sort = useDocsUIStore((s) => s.sort)
  const sortDir = useDocsUIStore((s) => s.sortDir)

  const { data } = useQuery({
    queryKey: [...docsKeys.documents(wsId ?? '', 'meeting-notes'), sort, sortDir],
    queryFn: () => fetchDocuments(wsId!, { deleted: false, archived: false, sort, sortDir }),
    enabled: !!wsId,
  })

  const docs = useMemo(() => {
    return (data ?? []).filter((d) => {
      const title = d.title.toLowerCase()
      const tags = (d.tags ?? []).map((t) => t.toLowerCase())
      return title.includes('meeting') || tags.some((t) => t.includes('meeting'))
    })
  }, [data])

  return (
    <DocsListView
      title="Meeting Notes"
      crumbLabel="Meeting Notes"
      docs={docs}
      context="active"
      emptyIcon={Sparkles}
      emptyTitle="No meeting notes yet."
      emptyDescription="Create a doc with “meeting” in the title or tag it with meeting notes."
      searchPlaceholder="Search meeting notes"
      showHeaderActions
    />
  )
}

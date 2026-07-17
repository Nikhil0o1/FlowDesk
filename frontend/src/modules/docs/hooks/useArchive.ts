import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useCurrentContext } from '../../../lib/queries'
import { getArchived } from '../services/archive.service'
import { isArchived as isArchivedDoc } from '../services/docs.service'
import { docsKeys, fetchDocuments } from '../services/docsApi.service'
import { useDocuments } from './useDocuments'

/** Archive view + archive / unarchive actions. */
export function useArchive() {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const { archiveDocument, unarchiveDocument } = useDocuments()

  const archivedQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'archived'),
    queryFn: () => fetchDocuments(wsId!, { deleted: false, archived: true }),
    enabled: !!wsId,
  })

  const archived = useMemo(() => getArchived(archivedQuery.data ?? []), [archivedQuery.data])

  const archive = useCallback((ids: string[]) => Promise.all(ids.map((id) => archiveDocument(id))), [archiveDocument])
  const unarchive = useCallback((ids: string[]) => Promise.all(ids.map((id) => unarchiveDocument(id))), [unarchiveDocument])

  const { documents } = useDocuments()
  const isArchived = useCallback(
    (id: string) => {
      const d = documents.find((x) => x.id === id)
      return !!d && isArchivedDoc(d)
    },
    [documents],
  )

  return { archived, archive, unarchive, isArchived, isLoading: archivedQuery.isLoading }
}

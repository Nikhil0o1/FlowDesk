import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'

import { useCurrentContext } from '../../../lib/queries'
import { DocsListView } from '../components/DocsListView'
import { docsKeys, fetchDocuments, type DocScope } from '../services/docsApi.service'
import { useDocsUIStore } from '../stores/docsUIStore'

interface ScopedDocsPageProps {
  scope: DocScope
  title: string
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription?: string
  isWiki?: boolean
}

/** Server-backed listing for scoped views (My Docs / Shared / Private / Wikis). */
export function ScopedDocsPage({ scope, title, emptyIcon, emptyTitle, emptyDescription, isWiki }: ScopedDocsPageProps) {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const sort = useDocsUIStore((s) => s.sort)
  const sortDir = useDocsUIStore((s) => s.sortDir)
  const filterRules = useDocsUIStore((s) => s.filterRules)
  const tagFilter = useDocsUIStore((s) => s.tagFilter)

  const { data } = useQuery({
    queryKey: [
      ...docsKeys.documents(wsId ?? '', `scope:${scope}${isWiki ? ':wiki' : ''}`),
      sort,
      sortDir,
      filterRules,
      tagFilter,
    ],
    queryFn: () =>
      fetchDocuments(wsId!, {
        deleted: false,
        archived: false,
        scope,
        isWiki,
        sort,
        sortDir,
        filterRules,
        tags: tagFilter,
      }),
    enabled: !!wsId,
  })

  return (
    <DocsListView
      title={title}
      crumbLabel={title}
      docs={data ?? []}
      context="active"
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      searchPlaceholder={`Search ${title.toLowerCase()}`}
      showHeaderActions
    />
  )
}

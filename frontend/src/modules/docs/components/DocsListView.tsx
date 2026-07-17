import { useMemo, useState } from 'react'
import { SearchX, type LucideIcon } from 'lucide-react'

import { useCurrentContext } from '../../../lib/queries'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useDocsBootstrap } from '../context/DocsContext'
import { useDocFiltering } from '../hooks/useDocFiltering'
import { useFolders } from '../hooks/useFolders'
import { searchDocuments } from '../services/docs.service'
import type { FlowDoc } from '../types/document'
import type { DocCardContext } from '../types/editor'
import { DocCollection } from './DocCollection'
import { DocsBreadcrumb, type Crumb } from './DocsBreadcrumb'
import { DocsHeaderActions } from './DocsHeaderActions'
import { DocsToolbar } from './DocsToolbar'

interface DocsListViewProps {
  title: string
  crumbLabel: string
  docs: FlowDoc[]
  context: DocCardContext
  selectable?: boolean
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription?: string
  headerActions?: React.ReactNode
  renderExtraTop?: (query: string) => React.ReactNode
  searchPlaceholder?: string
  showHeaderActions?: boolean
}

/** Shared scaffold for scoped Docs views (My Docs, Favorites, etc.). */
export function DocsListView({
  title,
  crumbLabel,
  docs,
  context,
  selectable = true,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  headerActions,
  renderExtraTop,
  searchPlaceholder = 'Search',
  showHeaderActions = false,
}: DocsListViewProps) {
  useDocsBootstrap()
  const { workspace } = useCurrentContext()
  const workspaceName = workspace?.name ?? 'FlowDesk'
  const { folders } = useFolders()

  const [query, setQuery] = useState('')

  const searched = useMemo(() => searchDocuments(docs, folders, query), [docs, folders, query])
  const { result: filtered } = useDocFiltering(searched)

  const crumbs: Crumb[] = [{ label: workspaceName, to: '/app/docs' }, { label: crumbLabel }]
  const extraTop = renderExtraTop?.(query)

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-5">
      <DocsBreadcrumb items={crumbs} />

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-bold text-fg">{title}</h1>
        {headerActions ?? (showHeaderActions ? <DocsHeaderActions /> : null)}
      </div>

      <div className="mt-4">
        <DocsToolbar docs={searched} search={query} onSearchChange={setQuery} searchPlaceholder={searchPlaceholder} />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 pb-6">
          {extraTop}
          {filtered.length > 0 ? (
            <DocCollection
              docs={filtered}
              view="list"
              context={context}
              query={query}
              selectable={selectable}
              workspaceName={workspaceName}
            />
          ) : extraTop ? null : query ? (
            <EmptyState icon={SearchX} title="No documents found." description="Try a different search term." />
          ) : (
            <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
          )}
        </div>
      </div>
    </div>
  )
}

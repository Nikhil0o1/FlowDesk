import { useMemo, useState } from 'react'
import { Clock, FileText, SearchX, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { timeAgo } from '../../../lib/utils'
import { useCurrentContext } from '../../../lib/queries'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useDocsBootstrap } from '../context/DocsContext'
import { useDocuments } from '../hooks/useDocuments'
import { useFolders } from '../hooks/useFolders'
import { useRecent } from '../hooks/useRecent'
import { resolveRecent } from '../services/recent.service'
import { DocsBreadcrumb, type Crumb } from '../components/DocsBreadcrumb'
import { HighlightText } from '../components/Search/HighlightText'
import { SearchBox } from '../components/Search/SearchBox'

/** Recently-opened documents with per-item remove and clear-history. */
export default function RecentPage() {
  useDocsBootstrap()
  const navigate = useNavigate()
  const { workspace } = useCurrentContext()
  const workspaceName = workspace?.name ?? 'FlowDesk'
  const { documents } = useDocuments()
  const { getFolder } = useFolders()
  const { entries, remove, clear } = useRecent()
  const [query, setQuery] = useState('')

  const resolved = useMemo(() => resolveRecent(entries, documents), [entries, documents])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? resolved.filter((r) => r.doc.title.toLowerCase().includes(q)) : resolved
  }, [resolved, query])

  const crumbs: Crumb[] = [{ label: workspaceName, to: '/app/docs' }, { label: 'Recent' }]

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-6 py-5">
      <DocsBreadcrumb items={crumbs} />

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">Recent</h1>
        {resolved.length > 0 && (
          <button type="button" className="btn-secondary" onClick={clear}>
            Clear history
          </button>
        )}
      </div>

      <div className="mt-4">
        <SearchBox value={query} onChange={setQuery} placeholder="Search recent" ariaLabel="Search recent" className="w-56" />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-6">
        {filtered.length === 0 ? (
          query ? (
            <EmptyState icon={SearchX} title="No documents found." description="Try a different search term." />
          ) : (
            <EmptyState icon={Clock} title="No recent documents." description="Documents you open will appear here." />
          )
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
            {filtered.map(({ doc, openedAt }) => {
              const go = () => navigate(`/app/docs/${doc.id}`)
              const folderName = doc.folderId ? getFolder(doc.folderId)?.name : undefined
              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(e) => e.key === 'Enter' && go()}
                  className="group flex cursor-pointer items-center gap-3 border-b border-ink-700/60 px-3 py-2.5 transition-colors hover:bg-ink-800"
                >
                  <FileText size={16} className="shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">
                      <HighlightText text={doc.title} query={query} />
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                      {folderName && (
                        <>
                          <span className="truncate">{folderName}</span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <Clock size={11} className="shrink-0" />
                      <span className="shrink-0">Opened {timeAgo(new Date(openedAt).toISOString())}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{doc.author}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove from recent"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(doc.id)
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-ink-700 hover:text-fg focus:opacity-100 group-hover:opacity-100 sm:opacity-0"
                  >
                    <X size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

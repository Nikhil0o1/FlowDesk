import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ArrowLeftRight, FileText, Link2, Loader2, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useCurrentContext } from '../../../../lib/queries'
import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { useDocumentLinks } from '../../hooks/useDocumentLinks'
import { fetchDocuments, fetchRecentTasksForLink, searchTasksForLink } from '../../services/docsApi.service'
import type { DocLink, DocLinkTargetType } from '../../types/docLink'

type LinkTab = 'tasks' | 'docs'

interface LinkTaskOrDocPickerProps {
  documentId: string
  readOnly?: boolean
  showChips?: boolean
  variant?: 'default' | 'toolbar'
}

/** ClickUp-style popover to link tasks or other docs to this page. */
export function LinkTaskOrDocPicker({
  documentId,
  readOnly,
  showChips = true,
  variant = 'default',
}: LinkTaskOrDocPickerProps) {
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const { links, addLink, removeLink } = useDocumentLinks(documentId)

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<LinkTab>('tasks')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const recentTasksQuery = useQuery({
    queryKey: ['link-picker-recent-tasks', wsId],
    queryFn: () => fetchRecentTasksForLink(wsId),
    enabled: open && tab === 'tasks' && debounced.trim().length < 2,
  })

  const searchTasksQuery = useQuery({
    queryKey: ['link-search-tasks', debounced],
    queryFn: () => searchTasksForLink(debounced),
    enabled: open && tab === 'tasks' && debounced.trim().length >= 2,
  })

  const searchDocsQuery = useQuery({
    queryKey: ['link-search-docs', wsId, debounced],
    queryFn: () =>
      fetchDocuments(wsId!, {
        q: debounced.trim().length >= 2 ? debounced : undefined,
        deleted: false,
        archived: false,
        sort: 'updated',
        sortDir: 'desc',
      }),
    enabled: open && tab === 'docs' && !!wsId,
  })

  const taskItems =
    debounced.trim().length >= 2 ? (searchTasksQuery.data ?? []) : (recentTasksQuery.data ?? [])

  const tasksError = debounced.trim().length >= 2 ? searchTasksQuery.isError : recentTasksQuery.isError

  const docItems = (searchDocsQuery.data ?? []).filter((d) => d.id !== documentId)

  const isLinked = (targetType: DocLinkTargetType, targetId: string) =>
    links.some((l) => l.targetType === targetType && l.targetId === targetId)

  const toggleLink = async (targetType: DocLinkTargetType, targetId: string) => {
    if (readOnly) return
    const existing = links.find((l) => l.targetType === targetType && l.targetId === targetId)
    setBusy(targetId)
    try {
      if (existing) {
        await removeLink(existing.id)
        toast.success('Link removed')
      } else {
        await addLink({ targetType, targetId })
        toast.success('Linked successfully')
      }
    } catch {
      toast.error('Could not update link')
    } finally {
      setBusy(null)
    }
  }

  const loading =
    (tab === 'tasks' &&
      (debounced.length >= 2 ? searchTasksQuery.isFetching : recentTasksQuery.isFetching)) ||
    (tab === 'docs' && searchDocsQuery.isFetching)

  const LinkIcon = variant === 'toolbar' ? ArrowLeftRight : Link2

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
          variant === 'toolbar'
            ? 'text-fg-muted hover:bg-ink-800 hover:text-fg-secondary'
            : 'rounded-lg text-xs font-medium text-fg-muted hover:bg-ink-800 hover:text-fg',
        )}
      >
        <LinkIcon size={14} />
        Link Task or Doc
      </button>

      {showChips && links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {links.map((link) => (
            <LinkedChip key={link.id} link={link} onRemove={readOnly ? undefined : () => void removeLink(link.id)} />
          ))}
        </div>
      )}

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-xl border border-ink-700 bg-ink-850 p-3 shadow-popover">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              autoFocus
              className="w-full rounded-lg border border-ink-600 bg-ink-800 py-2 pl-8 pr-3 text-sm text-fg outline-none focus:border-brand"
            />
          </div>

          <div className="mb-2 flex gap-4 border-b border-ink-700">
            {(['tasks', 'docs'] as LinkTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'border-b-2 pb-2 text-sm font-medium capitalize transition-colors',
                  tab === t ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {t === 'tasks' ? 'Tasks' : 'Docs'}
              </button>
            ))}
          </div>

          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            {tab === 'tasks'
              ? debounced.length >= 2
                ? 'Search results'
                : 'Recent tasks'
              : debounced.length >= 2
                ? 'Search results'
                : 'Recent docs'}
          </p>

          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <div className="flex justify-center py-6 text-fg-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}

            {!loading && tab === 'tasks' && tasksError && (
              <p className="py-4 text-center text-xs text-red-400">Could not load tasks</p>
            )}

            {!loading && !tasksError && tab === 'tasks' && taskItems.length === 0 && (
              <p className="py-4 text-center text-xs text-fg-muted">No tasks found</p>
            )}

            {!loading &&
              tab === 'tasks' &&
              taskItems.map((task) => {
                const linked = isLinked('task', task.id)
                return (
                  <button
                    key={task.id}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void toggleLink('task', task.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-ink-800',
                      linked && 'bg-ink-800',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                        linked ? 'border-brand bg-brand' : 'border-ink-600',
                      )}
                    >
                      {linked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-fg">{task.title}</span>
                    {busy === task.id && <Loader2 size={14} className="animate-spin text-fg-muted" />}
                  </button>
                )
              })}

            {!loading && tab === 'docs' && docItems.length === 0 && (
              <p className="py-4 text-center text-xs text-fg-muted">No documents found</p>
            )}

            {!loading &&
              tab === 'docs' &&
              docItems.slice(0, 20).map((doc) => {
                const linked = isLinked('document', doc.id)
                return (
                  <button
                    key={doc.id}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void toggleLink('document', doc.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-ink-800',
                      linked && 'bg-ink-800',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                        linked ? 'border-brand bg-brand' : 'border-ink-600',
                      )}
                    >
                      {linked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <FileText size={14} className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate text-fg">{doc.title || 'Untitled'}</span>
                    {busy === doc.id && <Loader2 size={14} className="animate-spin text-fg-muted" />}
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function LinkedChip({ link, onRemove }: { link: DocLink; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-fg-secondary">
      <Link to={link.href} className="flex items-center gap-1 hover:text-fg">
        {link.title}
        <ArrowUpRight size={11} />
      </Link>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-fg-muted hover:text-red-400" aria-label="Remove link">
          ×
        </button>
      )}
    </span>
  )
}

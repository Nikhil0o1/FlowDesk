import { useQuery } from '@tanstack/react-query'
import { FileText, FolderKanban, MessageSquare, Search, User as UserIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { api } from '../../lib/api'
import type { SearchResults } from '../../lib/types'
import { Avatar } from '../ui/Avatar'
import { StatusPill } from '../ui/badges'
import { Spinner } from '../ui/Spinner'

export function SearchCommand({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setDebounced('')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.trim().length >= 2,
  })

  if (!open) return null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const hasResults =
    data && (data.tasks.length || data.projects.length || data.comments.length || data.users.length)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-popover">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3.5">
          <Search size={17} className="text-fg-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, projects, comments, people…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
          {isFetching && <Spinner className="h-4 w-4" />}
          <kbd className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-fg-secondary">Esc</kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {debounced.trim().length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-fg-muted">
              Type at least 2 characters to search
            </p>
          ) : !hasResults && !isFetching ? (
            <p className="px-3 py-8 text-center text-sm text-fg-muted">No results for “{debounced}”</p>
          ) : (
            <>
              {data?.tasks.length ? (
                <ResultGroup label="Tasks">
                  {data.tasks.map((task) => (
                    <button key={task.id} className="menu-item" onClick={() => go(`/app/tasks/${task.id}`)}>
                      <FileText size={14} className="shrink-0 text-fg-muted" />
                      <span className="shrink-0 text-xs text-fg-muted">{task.ref}</span>
                      <span className="flex-1 truncate">{task.title}</span>
                      <StatusPill status={task.status} />
                    </button>
                  ))}
                </ResultGroup>
              ) : null}
              {data?.projects.length ? (
                <ResultGroup label="Projects">
                  {data.projects.map((project) => (
                    <button key={project.id} className="menu-item" onClick={() => go(`/app/projects/${project.id}`)}>
                      <FolderKanban size={14} className="shrink-0" style={{ color: project.color }} />
                      <span className="flex-1 truncate">{project.name}</span>
                      <span className="text-xs text-fg-muted">{project.key}</span>
                    </button>
                  ))}
                </ResultGroup>
              ) : null}
              {data?.comments.length ? (
                <ResultGroup label="Comments">
                  {data.comments.map((hit) => (
                    <button key={hit.comment_id} className="menu-item" onClick={() => go(`/app/tasks/${hit.task_id}`)}>
                      <MessageSquare size={14} className="shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-fg-muted">on {hit.task_title}</span>
                        <span className="block truncate">{hit.excerpt}</span>
                      </span>
                    </button>
                  ))}
                </ResultGroup>
              ) : null}
              {data?.users.length ? (
                <ResultGroup label="People">
                  {data.users.map((person) => (
                    <div key={person.id} className="menu-item cursor-default">
                      <Avatar name={person.full_name || person.email} src={person.avatar_url} size={22} />
                      <span className="flex-1 truncate">{person.full_name || person.email}</span>
                      <span className="truncate text-xs text-fg-muted">{person.email}</span>
                    </div>
                  ))}
                </ResultGroup>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      {children}
    </div>
  )
}

// Re-export icon for convenience elsewhere
export { UserIcon }

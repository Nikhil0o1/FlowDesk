import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckSquare, ChevronRight, FolderKanban, Layers, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { useProjects, useSpaces, useTaskLists } from '../../lib/queries'
import type { Page, Task } from '../../lib/types'
import { cn } from '../../lib/utils'

type Crumb = { id: string; name: string }

/** ClickUp-style location picker for tagging a task in chat: drill down
 * Space → Project → (List) → task instead of free-text search. Every level is
 * live workspace data the viewer already has access to. */
export function TaskBrowsePanel({
  workspaceId,
  onPick,
}: {
  workspaceId: string
  onPick: (task: Task) => void
}) {
  const [space, setSpace] = useState<Crumb | null>(null)
  const [project, setProject] = useState<Crumb | null>(null)
  const [listId, setListId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const spaces = useSpaces(workspaceId)
  const projects = useProjects(workspaceId)
  const lists = useTaskLists(project?.id)
  const tasks = useQuery({
    queryKey: ['chat-browse-tasks', project?.id],
    queryFn: () => api.get<Page<Task>>(`/projects/${project!.id}/tasks?page_size=200`),
    enabled: !!project,
    staleTime: 15_000,
  })

  // Personal lists are private — not a place to link tasks from in a channel.
  const browsable = useMemo(
    () => (projects.data ?? []).filter((p) => !p.is_personal && !p.is_archived),
    [projects.data],
  )
  const spaceless = browsable.filter((p) => !p.space_id)

  const back = () => {
    if (project) {
      setProject(null)
      setListId(null)
      setFilter('')
    } else {
      setSpace(null)
    }
  }

  const visibleTasks = (tasks.data?.items ?? []).filter((t) => {
    if (listId && t.list_id !== listId) return false
    if (filter.trim() && !t.title.toLowerCase().includes(filter.trim().toLowerCase())) return false
    return true
  })

  return (
    <div>
      {/* Breadcrumb header */}
      <div className="flex items-center gap-1 border-b border-ink-700 px-2 py-1.5 text-[11px] text-fg-muted">
        {(space || project) && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              back()
            }}
            className="rounded p-0.5 hover:bg-ink-750 hover:text-fg"
            title="Back"
          >
            <ArrowLeft size={12} />
          </button>
        )}
        <span className="truncate">
          {!space && !project && 'Pick a location'}
          {space && !project && space.name}
          {project && (space ? `${space.name} / ${project.name}` : project.name)}
        </span>
      </div>

      {/* Level 1: spaces */}
      {!space && !project && (
        <>
          {(spaces.data ?? []).map((s) => {
            const count = browsable.filter((p) => p.space_id === s.id).length
            return (
              <button
                key={s.id}
                type="button"
                className="menu-item"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setSpace({ id: s.id, name: s.name })
                }}
              >
                <span
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{ backgroundColor: s.color }}
                >
                  {s.name[0]?.toUpperCase()}
                </span>
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-fg-muted">{count}</span>
                <ChevronRight size={12} className="shrink-0 text-fg-muted" />
              </button>
            )
          })}
          {spaceless.map((p) => (
            <button
              key={p.id}
              type="button"
              className="menu-item"
              onMouseDown={(e) => {
                e.preventDefault()
                setProject({ id: p.id, name: p.name })
              }}
            >
              <FolderKanban size={14} className="shrink-0" style={{ color: p.color }} />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[10px] text-fg-muted">{p.task_count ?? ''}</span>
              <ChevronRight size={12} className="shrink-0 text-fg-muted" />
            </button>
          ))}
          {spaces.isLoading && <p className="px-3 py-2 text-xs text-fg-muted">Loading spaces…</p>}
          {!spaces.isLoading && (spaces.data ?? []).length === 0 && spaceless.length === 0 && (
            <p className="px-3 py-2 text-xs text-fg-muted">No spaces or projects you can see here.</p>
          )}
        </>
      )}

      {/* Level 2: projects in the space */}
      {space && !project && (
        <>
          {browsable
            .filter((p) => p.space_id === space.id)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="menu-item"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setProject({ id: p.id, name: p.name })
                }}
              >
                <FolderKanban size={14} className="shrink-0" style={{ color: p.color }} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[10px] text-fg-muted">{p.task_count ?? ''}</span>
                <ChevronRight size={12} className="shrink-0 text-fg-muted" />
              </button>
            ))}
          {browsable.filter((p) => p.space_id === space.id).length === 0 && (
            <p className="px-3 py-2 text-xs text-fg-muted">No projects in this space.</p>
          )}
        </>
      )}

      {/* Level 3: (list filter +) tasks in the project */}
      {project && (
        <>
          <div className="flex items-center gap-1.5 px-2 pt-1.5">
            <Search size={12} className="shrink-0 text-fg-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tasks…"
              className="w-full bg-transparent py-1 text-xs text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          {(lists.data ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 py-1.5">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setListId(null)
                }}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  listId === null ? 'bg-brand/15 text-brand' : 'bg-ink-750 text-fg-secondary hover:text-fg',
                )}
              >
                All
              </button>
              {(lists.data ?? []).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setListId(l.id)
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    listId === l.id ? 'bg-brand/15 text-brand' : 'bg-ink-750 text-fg-secondary hover:text-fg',
                  )}
                >
                  <Layers size={9} /> {l.name}
                </button>
              ))}
            </div>
          )}
          {tasks.isLoading && <p className="px-3 py-2 text-xs text-fg-muted">Loading tasks…</p>}
          {!tasks.isLoading && visibleTasks.length === 0 && (
            <p className="px-3 py-2 text-xs text-fg-muted">No matching tasks here.</p>
          )}
          {visibleTasks.map((t) => (
            <button
              key={t.id}
              type="button"
              className="menu-item"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(t)
              }}
            >
              <CheckSquare size={15} className="shrink-0 text-brand" />
              <span className="flex-1 truncate">{t.title}</span>
              {t.status && (
                <span
                  className="shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase"
                  style={{ color: t.status.color, backgroundColor: `${t.status.color}1a` }}
                >
                  {t.status.name}
                </span>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

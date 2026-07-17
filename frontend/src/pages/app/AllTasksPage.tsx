import { ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Priority } from '../../lib/types'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import { useAllTasks } from '../../services/tasks.service'
import { ALL_COLS, TaskRow, gridTemplate } from '../../components/tasks/TaskTable'
import { ErrorState } from '../../components/home/ErrorState'
import { HomePageHeader } from '../../components/home/HomePageHeader'
import { SearchInput } from '../../components/home/SearchInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'

type StateFilter = 'all' | 'open' | 'completed'
type PriorityFilter = 'all' | Priority
type SortKey = 'updated' | 'newest' | 'oldest' | 'priority'

const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

const HEADER_LABELS: Record<(typeof ALL_COLS)[number], string> = {
  assignee: 'Assignee',
  due: 'Due date',
  priority: 'Priority',
  status: 'Status',
  comments: 'Comments',
}

export default function AllTasksPage() {
  const { data, isLoading, error } = useAllTasks()
  useRestoreTaskListFocus(!isLoading && data.length > 0)
  const [q, setQ] = useState('')
  const [state, setState] = useState<StateFilter>('all')
  const [priority, setPriority] = useState<PriorityFilter>('all')
  const [sort, setSort] = useState<SortKey>('updated')

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = data.filter((task) => {
      if (state === 'open' && task.completed_at) return false
      if (state === 'completed' && !task.completed_at) return false
      if (priority !== 'all' && task.priority !== priority) return false
      if (query && !task.title.toLowerCase().includes(query)) return false
      return true
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'newest':
          return b.created_at.localeCompare(a.created_at)
        case 'oldest':
          return a.created_at.localeCompare(b.created_at)
        case 'priority':
          return (
            (a.priority ? PRIORITY_WEIGHT[a.priority] : 99) -
            (b.priority ? PRIORITY_WEIGHT[b.priority] : 99)
          )
        case 'updated':
        default:
          return b.updated_at.localeCompare(a.updated_at)
      }
    })
    return sorted
  }, [data, q, state, priority, sort])

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <HomePageHeader
        title="All Tasks"
        description="Every task across the projects you can access."
        action={<span className="text-sm text-fg-muted">{visible.length} tasks</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search tasks" className="max-w-xs flex-1" />
        <select
          className="input-dark !w-auto"
          value={state}
          onChange={(e) => setState(e.target.value as StateFilter)}
          aria-label="Filter by state"
        >
          <option value="all">State: All</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>
        <select
          className="input-dark !w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value as PriorityFilter)}
          aria-label="Filter by priority"
        >
          <option value="all">Priority: Any</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select
          className="input-dark !w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort tasks"
        >
          <option value="updated">Recently updated</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="priority">Priority</option>
        </select>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={q || state !== 'all' || priority !== 'all' ? 'No matching tasks' : 'No tasks yet'}
            description="Tasks from your projects will appear here."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-700">
            <div
              className="grid items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
              style={{ gridTemplateColumns: gridTemplate(ALL_COLS) }}
            >
              <span>Name</span>
              {ALL_COLS.map((col) => (
                <span key={col}>{HEADER_LABELS[col]}</span>
              ))}
            </div>
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} canEdit={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

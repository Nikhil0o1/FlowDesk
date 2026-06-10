import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../../lib/api'
import type { Page, Task } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { TaskRow } from '../../components/tasks/TaskTable'
import { EmptyState } from '../../components/ui/EmptyState'
import { CenteredSpinner } from '../../components/ui/Spinner'

type DueFilter = '' | 'today' | 'week' | 'overdue'

export default function ListPage() {
  const queryClient = useQueryClient()
  // URL-driven so the Planner sidebar links (Today / This week / Overdue / Created) work
  const [params, setParams] = useSearchParams()
  const relation = params.get('relation') === 'created' ? 'created' : 'assigned'
  const due = (['today', 'week', 'overdue'].includes(params.get('due') ?? '') ? params.get('due') : '') as DueFilter
  const [includeCompleted, setIncludeCompleted] = useState(false)

  const setRelation = (value: 'assigned' | 'created') => {
    if (value === 'created') params.set('relation', 'created')
    else params.delete('relation')
    setParams(params, { replace: true })
  }
  const setDue = (value: DueFilter) => {
    if (value) params.set('due', value)
    else params.delete('due')
    setParams(params, { replace: true })
  }

  const queryString = useMemo(() => {
    let s = `relation=${relation}&include_completed=${includeCompleted}&page_size=200`
    if (due) s += `&due=${due}`
    return s
  }, [relation, due, includeCompleted])

  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks', queryString],
    queryFn: () => api.get<Page<Task>>(`/me/tasks?${queryString}`),
  })

  useRealtime(['task.updated', 'task.created', 'task.assigned', 'task.deleted'], () => {
    void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
  })

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <h1 className="text-xl font-bold text-fg">My Tasks</h1>
      <p className="mt-0.5 text-sm text-fg-secondary">Everything on your plate across projects.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          <FilterTab active={relation === 'assigned'} onClick={() => setRelation('assigned')}>
            Assigned to me
          </FilterTab>
          <FilterTab active={relation === 'created'} onClick={() => setRelation('created')}>
            Created by me
          </FilterTab>
        </div>
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          <FilterTab active={due === ''} onClick={() => setDue('')}>
            All
          </FilterTab>
          <FilterTab active={due === 'today'} onClick={() => setDue('today')}>
            Due today
          </FilterTab>
          <FilterTab active={due === 'week'} onClick={() => setDue('week')}>
            This week
          </FilterTab>
          <FilterTab active={due === 'overdue'} onClick={() => setDue('overdue')} danger>
            Overdue
          </FilterTab>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-secondary">
          <input
            type="checkbox"
            className="accent-brand"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
          />
          Show completed
        </label>
      </div>

      <div className="mt-5">
        {isLoading ? (
          <CenteredSpinner />
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nothing here"
            description={relation === 'assigned' ? 'Tasks assigned to you will appear here.' : 'Tasks you created will appear here.'}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-700">
            <div className="grid grid-cols-[minmax(280px,1fr)_140px_110px_90px_120px_70px] items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted max-lg:grid-cols-[minmax(200px,1fr)_110px_90px]">
              <span>Name</span>
              <span>Assignee</span>
              <span className="max-lg:hidden">Due date</span>
              <span className="max-lg:hidden">Priority</span>
              <span>Status</span>
              <span className="max-lg:hidden">Comments</span>
            </div>
            {data!.items.map((task) => (
              <TaskRow key={task.id} task={task} canEdit />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterTab({
  active,
  onClick,
  danger,
  children,
}: {
  active: boolean
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? danger
            ? 'bg-red-500/15 text-red-400'
            : 'bg-brand-soft text-fg'
          : 'text-fg-secondary hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutList, List, Lock, Plus, SquareKanban } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FavoriteButton } from '../../../components/favorites/FavoriteButton'
import { TaskTable, type ColKey, type GroupBy } from '../../../components/tasks/TaskTable'
import { EmptyState } from '../../../components/ui/EmptyState'
import { CenteredSpinner } from '../../../components/ui/Spinner'
import { api } from '../../../lib/api'
import { invalidateMyTasks, usePersonalListProject } from '../../../lib/myTasksQueries'
import { useProjectTasks, useStatuses } from '../../../lib/queries'
import { useRealtime } from '../../../lib/ws'
import { favoriteViewTarget } from '../../../lib/favorites'
import { cn } from '../../../lib/utils'

type View = 'list' | 'board'

const COLS: ColKey[] = ['assignee', 'due', 'priority', 'status']

export default function PersonalListPage() {
  const queryClient = useQueryClient()
  const personal = usePersonalListProject()
  const projectId = personal.data?.id
  const statuses = useStatuses(projectId)
  const tasks = useProjectTasks(projectId)
  const lists = useQuery({
    queryKey: ['task-lists', projectId],
    queryFn: () => api.get<{ id: string; name: string }[]>(`/projects/${projectId}/lists`),
    enabled: !!projectId,
  })

  const [view, setView] = useState<View>('list')
  const [groupBy] = useState<GroupBy>('none')
  const [hideCompleted, setHideCompleted] = useState(false)

  useRealtime(['task.updated', 'task.created', 'task.deleted'], () => {
    invalidateMyTasks(queryClient)
    if (projectId) {
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
    }
  })

  const visibleTasks = useMemo(() => {
    const items = tasks.data?.items ?? []
    if (hideCompleted) return items.filter((t) => !t.completed_at)
    return items
  }, [tasks.data?.items, hideCompleted])

  if (personal.isLoading) return <CenteredSpinner />
  if (personal.isError || !personal.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-red-400">Could not load your personal list.</p>
        <button type="button" className="btn-secondary text-xs" onClick={() => void personal.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  const defaultListId = lists.data?.[0]?.id

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-6 py-3">
        <span className="text-sm text-fg-muted">My Tasks</span>
        <span className="text-fg-muted">/</span>
        <Lock size={14} className="text-fg-muted" />
        <span className="text-sm font-medium text-fg">Personal List</span>
        <FavoriteButton target={favoriteViewTarget('/app/my-tasks/personal', 'Personal List')} />
      </div>

      <div className="flex items-center gap-2 border-b border-ink-700 px-6 py-2">
        <ViewTab active={view === 'board'} onClick={() => setView('board')} icon={<SquareKanban size={14} />} label="Board" />
        <ViewTab active={view === 'list'} onClick={() => setView('list')} icon={<LayoutList size={14} />} label="List" />
        <span className="flex-1" />
        <button
          className={cn('btn-secondary !py-1.5 text-xs', hideCompleted && 'border-brand/40 bg-brand-soft')}
          onClick={() => setHideCompleted((v) => !v)}
        >
          Closed
        </button>
        <button
          className="btn-primary !py-1.5 text-xs"
          disabled={!defaultListId}
          onClick={async () => {
            if (!projectId || !defaultListId) return
            const statusId = statuses.data?.[0]?.id
            await api.post(`/projects/${projectId}/tasks`, {
              title: 'New task',
              list_id: defaultListId,
              status_id: statusId,
            })
            void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
            invalidateMyTasks(queryClient)
          }}
        >
          <Plus size={14} className="mr-1 inline" />
          Add Task
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.isLoading ? (
          <CenteredSpinner />
        ) : visibleTasks.length === 0 ? (
          <EmptyState
            icon={List}
            title="Personal list is empty"
            description="This is your private space for tasks — only you can see them."
            action={
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={!defaultListId}
                onClick={async () => {
                  if (!projectId || !defaultListId) return
                  const statusId = statuses.data?.[0]?.id
                  await api.post(`/projects/${projectId}/tasks`, {
                    title: 'New task',
                    list_id: defaultListId,
                    status_id: statusId,
                  })
                  void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
                  invalidateMyTasks(queryClient)
                }}
              >
                <Plus size={14} className="mr-1 inline" />
                Create a task
              </button>
            }
          />
        ) : view === 'list' && projectId && statuses.data ? (
          <TaskTable
            projectId={projectId}
            tasks={visibleTasks}
            statuses={statuses.data}
            canEdit
            groupBy={groupBy}
            cols={COLS}
          />
        ) : (
          <TaskTable
            projectId={projectId!}
            tasks={visibleTasks}
            statuses={statuses.data ?? []}
            canEdit
            groupBy="status"
            cols={COLS}
          />
        )}
      </div>
    </div>
  )
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-850 hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

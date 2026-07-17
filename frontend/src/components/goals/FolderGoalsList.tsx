import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Goal } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { GoalGridCard } from './GoalCards'
import { GoalProgressRing, goalProgressPercent } from './GoalProgressRing'
import { MoveGoalToFolderModal } from './MoveGoalToFolderModal'
import { OwnerAvatarStack } from './OwnerAvatarStack'

type SortKey = 'custom' | 'updated' | 'name' | 'progress'
type ViewMode = 'grid' | 'list'
type StatusFilter = 'all' | 'active' | 'completed' | 'draft' | 'archived'

interface FolderGoalsListProps {
  goals: Goal[]
  workspaceId: string
  canManage: boolean
  onOpenGoal: (goalId: string) => void
  onGoalsChanged?: () => void
}

export function FolderGoalsList({
  goals,
  workspaceId,
  canManage,
  onOpenGoal,
  onGoalsChanged,
}: FolderGoalsListProps) {
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = useState<SortKey>('custom')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [hideArchived, setHideArchived] = useState(true)
  const [view, setView] = useState<ViewMode>('grid')
  const [moving, setMoving] = useState<Goal | null>(null)
  const [search, setSearch] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const folderId = goals[0]?.folder_id ?? null

  const sorted = useMemo(() => {
    let list = [...goals]
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description ?? '').toLowerCase().includes(q) ||
          (g.owners ?? []).some(
            (o) =>
              (o.full_name || '').toLowerCase().includes(q) ||
              (o.email || '').toLowerCase().includes(q),
          ) ||
          (g.owner?.full_name || '').toLowerCase().includes(q) ||
          (g.owner?.email || '').toLowerCase().includes(q),
      )
    }
    if (statusFilter !== 'all') {
      list = list.filter((g) => g.status === statusFilter)
    } else if (hideArchived) {
      list = list.filter((g) => g.status !== 'archived')
    }
    list.sort((a, b) => {
      if (sortBy === 'custom') {
        const ao = a.display_order ?? 0
        const bo = b.display_order ?? 0
        if (ao !== bo) return ao - bo
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'progress') {
        return goalProgressPercent(b.progress) - goalProgressPercent(a.progress)
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
    return list
  }, [goals, hideArchived, search, sortBy, statusFilter])

  const counts = useMemo(() => {
    return {
      all: goals.length,
      active: goals.filter((g) => g.status === 'active').length,
      completed: goals.filter((g) => g.status === 'completed').length,
      draft: goals.filter((g) => g.status === 'draft').length,
      archived: goals.filter((g) => g.status === 'archived').length,
    }
  }, [goals])

  const reorderGoals = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.post(`/workspaces/${workspaceId}/goals/reorder`, {
        goal_ids: orderedIds,
        folder_id: folderId,
      }),
    onSuccess: () => {
      onGoalsChanged?.()
      void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
      void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const handleGoalDrop = (targetId: string) => {
    if (!dragId || dragId === targetId || !folderId) {
      setDragId(null)
      setOverId(null)
      return
    }
    const ids = sorted.map((g) => g.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) {
      setDragId(null)
      setOverId(null)
      return
    }
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    setSortBy('custom')
    reorderGoals.mutate(next)
    setDragId(null)
    setOverId(null)
  }

  const showOverlay = sorted.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-fg">
          Goals
          <span className="ml-1.5 font-normal text-fg-muted">({sorted.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search goals…"
              className="input h-7 w-36 !py-0.5 pl-7 text-xs sm:w-44"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            Status
            <select
              className="input h-7 !py-0.5 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All ({counts.all})</option>
              <option value="active">Active ({counts.active})</option>
              <option value="completed">Completed ({counts.completed})</option>
              <option value="draft">Draft ({counts.draft})</option>
              <option value="archived">Archived ({counts.archived})</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            Sort
            <select
              className="input h-7 !py-0.5 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="custom">Custom</option>
              <option value="updated">Updated</option>
              <option value="name">Name</option>
              <option value="progress">Progress</option>
            </select>
          </label>
          {statusFilter === 'all' && (
            <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <input
                type="checkbox"
                className="accent-brand"
                checked={hideArchived}
                onChange={(e) => setHideArchived(e.target.checked)}
              />
              Hide archived
            </label>
          )}
          <div className="inline-flex rounded-md border border-ink-700 p-0.5">
            <button
              type="button"
              title="Grid"
              className={cn('rounded p-1', view === 'grid' ? 'bg-ink-750 text-fg' : 'text-fg-muted')}
              onClick={() => setView('grid')}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              title="List"
              className={cn('rounded p-1', view === 'list' ? 'bg-ink-750 text-fg' : 'text-fg-muted')}
              onClick={() => setView('list')}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-muted">
          {search.trim() ? 'No goals match your search.' : 'No goals match these filters.'}
        </p>
      ) : (
        <div className={cn('relative min-h-0 flex-1', showOverlay && 'pt-1')}>
          <div
            className={cn(
              showOverlay
                ? 'h-full max-h-full overflow-y-auto rounded-xl border border-ink-700/90 bg-ink-900/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[2px]'
                : 'p-0.5',
            )}
          >
            {view === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sorted.map((goal) => (
                  <GoalGridCard
                    key={goal.id}
                    goal={goal}
                    workspaceId={workspaceId}
                    canManage={canManage}
                    compact
                    onOpen={() => onOpenGoal(goal.id)}
                    onChanged={onGoalsChanged}
                    draggable={canManage}
                    dragging={dragId === goal.id}
                    dropTarget={overId === goal.id && dragId !== null && dragId !== goal.id}
                    onDragStart={() => {
                      setSortBy('custom')
                      setDragId(goal.id)
                    }}
                    onDragEnter={() => setOverId(goal.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleGoalDrop(goal.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverId(null)
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-ink-700">
                {sorted.map((goal) => (
                  <GoalListRow
                    key={goal.id}
                    goal={goal}
                    canManage={canManage}
                    onOpen={() => onOpenGoal(goal.id)}
                    onMove={() => setMoving(goal)}
                  />
                ))}
              </div>
            )}
          </div>
          {showOverlay && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-xl bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent"
              aria-hidden
            />
          )}
        </div>
      )}

      <MoveGoalToFolderModal
        open={!!moving}
        onClose={() => setMoving(null)}
        goal={moving}
        workspaceId={workspaceId}
        onMoved={() => onGoalsChanged?.()}
      />
    </div>
  )
}

function GoalListRow({
  goal,
  canManage,
  onOpen,
  onMove,
}: {
  goal: Goal
  canManage: boolean
  onOpen: () => void
  onMove: () => void
}) {
  const pct = goalProgressPercent(goal.progress)
  return (
    <div className="flex items-center gap-2 border-b border-ink-750 px-2.5 py-2 last:border-b-0 hover:bg-ink-850/80">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <GoalProgressRing progress={pct} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{goal.name}</span>
            <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">
              {goal.status}
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            {goal.target_count} {goal.target_count === 1 ? 'target' : 'targets'} · {pct}% ·{' '}
            {timeAgo(goal.updated_at)}
          </p>
        </div>
        <OwnerAvatarStack
          owners={
            goal.owners && goal.owners.length > 0
              ? goal.owners
              : goal.owner
                ? [goal.owner]
                : []
          }
          size={24}
        />
      </button>
      {canManage && (
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={onMove}>
          Move
        </button>
      )}
    </div>
  )
}

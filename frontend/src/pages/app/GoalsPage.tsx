import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowUpDown, Check, Folder, Plus, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CreateFolderCard, FolderCard } from '../../components/goals/FolderCards'
import { CreateGoalModal } from '../../components/goals/CreateGoalModal'
import { FolderDetailView } from '../../components/goals/FolderDetailView'
import { FolderFormModal } from '../../components/goals/FolderFormModal'
import { GoalGridCard } from '../../components/goals/GoalCards'
import { GoalDetailView } from '../../components/goals/GoalDetailView'
import { goalProgressPercent } from '../../components/goals/GoalProgressRing'
import { EmptyState } from '../../components/ui/EmptyState'
import { Dropdown } from '../../components/ui/Dropdown'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { api, errorMessage } from '../../lib/api'
import { canAccessGoalsSection, canCreateGoal, canAccessGoals } from '../../lib/createAccess'
import {
  useCurrentContext,
  useGoalFolders,
  useGoals,
  useGoalsAccess,
  useGoalOwnerCandidates,
  useUserRoles,
  useWorkspaceMembers,
} from '../../lib/queries'
import { useQueryFlagModal } from '../../lib/useQueryFlagModal'
import { useRealtime } from '../../lib/ws'
import type { Goal, GoalFolder } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'

type SortKey = 'custom' | 'updated' | 'name' | 'due_date' | 'start_date' | 'progress'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'custom', label: 'Custom' },
  { key: 'updated', label: 'Updated' },
  { key: 'name', label: 'Name' },
  { key: 'due_date', label: 'Due date' },
  { key: 'start_date', label: 'Start Date' },
  { key: 'progress', label: 'Progress' },
]

function dateSortValue(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

function sortGoals(list: Goal[], sortBy: SortKey): Goal[] {
  const next = [...list]
  next.sort((a, b) => {
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
    if (sortBy === 'due_date') {
      const diff = dateSortValue(a.due_date) - dateSortValue(b.due_date)
      if (diff !== 0) return diff
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
    if (sortBy === 'start_date') {
      const diff = dateSortValue(a.start_date) - dateSortValue(b.start_date)
      if (diff !== 0) return diff
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
  return next
}

export default function GoalsPage() {
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const [showFolders, setShowFolders] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('custom')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [overFolderId, setOverFolderId] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const goalsAccessQuery = useGoalsAccess(workspace?.id)
  const sectionAccess = canAccessGoalsSection(org, workspace, userRoles, workspace?.id)
  const canViewGoals = canAccessGoals(sectionAccess, goalsAccessQuery.data)
  const sharedOnly = canViewGoals && !sectionAccess
  const folders = useGoalFolders(workspace?.id, showArchived, canViewGoals)
  const goals = useGoals(workspace?.id, canViewGoals)
  const goalOwnerCandidates = useGoalOwnerCandidates(workspace?.id)
  const { isOpen: createGoalOpen, open: openCreateGoal, close: closeCreateGoal } = useQueryFlagModal()
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [editFolder, setEditFolder] = useState<GoalFolder | null>(null)

  const selectedGoalId = params.get('goal')
  const selectedFolderId = params.get('folder')

  useRealtime('goal.updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-progress'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder-analytics'] })
    void queryClient.invalidateQueries({ queryKey: ['goals-access', workspace?.id] })
  })

  const canCreate = canCreateGoal(org, workspace, userRoles, workspace?.id)

  const folderList = useMemo(() => {
    const list = [...(folders.data ?? [])]
    list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    return list
  }, [folders.data])

  const rootGoals = useMemo(() => {
    let list = (goals.data ?? []).filter((g) => !g.folder_id)
    if (!showArchived) list = list.filter((g) => g.status !== 'archived')
    return sortGoals(list, sortBy)
  }, [goals.data, showArchived, sortBy])

  const clearDrag = () => {
    setDragId(null)
    setOverId(null)
    setOverFolderId(null)
  }

  const reorderGoals = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.post(`/workspaces/${workspace!.id}/goals/reorder`, {
        goal_ids: orderedIds,
        folder_id: null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const moveGoalToFolder = useMutation({
    mutationFn: ({ goalId, folderId }: { goalId: string; folderId: string }) =>
      api.post<Goal>(`/goals/${goalId}/move`, { folder_id: folderId }),
    onSuccess: (_updated, { folderId }) => {
      void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
      void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspace?.id] })
      void queryClient.invalidateQueries({ queryKey: ['goal-folder', folderId] })
      void queryClient.invalidateQueries({ queryKey: ['folder-goals', folderId] })
      void queryClient.invalidateQueries({ queryKey: ['goal-folder-analytics', folderId] })
      const folderName = folders.data?.find((f) => f.id === folderId)?.name ?? 'folder'
      toast.success(`Moved to ${folderName}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const handleGoalDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      clearDrag()
      return
    }
    const ids = rootGoals.map((g) => g.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) {
      clearDrag()
      return
    }
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    setSortBy('custom')
    void queryClient.setQueryData<Goal[]>(['goals', workspace?.id], (prev) => {
      if (!prev) return prev
      return prev.map((g) => {
        const idx = next.indexOf(g.id)
        return idx === -1 ? g : { ...g, display_order: idx }
      })
    })
    reorderGoals.mutate(next)
    clearDrag()
  }

  const handleFolderDrop = (folderId: string) => {
    if (!dragId || !canCreate) {
      clearDrag()
      return
    }
    const folder = folderList.find((f) => f.id === folderId)
    if (!folder || folder.is_archived) {
      clearDrag()
      return
    }
    // Optimistic: remove from root list immediately
    void queryClient.setQueryData<Goal[]>(['goals', workspace?.id], (prev) => {
      if (!prev) return prev
      return prev.map((g) => (g.id === dragId ? { ...g, folder_id: folderId } : g))
    })
    moveGoalToFolder.mutate({ goalId: dragId, folderId })
    clearDrag()
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortBy)?.label ?? 'Custom'

  const openFolder = (folderId: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('folder', folderId)
      next.delete('goal')
      next.delete('new')
      return next
    })
  }

  const closeFolder = () => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('folder')
      return next
    })
  }

  const openGoal = (goalId: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('goal', goalId)
      next.delete('new')
      return next
    })
  }

  const closeGoal = () => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('goal')
      return next
    })
  }

  const invalidateFolders = () => {
    void queryClient.invalidateQueries({ queryKey: ['goal-folders'] })
  }

  if (selectedGoalId) {
    return <GoalDetailView goalId={selectedGoalId} onBack={closeGoal} />
  }

  if (selectedFolderId) {
    return (
      <FolderDetailView folderId={selectedFolderId} onBack={closeFolder} onOpenGoal={openGoal} />
    )
  }

  if (
    goalsAccessQuery.isLoading ||
    (canViewGoals && (folders.isLoading || goals.isLoading))
  ) {
    return <CenteredSpinner />
  }

  if (!canViewGoals) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={Trophy}
          title="No goals shared with you"
          description="When someone shares a goal or folder with you, it will appear here."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-950">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Goals</h1>
          {sharedOnly && (
            <p className="mt-0.5 text-xs text-fg-muted">Shared with you</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            align="right"
            width="w-44"
            trigger={
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800 px-2.5 text-sm font-medium text-fg shadow-sm hover:bg-ink-850"
              >
                <ArrowUpDown size={14} className="text-fg-muted" />
                Sort by: {sortLabel}
              </button>
            }
          >
            {(close) => (
              <div className="py-1">
                <p className="px-3 py-1.5 text-xs text-fg-muted">Sort by</p>
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-fg hover:bg-ink-750"
                    onClick={() => {
                      setSortBy(opt.key)
                      close()
                    }}
                  >
                    <span>{opt.label}</span>
                    {sortBy === opt.key && <Check size={14} className="text-fg-muted" strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            )}
          </Dropdown>

          <ToolbarToggle
            active={showFolders}
            icon={<Folder size={15} />}
            label={`Folders: ${showFolders ? 'Hide' : 'Show'}`}
            onClick={() => setShowFolders((v) => !v)}
          />
          <ToolbarToggle
            active={!showArchived}
            icon={<Archive size={15} />}
            label={`Archived: ${showArchived ? 'Hide' : 'Show'}`}
            onClick={() => setShowArchived((v) => !v)}
          />

          {canCreate && (
            <button
              type="button"
              className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-sm font-semibold uppercase tracking-wide"
              onClick={openCreateGoal}
            >
              <Plus size={15} strokeWidth={2.5} />
              New Goal
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {showFolders && (
          <section className="mb-8">
            <div className="flex flex-wrap gap-3">
              {folderList.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onOpen={() => openFolder(folder.id)}
                  onEdit={canCreate ? () => setEditFolder(folder) : undefined}
                  dropTarget={
                    !!dragId && overFolderId === folder.id && !folder.is_archived
                  }
                  onDragEnter={() => {
                    if (dragId && !folder.is_archived) {
                      setOverFolderId(folder.id)
                      setOverId(null)
                    }
                  }}
                  onDragOver={(e) => {
                    if (dragId && !folder.is_archived) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleFolderDrop(folder.id)
                  }}
                />
              ))}
              {canCreate && <CreateFolderCard onClick={() => setCreateFolderOpen(true)} />}
            </div>
          </section>
        )}

        <section>
          {rootGoals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 py-16 text-center">
              <Trophy size={28} className="mx-auto mb-3 text-fg-muted" />
              <p className="text-sm text-fg-muted">
                {canCreate ? 'No goals yet. Create one to start tracking progress.' : 'No goals to show.'}
              </p>
              {canCreate && (
                <button
                  type="button"
                  className="btn-primary mt-4 inline-flex items-center gap-2"
                  onClick={openCreateGoal}
                >
                  <Plus size={16} />
                  New Goal
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
              {rootGoals.map((goal) => (
                <GoalGridCard
                  key={goal.id}
                  goal={goal}
                  workspaceId={workspace!.id}
                  canManage={canCreate}
                  onOpen={() => openGoal(goal.id)}
                  draggable={canCreate}
                  dragging={dragId === goal.id}
                  dropTarget={overId === goal.id && dragId !== null && dragId !== goal.id}
                  onDragStart={() => {
                    setSortBy('custom')
                    setDragId(goal.id)
                    setOverFolderId(null)
                  }}
                  onDragEnter={() => {
                    setOverId(goal.id)
                    setOverFolderId(null)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleGoalDrop(goal.id)}
                  onDragEnd={clearDrag}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {workspace?.id && (
        <>
          <CreateGoalModal
            open={createGoalOpen}
            onClose={closeCreateGoal}
            workspaceId={workspace.id}
            members={goalOwnerCandidates.data ?? []}
            onCreated={(goalId) => {
              closeCreateGoal()
              openGoal(goalId)
            }}
          />
          <FolderFormModal
            open={createFolderOpen}
            onClose={() => setCreateFolderOpen(false)}
            workspaceId={workspace.id}
            onSaved={(folder) => {
              invalidateFolders()
              openFolder(folder.id)
            }}
          />
          <FolderFormModal
            open={!!editFolder}
            onClose={() => setEditFolder(null)}
            workspaceId={workspace.id}
            folder={editFolder}
            onSaved={() => {
              invalidateFolders()
              setEditFolder(null)
            }}
          />
        </>
      )}
    </div>
  )
}

function ToolbarToggle({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors',
        active
          ? 'border-ink-700 bg-ink-800 text-fg-secondary shadow-sm hover:bg-ink-850 hover:text-fg'
          : 'border-ink-600 bg-ink-850 text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

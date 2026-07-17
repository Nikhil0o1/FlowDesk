import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Check,
  ChevronRight,
  Droplet,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Trophy,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { canManageGoal } from '../../lib/createAccess'
import {
  useCurrentContext,
  useGoal,
  useGoalActivity,
  useGoalFolders,
  useGoalProgress,
  useTargetTasks,
  useUserRoles,
  useGoalOwnerCandidates,
  useWorkspaceMembers,
} from '../../lib/queries'
import type { Activity, GoalTarget } from '../../lib/types'
import { cn, formatDate, timeAgo } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'
import { CreateTargetModal } from './CreateTargetModal'
import { GOAL_COLORS } from './GoalCards'
import { GoalProgressRing, goalProgressPercent } from './GoalProgressRing'
import { UnlinkTaskButton } from './LinkTasksModal'
import { AddToTargetModal } from './AddToTargetModal'
import { MoveGoalToFolderModal } from './MoveGoalToFolderModal'
import { OwnerAvatarStack } from './OwnerAvatarStack'
import { ShareGoalModal } from './ShareGoalModal'

const DEFAULT_GOAL_HEADER = '#3b82f6'

function targetSummary(target: GoalTarget): string {
  if (target.target_type === 'tasks') {
    const n = target.linked_task_count || 0
    return `${n} task${n === 1 ? '' : 's'}`
  }
  if (target.target_type === 'true_false') {
    return target.is_completed ? 'Done' : 'Not done'
  }
  return `${target.current_value ?? target.start_value ?? 0} / ${target.target_value ?? 1}`
}

function timelineWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return formatDate(iso)
}

function activityCopy(item: Activity): { subject: string; badge: string; text: string } {
  const data = item.data ?? {}
  const subject =
    (typeof data.target_title === 'string' && data.target_title) ||
    (typeof data.name === 'string' && data.name) ||
    'Goal'
  switch (item.action) {
    case 'goal.target_created':
      return { subject, badge: 'NOTE', text: 'Created Key Result' }
    case 'goal.created':
      return { subject, badge: 'NOTE', text: 'Created Goal' }
    case 'goal.archived':
      return { subject, badge: 'NOTE', text: 'Archived Goal' }
    case 'goal.unarchived':
      return { subject, badge: 'NOTE', text: 'Restored Goal' }
    case 'goal.moved':
      return { subject, badge: 'NOTE', text: 'Moved Goal' }
    case 'goal.tasks_linked':
      return { subject, badge: 'NOTE', text: 'Linked tasks' }
    case 'goal.task_unlinked':
      return { subject, badge: 'NOTE', text: 'Unlinked task' }
    case 'goal.sprint_linked':
      return { subject, badge: 'NOTE', text: 'Linked list' }
    case 'goal.sprint_unlinked':
      return { subject, badge: 'NOTE', text: 'Unlinked list' }
    case 'goal.member_added':
      return { subject, badge: 'NOTE', text: 'Shared goal' }
    case 'goal.member_removed':
      return { subject, badge: 'NOTE', text: 'Removed access' }
    case 'goal.updated':
      return { subject, badge: 'NOTE', text: 'Updated Goal' }
    default:
      return { subject, badge: 'NOTE', text: item.action.replace(/^goal\./, '').replace(/_/g, ' ') }
  }
}

function TargetRow({
  target,
  goalId,
  workspaceId,
  canManage,
  onAddTask,
}: {
  target: GoalTarget
  goalId: string
  workspaceId: string
  canManage: boolean
  onAddTask: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(target.title)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [currentDraft, setCurrentDraft] = useState(Number(target.current_value ?? 0))
  const queryClient = useQueryClient()
  const tasks = useTargetTasks(expanded && target.target_type === 'tasks' ? target.id : undefined)

  useEffect(() => {
    setTitleDraft(target.title)
    setCurrentDraft(Number(target.current_value ?? 0))
  }, [target.title, target.current_value])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goal', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-progress', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-target-tasks', target.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    void queryClient.invalidateQueries({ queryKey: ['folder-goals'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-activity', goalId] })
  }

  const updateTarget = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/targets/${target.id}`, body),
    onSuccess: () => {
      invalidate()
      toast.success('Target updated')
      setRenaming(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteTarget = useMutation({
    mutationFn: () => api.delete(`/targets/${target.id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Target deleted')
      setDeleteOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const saveRename = () => {
    const next = titleDraft.trim()
    if (!next) {
      toast.error('Target name is required')
      return
    }
    if (next === target.title) {
      setRenaming(false)
      return
    }
    updateTarget.mutate({ title: next })
  }

  const owners =
    target.owners && target.owners.length > 0
      ? target.owners
      : target.owner
        ? [target.owner]
        : []
  const pct = goalProgressPercent(target.progress)
  const total =
    target.target_type === 'tasks'
      ? target.linked_task_count || 0
      : target.target_type === 'true_false'
        ? 1
        : Math.max(1, Number(target.target_value ?? 1))
  const done =
    target.target_type === 'tasks'
      ? Math.round((pct / 100) * total)
      : target.target_type === 'true_false'
        ? target.is_completed
          ? 1
          : 0
        : Math.round((pct / 100) * total)
  const barLabel =
    target.target_type === 'tasks'
      ? `tasks ${done}/${total}`
      : target.target_type === 'true_false'
        ? target.is_completed
          ? 'done'
          : 'not done'
        : `${done}/${total}`

  return (
    <>
      <div className="border-b border-ink-750 last:border-b-0">
        <div className="flex items-center gap-3 py-3">
          <OwnerAvatarStack owners={owners} size={32} />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="w-full max-w-sm border-0 border-b border-fg bg-transparent px-0 py-0.5 text-sm font-medium text-fg outline-none focus:border-brand"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') {
                      setTitleDraft(target.title)
                      setRenaming(false)
                    }
                  }}
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-ink-700 px-2 py-1 text-xs font-semibold text-fg hover:bg-ink-600 disabled:opacity-50"
                  disabled={updateTarget.isPending}
                  onClick={saveRename}
                >
                  OK
                  <Check size={12} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className="btn-ghost !p-1"
                  onClick={() => {
                    setTitleDraft(target.title)
                    setRenaming(false)
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-semibold text-fg">{target.title}</span>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-brand hover:underline"
                  onClick={() => {
                    if (target.target_type === 'tasks') setExpanded((v) => !v)
                  }}
                >
                  {targetSummary(target)}
                </button>
                {canManage && (
                  <Dropdown
                    align="left"
                    width="w-44"
                    trigger={
                      <button type="button" className="rounded p-0.5 text-fg-muted hover:bg-ink-800 hover:text-fg" title="Target options">
                        <MoreHorizontal size={14} />
                      </button>
                    }
                  >
                    {(close) => (
                      <div className="py-1">
                        {target.target_type === 'tasks' && (
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              close()
                              onAddTask()
                            }}
                          >
                            <Plus size={14} />
                            Add task
                          </button>
                        )}
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            close()
                            setTitleDraft(target.title)
                            setRenaming(true)
                          }}
                        >
                          <Pencil size={14} />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="menu-item text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => {
                            close()
                            setDeleteOpen(true)
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </Dropdown>
                )}
              </div>
            )}
            <p className="mt-0.5 text-[11px] text-fg-muted">{timeAgo(target.updated_at)}</p>
          </div>

          <div className="w-[120px] shrink-0 text-right">
            <p className="mb-1 text-[11px] font-medium text-fg-muted">{barLabel}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {expanded && target.target_type === 'tasks' && (
          <div className="mb-2 ml-9 space-y-1 pb-1">
            {tasks.isLoading ? (
              <p className="text-xs text-fg-muted">Loading tasks…</p>
            ) : (tasks.data ?? []).length === 0 ? (
              <p className="text-xs text-fg-muted">No tasks linked yet</p>
            ) : (
              (tasks.data ?? []).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-ink-850/80 px-2 py-1.5 text-sm"
                >
                  <Link to={`/app/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:text-brand">
                    <span className="text-fg-muted">{task.ref}</span> {task.title}
                  </Link>
                  {canManage && (
                    <UnlinkTaskButton
                      targetId={target.id}
                      taskId={task.id}
                      goalId={goalId}
                      workspaceId={workspaceId}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {(target.target_type === 'number' || target.target_type === 'currency') && canManage && (
          <div className="mb-2 ml-9 flex flex-wrap items-center gap-2 pb-1 text-xs">
            <span className="text-fg-muted">
              {target.start_value ?? 0} → {target.target_value ?? 1}
            </span>
            <input
              type="number"
              className="input !w-20 !py-0.5 !text-xs"
              value={currentDraft}
              onChange={(e) => setCurrentDraft(Number(e.target.value))}
            />
            <button
              type="button"
              className="btn-ghost !px-2 !py-0.5 text-xs"
              disabled={updateTarget.isPending}
              onClick={() => updateTarget.mutate({ current_value: currentDraft })}
            >
              Update
            </button>
          </div>
        )}

        {target.target_type === 'true_false' && canManage && (
          <label className="mb-2 ml-9 inline-flex items-center gap-2 pb-1 text-xs text-fg-secondary">
            <input
              type="checkbox"
              className="accent-brand"
              checked={target.is_completed}
              disabled={updateTarget.isPending}
              onChange={(e) => updateTarget.mutate({ is_completed: e.target.checked })}
            />
            Mark as done
          </label>
        )}
      </div>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete target">
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Delete <span className="font-semibold text-fg">{target.title}</span>? Linked tasks are unlinked, not
            deleted.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              disabled={deleteTarget.isPending}
              onClick={() => deleteTarget.mutate()}
            >
              {deleteTarget.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

interface GoalDetailViewProps {
  goalId: string
  onBack: () => void
}

export function GoalDetailView({ goalId, onBack }: GoalDetailViewProps) {
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const members = useWorkspaceMembers(workspace?.id)
  const goalOwnerCandidates = useGoalOwnerCandidates(workspace?.id)
  const userId = useAuthStore((s) => s.user?.id)
  const goal = useGoal(goalId)
  const progress = useGoalProgress(goalId)
  const activity = useGoalActivity(goalId)
  const queryClient = useQueryClient()
  const [addTargetOpen, setAddTargetOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescOpen, setEditDescOpen] = useState(false)
  const [editDescription, setEditDescription] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null)

  const folders = useGoalFolders(workspace?.id)

  const canManage =
    !!goal.data && canManageGoal(goal.data, userId, org, workspace, userRoles)

  const invalidateGoal = () => {
    void queryClient.invalidateQueries({ queryKey: ['goal', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-progress', goalId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-activity', goalId] })
  }

  const patchGoal = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/goals/${goalId}`, body),
    onSuccess: () => {
      invalidateGoal()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const renameGoal = useMutation({
    mutationFn: (name: string) => api.patch(`/goals/${goalId}`, { name }),
    onSuccess: () => {
      invalidateGoal()
      toast.success('Goal renamed')
      setEditingName(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const updateDescription = useMutation({
    mutationFn: (description: string | null) => api.patch(`/goals/${goalId}`, { description }),
    onSuccess: () => {
      invalidateGoal()
      toast.success('Description updated')
      setEditDescOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteGoal = useMutation({
    mutationFn: () => api.delete(`/goals/${goalId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
      void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspace?.id] })
      toast.success('Goal deleted')
      setDeleteOpen(false)
      onBack()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const startRename = () => {
    if (!goal.data) return
    setEditName(goal.data.name)
    setEditingName(true)
  }

  const saveRename = () => {
    const next = editName.trim()
    if (!next) {
      toast.error('Goal name is required')
      return
    }
    if (next === goal.data?.name) {
      setEditingName(false)
      return
    }
    renameGoal.mutate(next)
  }

  if (goal.isLoading) return <CenteredSpinner />
  if (!goal.data) {
    return (
      <div className="p-8 text-center text-fg-muted">
        Goal not found
        <button type="button" className="btn-ghost mt-4" onClick={onBack}>
          Back to goals
        </button>
      </div>
    )
  }

  const g = goal.data
  const pct = goalProgressPercent(progress.data?.progress ?? g.progress)
  const folderName = folders.data?.find((f) => f.id === g.folder_id)?.name
  const headerColor = g.color || DEFAULT_GOAL_HEADER
  const activityItems = activity.data ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-950">
      <div className="shrink-0 px-6 pb-10 pt-5 text-white" style={{ backgroundColor: headerColor }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-white/85 hover:text-white"
            onClick={onBack}
          >
            <Trophy size={14} />
            All Goals
            <ChevronRight size={14} className="opacity-70" />
          </button>
          <div className="flex flex-wrap items-center gap-3">
            {(g.due_date || g.start_date) && (
              <span className="text-sm text-white/90">{formatDate(g.due_date || g.start_date)}</span>
            )}
            {canManage && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/45 px-2.5 py-1.5 text-sm text-white hover:bg-white/10"
                onClick={() => setShareOpen(true)}
              >
                <Share2 size={15} />
                Sharing & Permissions
              </button>
            )}
            {(g.created_by_user || g.owner) && (
              <div className="inline-flex items-center" title="Created by">
                <Avatar
                  name={
                    (g.created_by_user || g.owner)?.full_name ||
                    (g.created_by_user || g.owner)?.email ||
                    '?'
                  }
                  src={(g.created_by_user || g.owner)?.avatar_url}
                  color={(g.created_by_user || g.owner)?.avatar_color}
                  size={28}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <GoalProgressRing progress={pct} size={88} strokeWidth={7} tone="onColor" />
          <div className="min-w-0 flex-1">
            {(g.is_private || folderName || g.status === 'archived') && (
              <div className="mb-1 flex flex-wrap items-center gap-2 text-white/75">
                {g.status === 'archived' && (
                  <span className="text-xs font-medium uppercase tracking-wide">Archived</span>
                )}
                {g.is_private && (
                  <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Private
                  </span>
                )}
                {folderName && (
                  <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {folderName}
                  </span>
                )}
              </div>
            )}

            {editingName ? (
              <div className="max-w-xl">
                <input
                  autoFocus
                  className="w-full border-0 border-b border-white bg-transparent px-0 py-1 text-xl font-bold text-white outline-none placeholder:text-white/50 focus:border-white"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/30 disabled:opacity-50"
                    disabled={!editName.trim() || renameGoal.isPending}
                    onClick={saveRename}
                  >
                    OK
                    <Check size={14} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-white/80 hover:bg-white/10"
                    onClick={() => setEditingName(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h1 className="text-2xl font-bold text-white">{g.name}</h1>
                {canManage && (
                  <Dropdown
                    align="left"
                    width="w-48"
                    trigger={
                      <button
                        type="button"
                        className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
                        title="Goal options"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    }
                  >
                    {(close) => (
                      <div className="py-1">
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            close()
                            startRename()
                          }}
                        >
                          <Pencil size={14} />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            close()
                            setColorOpen(true)
                          }}
                        >
                          <Droplet size={14} />
                          Change color
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            close()
                            setFolderOpen(true)
                          }}
                        >
                          <FolderInput size={14} />
                          Move to Folder
                        </button>
                        {g.status !== 'archived' ? (
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              close()
                              patchGoal.mutate(
                                { status: 'archived' },
                                { onSuccess: () => toast.success('Goal archived') },
                              )
                            }}
                          >
                            <Archive size={14} />
                            Archive
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              close()
                              patchGoal.mutate(
                                { status: 'active' },
                                { onSuccess: () => toast.success('Goal restored') },
                              )
                            }}
                          >
                            <Archive size={14} />
                            Unarchive
                          </button>
                        )}
                        <button
                          type="button"
                          className="menu-item text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => {
                            close()
                            setDeleteOpen(true)
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </Dropdown>
                )}
              </div>
            )}

            {g.description ? (
              <button
                type="button"
                className={cn(
                  'mt-3 max-w-2xl rounded-md bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm',
                  canManage && 'hover:bg-white/95',
                )}
                disabled={!canManage}
                onClick={() => {
                  if (!canManage) return
                  setEditDescription(g.description ?? '')
                  setEditDescOpen(true)
                }}
              >
                {g.description}
              </button>
            ) : (
              canManage && (
                <button
                  type="button"
                  className="mt-3 rounded-md bg-white/20 px-3 py-2 text-sm text-white/90 hover:bg-white/25"
                  onClick={() => {
                    setEditDescription('')
                    setEditDescOpen(true)
                  }}
                >
                  + Add description
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div className="-mt-6 flex-1 overflow-y-auto px-6 pb-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <section className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-3 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Targets</h2>
              {canManage && (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-xs font-medium text-fg hover:bg-ink-750"
                  onClick={() => setAddTargetOpen(true)}
                >
                  <Plus size={12} strokeWidth={2.5} />
                  Add
                </button>
              )}
            </div>
            {g.targets.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-muted">
                No targets yet.
                {canManage && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="text-brand hover:underline"
                      onClick={() => setAddTargetOpen(true)}
                    >
                      Add a target
                    </button>
                  </>
                )}
              </p>
            ) : (
              <div>
                {g.targets.map((target) => (
                  <TargetRow
                    key={target.id}
                    target={target}
                    goalId={goalId}
                    workspaceId={g.workspace_id}
                    canManage={canManage}
                    onAddTask={() => setLinkTargetId(target.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-fg">Timeline</h2>
            {activity.isLoading ? (
              <p className="py-4 text-center text-sm text-fg-muted">Loading timeline…</p>
            ) : activityItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-muted">No activity yet</p>
            ) : (
              <ul className="divide-y divide-ink-750">
                {activityItems.map((item) => {
                  const copy = activityCopy(item)
                  const actor =
                    item.actor?.full_name || item.actor?.email || 'Someone'
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-1"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">{copy.subject}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                          <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">
                            {copy.badge}
                          </span>
                          <span>{copy.text}</span>
                        </div>
                      </div>
                      <p className="shrink-0 text-xs text-fg-muted">
                        {timelineWhen(item.created_at)}, by {actor}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {workspace?.id && (
        <CreateTargetModal
          open={addTargetOpen}
          onClose={() => setAddTargetOpen(false)}
          goalId={goalId}
          members={goalOwnerCandidates.data ?? []}
          onCreated={() => {
            setAddTargetOpen(false)
            invalidateGoal()
          }}
        />
      )}

      {linkTargetId && (
        <AddToTargetModal
          open={!!linkTargetId}
          onClose={() => setLinkTargetId(null)}
          targetId={linkTargetId}
          goalId={goalId}
          workspaceId={g.workspace_id}
          targetOwner={g.targets.find((t) => t.id === linkTargetId)?.owner ?? null}
        />
      )}

      <ShareGoalModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        goalId={goalId}
        goalName={g.name}
        workspaceName={workspace?.name ?? 'Workspace'}
        members={members.data ?? []}
      />

      <Modal open={colorOpen} onClose={() => setColorOpen(false)} title="Change color">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={cn(
                  'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                  g.color === c ? 'border-fg' : 'border-transparent',
                )}
                style={{ backgroundColor: c }}
                onClick={() =>
                  patchGoal.mutate(
                    { color: c },
                    {
                      onSuccess: () => {
                        toast.success('Color updated')
                        setColorOpen(false)
                      },
                    },
                  )
                }
              />
            ))}
          </div>
          {g.color && (
            <button
              type="button"
              className="text-sm text-fg-muted hover:text-fg"
              onClick={() =>
                patchGoal.mutate(
                  { color: null },
                  {
                    onSuccess: () => {
                      toast.success('Color cleared')
                      setColorOpen(false)
                    },
                  },
                )
              }
            >
              Clear color
            </button>
          )}
        </div>
      </Modal>

      {workspace?.id && (
        <MoveGoalToFolderModal
          open={folderOpen}
          onClose={() => setFolderOpen(false)}
          goal={g}
          workspaceId={workspace.id}
          canCreateFolder={canManage}
          onMoved={() => invalidateGoal()}
        />
      )}

      <Modal open={editDescOpen} onClose={() => setEditDescOpen(false)} title="Edit description">
        <div className="space-y-4">
          <textarea
            autoFocus
            className="min-h-[100px] w-full resize-y border-0 border-b border-fg bg-transparent px-0 py-2 text-base text-fg outline-none placeholder:text-fg-muted focus:border-brand"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEditDescOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-700 px-3 py-1.5 text-sm font-semibold text-fg hover:bg-ink-600 disabled:opacity-50"
              disabled={updateDescription.isPending}
              onClick={() => updateDescription.mutate(editDescription.trim() || null)}
            >
              OK
              <Check size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete goal">
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Delete <span className="font-semibold text-fg">{g.name}</span>? This removes the goal, its targets,
            and task links. Tasks themselves are not deleted.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              disabled={deleteGoal.isPending}
              onClick={() => deleteGoal.mutate()}
            >
              {deleteGoal.isPending ? 'Deleting…' : 'Delete goal'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

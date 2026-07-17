import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Check,
  Droplet,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Goal } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Dropdown } from '../ui/Dropdown'
import { Modal } from '../ui/Modal'
import { GoalProgressRing, goalProgressPercent } from './GoalProgressRing'
import { MoveGoalToFolderModal } from './MoveGoalToFolderModal'
import { OwnerAvatarStack } from './OwnerAvatarStack'

export const GOAL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
]

interface GoalGridCardProps {
  goal: Goal
  workspaceId: string
  canManage?: boolean
  onOpen: () => void
  onChanged?: () => void
  /** Compact layout for folder detail pages */
  compact?: boolean
  /** Show shuffle grip + accept drops when reordering */
  draggable?: boolean
  dragging?: boolean
  dropTarget?: boolean
  onDragStart?: () => void
  onDragEnter?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}

/** Compact ClickUp-style goal card: accent bar, ring, dashed targets, footer */
export function GoalGridCard({
  goal,
  workspaceId,
  canManage,
  onOpen,
  onChanged,
  draggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
  compact = false,
}: GoalGridCardProps) {
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState(goal.name)
  const [colorOpen, setColorOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const pct = goalProgressPercent(goal.progress)
  const accent =
    goal.color ||
    (goal.status === 'completed' ? '#22c55e' : goal.status === 'archived' ? '#64748b' : '#4b5563')

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['goal', goal.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-progress', goal.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders'] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    void queryClient.invalidateQueries({ queryKey: ['folder-goals'] })
    onChanged?.()
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/goals/${goal.id}`, body),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/goals/${goal.id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Goal deleted')
      setDeleteOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const saveRename = () => {
    const next = renameDraft.trim()
    if (!next) {
      toast.error('Goal name is required')
      return
    }
    if (next === goal.name) {
      setRenameOpen(false)
      return
    }
    patch.mutate(
      { name: next },
      {
        onSuccess: () => {
          toast.success('Goal renamed')
          setRenameOpen(false)
        },
      },
    )
  }

  return (
    <>
      <div
        className={cn(
          'group relative flex w-full flex-col overflow-hidden rounded-lg border bg-ink-800 shadow-sm transition-all',
          compact ? 'h-[156px]' : 'h-[200px]',
          'border-ink-700 hover:border-ink-600 hover:bg-ink-850 hover:shadow-md',
          dropTarget && 'border-brand ring-2 ring-brand/30',
          dragging && 'scale-[0.98] opacity-50',
          goal.status === 'archived' && !dragging && 'opacity-60',
        )}
        onDragEnter={draggable ? onDragEnter : undefined}
        onDragOver={draggable ? onDragOver : undefined}
        onDrop={draggable ? onDrop : undefined}
      >
        <div className="absolute inset-x-0 top-0 z-[1] h-1" style={{ backgroundColor: accent }} />

        {canManage && draggable && (
          <button
            type="button"
            draggable
            title="Drag to reorder"
            className={cn(
              'absolute left-1 top-1/2 z-20 -translate-y-1/2 cursor-grab rounded p-0.5 text-fg-muted',
              'opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg active:cursor-grabbing',
              'group-hover:opacity-100 focus-visible:opacity-100',
              dragging && 'opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/goal-id', goal.id)
              onDragStart?.()
            }}
            onDragEnd={() => onDragEnd?.()}
          >
            <GripVertical size={16} />
          </button>
        )}

        {canManage && (
          <div className="absolute right-1.5 top-2.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Dropdown
              align="right"
              width="w-48"
              trigger={
                <button
                  type="button"
                  className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
                  title="Goal options"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={15} />
                </button>
              }
            >
              {(close) => (
                <div className="py-1">
                  <button
                    type="button"
                    className="menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      close()
                      setRenameDraft(goal.name)
                      setRenameOpen(true)
                    }}
                  >
                    <Pencil size={14} />
                    Rename
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
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
                    onClick={(e) => {
                      e.stopPropagation()
                      close()
                      setMoveOpen(true)
                    }}
                  >
                    <FolderInput size={14} />
                    Move to Folder
                  </button>
                  {goal.status !== 'archived' ? (
                    <button
                      type="button"
                      className="menu-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        close()
                        patch.mutate(
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
                      onClick={(e) => {
                        e.stopPropagation()
                        close()
                        patch.mutate(
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
                    onClick={(e) => {
                      e.stopPropagation()
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
          </div>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="relative z-[1] flex h-full flex-col px-3 pb-2.5 pt-3 text-left"
        >
          <div className={cn('mb-2 flex justify-center', compact && 'mb-1.5')}>
            <GoalProgressRing progress={pct} size={compact ? 52 : 72} strokeWidth={compact ? 4 : 5} />
          </div>

          <h3 className={cn('mb-1 line-clamp-2 text-center font-semibold leading-snug text-fg', compact ? 'text-xs' : 'text-[13px]')}>
            {goal.name}
          </h3>

          <p className={cn('text-center text-fg-muted', compact ? 'mb-2 text-[11px]' : 'mb-3 text-[12px]')}>
            <span className="border-b border-dashed border-fg-muted/70 pb-px">
              {goal.target_count} {goal.target_count === 1 ? 'target' : 'targets'}
            </span>
          </p>

          <div className="mt-auto flex items-center justify-between gap-2">
            <OwnerAvatarStack
              owners={
                goal.owners && goal.owners.length > 0
                  ? goal.owners
                  : goal.owner
                    ? [goal.owner]
                    : []
              }
              size={compact ? 20 : 22}
            />
            <span className={cn('truncate text-fg-muted', compact ? 'text-[10px]' : 'text-[11px]')}>{formatGoalUpdated(goal.updated_at)}</span>
          </div>
        </button>
      </div>

      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename goal">
        <div className="space-y-4">
          <input
            autoFocus
            className="input w-full"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename()
              if (e.key === 'Escape') setRenameOpen(false)
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-1.5"
              disabled={patch.isPending || !renameDraft.trim()}
              onClick={saveRename}
            >
              OK
              <Check size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={colorOpen} onClose={() => setColorOpen(false)} title="Change color">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Color appears as the stripe on the card and fills the goal header.</p>
          <div className="flex flex-wrap gap-2">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={cn(
                  'h-9 w-9 rounded-full border-2 transition-transform hover:scale-110',
                  goal.color === c ? 'border-fg' : 'border-transparent',
                )}
                style={{ backgroundColor: c }}
                onClick={() =>
                  patch.mutate(
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
          {goal.color && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
              onClick={() =>
                patch.mutate(
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
              <X size={14} />
              Clear color
            </button>
          )}
        </div>
      </Modal>

      <MoveGoalToFolderModal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        goal={goal}
        workspaceId={workspaceId}
        canCreateFolder={canManage}
        onMoved={() => {
          invalidate()
          setMoveOpen(false)
        }}
      />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete goal">
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Delete <span className="font-semibold text-fg">{goal.name}</span>? Targets and task links are
            removed. Tasks themselves are kept.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function formatGoalUpdated(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} Min${minutes === 1 ? '' : 's'}`
  return timeAgo(iso)
}

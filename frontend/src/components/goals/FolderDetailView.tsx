import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { canCreateGoal, canManageGoal } from '../../lib/createAccess'
import {
  useCurrentContext,
  useGoalFolder,
  useGoalFolderAnalytics,
  useUserRoles,
  useGoalOwnerCandidates,
  useWorkspaceMembers,
} from '../../lib/queries'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Dropdown } from '../ui/Dropdown'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'
import { CreateGoalModal } from './CreateGoalModal'
import { FolderAnalyticsCards } from './FolderAnalyticsCards'
import { FolderFormModal } from './FolderFormModal'
import { FolderGoalsList } from './FolderGoalsList'
import { GoalProgressRing, goalProgressPercent } from './GoalProgressRing'
import { ShareFolderModal } from './ShareFolderModal'

interface FolderDetailViewProps {
  folderId: string
  onBack: () => void
  onOpenGoal: (goalId: string) => void
}

export function FolderDetailView({ folderId, onBack, onOpenGoal }: FolderDetailViewProps) {
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const members = useWorkspaceMembers(workspace?.id)
  const goalOwnerCandidates = useGoalOwnerCandidates(workspace?.id)
  const userId = useAuthStore((s) => s.user?.id)
  const folder = useGoalFolder(folderId)
  const analytics = useGoalFolderAnalytics(folderId)
  const queryClient = useQueryClient()
  const [createGoalOpen, setCreateGoalOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const canCreate = canCreateGoal(org, workspace, userRoles, workspace?.id)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goal-folder', folderId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder-analytics', folderId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders'] })
    void queryClient.invalidateQueries({ queryKey: ['folder-goals', folderId] })
    void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
  }

  const deleteFolder = useMutation({
    mutationFn: () => api.delete(`/goal-folders/${folderId}`),
    onSuccess: () => {
      invalidate()
      toast.success('Folder deleted')
      onBack()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const toggleArchive = useMutation({
    mutationFn: (is_archived: boolean) => api.patch(`/goal-folders/${folderId}`, { is_archived }),
    onSuccess: (_data, is_archived) => {
      invalidate()
      toast.success(is_archived ? 'Folder archived' : 'Folder restored')
      if (is_archived) onBack()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (folder.isLoading) return <CenteredSpinner />
  if (!folder.data) {
    return (
      <div className="p-8 text-center text-fg-muted">
        Folder not found
        <button type="button" className="btn-ghost mt-4" onClick={onBack}>
          Back to folders
        </button>
      </div>
    )
  }

  const f = folder.data
  const pct = goalProgressPercent(f.progress)
  const canManageAny =
    canCreate ||
    f.goals.some((g) => canManageGoal(g, userId, org, workspace, userRoles))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="border-b border-ink-700 bg-ink-900 px-4 py-3"
        style={f.color ? { boxShadow: `inset 3px 0 0 ${f.color}` } : undefined}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
            onClick={onBack}
          >
            <ArrowLeft size={14} />
            All folders
          </button>
          <div className="flex items-center gap-1.5">
            {canCreate && !f.is_archived && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1 !px-2 !py-1 text-xs"
                onClick={() => setCreateGoalOpen(true)}
              >
                <Plus size={14} />
                New Goal
              </button>
            )}
            <Dropdown
              align="right"
              width="w-48"
              trigger={
                <button type="button" className="btn-ghost !p-1.5" title="Folder options">
                  <MoreHorizontal size={18} />
                </button>
              }
            >
              {(close) => (
                <div className="py-1">
                  {canCreate && (
                    <>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close()
                          setEditOpen(true)
                        }}
                      >
                        <Pencil size={14} />
                        Edit folder
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close()
                          setShareOpen(true)
                        }}
                      >
                        <Share2 size={14} />
                        Share
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        disabled={toggleArchive.isPending}
                        onClick={() => {
                          close()
                          toggleArchive.mutate(!f.is_archived)
                        }}
                      >
                        <Archive size={14} />
                        {f.is_archived ? 'Unarchive' : 'Archive'}
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
                        Delete folder
                      </button>
                    </>
                  )}
                </div>
              )}
            </Dropdown>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <GoalProgressRing progress={pct} size={52} className="text-fg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-lg font-bold text-fg">{f.name}</h1>
              {f.is_private && (
                <span className="rounded-full bg-ink-750 px-2 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">
                  Private
                </span>
              )}
              {f.is_archived && (
                <span className="rounded-full bg-ink-750 px-2 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">
                  Archived
                </span>
              )}
            </div>
            {f.description ? (
              <p className="mt-1 max-w-2xl text-xs text-fg-secondary line-clamp-2">{f.description}</p>
            ) : (
              canCreate && (
                <button
                  type="button"
                  className="mt-1 text-xs text-fg-muted hover:text-fg"
                  onClick={() => setEditOpen(true)}
                >
                  + Add description
                </button>
              )
            )}
            <p className="mt-1 text-xs text-fg-muted">
              {f.goal_count} {f.goal_count === 1 ? 'goal' : 'goals'} · {pct}% average progress
              {f.active_count != null && (
                <>
                  {' '}
                  · {f.active_count} active · {f.completed_count} completed
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        <FolderAnalyticsCards folder={f} analytics={analytics.data} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {f.goals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center">
            <p className="text-sm text-fg-muted">No goals in this folder yet.</p>
            {canCreate && !f.is_archived && (
              <button
                type="button"
                className="btn-primary mt-4 inline-flex items-center gap-2"
                onClick={() => setCreateGoalOpen(true)}
              >
                <Plus size={16} />
                Create goal
              </button>
            )}
          </div>
        ) : (
          workspace?.id && (
            <FolderGoalsList
              goals={f.goals}
              workspaceId={workspace.id}
              canManage={canManageAny}
              onOpenGoal={onOpenGoal}
              onGoalsChanged={invalidate}
            />
          )
        )}
      </div>

      {workspace?.id && (
        <>
          <CreateGoalModal
            open={createGoalOpen}
            onClose={() => setCreateGoalOpen(false)}
            workspaceId={workspace.id}
            members={goalOwnerCandidates.data ?? []}
            folderId={folderId}
            onCreated={(goalId) => {
              setCreateGoalOpen(false)
              invalidate()
              onOpenGoal(goalId)
            }}
          />
          <FolderFormModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            workspaceId={workspace.id}
            folder={f}
            onSaved={() => {
              setEditOpen(false)
              invalidate()
            }}
          />
          <ShareFolderModal
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            folderId={folderId}
            folderName={f.name}
            workspaceName={workspace.name}
            members={members.data ?? []}
          />
          <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete folder?">
            <p className="mb-4 text-sm text-fg-secondary">
              Goals in this folder will become unfiled. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleteFolder.isPending}
                onClick={() => deleteFolder.mutate()}
              >
                Delete
              </button>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

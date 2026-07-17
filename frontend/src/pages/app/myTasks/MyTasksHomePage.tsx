import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, LayoutGrid, List, MessageSquare, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { navigateToNotification } from '../../../components/notifications/NotificationsDropdown'
import { RecentListRow } from '../../../components/recents/RecentListRow'
import { CreateAssignedTaskModal } from '../../../components/myTasks/CreateAssignedTaskModal'
import { AddTaskModal } from '../../../components/tasks/AddTaskModal'
import { CrossProjectTaskList } from '../../../components/myTasks/CrossProjectTaskList'
import { MyTasksAgenda, MyWorkPanel, MyWorkSettingsMenu } from '../../../components/myTasks/MyWorkPanel'
import { MyTasksCardGrid } from '../../../components/myTasks/MyTasksCardGrid'
import { MyTasksCardShell } from '../../../components/myTasks/MyTasksCardShell'
import { Modal } from '../../../components/ui/Modal'
import { CenteredSpinner } from '../../../components/ui/Spinner'
import { api } from '../../../lib/api'
import { greetingFirstName, useTimeGreeting } from '../../../lib/greeting'
import {
  MY_TASKS_CARD_IDS,
  MY_TASKS_CARD_LABELS,
  type MyTasksCardId,
} from '../../../lib/myTasksCards'
import {
  invalidateMyTasks,
  useMyTasks,
  usePersonalListProject,
} from '../../../lib/myTasksQueries'
import { useProjectTasks } from '../../../lib/queries'
import { getRecents, RECENTS_UPDATED_EVENT, type RecentItem } from '../../../lib/recents'
import { rememberOpenedTask } from '../../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../../lib/useRestoreTaskListFocus'
import type { AppNotification, Page, Task } from '../../../lib/types'
import { useRealtime } from '../../../lib/ws'
import { useUIStore } from '../../../stores/ui'
import { useAuthStore } from '../../../stores/auth'
import { cn } from '../../../lib/utils'

export default function MyTasksHomePage() {
  const [manageOpen, setManageOpen] = useState(false)
  const rawVisible = useUIStore((s) => s.myTasksVisibleCards)
  const reorderCards = useUIStore((s) => s.reorderMyTasksCards)
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const timeGreeting = useTimeGreeting()
  const firstName = greetingFirstName(user)

  const visibleCards = useMemo(
    () => rawVisible.filter((id): id is MyTasksCardId => (MY_TASKS_CARD_IDS as readonly string[]).includes(id)),
    [rawVisible],
  )

  useRealtime(['task.updated', 'task.created', 'task.assigned', 'task.deleted'], () => {
    invalidateMyTasks(queryClient)
  })

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col px-6 py-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-fg-secondary">My Tasks</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            {firstName ? `${timeGreeting}, ${firstName}` : timeGreeting}
          </h1>
        </div>
        <button className="btn-secondary text-xs" onClick={() => setManageOpen(true)}>
          <LayoutGrid size={14} className="mr-1.5 inline" />
          Manage cards
        </button>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-8">
        {visibleCards.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No cards visible. Use <strong>Manage cards</strong> to add widgets.
          </p>
        ) : (
          <MyTasksCardGrid
            cardIds={visibleCards}
            onReorder={reorderCards}
            renderCard={(id, drag) => (
              <MyTasksDashboardCard
                key={id}
                id={id}
                onDragStart={(e) => {
                  drag.onDragStart()
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={drag.onDragOver}
                onDrop={drag.onDrop}
                isDragTarget={drag.isDragTarget}
              />
            )}
          />
        )}
      </div>

      {manageOpen && <ManageMyTasksCardsModal onClose={() => setManageOpen(false)} />}
    </div>
  )
}

function MyTasksDashboardCard({
  id,
  onDragStart,
  onDragOver,
  onDrop,
  isDragTarget,
}: {
  id: MyTasksCardId
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  isDragTarget: boolean
}) {
  const shellProps = {
    cardId: id,
    onDragHandlePointerDown: onDragStart,
    onDragOver,
    onDrop,
    isDragTarget,
  }

  switch (id) {
    case 'recents':
      return <RecentsCard {...shellProps} />
    case 'agenda':
      return <AgendaCard {...shellProps} />
    case 'my_work':
      return <MyWorkCard {...shellProps} />
    case 'assigned_comments':
      return <AssignedCommentsCard {...shellProps} />
    case 'personal_list':
      return <PersonalListCard {...shellProps} />
    case 'assigned':
      return <AssignedCard {...shellProps} />
    case 'created':
      return <CreatedByMeCard {...shellProps} />
    default:
      return null
  }
}

type CardProps = {
  cardId: MyTasksCardId
  onDragHandlePointerDown: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  isDragTarget: boolean
}

function RecentsCard(props: CardProps) {
  const [recents, setRecents] = useState<RecentItem[]>(() => getRecents())

  useEffect(() => {
    const refresh = () => setRecents(getRecents())
    window.addEventListener(RECENTS_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(RECENTS_UPDATED_EVENT, refresh)
  }, [])

  return (
    <MyTasksCardShell {...props}>
      <div className="h-full min-h-0 overflow-y-auto px-1 py-1">
        {recents.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-fg-muted">
            Projects and tasks you open will show up here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recents.slice(0, 8).map((item) => (
              <RecentListRow key={`${item.type}-${item.id}`} item={item} />
            ))}
          </ul>
        )}
      </div>
    </MyTasksCardShell>
  )
}

function AgendaCard(props: CardProps) {
  const [day, setDay] = useState(() => new Date())
  const assigned = useMyTasks({ relation: 'assigned', pageSize: 100 })

  return (
    <MyTasksCardShell {...props} bodyClassName="bg-ink-900">
      <MyTasksAgenda day={day} tasks={assigned.data?.items ?? []} onDayChange={setDay} embedded />
    </MyTasksCardShell>
  )
}

function MyWorkCard(props: CardProps) {
  const assigned = useMyTasks({ relation: 'assigned', pageSize: 200 })
  const delegated = useMyTasks({ relation: 'delegated', pageSize: 100 })
  const done = useMyTasks({ relation: 'assigned', includeCompleted: true, pageSize: 200 })
  const loading = assigned.isLoading || delegated.isLoading || done.isLoading
  const doneTasks = (done.data?.items ?? []).filter((t) => !!t.completed_at)

  return (
    <MyTasksCardShell {...props} hideAdd headerActions={<MyWorkSettingsMenu />}>
      <MyWorkPanel
        embedded
        assignedTasks={assigned.data?.items ?? []}
        delegatedTasks={delegated.data?.items ?? []}
        doneTasks={doneTasks}
        loading={loading}
      />
    </MyTasksCardShell>
  )
}

function AssignedCommentsCard(props: CardProps) {
  const navigate = useNavigate()
  const comments = useQuery({
    queryKey: ['notifications', 'assigned-comments', 1],
    queryFn: () =>
      api.get<Page<AppNotification>>('/notifications?view=assigned_comments&page=1&page_size=8'),
  })
  const items = comments.data?.items ?? []

  return (
    <MyTasksCardShell {...props}>
      <div className="h-full min-h-0 overflow-y-auto px-2 py-1">
        {comments.isLoading ? (
          <CenteredSpinner />
        ) : items.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-fg-muted">
            You don&apos;t have any assigned comments — keep it up!
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => navigateToNotification(n, navigate)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-800"
                >
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-fg">{n.title}</span>
                    {n.body && <span className="line-clamp-1 text-xs text-fg-muted">{n.body}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MyTasksCardShell>
  )
}

function PersonalListCard(props: CardProps) {
  const navigate = useNavigate()
  const personal = usePersonalListProject()
  const tasks = useProjectTasks(personal.data?.id)
  const open = (tasks.data?.items ?? []).filter((t) => !t.completed_at).slice(0, 8)
  useRestoreTaskListFocus(!personal.isLoading && open.length > 0)

  return (
    <MyTasksCardShell {...props} onAdd={() => navigate('/app/my-tasks/personal')}>
      <div className="h-full min-h-0 overflow-y-auto px-2 py-1">
        {personal.isLoading ? (
          <CenteredSpinner />
        ) : open.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm text-fg-muted">Your private tasks live here.</p>
            <button
              type="button"
              className="btn-secondary mt-3 text-xs"
              onClick={() => navigate('/app/my-tasks/personal')}
            >
              <Plus size={13} className="mr-1 inline" />
              Create task
            </button>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {open.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  data-task-id={task.id}
                  onClick={() => {
                    rememberOpenedTask(task.id)
                    navigate(`/app/tasks/${task.id}`)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-800"
                >
                  <List size={14} className="shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate text-fg">{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MyTasksCardShell>
  )
}

function AssignedCard(props: CardProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const showClosedTasks = useUIStore((s) => s.assignedToMeCardSettings.showClosedTasks)
  const setCardSetting = useUIStore((s) => s.setAssignedToMeCardSetting)
  const { data, isLoading, isError, error } = useMyTasks({
    relation: 'assigned',
    includeCompleted: showClosedTasks,
    pageSize: 200,
  })

  return (
    <>
      <MyTasksCardShell {...props} onAdd={() => setCreateOpen(true)}>
        {isLoading && !data ? (
          <CenteredSpinner />
        ) : (
          <CrossProjectTaskList
            variant="embedded"
            tasks={data?.items ?? []}
            showSubtasks={false}
            includeCompleted={showClosedTasks}
            onIncludeCompletedChange={(value) => setCardSetting('showClosedTasks', value)}
            onAddTask={() => setCreateOpen(true)}
            emptyDescription={
              isError
                ? (error as Error)?.message ?? 'Failed to load tasks'
                : 'Tasks assigned to you will appear here.'
            }
          />
        )}
      </MyTasksCardShell>
      <CreateAssignedTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}

function CreatedByMeCard(props: CardProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const { data, isLoading, isError, error } = useMyTasks({
    relation: 'created',
    includeCompleted: showClosed,
    pageSize: 200,
  })

  return (
    <>
      <MyTasksCardShell {...props} onAdd={() => setCreateOpen(true)}>
        {isLoading && !data ? (
          <CenteredSpinner />
        ) : (
          <CrossProjectTaskList
            variant="embedded"
            tasks={data?.items ?? []}
            showSubtasks={false}
            includeCompleted={showClosed}
            onIncludeCompletedChange={setShowClosed}
            onAddTask={() => setCreateOpen(true)}
            emptyDescription={
              isError
                ? (error as Error)?.message ?? 'Failed to load tasks'
                : 'Tasks you created will appear here.'
            }
          />
        )}
      </MyTasksCardShell>
      <AddTaskModal open={createOpen} onClose={() => setCreateOpen(false)} navigateToTask={false} />
    </>
  )
}

function ManageMyTasksCardsModal({ onClose }: { onClose: () => void }) {
  const visible = useUIStore((s) => s.myTasksVisibleCards)
  const hideCard = useUIStore((s) => s.hideMyTasksCard)
  const showCard = useUIStore((s) => s.showMyTasksCard)
  const resetCards = useUIStore((s) => s.resetMyTasksVisibleCards)

  const toggle = (id: MyTasksCardId) => {
    if (visible.includes(id)) hideCard(id)
    else showCard(id)
  }

  const reset = () => resetCards()

  return (
    <Modal open onClose={onClose} title="Manage cards" width="max-w-md">
      <p className="mb-4 text-sm text-fg-secondary">
        Choose which widgets appear on your My Tasks home. Drag cards on the dashboard to reorder them.
      </p>
      <ul className="space-y-1">
        {MY_TASKS_CARD_IDS.map((id) => {
          const on = visible.includes(id)
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                  on ? 'border-brand/40 bg-brand-soft text-fg' : 'border-ink-700 text-fg-secondary hover:bg-ink-850',
                )}
              >
                {on ? <CheckCircle2 size={16} className="text-brand" /> : <span className="h-4 w-4" />}
                {MY_TASKS_CARD_LABELS[id]}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={reset}>
          Reset all
        </button>
        <button type="button" className="btn-primary text-xs" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  )
}

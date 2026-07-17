import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, CheckCircle2, MoreHorizontal, Pencil, Play, Plus, Target, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSprints, useStatuses, useWorkspaceMembers } from '../../lib/queries'
import { parseSprintTab, type SprintTab } from '../../lib/sprintRoutes'
import { useQueryFlagModal } from '../../lib/useQueryFlagModal'
import { useResetFormWhenOpen } from '../../lib/useResetFormWhenOpen'
import type {
  Page,
  RetrospectiveItem,
  RetrospectiveItemCategory,
  Sprint,
  SprintBurndown,
  SprintRetrospective,
  Standup,
  Task,
} from '../../lib/types'
import { cn, formatDate, minEndDateKey, minSelectableDateKey, todayDateKey } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { KanbanBoard } from '../../components/tasks/KanbanBoard'
import { CreateGithubIssueToggle, useCreateGithubIssuePreference } from '../../components/github/CreateGithubIssueToggle'
import { Avatar } from '../../components/ui/Avatar'
import { DateInput } from '../../components/ui/DateInput'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const STATUS_STYLES: Record<Sprint['status'], string> = {
  planned: 'bg-ink-750 text-fg-secondary',
  active: 'bg-emerald-500/15 text-emerald-400',
  completed: 'bg-brand-soft text-brand',
}

export default function SprintsPage() {
  const { workspace } = useCurrentContext()
  const sprints = useSprints(workspace?.id)
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { isOpen: createOpen, open: openCreate, close: closeCreate } = useQueryFlagModal()

  useRealtime('sprint.updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['sprints', workspace?.id] })
    void queryClient.invalidateQueries({ queryKey: ['sprint-tasks'] })
  })

  const selectedId = params.get('sprint') ?? sprints.data?.find((s) => s.status === 'active')?.id ?? sprints.data?.[0]?.id
  const selected = sprints.data?.find((s) => s.id === selectedId) ?? null

  const canManage = workspace?.my_role === 'admin' || workspace?.my_role === 'owner'

  if (sprints.isLoading) return <CenteredSpinner />

  return (
    <div className="flex h-full">
      {/* Sprint list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-ink-700 bg-ink-850/50">
        <div className="flex items-center justify-between px-4 py-3.5">
          <h2 className="text-sm font-bold text-fg">Sprints</h2>
          {canManage && (
            <button className="btn-ghost !p-1.5" onClick={openCreate}>
              <Plus size={15} />
            </button>
          )}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {(sprints.data ?? []).map((sprint) => (
            <button
              key={sprint.id}
              onClick={() => {
                params.set('sprint', sprint.id)
                setParams(params, { replace: true })
              }}
              className={cn(
                'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                sprint.id === selectedId
                  ? 'border-brand bg-brand-soft'
                  : 'border-ink-700 bg-ink-900 hover:bg-ink-850',
              )}
            >
              <div className="flex items-center gap-2">
                <Zap size={13} className={sprint.status === 'active' ? 'text-emerald-400' : 'text-fg-muted'} />
                <span className="flex-1 truncate text-sm font-medium text-fg">{sprint.name}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', STATUS_STYLES[sprint.status])}>
                  {sprint.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-fg-muted">
                {sprint.start_date ? formatDate(sprint.start_date) : 'Not scheduled'}
                {sprint.end_date ? ` → ${formatDate(sprint.end_date)}` : ''}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-secondary">
                <span>{sprint.task_count} tasks</span>
                <span>·</span>
                <span>
                  {sprint.completed_points}/{sprint.total_points} pts
                </span>
              </div>
            </button>
          ))}
          {(sprints.data ?? []).length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-fg-muted">No sprints yet</p>
          )}
        </div>
      </div>

      {/* Sprint detail */}
      {selected ? (
        <SprintDetail key={selected.id} sprint={selected} canManage={canManage} />
      ) : (
        <div className="flex-1">
          <EmptyState
            icon={Zap}
            title="No sprint selected"
            description="Create a sprint to start planning your iteration."
            action={
              canManage ? (
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={14} /> New sprint
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      <CreateSprintModal open={createOpen} onClose={closeCreate} />
    </div>
  )
}

function SprintDetail({ sprint, canManage }: { sprint: Sprint; canManage: boolean }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [params, setParams] = useSearchParams()
  const rawTab = parseSprintTab(params.get('tab'))
  const tab: SprintTab =
    rawTab === 'retrospective' && sprint.status !== 'completed' ? 'board' : rawTab

  useEffect(() => {
    if (rawTab === 'retrospective' && sprint.status !== 'completed') {
      const next = new URLSearchParams(params)
      next.delete('tab')
      setParams(next, { replace: true })
    }
  }, [rawTab, sprint.status, params, setParams])

  const setTab = (nextTab: SprintTab) => {
    const next = new URLSearchParams(params)
    if (nextTab === 'board') next.delete('tab')
    else next.set('tab', nextTab)
    setParams(next, { replace: true })
  }

  const tasks = useQuery({
    queryKey: ['sprint-tasks', sprint.id],
    queryFn: () => api.get<Task[]>(`/sprints/${sprint.id}/tasks`),
  })

  const isScrumMaster = sprint.scrum_master_id === user?.id
  const canRun = canManage || isScrumMaster
  const incompleteCount = (tasks.data ?? []).filter((t) => !t.completed_at).length

  const goToRetrospective = () => {
    const next = new URLSearchParams(params)
    next.set('tab', 'retrospective')
    setParams(next, { replace: true })
  }

  const act = useMutation({
    mutationFn: (action: 'start' | 'complete') =>
      api.post(action === 'complete' ? `/sprints/${sprint.id}/complete` : `/sprints/${sprint.id}/start`),
    onSuccess: (_, action) => {
      if (action === 'complete') {
        toast.success('Sprint completed — retrospective is ready')
        void queryClient.invalidateQueries({ queryKey: ['sprints'] })
        goToRetrospective()
        return
      }
      toast.success('Sprint started')
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const del = useMutation({
    mutationFn: () => api.delete(`/sprints/${sprint.id}`),
    onSuccess: () => {
      toast.success('Sprint deleted')
      setConfirmDelete(false)
      params.delete('sprint')
      setParams(params, { replace: true })
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const projectId = tasks.data?.[0]?.project_id ?? sprint.project_id ?? undefined
  const projects = useProjects(sprint.workspace_id)
  const project = projects.data?.find((p) => p.id === projectId)
  const statuses = useStatuses(projectId ?? undefined)
  const canEditAllTasks = canManage || project?.my_role === 'admin'
  const canMoveTask = (task: Task) =>
    sprint.status !== 'completed' &&
    (canEditAllTasks || task.assignees.some((assignee) => assignee.id === user?.id))

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-ink-700 px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-fg">{sprint.name}</h1>
          <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold uppercase', STATUS_STYLES[sprint.status])}>
            {sprint.status}
          </span>
          <span className="flex-1" />
          {sprint.scrum_master && (
            <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <Avatar name={sprint.scrum_master.full_name} src={sprint.scrum_master.avatar_url} size={20} />
              Scrum master
            </span>
          )}
          {sprint.status !== 'completed' && (
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => setAddTaskOpen(true)}>
              <Plus size={13} /> Add Task
            </button>
          )}
          {canRun && sprint.status === 'planned' && (
            <button className="btn-primary !py-1.5 text-xs" onClick={() => act.mutate('start')} disabled={act.isPending}>
              <Play size={13} /> Start sprint
            </button>
          )}
          {canRun && sprint.status === 'active' && (
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => (incompleteCount > 0 ? setCompleteOpen(true) : act.mutate('complete'))}
              disabled={act.isPending}
            >
              <CheckCircle2 size={13} /> Complete sprint
            </button>
          )}
          {canRun && (
            <Dropdown
              align="right"
              width="w-44"
              trigger={
                <button className="btn-ghost !p-1.5" title="Sprint options">
                  <MoreHorizontal size={15} />
                </button>
              }
            >
              {(close) => (
                <>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setEditOpen(true)
                      close()
                    }}
                  >
                    <Pencil size={14} className="text-fg-muted" /> Edit sprint
                  </button>
                  {canManage && (
                    <button
                      className="menu-item !text-red-400"
                      onClick={() => {
                        setConfirmDelete(true)
                        close()
                      }}
                    >
                      <Trash2 size={14} /> Delete sprint
                    </button>
                  )}
                </>
              )}
            </Dropdown>
          )}
        </div>
        {sprint.goal && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-fg-secondary">
            <Target size={13} className="text-brand" /> {sprint.goal}
          </p>
        )}
        <div className="mt-2 flex items-center gap-4 text-xs text-fg-muted">
          <span className="flex items-center gap-1">
            <CalendarRange size={12} />
            {sprint.start_date ? formatDate(sprint.start_date) : '—'} →{' '}
            {sprint.end_date ? formatDate(sprint.end_date) : '—'}
          </span>
          <span>
            {sprint.completed_points}/{sprint.total_points} story points
          </span>
          <span>{sprint.task_count} tasks</span>
        </div>

        <div className="mt-3 flex gap-1">
          {(
            [
              'board',
              'backlog',
              'burndown',
              'standups',
              ...(sprint.status === 'completed' ? (['retrospective'] as const) : []),
            ] as SprintTab[]
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {tab === 'board' &&
          (tasks.isLoading || statuses.isLoading ? (
            <CenteredSpinner />
          ) : projectId && (tasks.data ?? []).length > 0 ? (
            <KanbanBoard
              projectId={projectId}
              sprintId={sprint.id}
              tasks={tasks.data ?? []}
              statuses={statuses.data ?? []}
              canEdit={sprint.status !== 'completed'}
              canEditTask={canMoveTask}
              taskListQueryKey={['sprint-tasks', sprint.id]}
            />
          ) : (
            <EmptyState icon={Zap} title="No tasks in this sprint" description="Add tasks from the backlog tab." />
          ))}
        {tab === 'backlog' && <SprintBacklog sprint={sprint} sprintTasks={tasks.data ?? []} />}
        {tab === 'burndown' && <Burndown sprintId={sprint.id} />}
        {tab === 'standups' && <Standups sprintId={sprint.id} />}
        {tab === 'retrospective' && sprint.status === 'completed' && (
          <Retrospective sprint={sprint} canManage={canManage} />
        )}
      </div>

      <AddSprintTaskModal sprint={sprint} open={addTaskOpen} onClose={() => setAddTaskOpen(false)} />
      <CompleteSprintModal
        sprint={sprint}
        incompleteCount={incompleteCount}
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        onCompleted={goToRetrospective}
      />
      <EditSprintModal sprint={sprint} open={editOpen} onClose={() => setEditOpen(false)} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete sprint" width="max-w-sm">
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Delete <span className="font-semibold text-fg">{sprint.name}</span>? Tasks stay in their
            projects — only the sprint and its planning data are removed.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn-primary !bg-red-500 !py-1.5 text-xs hover:!bg-red-600"
              disabled={del.isPending}
              onClick={() => del.mutate()}
            >
              <Trash2 size={13} /> Delete sprint
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Edit name, goal, dates and scrum master — sprint manager (admin / org owner / scrum master) only. */
function EditSprintModal({ sprint, open, onClose }: { sprint: Sprint; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const members = useWorkspaceMembers(sprint.workspace_id)
  const [name, setName] = useState(sprint.name)
  const [goal, setGoal] = useState(sprint.goal ?? '')
  const [startDate, setStartDate] = useState(sprint.start_date ?? '')
  const [endDate, setEndDate] = useState(sprint.end_date ?? '')
  const [scrumMasterId, setScrumMasterId] = useState(sprint.scrum_master_id ?? '')

  const save = useMutation({
    mutationFn: () =>
      api.patch<Sprint>(`/sprints/${sprint.id}`, {
        name: name.trim(),
        goal: goal.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        scrum_master_id: scrumMasterId || null,
      }),
    onSuccess: () => {
      toast.success('Sprint updated')
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const datesInvalid = !!startDate && !!endDate && endDate <= startDate
  const today = todayDateKey()
  const startMin = minSelectableDateKey(sprint.start_date)
  const endMin = minEndDateKey(startDate || today, sprint.end_date)
  const pastDate =
    (!!startDate && startDate < today && startDate !== (sprint.start_date ?? '')) ||
    (!!endDate && endDate < today && endDate !== (sprint.end_date ?? ''))

  return (
    <Modal open={open} onClose={onClose} title="Edit sprint" width="max-w-md">
      <div className="space-y-3">
        <input className="input-dark" placeholder="Sprint name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <textarea rows={2} className="input-dark resize-none" placeholder="Sprint goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-fg-muted">Start</label>
            <DateInput value={startDate} onChange={setStartDate} min={startMin} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-fg-muted">End</label>
            <DateInput value={endDate} onChange={setEndDate} min={endMin} />
          </div>
        </div>
        {datesInvalid && <p className="text-xs text-red-400">End date must be after the start date.</p>}
        {pastDate && <p className="text-xs text-red-400">Sprint dates cannot be in the past.</p>}
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Scrum master</label>
          <select className="input-dark" value={scrumMasterId} onChange={(e) => setScrumMasterId(e.target.value)}>
            <option value="">No scrum master</option>
            {(members.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user?.full_name || m.user?.email}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary w-full" disabled={save.isPending || !name.trim() || datesInvalid || pastDate} onClick={() => save.mutate()}>
          Save changes
        </button>
      </div>
    </Modal>
  )
}

/** Create a task directly inside the sprint (ClickUp-style: sprints behave like lists). */
function AddSprintTaskModal({ sprint, open, onClose }: { sprint: Sprint; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const projects = useProjects(sprint.workspace_id)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createGithubIssue, setCreateGithubIssue] = useCreateGithubIssuePreference()

  const effectiveProject = sprint.project_id ?? (projectId || projects.data?.[0]?.id)
  const sprintProject = projects.data?.find((p) => p.id === sprint.project_id)

  const handleClose = () => {
    setTitle('')
    setProjectId('')
    onClose()
  }

  const create = async () => {
    if (!title.trim() || !effectiveProject) return
    setCreating(true)
    try {
      const task = await api.post<Task>(`/projects/${effectiveProject}/tasks`, {
        title: title.trim(),
        create_github_issue: createGithubIssue,
      })
      await api.post(`/sprints/${sprint.id}/tasks`, { task_ids: [task.id] })
      toast.success(`${task.ref} created and added to sprint`)
      void queryClient.invalidateQueries({ queryKey: ['sprint-tasks', sprint.id] })
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['backlog'] })
      handleClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Add task to ${sprint.name}`} width="max-w-md">
      <div className="space-y-3">
        <input
          autoFocus
          className="input-dark"
          placeholder="Task name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && void create()}
        />
        {sprint.project_id ? (
          <p className="text-xs text-fg-muted">
            Project: <span className="text-fg-secondary">{sprintProject?.name ?? '…'}</span>
          </p>
        ) : (
          <select className="input-dark" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {effectiveProject && (
          <CreateGithubIssueToggle
            projectId={effectiveProject}
            checked={createGithubIssue}
            onChange={setCreateGithubIssue}
          />
        )}
        <button className="btn-primary w-full" disabled={creating || !title.trim() || !effectiveProject} onClick={() => void create()}>
          <Plus size={14} /> Create in sprint
        </button>
      </div>
    </Modal>
  )
}

/** Complete the sprint, optionally rolling unfinished tasks into another sprint (Jira-style). */
function CompleteSprintModal({
  sprint,
  incompleteCount,
  open,
  onClose,
  onCompleted,
}: {
  sprint: Sprint
  incompleteCount: number
  open: boolean
  onClose: () => void
  onCompleted: () => void
}) {
  const queryClient = useQueryClient()
  const sprints = useSprints(sprint.workspace_id)
  const [moveTo, setMoveTo] = useState('')

  const targets = (sprints.data ?? []).filter(
    (s) =>
      s.id !== sprint.id &&
      s.status !== 'completed' &&
      (!s.project_id || !sprint.project_id || s.project_id === sprint.project_id),
  )

  const complete = useMutation({
    mutationFn: () =>
      api.post(`/sprints/${sprint.id}/complete`, moveTo ? { move_incomplete_to: moveTo } : {}),
    onSuccess: () => {
      toast.success('Sprint completed — retrospective is ready')
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
      void queryClient.invalidateQueries({ queryKey: ['sprint-tasks'] })
      onClose()
      onCompleted()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title={`Complete ${sprint.name}`} width="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">
          <span className="font-semibold text-fg">{incompleteCount}</span> task
          {incompleteCount === 1 ? ' is' : 's are'} not done yet. Where should they go?
        </p>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5">
            <input type="radio" className="accent-brand" checked={moveTo === ''} onChange={() => setMoveTo('')} />
            <span className="text-sm text-fg">Leave them in this sprint</span>
          </label>
          {targets.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5"
            >
              <input type="radio" className="accent-brand" checked={moveTo === s.id} onChange={() => setMoveTo(s.id)} />
              <span className="flex-1 text-sm text-fg">Move to {s.name}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', STATUS_STYLES[s.status])}>
                {s.status}
              </span>
            </label>
          ))}
          {targets.length === 0 && (
            <p className="text-xs text-fg-muted">No other open sprint to move them to — create the next sprint first if you want to roll tasks over.</p>
          )}
        </div>
        <button className="btn-primary w-full" disabled={complete.isPending} onClick={() => complete.mutate()}>
          <CheckCircle2 size={14} /> Complete sprint
        </button>
      </div>
    </Modal>
  )
}

function SprintBacklog({ sprint, sprintTasks }: { sprint: Sprint; sprintTasks: Task[] }) {
  const queryClient = useQueryClient()
  const projects = useProjects(sprint.workspace_id)
  const [projectId, setProjectId] = useState(sprint.project_id ?? '')
  const effectiveProject = projectId || projects.data?.[0]?.id

  const backlog = useQuery({
    queryKey: ['backlog', effectiveProject],
    queryFn: () => api.get<Page<Task>>(`/projects/${effectiveProject}/tasks?page_size=200`),
    enabled: !!effectiveProject,
  })

  const inSprint = new Set(sprintTasks.map((t) => t.id))
  const available = (backlog.data?.items ?? []).filter((t) => !inSprint.has(t.id) && !t.completed_at)

  const toggle = async (taskId: string, add: boolean) => {
    try {
      if (add) await api.post(`/sprints/${sprint.id}/tasks`, { task_ids: [taskId] })
      else await api.delete(`/sprints/${sprint.id}/tasks/${taskId}`)
      toast.success(add ? 'Task added to sprint' : 'Task removed from sprint')
      void queryClient.invalidateQueries({ queryKey: ['sprint-tasks', sprint.id] })
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 pb-10">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">In sprint ({sprintTasks.length})</h3>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {sprintTasks.map((task) => (
            <BacklogRow key={task.id} task={task} actionLabel="Remove" onAction={() => toggle(task.id, false)} danger />
          ))}
          {sprintTasks.length === 0 && (
            <p className="bg-ink-900 px-4 py-3 text-sm text-fg-muted">Nothing in the sprint yet.</p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-fg">Backlog</h3>
          {sprint.project_id ? (
            <span className="text-xs text-fg-muted">
              {projects.data?.find((p) => p.id === sprint.project_id)?.name ?? ''} — unscheduled tasks
            </span>
          ) : (
            <select className="input-dark !w-auto !py-1 text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {available.map((task) => (
            <BacklogRow key={task.id} task={task} actionLabel="Add" onAction={() => toggle(task.id, true)} />
          ))}
          {available.length === 0 && (
            <p className="bg-ink-900 px-4 py-3 text-sm text-fg-muted">
              No open tasks left in this project's backlog. Use “Add Task” at the top to create one directly in the sprint.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function BacklogRow({
  task,
  actionLabel,
  onAction,
  danger,
}: {
  task: Task
  actionLabel: string
  onAction: () => void
  danger?: boolean
}) {
  return (
    <div className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2 last:border-b-0">
      <span className="text-xs text-fg-muted">{task.ref}</span>
      <span className="flex-1 truncate text-sm text-fg">{task.title}</span>
      {task.story_points != null && (
        <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] text-fg-secondary">{task.story_points} pts</span>
      )}
      <button
        className={cn('text-xs font-medium', danger ? 'text-red-400 hover:text-red-300' : 'text-brand hover:text-brand-hover')}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  )
}

function Burndown({ sprintId }: { sprintId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['burndown', sprintId],
    queryFn: () => api.get<SprintBurndown>(`/sprints/${sprintId}/burndown`),
  })
  if (isLoading) return <CenteredSpinner />
  if (!data || data.points.length === 0) {
    return <EmptyState icon={Target} title="No burndown data" description="Set sprint dates and story points to see the burndown." />
  }

  const max = Math.max(data.total_points, 1)
  const width = 640
  const height = 220
  const stepX = width / Math.max(data.points.length - 1, 1)
  const y = (v: number) => height - (v / max) * (height - 20) - 10

  const actualPath = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * stepX},${y(p.remaining_points)}`).join(' ')
  const idealPath = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * stepX},${y(p.ideal_points)}`).join(' ')

  return (
    <div className="mx-auto max-w-3xl px-6">
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <div className="mb-4 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-fg-secondary">
            <span className="h-2 w-4 rounded bg-brand" /> Remaining
          </span>
          <span className="flex items-center gap-1.5 text-fg-secondary">
            <span className="h-0.5 w-4 bg-fg-muted" /> Ideal
          </span>
          <span className="flex-1" />
          <span className="text-fg-secondary">
            {data.completed_points}/{data.total_points} pts done
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
          <path d={idealPath} stroke="#6F737B" strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
          <path d={actualPath} stroke="#2B88EE" strokeWidth="2.5" fill="none" />
          {data.points.map((p, i) => (
            <circle key={p.day} cx={i * stepX} cy={y(p.remaining_points)} r="3" fill="#2B88EE" />
          ))}
        </svg>
        <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
          <span>{formatDate(data.points[0].day)}</span>
          <span>{formatDate(data.points[data.points.length - 1].day)}</span>
        </div>
      </div>
    </div>
  )
}

function Standups({ sprintId }: { sprintId: string }) {
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [yesterday, setYesterday] = useState('')
  const [todayText, setTodayText] = useState('')
  const [blockers, setBlockers] = useState('')

  const standups = useQuery({
    queryKey: ['standups', sprintId],
    queryFn: () => api.get<Page<Standup>>(`/sprints/${sprintId}/standups?page_size=100`),
  })

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/sprints/${sprintId}/standups`, {
        for_date: today,
        yesterday: yesterday.trim() || null,
        today: todayText.trim() || null,
        blockers: blockers.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Standup submitted')
      setYesterday('')
      setTodayText('')
      setBlockers('')
      void queryClient.invalidateQueries({ queryKey: ['standups', sprintId] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 pb-10">
      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="mb-3 text-sm font-semibold text-fg">Today's standup</h3>
        <div className="space-y-2.5">
          <textarea rows={2} className="input-dark resize-none" placeholder="What did you do yesterday?" value={yesterday} onChange={(e) => setYesterday(e.target.value)} />
          <textarea rows={2} className="input-dark resize-none" placeholder="What will you do today?" value={todayText} onChange={(e) => setTodayText(e.target.value)} />
          <textarea rows={2} className="input-dark resize-none" placeholder="Any blockers?" value={blockers} onChange={(e) => setBlockers(e.target.value)} />
          <div className="flex justify-end">
            <button
              className="btn-primary !py-1.5 text-xs"
              disabled={submit.isPending || (!yesterday.trim() && !todayText.trim() && !blockers.trim())}
              onClick={() => submit.mutate()}
            >
              Submit standup
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {(standups.data?.items ?? []).map((standup) => (
          <div key={standup.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <Avatar name={standup.user?.full_name || '?'} src={standup.user?.avatar_url} size={26} />
              <span className="text-sm font-semibold text-fg">{standup.user?.full_name || 'Someone'}</span>
              <span className="text-xs text-fg-muted">{formatDate(standup.for_date)}</span>
            </div>
            <div className="space-y-1.5 text-sm">
              {standup.yesterday && (
                <p className="text-fg-secondary"><span className="font-medium text-fg-muted">Yesterday: </span>{standup.yesterday}</p>
              )}
              {standup.today && (
                <p className="text-fg-secondary"><span className="font-medium text-fg-muted">Today: </span>{standup.today}</p>
              )}
              {standup.blockers && (
                <p className="text-red-300"><span className="font-medium text-red-400">Blockers: </span>{standup.blockers}</p>
              )}
            </div>
          </div>
        ))}
        {(standups.data?.items ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-fg-muted">No standups submitted yet.</p>
        )}
      </section>
    </div>
  )
}

const RETRO_COLUMNS: {
  category: RetrospectiveItemCategory
  title: string
  subtitle: string
  placeholder: string
}[] = [
  {
    category: 'rose',
    title: 'Went well',
    subtitle: 'Roses — wins and habits to keep',
    placeholder: 'What worked well this sprint?',
  },
  {
    category: 'thorn',
    title: 'Needs improvement',
    subtitle: 'Thorns — what got in the way',
    placeholder: 'What hindered progress?',
  },
  {
    category: 'bud',
    title: 'Action items',
    subtitle: 'Buds — 1–2 concrete follow-ups',
    placeholder: 'What should we try next sprint?',
  },
]

function Retrospective({ sprint, canManage }: { sprint: Sprint; canManage: boolean }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const members = useWorkspaceMembers(sprint.workspace_id)
  const [stageNotes, setStageNotes] = useState('')
  const [drafts, setDrafts] = useState<Record<RetrospectiveItemCategory, string>>({
    rose: '',
    thorn: '',
    bud: '',
  })
  const [budAssignee, setBudAssignee] = useState('')

  const retro = useQuery({
    queryKey: ['sprint-retrospective', sprint.id],
    queryFn: () => api.get<SprintRetrospective>(`/sprints/${sprint.id}/retrospective`),
  })

  useEffect(() => {
    if (retro.data) setStageNotes(retro.data.stage_notes ?? '')
  }, [retro.data])

  const saveNotes = useMutation({
    mutationFn: () =>
      api.patch<SprintRetrospective>(`/sprints/${sprint.id}/retrospective`, {
        stage_notes: stageNotes.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Stage notes saved')
      void queryClient.invalidateQueries({ queryKey: ['sprint-retrospective', sprint.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const addItem = useMutation({
    mutationFn: (payload: {
      category: RetrospectiveItemCategory
      body: string
      assignee_id?: string | null
    }) => api.post<RetrospectiveItem>(`/sprints/${sprint.id}/retrospective/items`, payload),
    onSuccess: (_, vars) => {
      setDrafts((d) => ({ ...d, [vars.category]: '' }))
      if (vars.category === 'bud') setBudAssignee('')
      void queryClient.invalidateQueries({ queryKey: ['sprint-retrospective', sprint.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const patchItem = useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string
      body: { body?: string; is_done?: boolean; assignee_id?: string | null }
    }) => api.patch<RetrospectiveItem>(`/sprints/${sprint.id}/retrospective/items/${itemId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sprint-retrospective', sprint.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/sprints/${sprint.id}/retrospective/items/${itemId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sprint-retrospective', sprint.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const canEditItem = (item: RetrospectiveItem) =>
    canManage || item.author_id === user?.id || sprint.scrum_master_id === user?.id

  if (retro.isLoading) return <CenteredSpinner />
  if (retro.isError || !retro.data) {
    return (
      <p className="px-6 py-8 text-center text-sm text-fg-muted">
        Could not load the retrospective.
      </p>
    )
  }

  const summary = retro.data.summary
  const itemsByCategory = (category: RetrospectiveItemCategory) =>
    retro.data.items.filter((i) => i.category === category)

  return (
    <div className="space-y-6 px-6 pb-10">
      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="text-sm font-semibold text-fg">Sprint retrospective</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Reflect on what went well, what hindered progress, and commit to a few action items for the
          next sprint. Add notes as a team — no meeting required.
        </p>
        {summary && (
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-fg-muted">Tasks done</p>
              <p className="text-sm font-semibold text-fg">
                {summary.completed_tasks}/{summary.total_tasks}
              </p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-fg-muted">Story points</p>
              <p className="text-sm font-semibold text-fg">
                {summary.completed_points}/{summary.total_points}
              </p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-fg-muted">Scope changes</p>
              <p className="text-sm font-semibold text-fg">{summary.scope_changes}</p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-fg-muted">Pace</p>
              <p className="text-sm font-semibold capitalize text-fg">{summary.pace.replace('_', ' ')}</p>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="mb-1 text-sm font-semibold text-fg">Set the stage</h3>
        <p className="mb-2 text-xs text-fg-muted">
          Optional facilitator note — keep discussion blameless and focused on improvement.
        </p>
        <textarea
          rows={2}
          className="input-dark resize-none"
          placeholder="e.g. We're here to improve how we work together…"
          value={stageNotes}
          onChange={(e) => setStageNotes(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button
            className="btn-secondary !py-1.5 text-xs"
            disabled={saveNotes.isPending || stageNotes === (retro.data.stage_notes ?? '')}
            onClick={() => saveNotes.mutate()}
          >
            Save notes
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {RETRO_COLUMNS.map((col) => (
          <section key={col.category} className="flex flex-col rounded-xl border border-ink-700 bg-ink-850 p-3">
            <h3 className="text-sm font-semibold text-fg">{col.title}</h3>
            <p className="mb-3 text-[11px] text-fg-muted">{col.subtitle}</p>

            <div className="mb-3 space-y-2">
              {itemsByCategory(col.category).map((item) => (
                <div key={item.id} className="rounded-lg border border-ink-700 bg-ink-900 p-2.5">
                  <div className="flex items-start gap-2">
                    {col.category === 'bud' && (
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-brand"
                        checked={item.is_done}
                        disabled={!canEditItem(item) || patchItem.isPending}
                        onChange={(e) =>
                          patchItem.mutate({ itemId: item.id, body: { is_done: e.target.checked } })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm text-fg',
                          item.is_done && col.category === 'bud' && 'text-fg-muted line-through',
                        )}
                      >
                        {item.body}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                        <span className="flex items-center gap-1">
                          <Avatar name={item.author?.full_name || '?'} src={item.author?.avatar_url} size={16} />
                          {item.author?.full_name || 'Someone'}
                        </span>
                        {item.assignee && (
                          <span className="flex items-center gap-1">
                            · Owner{' '}
                            <Avatar
                              name={item.assignee.full_name}
                              src={item.assignee.avatar_url}
                              size={16}
                            />
                            {item.assignee.full_name}
                          </span>
                        )}
                      </div>
                    </div>
                    {canEditItem(item) && (
                      <button
                        className="btn-ghost !p-1 text-fg-muted hover:text-red-400"
                        title="Delete"
                        disabled={deleteItem.isPending}
                        onClick={() => deleteItem.mutate(item.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {itemsByCategory(col.category).length === 0 && (
                <p className="py-2 text-center text-xs text-fg-muted">No items yet</p>
              )}
            </div>

            <div className="mt-auto space-y-2 border-t border-ink-700 pt-3">
              <textarea
                rows={2}
                className="input-dark resize-none text-sm"
                placeholder={col.placeholder}
                value={drafts[col.category]}
                onChange={(e) => setDrafts((d) => ({ ...d, [col.category]: e.target.value }))}
              />
              {col.category === 'bud' && (
                <select
                  className="input-dark text-xs"
                  value={budAssignee}
                  onChange={(e) => setBudAssignee(e.target.value)}
                >
                  <option value="">Owner (optional)</option>
                  {(members.data ?? []).map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.user?.full_name || m.user?.email || m.user_id}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn-primary w-full !py-1.5 text-xs"
                disabled={addItem.isPending || !drafts[col.category].trim()}
                onClick={() =>
                  addItem.mutate({
                    category: col.category,
                    body: drafts[col.category].trim(),
                    assignee_id: col.category === 'bud' && budAssignee ? budAssignee : undefined,
                  })
                }
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function CreateSprintModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const members = useWorkspaceMembers(workspace?.id)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [projectId, setProjectId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [scrumMasterId, setScrumMasterId] = useState('')
  const [creating, setCreating] = useState(false)

  const resetForm = useCallback(() => {
    setName('')
    setGoal('')
    setProjectId('')
    setStartDate('')
    setEndDate('')
    setScrumMasterId('')
  }, [])

  useResetFormWhenOpen(open, resetForm)

  const today = todayDateKey()
  const datesInvalid = !!startDate && !!endDate && endDate <= startDate
  const pastDate = (!!startDate && startDate < today) || (!!endDate && endDate < today)
  const endMin = minEndDateKey(startDate || today)

  const create = async () => {
    if (!workspace || !name.trim()) return
    setCreating(true)
    try {
      await api.post(`/workspaces/${workspace.id}/sprints`, {
        name: name.trim(),
        goal: goal.trim() || null,
        project_id: projectId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        scrum_master_id: scrumMasterId || null,
      })
      void queryClient.invalidateQueries({ queryKey: ['sprints', workspace.id] })
      toast.success('Sprint created')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create sprint" width="max-w-md">
      <div className="space-y-3">
        <input className="input-dark" placeholder="Sprint name (e.g. Sprint 2)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <textarea rows={2} className="input-dark resize-none" placeholder="Sprint goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <select className="input-dark" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects (workspace sprint)</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-fg-muted">Start</label>
            <DateInput value={startDate} onChange={setStartDate} min={today} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-fg-muted">End</label>
            <DateInput value={endDate} onChange={setEndDate} min={endMin} />
          </div>
        </div>
        {datesInvalid && <p className="text-xs text-red-400">End date must be after the start date.</p>}
        {pastDate && <p className="text-xs text-red-400">Sprint dates cannot be in the past.</p>}
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Scrum master (optional)</label>
          <select className="input-dark" value={scrumMasterId} onChange={(e) => setScrumMasterId(e.target.value)}>
            <option value="">No scrum master</option>
            {(members.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user?.full_name || m.user?.email}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-fg-muted">
            Any workspace member — they can edit, start and complete this sprint without needing admin rights.
          </p>
        </div>
        <button className="btn-primary w-full" disabled={creating || !name.trim() || datesInvalid || pastDate} onClick={create}>
          {creating ? 'Creating…' : 'Create sprint'}
        </button>
      </div>
    </Modal>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, CheckCircle2, Play, Plus, Target, Zap } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSprints, useStatuses } from '../../lib/queries'
import type { Page, Sprint, SprintBurndown, Standup, Task } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { KanbanBoard } from '../../components/tasks/KanbanBoard'
import { Avatar } from '../../components/ui/Avatar'
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
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1')

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
            <button className="btn-ghost !p-1.5" onClick={() => setCreateOpen(true)}>
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
                <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={14} /> New sprint
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      <CreateSprintModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function SprintDetail({ sprint, canManage }: { sprint: Sprint; canManage: boolean }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<'board' | 'backlog' | 'burndown' | 'standups'>('board')

  const tasks = useQuery({
    queryKey: ['sprint-tasks', sprint.id],
    queryFn: () => api.get<Task[]>(`/sprints/${sprint.id}/tasks`),
  })

  const isScrumMaster = sprint.scrum_master_id === user?.id
  const canRun = canManage || isScrumMaster

  const act = useMutation({
    mutationFn: (action: 'start' | 'complete') => api.post<Sprint>(`/sprints/${sprint.id}/${action}`),
    onSuccess: (_, action) => {
      toast.success(`Sprint ${action === 'start' ? 'started' : 'completed'}`)
      void queryClient.invalidateQueries({ queryKey: ['sprints'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const projectId = tasks.data?.[0]?.project_id ?? sprint.project_id ?? undefined
  const statuses = useStatuses(projectId ?? undefined)

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
          {canRun && sprint.status === 'planned' && (
            <button className="btn-primary !py-1.5 text-xs" onClick={() => act.mutate('start')} disabled={act.isPending}>
              <Play size={13} /> Start sprint
            </button>
          )}
          {canRun && sprint.status === 'active' && (
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => act.mutate('complete')} disabled={act.isPending}>
              <CheckCircle2 size={13} /> Complete sprint
            </button>
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
          {(['board', 'backlog', 'burndown', 'standups'] as const).map((t) => (
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
              tasks={tasks.data ?? []}
              statuses={statuses.data ?? []}
              canEdit={sprint.status !== 'completed'}
            />
          ) : (
            <EmptyState icon={Zap} title="No tasks in this sprint" description="Add tasks from the backlog tab." />
          ))}
        {tab === 'backlog' && <SprintBacklog sprint={sprint} sprintTasks={tasks.data ?? []} />}
        {tab === 'burndown' && <Burndown sprintId={sprint.id} />}
        {tab === 'standups' && <Standups sprintId={sprint.id} />}
      </div>
    </div>
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
          <select className="input-dark !w-auto !py-1 text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {available.map((task) => (
            <BacklogRow key={task.id} task={task} actionLabel="Add" onAction={() => toggle(task.id, true)} />
          ))}
          {available.length === 0 && (
            <p className="bg-ink-900 px-4 py-3 text-sm text-fg-muted">Backlog is empty.</p>
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
          <path d={actualPath} stroke="#8C5BFF" strokeWidth="2.5" fill="none" />
          {data.points.map((p, i) => (
            <circle key={p.day} cx={i * stepX} cy={y(p.remaining_points)} r="3" fill="#8C5BFF" />
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

function CreateSprintModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [projectId, setProjectId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [creating, setCreating] = useState(false)

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
      })
      void queryClient.invalidateQueries({ queryKey: ['sprints', workspace.id] })
      toast.success('Sprint created')
      setName('')
      setGoal('')
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
            <input type="date" className="input-dark" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-fg-muted">End</label>
            <input type="date" className="input-dark" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={creating || !name.trim()} onClick={create}>
          {creating ? 'Creating…' : 'Create sprint'}
        </button>
      </div>
    </Modal>
  )
}
